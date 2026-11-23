"""Comprehensive VIGILIA 3.2 External Antifraud Testing test suite."""

from __future__ import annotations

import json
from pathlib import Path
import sys
from unittest.mock import patch

from fastapi.testclient import TestClient
import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]
for p in (str(REPO_ROOT), str(BACKEND_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)

from app.database import Base, apply_safe_migrations, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import AntifraudEngine, DefenseConfiguration  # noqa: E402
from app.services.antifraud_connector import (  # noqa: E402
    ConnectorSecurityError,
    ConnectorUnavailableError,
    ExternalHttpConnector,
    match_and_normalize_predictions,
    parse_imported_predictions,
    sanitize_transactions_for_external,
    validate_allowed_engine_url,
)
from app.services.defense_engine import get_default_config_payload  # noqa: E402
from app.services.external_testing import seed_default_engines  # noqa: E402
from app.services.reports import _sanitize_csv_cell  # noqa: E402
from app.services.simulator import generate_synthetic_dataset  # noqa: E402
from external_antifraud_b.app import app as external_b_app  # noqa: E402


class _AsgiSyncTransport(httpx.BaseTransport):
    """Bridge synchronous httpx calls directly to an in-process FastAPI ASGI app."""

    def __init__(self, asgi_app):
        self._tc = TestClient(asgi_app)

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        path = request.url.raw_path.decode("ascii")
        headers = dict(request.headers)
        if request.method == "GET":
            r = self._tc.get(path, headers=headers)
        elif request.method == "POST":
            r = self._tc.post(path, content=request.content, headers=headers)
        else:
            r = self._tc.request(request.method, path, content=request.content, headers=headers)
        return httpx.Response(status_code=r.status_code, headers=r.headers, content=r.content)


@pytest.fixture
def client(tmp_path: Path):
    db_file = tmp_path / "test_vigilia_32.db"
    test_engine = create_engine(
        f"sqlite:///{db_file}", connect_args={"check_same_thread": False}, future=True
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine, future=True)
    Base.metadata.create_all(bind=test_engine)
    apply_safe_migrations(test_engine)

    db = TestingSessionLocal()
    db.add(DefenseConfiguration(**get_default_config_payload()))
    db.commit()
    seed_default_engines(db)
    db.close()

    def override_get_db():
        session = TestingSessionLocal()
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as tc:
        yield tc
    app.dependency_overrides.clear()
    test_engine.dispose()


def test_external_antifraud_b_standalone_service_and_profiles():
    ext_client = TestClient(external_b_app)

    r_health = ext_client.get("/health")
    assert r_health.status_code == 200
    assert r_health.json()["service"] == "External Antifraud B"
    assert r_health.json()["supports_config"] is True

    r_cfg = ext_client.get("/config")
    assert r_cfg.status_code == 200
    assert r_cfg.json()["active_profile"] == "baseline"
    assert "decision_threshold" in r_cfg.json()["parameters"]

    _, txs = generate_synthetic_dataset(transaction_count=120, customer_count=20, risk_ratio=0.1, seed=42)
    sanitized = sanitize_transactions_for_external(txs)
    for item in sanitized:
        assert "ground_truth_label" not in item
        assert "scenario_type" not in item
        assert "split_name" not in item

    r_base = ext_client.post("/analyze", json={"protocol_version": "1.0", "transactions": sanitized})
    assert r_base.status_code == 200
    base_body = r_base.json()
    assert len(base_body["results"]) == len(sanitized)
    assert base_body["engine_version"] == "B-1.0-baseline"

    # Evaluate safe alternative config_override WITHOUT mutating baseline preset
    r_override = ext_client.post(
        "/analyze",
        json={
            "protocol_version": "1.0",
            "config_override": {"decision_threshold": 52.0, "duplicate_window_min": 40},
            "transactions": sanitized,
        },
    )
    assert r_override.status_code == 200
    assert r_override.json()["engine_version"] == "B-1.0-baseline-custom"
    # Baseline active profile stays intact
    assert ext_client.get("/config").json()["active_profile"] == "baseline"


def test_security_allowlist_and_redirect_blocking():
    assert validate_allowed_engine_url("http://127.0.0.1:8010") == "http://127.0.0.1:8010"
    assert validate_allowed_engine_url("http://localhost:8011/") == "http://localhost:8011"

    for bad_url in (
        "https://evil.example.com:8010",
        "http://10.0.0.5:8010",
        "http://127.0.0.1:9999",
        "http://user:pass@127.0.0.1:8010",
        "ftp://127.0.0.1:8010",
    ):
        with pytest.raises(ConnectorSecurityError):
            validate_allowed_engine_url(bad_url)

    def redirect_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code=302, headers={"Location": "http://169.254.169.254/latest"})

    connector = ExternalHttpConnector(
        "http://127.0.0.1:8010",
        transport=httpx.MockTransport(redirect_handler),
    )
    health = connector.check_health()
    assert health["online"] is False
    assert "redirect" in health["error"].lower()

    with pytest.raises(ConnectorSecurityError):
        connector.analyze_transactions(
            [
                {
                    "id": 1,
                    "transaction_code": "TXN-1",
                    "customer_code": "CUST-1",
                    "recipient_code": "REC-1",
                    "amount_kzt": 10000.0,
                    "timestamp": "2026-11-20T10:00:00+00:00",
                    "split_name": "all",
                }
            ]
        )


def test_id_matching_missing_scores_and_incomplete_responses():
    _, txs = generate_synthetic_dataset(transaction_count=20, customer_count=5, risk_ratio=0.1, seed=7)
    slice_txs = txs[:4]
    # Reversed order, missing 1 ID, 1 duplicate, 1 unknown ID, omitted risk_score and reason_codes
    raw_results = [
        {"transaction_id": slice_txs[3].transaction_code, "predicted_label": 1},
        {"transaction_id": slice_txs[1].transaction_code, "predicted_label": 0, "risk_score": 0.25},
        {"transaction_id": slice_txs[1].transaction_code, "predicted_label": 1},  # duplicate
        {"transaction_id": "TXN-UNKNOWN", "predicted_label": 1},  # unexpected
        {"transaction_id": slice_txs[0].transaction_code, "predicted_label": 0},
    ]
    out = match_and_normalize_predictions(slice_txs, raw_results)
    comp = out["completeness"]
    assert comp["total_sent"] == 4
    assert comp["evaluated_count"] == 3
    assert comp["missing_count"] == 1
    assert comp["duplicate_count"] == 1
    assert comp["unexpected_count"] == 1
    assert slice_txs[2].transaction_code in comp["missing_ids_sample"]
    # Missing TXN must NOT be treated as negative prediction
    assert [p["transaction_code"] for p in out["predictions"]] == [
        slice_txs[0].transaction_code,
        slice_txs[1].transaction_code,
        slice_txs[3].transaction_code,
    ]
    assert out["predictions"][1]["risk_score"] == 25.0  # normalized from 0..1
    assert out["predictions"][0]["reason_codes"] == []  # never fabricated


def test_csv_formula_injection_protection_and_import_validation():
    assert _sanitize_csv_cell("=CMD|'/C calc'!A0") == "'=CMD|'/C calc'!A0"
    assert _sanitize_csv_cell("+SUM(A1:A2)") == "'+SUM(A1:A2)"
    assert _sanitize_csv_cell("@SUM(1,1)") == "'@SUM(1,1)"
    assert _sanitize_csv_cell("TXN-000001") == "TXN-000001"

    with pytest.raises(ValueError):
        parse_imported_predictions("json", "{not valid json")
    with pytest.raises(ValueError):
        parse_imported_predictions("xml", "<rows/>")


def test_external_api_whitebox_blackbox_import_and_engine_comparison(client: TestClient):
    # 1. Generate dataset (seed=42, 600 txs)
    r_ds = client.post(
        "/api/datasets/generate",
        json={
            "name": "External Lab 600",
            "transaction_count": 600,
            "customer_count": 60,
            "risk_ratio": 0.06,
            "seed": 42,
        },
    )
    assert r_ds.status_code == 201
    dataset_id = r_ds.json()["id"]

    # 2. Verify unavailable external service returns 503 cleanly
    def failing_connect(_self):
        raise httpx.ConnectError("Connection refused")

    transport = _AsgiSyncTransport(external_b_app)

    # Check engines list with live ASGI transport
    with patch("app.services.external_testing.ExternalHttpConnector.__init__", autospec=True) as mock_init:
        def init_with_transport(self, base_url, timeout_sec=8.0, transport=None):
            self.base_url = validate_allowed_engine_url(base_url)
            self.timeout_sec = timeout_sec
            self.transport = _AsgiSyncTransport(external_b_app)

        mock_init.side_effect = init_with_transport

        engines = client.get("/api/external/engines").json()
        by_code = {e["code"]: e for e in engines}
        assert by_code["internal_vigilia"]["online"] is True
        assert by_code["external_b"]["online"] is True
        assert by_code["external_b"]["supports_config"] is True
        assert by_code["external_b_blackbox"]["supports_config"] is False

        # 3. White-Box test of External Antifraud B
        r_ext = client.post(
            "/api/external/experiments",
            json={
                "engine_id": by_code["external_b"]["id"],
                "dataset_id": dataset_id,
                "split_name": "all",
                "profile": "baseline",
            },
        )
        assert r_ext.status_code == 201
        ext_exp = r_ext.json()
        assert ext_exp["adapter_type"] == "external_api"
        assert ext_exp["diagnostic_mode"] == "white_box"
        assert ext_exp["completeness_json"]["missing_count"] == 0

        # Intelligence works for external experiment + Risk Score Distribution & Metadata
        r_intel = client.get(f"/api/intelligence/{ext_exp['id']}")
        assert r_intel.status_code == 200
        intel_body = r_intel.json()
        assert intel_body["adapter_type"] == "external_api"
        assert intel_body["risk_score_distribution"]["available"] is True
        assert len(intel_body["risk_score_distribution"]["buckets"]) == 10
        assert intel_body["experiment_metadata"]["dataset_id"] == dataset_id
        assert intel_body["experiment_metadata"]["seed"] == 42

        # Paginated Transaction Inspector endpoint with outcome filtering
        r_insp_page = client.get(
            f"/api/intelligence/{ext_exp['id']}/transactions?page=1&page_size=10&outcome=fn"
        )
        assert r_insp_page.status_code == 200
        insp_data = r_insp_page.json()
        assert insp_data["has_risk_scores"] is True
        assert all(it["outcome"] == "FN" for it in insp_data["items"])

        # 4. External Evolution Mode 1 (Configurable White-Box) — 1-shot & 2-step + diff (VIGILIA 3.4)
        r_evo = client.post("/api/external/evolution", json={"experiment_id": ext_exp["id"]})
        assert r_evo.status_code == 201
        ext_evo = r_evo.json()
        assert ext_evo["mode"] == "configurable_white_box"
        assert ext_evo["status"] == "completed"
        assert len(ext_evo["candidates_json"]) == 3
        assert "evaluation_split" in ext_evo["comparison_json"]
        assert "scenario_comparison" in ext_evo["comparison_json"]
        assert "scenario_audit" in ext_evo["comparison_json"]
        assert ext_evo["comparison_json"]["scenario_audit"]["categories_disjoint"] is True
        assert ext_evo["comparison_json"]["scenario_audit"]["totals_match_overall"] is True
        scen_rows = ext_evo["comparison_json"]["scenario_comparison"]
        assert len(scen_rows) > 0
        ev_split = ext_evo["comparison_json"]["evaluation_split"]
        assert sum(r["baseline_fn"] for r in scen_rows) == ev_split["baseline"]["false_negatives"]
        assert sum(r["candidate_fn"] for r in scen_rows) == ev_split["candidate"]["false_negatives"]
        assert sum(r["baseline_fp"] for r in scen_rows) == ev_split["baseline"]["false_positives"]
        assert sum(r["candidate_fp"] for r in scen_rows) == ev_split["candidate"]["false_positives"]
        pdetails = ext_evo["comparison_json"].get("param_details", [])
        assert len(pdetails) > 1
        assert len({p["purpose"] for p in pdetails}) == len(pdetails)

        r_ext_diff = client.get(f"/api/external/evolution/{ext_evo['id']}/diff")
        assert r_ext_diff.status_code == 200
        ext_diff = r_ext_diff.json()
        assert ext_diff["split_name"] == "evaluation"
        assert ext_diff["summary"]["matched_transactions"] > 0

        # 4b. VIGILIA 3.4 2-step external evolution: analyze -> validate
        r_ext_an = client.post("/api/external/evolution/analyze", json={"experiment_id": ext_exp["id"]})
        assert r_ext_an.status_code == 201
        ext_an = r_ext_an.json()
        assert ext_an["status"] == "analyzed"
        assert ext_an["verdict"] == "pending_validation"

        r_ext_val = client.post(
            "/api/external/evolution/validate",
            json={"evolution_run_id": ext_an["id"]},
        )
        assert r_ext_val.status_code == 200
        ext_val = r_ext_val.json()
        assert ext_val["status"] == "completed"
        assert "final_baseline_experiment_id" in ext_val["comparison_json"]
        assert "final_candidate_experiment_id" in ext_val["comparison_json"]

        r_ext_diff_2 = client.get(f"/api/external/evolution/{ext_val['id']}/diff")
        assert r_ext_diff_2.status_code == 200
        assert r_ext_diff_2.json()["summary"]["matched_transactions"] > 0

        # 5. External Evolution Mode 2 (Black-Box) + Retest on updated profile
        r_bb = client.post(
            "/api/external/experiments",
            json={
                "engine_id": by_code["external_b_blackbox"]["id"],
                "dataset_id": dataset_id,
                "split_name": "evaluation",
                "profile": "baseline",
            },
        )
        assert r_bb.status_code == 201
        bb_exp = r_bb.json()
        assert bb_exp["diagnostic_mode"] == "black_box"

        r_bb_evo = client.post("/api/external/evolution", json={"experiment_id": bb_exp["id"]})
        assert r_bb_evo.status_code == 201
        bb_evo = r_bb_evo.json()
        assert bb_evo["mode"] == "black_box_manual"
        assert bb_evo["status"] == "awaiting_retest"

        r_bb_retest = client.post(
            "/api/external/evolution/retest",
            json={"evolution_run_id": bb_evo["id"], "profile": "updated"},
        )
        assert r_bb_retest.status_code == 200
        bb_done = r_bb_retest.json()
        assert bb_done["status"] == "completed"
        assert "evaluation_split" in bb_done["comparison_json"]

        # 6. Compare Internal VIGILIA vs External Antifraud B on same dataset & split
        r_cmp = client.post(
            "/api/external/compare",
            json={
                "dataset_id": dataset_id,
                "split_name": "evaluation",
                "left_engine_id": by_code["internal_vigilia"]["id"],
                "right_engine_id": by_code["external_b"]["id"],
            },
        )
        assert r_cmp.status_code == 201
        cmp_data = r_cmp.json()
        assert cmp_data["comparison_json"]["left"]["engine_name"] == "VIGILIA Internal Defense"
        assert cmp_data["comparison_json"]["right"]["engine_name"] == "External Antifraud B"

    # 7. CSV/JSON Import + Black-Box retest via CSV upload
    ds_detail = client.get(f"/api/datasets/{dataset_id}?page=1&page_size=200").json()
    tx_items = ds_detail["transactions"]
    csv_lines = ["transaction_id,predicted_label,risk_score,reason_codes"]
    for tx in tx_items:
        # Simple deterministic external offline heuristic (only from amount/is_new_recipient)
        pred = 1 if (tx["amount_kzt"] >= 900_000 or (tx["is_new_recipient"] and tx["amount_kzt"] >= 350_000)) else 0
        csv_lines.append(f"{tx['transaction_code']},{pred},{'75' if pred else '15'},{'RULE_AMOUNT' if pred else ''}")
    csv_payload = "\n".join(csv_lines)

    r_imp = client.post(
        "/api/external/import",
        json={
            "dataset_id": dataset_id,
            "version_label": "OfflineCSV v1",
            "file_format": "csv",
            "content": csv_payload,
            "split_name": "all",
        },
    )
    assert r_imp.status_code == 201
    imp_exp = r_imp.json()
    assert imp_exp["adapter_type"] == "imported"
    assert imp_exp["diagnostic_mode"] == "black_box"

    # 7b. Import WITHOUT risk_score -> risk_score_distribution.available must be False
    no_score_csv = "\n".join(
        ["transaction_id,predicted_label"]
        + [f"{tx['transaction_code']},{1 if tx['amount_kzt'] >= 900_000 else 0}" for tx in tx_items[:40]]
    )
    r_imp_noscore = client.post(
        "/api/external/import",
        json={
            "dataset_id": dataset_id,
            "version_label": "NoScore v1",
            "file_format": "csv",
            "content": no_score_csv,
            "split_name": "all",
        },
    )
    assert r_imp_noscore.status_code == 201
    noscore_id = r_imp_noscore.json()["id"]
    r_intel_ns = client.get(f"/api/intelligence/{noscore_id}")
    assert r_intel_ns.status_code == 200
    assert r_intel_ns.json()["risk_score_distribution"]["available"] is False
    r_insp_ns = client.get(f"/api/intelligence/{noscore_id}/transactions?page=1&page_size=5")
    assert r_insp_ns.status_code == 200
    assert r_insp_ns.json()["has_risk_scores"] is False
    assert all(it["risk_score"] is None for it in r_insp_ns.json()["items"])

    # 8. Unreachable external service returns 503 cleanly
    with patch("app.services.external_testing.ExternalHttpConnector.analyze_transactions") as mock_analyze:
        mock_analyze.side_effect = ConnectorUnavailableError("Connection refused")
        engines_now = {e["code"]: e for e in client.get("/api/external/engines").json()}
        r_fail = client.post(
            "/api/external/experiments",
            json={
                "engine_id": engines_now["external_b"]["id"],
                "dataset_id": dataset_id,
                "split_name": "all",
            },
        )
        assert r_fail.status_code == 503

    # 9. Internal VIGILIA Evolution Diff endpoint + scenario_comparison fields (VIGILIA 3.4)
    cfgs = client.get("/api/defense/configurations").json()
    baseline_cfg_id = next((c["id"] for c in cfgs if c.get("is_baseline")), cfgs[0]["id"])
    r_int_exp = client.post(
        "/api/experiments",
        json={
            "dataset_id": dataset_id,
            "defense_config_id": baseline_cfg_id,
            "split_name": "evaluation",
            "name": "V34 Internal Base",
        },
    )
    assert r_int_exp.status_code == 201
    int_exp_id = r_int_exp.json()["id"]

    r_int_an = client.post("/api/evolution/analyze", json={"experiment_id": int_exp_id})
    assert r_int_an.status_code == 201
    int_run_id = r_int_an.json()["id"]

    r_int_val = client.post("/api/evolution/validate", json={"evolution_run_id": int_run_id})
    assert r_int_val.status_code == 200
    int_val = r_int_val.json()
    assert int_val["status"] == "completed"
    int_scen = int_val["comparison_json"]["scenario_comparison"]
    assert len(int_scen) > 0
    assert int_val["comparison_json"]["scenario_audit"]["totals_match_overall"] is True
    int_ev = int_val["comparison_json"]["evaluation_split"]
    assert sum(r["baseline_fn"] for r in int_scen) == int_ev["baseline"]["false_negatives"]
    assert sum(r["candidate_fn"] for r in int_scen) == int_ev["candidate"]["false_negatives"]
    assert sum(r["baseline_fp"] for r in int_scen) == int_ev["baseline"]["false_positives"]
    assert sum(r["candidate_fp"] for r in int_scen) == int_ev["candidate"]["false_positives"]

    r_int_diff = client.get(f"/api/evolution/runs/{int_run_id}/diff")
    assert r_int_diff.status_code == 200
    int_diff = r_int_diff.json()
    assert int_diff["split_name"] == "evaluation"
    assert int_diff["summary"]["matched_transactions"] > 0
    assert isinstance(int_diff["fixed_misses"], list)
    assert isinstance(int_diff["new_false_positives"], list)
    assert isinstance(int_diff["new_misses"], list)


def test_scenario_fn_fp_consistency_and_regression_example(client: TestClient):
    """Regression test matching exact user example: per-scenario FN/FP & sum consistency."""
    r_ds = client.post(
        "/api/datasets/generate",
        json={
            "name": "Regression FN FP 600",
            "transaction_count": 600,
            "customer_count": 60,
            "risk_ratio": 0.06,
            "seed": 42,
        },
    )
    assert r_ds.status_code == 201
    dataset_id = r_ds.json()["id"]

    # Fetch evaluation split ground truth rows via datasets detail (use all pages <= 200 each)
    eval_txs = []
    for p in range(1, 5):
        page_res = client.get(f"/api/datasets/{dataset_id}?page={p}&page_size=200").json()
        eval_txs.extend([t for t in page_res["transactions"] if t["split_name"] == "evaluation"])
        if len(page_res["transactions"]) < 200:
            break

    # Pick deterministic subset matching exact scenario counts if available or test exact formula
    by_scen_risk = {}
    legit_rows = []
    for t in eval_txs:
        if t["ground_truth_label"] == 1:
            by_scen_risk.setdefault(t["scenario_type"], []).append(t)
        else:
            legit_rows.append(t)

    # Construct baseline & candidate CSV predictions where:
    # - baseline misses all risks except up to 2 in duplicate_payment (FN 3/5 if 5)
    # - candidate catches 2 more in duplicate_payment, 1 in new_recipient_risk, and causes 1 new FP in legit_rows
    base_lines = ["transaction_id,predicted_label,risk_score"]
    cand_lines = ["transaction_id,predicted_label,risk_score"]
    expected_b_fn = {}
    expected_c_fn = {}
    for st, items in by_scen_risk.items():
        expected_b_fn[st] = 0
        expected_c_fn[st] = 0
        for idx, t in enumerate(items):
            if st == "duplicate_payment" and idx < 2:
                b_pred, c_pred = 1, 1
            elif st == "duplicate_payment" and idx < 4:
                b_pred, c_pred = 0, 1
            elif st == "new_recipient_risk" and idx == 0:
                b_pred, c_pred = 0, 1
            else:
                b_pred, c_pred = 0, 0
            if b_pred == 0:
                expected_b_fn[st] += 1
            if c_pred == 0:
                expected_c_fn[st] += 1
            base_lines.append(f"{t['transaction_code']},{b_pred},{80 if b_pred else 20}")
            cand_lines.append(f"{t['transaction_code']},{c_pred},{80 if c_pred else 20}")

    for idx, t in enumerate(legit_rows):
        b_pred = 0
        c_pred = 1 if idx == 0 else 0  # Exactly 1 new FP
        base_lines.append(f"{t['transaction_code']},{b_pred},15")
        cand_lines.append(f"{t['transaction_code']},{c_pred},{65 if c_pred else 15}")

    r_b = client.post(
        "/api/external/import",
        json={"dataset_id": dataset_id, "version_label": "RegBase", "file_format": "csv", "content": "\n".join(base_lines), "split_name": "evaluation"},
    )
    assert r_b.status_code == 201

    r_bb_evo = client.post("/api/external/evolution", json={"experiment_id": r_b.json()["id"]})
    assert r_bb_evo.status_code == 201
    r_ret = client.post(
        "/api/external/evolution/retest",
        json={
            "evolution_run_id": r_bb_evo.json()["id"],
            "file_format": "csv",
            "content": "\n".join(cand_lines),
            "version_label": "RegCand",
        },
    )
    assert r_ret.status_code == 200
    cmp_json = r_ret.json()["comparison_json"]
    audit = cmp_json["scenario_audit"]
    assert audit["categories_disjoint"] is True
    assert audit["totals_match_overall"] is True
    by_s = {x["scenario_type"]: x for x in cmp_json["scenario_comparison"]}
    for st in expected_b_fn:
        assert by_s[st]["baseline_fn"] == expected_b_fn[st]
        assert by_s[st]["candidate_fn"] == expected_c_fn[st]
    fp_legit_scen = legit_rows[0]["scenario_type"]
    assert by_s[fp_legit_scen]["baseline_fp"] == 0
    assert by_s[fp_legit_scen]["candidate_fp"] == 1
    assert sum(x["candidate_fp"] for x in cmp_json["scenario_comparison"]) == 1
    assert sum(x["baseline_fn"] for x in cmp_json["scenario_comparison"]) == audit["overall"]["baseline_fn"]
    assert sum(x["candidate_fn"] for x in cmp_json["scenario_comparison"]) == audit["overall"]["candidate_fn"]


def test_blackbox_vs_whitebox_strict_separation(client: TestClient):
    with patch("app.services.external_testing.ExternalHttpConnector.__init__", autospec=True) as mock_init:
        def init_with_transport(self, base_url, timeout_sec=8.0, transport=None):
            self.base_url = validate_allowed_engine_url(base_url)
            self.timeout_sec = timeout_sec
            self.transport = _AsgiSyncTransport(external_b_app)

        mock_init.side_effect = init_with_transport

        r_ds = client.post(
            "/api/datasets/generate",
            json={"name": "BB WB Separation 1K", "transaction_count": 900, "customer_count": 90, "risk_ratio": 0.08, "seed": 2026},
        )
        assert r_ds.status_code == 201
        dataset_id = r_ds.json()["id"]

        engines = client.get("/api/external/engines").json()
        by_code = {e["code"]: e for e in engines}

        # Black-Box run on external_b_blackbox -> threshold + Allow/Review/Block routing ONLY (no internal rule edits)
        r_bb = client.post(
            "/api/external/experiments",
            json={
                "engine_id": by_code["external_b_blackbox"]["id"],
                "dataset_id": dataset_id,
                "split_name": "evaluation",
                "profile": "baseline",
            },
        )
        assert r_bb.status_code == 201
        bb_exp = r_bb.json()
        r_bb_evo = client.post("/api/external/evolution", json={"experiment_id": bb_exp["id"]})
        assert r_bb_evo.status_code == 201
        bb_evo = r_bb_evo.json()
        assert bb_evo["mode"] == "black_box_manual"
        bb_policy = bb_evo["comparison_json"]["black_box_policy"]
        assert bb_policy["internal_rules_modified"] is False
        assert bb_policy["scope"] == "external_threshold_and_routing_only"
        assert bb_policy["has_risk_scores"] is True
        assert set(bb_evo["proposed_config_json"].keys()).issubset({"block_threshold", "review_threshold"})

        # Validate Black-Box score cutoff + routing candidate directly without touching internal vendor rules
        r_bb_val = client.post(
            "/api/external/evolution/validate",
            json={"evolution_run_id": bb_evo["id"], "candidate_key": "T2"},
        )
        assert r_bb_val.status_code == 200
        bb_done = r_bb_val.json()
        assert bb_done["status"] == "completed"
        assert bb_done["comparison_json"]["black_box_policy"]["internal_rules_modified"] is False
        assert bb_done["comparison_json"]["black_box_policy"]["routing_counts"]["total"] > 0
        assert bb_done["comparison_json"]["adversarial_shift"]["status"] == "evaluated"

        # White-Box run on external_b -> modifies internal parameters & evaluates adversarial shift
        r_wb = client.post(
            "/api/external/experiments",
            json={
                "engine_id": by_code["external_b"]["id"],
                "dataset_id": dataset_id,
                "split_name": "evaluation",
                "profile": "baseline",
            },
        )
        assert r_wb.status_code == 201
        r_wb_an = client.post("/api/external/evolution", json={"experiment_id": r_wb.json()["id"]})
        assert r_wb_an.status_code == 201
        r_wb_val = client.post(
            "/api/external/evolution/validate",
            json={"evolution_run_id": r_wb_an.json()["id"]},
        )
        assert r_wb_val.status_code == 200
        wb_done = r_wb_val.json()
        assert wb_done["comparison_json"]["white_box_policy"]["internal_rules_modified"] is True
        assert wb_done["comparison_json"]["adversarial_shift"]["status"] == "evaluated"
