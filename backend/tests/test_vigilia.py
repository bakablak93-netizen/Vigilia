"""Comprehensive VIGILIA 2.0 unit, statistical, guardrail, and API integration test suite."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import tempfile

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.database import Base, apply_safe_migrations, configure_sqlite_engine, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models import DefenseConfiguration  # noqa: E402
from app.services.defense_engine import (  # noqa: E402
    DEFAULT_RULES_CONFIG,
    DefenseEngine,
    get_default_config_payload,
)
from app.services.defense_evolution import apply_adversarial_shift, evaluate_evolution_verdict  # noqa: E402
from app.services.evaluation_engine import compute_binary_metrics, evaluate_predictions  # noqa: E402
from app.services.simulator import (  # noqa: E402
    generate_synthetic_dataset,
    verify_dataset_quality,
)


# ---------------------------------------------------------------------------
# 1. Virtual Bank Simulator 2.0 & Scenario Quality Checks
# ---------------------------------------------------------------------------

def test_simulator_generates_valid_stratified_transactions():
    customers, txs = generate_synthetic_dataset(
        transaction_count=1000,
        customer_count=100,
        risk_ratio=0.05,
        seed=42,
    )
    assert len(customers) == 100
    assert len(txs) == 1000

    quality = verify_dataset_quality(customers, txs, expected_risk_ratio=0.05)
    assert quality["valid"] is True
    assert quality["is_chronological"] is True
    assert quality["unique_codes"] is True
    assert quality["no_trivial_leakage"] is True
    assert len(quality["customer_types"]) >= 3  # individual, small_business, medium_business
    assert 40 <= quality["actual_risk_count"] <= 60

    # Verify stratified splitting: unusual_amount has risk events in calibration, validation, AND evaluation
    ua_eval_risk = [
        t for t in txs if t.scenario_type == "unusual_amount" and t.split_name == "evaluation" and t.ground_truth_label == 1
    ]
    ua_val_risk = [
        t for t in txs if t.scenario_type == "unusual_amount" and t.split_name == "validation" and t.ground_truth_label == 1
    ]
    assert len(ua_eval_risk) >= 3
    assert len(ua_val_risk) >= 3


def test_simulator_seed_reproducibility():
    c1, t1 = generate_synthetic_dataset(transaction_count=300, customer_count=40, risk_ratio=0.08, seed=12345)
    c2, t2 = generate_synthetic_dataset(transaction_count=300, customer_count=40, risk_ratio=0.08, seed=12345)
    c3, t3 = generate_synthetic_dataset(transaction_count=300, customer_count=40, risk_ratio=0.08, seed=99999)

    assert [c.customer_code for c in c1] == [c.customer_code for c in c2]
    assert [(t.transaction_code, t.amount_kzt, t.ground_truth_label, t.scenario_type, t.split_name) for t in t1] == [
        (t.transaction_code, t.amount_kzt, t.ground_truth_label, t.scenario_type, t.split_name) for t in t2
    ]
    assert [(t.amount_kzt, t.customer_code) for t in t1] != [(t.amount_kzt, t.customer_code) for t in t3]


def test_simulator_non_normal_scenarios_include_legitimate_cases():
    _, txs = generate_synthetic_dataset(transaction_count=1200, customer_count=120, risk_ratio=0.10, seed=77)
    for scen in (
        "unusual_amount",
        "new_recipient_risk",
        "duplicate_payment",
        "suspicious_sequence",
        "structuring_smurfing",
        "account_takeover_ato",
    ):
        scen_txs = [t for t in txs if t.scenario_type == scen]
        assert len(scen_txs) > 0
        assert any(t.ground_truth_label == 0 for t in scen_txs), f"{scen} must include legitimate examples"
        assert any(t.ground_truth_label == 1 for t in scen_txs), f"{scen} must include risk examples"
        splits_with_risk = {t.split_name for t in scen_txs if t.ground_truth_label == 1}
        assert {"calibration", "validation", "evaluation"}.issubset(splits_with_risk), f"{scen} must span all 3 splits"


# ---------------------------------------------------------------------------
# 2. Defense Engine 2.0, Anti-Leakage Assertion & Rule Toggling
# ---------------------------------------------------------------------------

def test_defense_engine_rejects_label_leakage():
    engine = DefenseEngine(DEFAULT_RULES_CONFIG, decision_threshold=55.0)
    leaked_tx = [
        {
            "id": 1,
            "transaction_code": "TXN-000001",
            "customer_code": "CUS-0001",
            "recipient_code": "REC-001",
            "amount_kzt": 50_000.0,
            "timestamp": datetime(2026, 11, 5, 10, 0, tzinfo=timezone.utc),
            "transaction_type": "p2p_transfer",
            "channel": "mobile_app",
            "is_new_recipient": False,
            "customer_segment": "retail_standard",
            "transaction_frequency": 1.0,
            "split_name": "evaluation",
            "ground_truth_label": 1,
        }
    ]
    with pytest.raises(ValueError, match="Security violation"):
        engine.evaluate_transactions(leaked_tx, {})


def test_defense_engine_risk_score_and_rule_toggling():
    base_ts = datetime(2026, 11, 5, 2, 15, 0, tzinfo=timezone.utc)
    customers = {
        "CUS-0001": {
            "customer_type": "individual",
            "account_age_days": 60,
            "typical_amount_max_kzt": 50_000.0,
            "avg_amount_kzt": 20_000.0,
            "std_amount_kzt": 8_000.0,
        }
    }
    txs = [
        {
            "id": 1,
            "transaction_code": "TXN-000001",
            "customer_code": "CUS-0001",
            "recipient_code": "REC-EXT-001",
            "amount_kzt": 320_000.0,
            "timestamp": base_ts,
            "transaction_type": "p2p_transfer",
            "channel": "mobile_app",
            "is_new_recipient": True,
            "customer_segment": "retail_standard",
            "transaction_frequency": 1.0,
            "split_name": "evaluation",
        },
        {
            "id": 2,
            "transaction_code": "TXN-000002",
            "customer_code": "CUS-0001",
            "recipient_code": "REC-EXT-001",
            "amount_kzt": 320_000.0,
            "timestamp": base_ts + timedelta(minutes=3),
            "transaction_type": "p2p_transfer",
            "channel": "mobile_app",
            "is_new_recipient": True,
            "customer_segment": "retail_standard",
            "transaction_frequency": 2.0,
            "split_name": "evaluation",
        },
    ]

    engine_enabled = DefenseEngine(DEFAULT_RULES_CONFIG, decision_threshold=55.0)
    preds_on = engine_enabled.evaluate_transactions(txs, customers)
    assert 0.0 <= preds_on[0]["risk_score"] <= 100.0
    assert 0.0 <= preds_on[1]["risk_score"] <= 100.0
    assert preds_on[1]["predicted_label"] == 1

    disabled_rules = {k: {**v, "enabled": False} for k, v in DEFAULT_RULES_CONFIG.items()}
    engine_disabled = DefenseEngine(disabled_rules, decision_threshold=55.0)
    preds_off = engine_disabled.evaluate_transactions(txs, customers)
    assert all(p["risk_score"] == 0.0 and p["predicted_label"] == 0 for p in preds_off)


# ---------------------------------------------------------------------------
# 3. Evaluation Engine Metrics & Edge Cases
# ---------------------------------------------------------------------------

def test_evaluation_metrics_and_edge_cases():
    records = [
        {"predicted_label": 1, "ground_truth_label": 1, "risk_score": 80, "risk_level": "critical"},
        {"predicted_label": 1, "ground_truth_label": 0, "risk_score": 60, "risk_level": "high"},
        {"predicted_label": 0, "ground_truth_label": 1, "risk_score": 40, "risk_level": "medium"},
        {"predicted_label": 0, "ground_truth_label": 0, "risk_score": 10, "risk_level": "low"},
    ]
    res = compute_binary_metrics(records)
    assert res["confusion_matrix"] == {"tp": 1, "fp": 1, "tn": 1, "fn": 1}
    assert res["metrics"]["precision"] == 0.5
    assert res["metrics"]["recall"] == 0.5
    assert res["metrics"]["f1_score"] == 0.5

    empty_res = compute_binary_metrics([])
    assert empty_res["metrics"]["total_transactions"] == 0
    assert empty_res["metrics"]["precision"] == 0.0
    assert empty_res["metrics"]["recall"] == 0.0


# ---------------------------------------------------------------------------
# 4. All 9 Defense Evolution 2.0 Guardrail & Verdict Cases (Section 12)
# ---------------------------------------------------------------------------

def _mk_cmp(base: dict, cand: dict) -> dict:
    keys = [
        "recall",
        "precision",
        "f1_score",
        "false_positive_rate",
        "false_negative_rate",
        "accuracy",
        "true_positives",
        "false_positives",
        "false_negatives",
        "true_negatives",
    ]
    return {
        "baseline": base,
        "candidate": cand,
        "delta": {k: round(float(cand.get(k, 0)) - float(base.get(k, 0)), 4) for k in keys},
    }


def test_defense_evolution_all_nine_verdict_cases():
    base_std = {
        "total_transactions": 400,
        "actual_risk_events": 20,
        "predicted_risk_events": 8,
        "true_positives": 8,
        "false_positives": 0,
        "true_negatives": 380,
        "false_negatives": 12,
        "precision": 1.0,
        "recall": 0.40,
        "f1_score": 0.5714,
        "false_positive_rate": 0.0,
        "false_negative_rate": 0.60,
        "accuracy": 0.97,
    }

    # Case 1: Candidate genuinely improved
    cand_improved = {
        **base_std,
        "predicted_risk_events": 16,
        "true_positives": 15,
        "false_positives": 1,
        "true_negatives": 379,
        "false_negatives": 5,
        "precision": 0.9375,
        "recall": 0.75,
        "f1_score": 0.8333,
        "false_positive_rate": 0.0026,
    }
    cmp1 = _mk_cmp(base_std, cand_improved)
    v1, _, _ = evaluate_evolution_verdict(cmp1, cmp1)
    assert v1 == "improved"

    # Case 2: Candidate improved Recall, but severely degraded FPR (above guardrail max_fpr=0.025)
    cand_high_fpr = {
        **base_std,
        "predicted_risk_events": 42,
        "true_positives": 16,
        "false_positives": 26,
        "true_negatives": 354,
        "false_negatives": 4,
        "precision": 0.381,
        "recall": 0.80,
        "f1_score": 0.5161,
        "false_positive_rate": 0.0684,
    }
    cmp2 = _mk_cmp(base_std, cand_high_fpr)
    v2, _, _ = evaluate_evolution_verdict(cmp2, cmp2)
    assert v2 == "rejected_regression"

    # Case 2b: Candidate improved Recall, with moderate FPR/Precision trade-off -> mixed
    cand_mixed = {
        **base_std,
        "predicted_risk_events": 21,
        "true_positives": 12,
        "false_positives": 5,
        "true_negatives": 375,
        "false_negatives": 8,
        "precision": 0.7059,
        "recall": 0.60,
        "f1_score": 0.6486,
        "false_positive_rate": 0.0132,
    }
    cmp2b = _mk_cmp(base_std, cand_mixed)
    v2b, _, _ = evaluate_evolution_verdict(cmp2b, cmp2b)
    assert v2b == "mixed"

    # Case 3: Candidate gave no noticeable effect
    cand_flat = {**base_std}
    cmp3 = _mk_cmp(base_std, cand_flat)
    v3, _, _ = evaluate_evolution_verdict(cmp3, cmp3)
    assert v3 == "no_significant_improvement"

    # Case 4: Candidate degraded F1
    cand_worse_f1 = {
        **base_std,
        "predicted_risk_events": 6,
        "true_positives": 5,
        "false_positives": 1,
        "false_negatives": 15,
        "precision": 0.8333,
        "recall": 0.25,
        "f1_score": 0.3846,
        "false_positive_rate": 0.0026,
    }
    cmp4 = _mk_cmp(base_std, cand_worse_f1)
    v4, _, _ = evaluate_evolution_verdict(cmp4, cmp4)
    assert v4 == "rejected_regression"

    # Case 5: Insufficient data for reliable conclusion (< 30 tx or < 4 risk events)
    tiny_base = {**base_std, "total_transactions": 18, "actual_risk_events": 2}
    cmp5 = _mk_cmp(tiny_base, tiny_base)
    v5, _, _ = evaluate_evolution_verdict(cmp5, cmp5)
    assert v5 == "insufficient_evidence"

    # Case 6: All positive operations missed (Recall = 0)
    cand_all_missed = {
        **base_std,
        "predicted_risk_events": 0,
        "true_positives": 0,
        "false_negatives": 20,
        "precision": 0.0,
        "recall": 0.0,
        "f1_score": 0.0,
    }
    cmp6 = _mk_cmp(base_std, cand_all_missed)
    v6, _, _ = evaluate_evolution_verdict(cmp6, cmp6)
    assert v6 == "rejected_regression"

    # Case 7: No positive operations in dataset (actual_risk_events = 0)
    no_pos_m = {**base_std, "actual_risk_events": 0, "true_positives": 0, "false_negatives": 0}
    cmp7 = _mk_cmp(no_pos_m, no_pos_m)
    v7, _, _ = evaluate_evolution_verdict(cmp7, cmp7)
    assert v7 == "insufficient_evidence"

    # Case 8: Zero false positives (fp = 0) with strong recall gain
    cand_zero_fp = {
        **base_std,
        "predicted_risk_events": 15,
        "true_positives": 15,
        "false_positives": 0,
        "false_negatives": 5,
        "precision": 1.0,
        "recall": 0.75,
        "f1_score": 0.8571,
        "false_positive_rate": 0.0,
    }
    cmp8 = _mk_cmp(base_std, cand_zero_fp)
    v8, _, _ = evaluate_evolution_verdict(cmp8, cmp8)
    assert v8 == "improved"

    # Case 9: All operations classified identically (100% flagged as risky)
    cand_all_ones = {
        **base_std,
        "predicted_risk_events": 400,
        "true_positives": 20,
        "false_positives": 380,
        "true_negatives": 0,
        "false_negatives": 0,
        "precision": 0.05,
        "recall": 1.0,
        "f1_score": 0.0952,
        "false_positive_rate": 1.0,
    }
    cmp9 = _mk_cmp(base_std, cand_all_ones)
    v9, _, _ = evaluate_evolution_verdict(cmp9, cmp9)
    assert v9 == "rejected_regression"


# ---------------------------------------------------------------------------
# 5. End-to-End API: Stress Test, Defense Evolution 2.0, Multi-Seed Benchmark,
#    Security Intelligence, Demo Mode & Printable Reports
# ---------------------------------------------------------------------------

@pytest.fixture
def client(tmp_path: Path):
    db_file = tmp_path / "test_vigilia_v2.db"
    test_engine = create_engine(
        f"sqlite:///{db_file}", connect_args={"check_same_thread": False}, future=True
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine, future=True)
    Base.metadata.create_all(bind=test_engine)
    apply_safe_migrations(test_engine)

    db = TestingSessionLocal()
    db.add(DefenseConfiguration(**get_default_config_payload()))
    db.commit()
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


def test_full_api_v2_workflow_benchmark_intelligence_and_demo(client: TestClient):
    # 1. Health & scenarios
    r_health = client.get("/api/health")
    assert r_health.status_code == 200
    assert r_health.json()["status"] == "ok"

    # 2. Generate 1,000 transactions (seed=42)
    r_ds = client.post(
        "/api/datasets/generate",
        json={
            "name": "User Dataset 1K",
            "transaction_count": 1000,
            "customer_count": 100,
            "risk_ratio": 0.05,
            "seed": 42,
        },
    )
    assert r_ds.status_code == 201
    dataset = r_ds.json()
    assert dataset["transaction_count"] == 1000

    baseline_cfg = client.get("/api/defense/configurations").json()[0]

    # 3. Run baseline experiment
    r_exp = client.post(
        "/api/experiments",
        json={
            "name": "Baseline Stress Test",
            "dataset_id": dataset["id"],
            "defense_config_id": baseline_cfg["id"],
            "split_name": "all",
        },
    )
    assert r_exp.status_code == 201
    exp = r_exp.json()

    # 4. Defense Evolution 2.0: Analyze & generate Candidates A, B, C, D
    r_evo_analyze = client.post(
        "/api/evolution/analyze",
        json={"experiment_id": exp["id"]},
    )
    assert r_evo_analyze.status_code == 201
    evo = r_evo_analyze.json()
    assert len(evo["candidates_json"]) == 4
    assert {c["key"] for c in evo["candidates_json"]} == {"A", "B", "C", "D"}
    # Verify single-rule ablation attribution exists on changed params
    assert any("before_metrics" in p for p in evo["changed_params_json"])

    # 5. Defense Evolution 2.0: Validate selected candidate on held-out evaluation split
    r_evo_val = client.post(
        "/api/evolution/validate",
        json={"evolution_run_id": evo["id"], "candidate_key": evo["selected_candidate_key"]},
    )
    assert r_evo_val.status_code == 200
    evo_done = r_evo_val.json()
    assert evo_done["status"] == "completed"
    assert evo_done["verdict"] == "improved"

    # Verify Unusual Amount on held-out evaluation split improved above 0% and is not artificially 100%
    scen_cmp = {
        s["scenario_type"]: s for s in evo_done["comparison_json"]["scenario_comparison"]
    }
    assert 0.0 < scen_cmp["unusual_amount"]["candidate_recall"] <= 1.0
    assert scen_cmp["unusual_amount"]["candidate_recall"] >= scen_cmp["unusual_amount"]["baseline_recall"]
    assert 0.0 < evo_done["comparison_json"]["evaluation_split"]["candidate"]["recall"] < 1.0

    # Verify Evolution History lineage endpoint
    r_hist = client.get("/api/evolution/history")
    assert r_hist.status_code == 200
    assert len(r_hist.json()) >= 2

    # 6. Security Intelligence endpoint & Transaction Inspector
    r_intel = client.get(f"/api/intelligence/{exp['id']}")
    assert r_intel.status_code == 200
    intel = r_intel.json()
    assert len(intel["weakness_explorer"]) == 7
    assert "false_positive_analysis" in intel
    assert "false_negative_analysis" in intel
    assert "reliability_report" in intel
    assert len(intel["transaction_inspector_samples"]) > 0

    sample_tx_code = intel["transaction_inspector_samples"][0]["transaction_code"]
    r_tx_insp = client.get(f"/api/intelligence/{exp['id']}/transactions/{sample_tx_code}")
    assert r_tx_insp.status_code == 200
    assert r_tx_insp.json()["transaction_code"] == sample_tx_code

    # 7. Multi-Seed Benchmark Engine (5 independent seeds)
    r_bm = client.post(
        "/api/benchmarks/run",
        json={
            "name": "5-Seed Benchmark",
            "transaction_count": 400,
            "customer_count": 50,
            "risk_ratio": 0.05,
            "seeds": [42, 101, 202, 303, 404],
            "split_name": "evaluation",
            "baseline_config_id": baseline_cfg["id"],
            "candidate_config_id": evo_done["candidate_config_id"],
        },
    )
    assert r_bm.status_code == 201
    bm = r_bm.json()
    assert bm["completed_runs"] == 5
    assert "macro" in bm["aggregated_metrics_json"]["baseline"]
    assert "micro" in bm["aggregated_metrics_json"]["baseline"]
    assert bm["comparison_summary_json"]["verdict"] in ("improved", "mixed")

    r_bm_csv = client.get(f"/api/benchmarks/{bm['id']}/export?format=csv")
    assert r_bm_csv.status_code == 200
    assert "seed,split_name,base_recall" in r_bm_csv.text

    # 8. Printable HTML report export
    r_html = client.get(f"/api/reports/{exp['id']}/export?format=html")
    assert r_html.status_code == 200
    assert "<title>VIGILIA Report" in r_html.text

    # 9. Competition Demo Mode launch & non-destructive reset
    r_demo = client.post("/api/demo/launch")
    assert r_demo.status_code == 201
    assert r_demo.json()["status"] == "completed"

    r_reset = client.post("/api/demo/reset")
    assert r_reset.status_code == 200
    assert r_reset.json()["removed_demo_datasets"] >= 1

    # Confirm user's original dataset ("User Dataset 1K") was NOT deleted by demo reset
    remaining_ds = client.get("/api/datasets").json()
    assert any(d["name"] == "User Dataset 1K" for d in remaining_ds)


def test_adversarial_shift_guardrail_and_7_scenarios_evolution(client: TestClient):
    base_ts = datetime(2026, 11, 5, 10, 0, tzinfo=timezone.utc)
    txs = [
        {
            "id": 1,
            "transaction_code": "TXN-SH-1",
            "customer_code": "CUS-1",
            "recipient_code": "REC-A",
            "amount_kzt": 100_000.0,
            "timestamp": base_ts,
            "transaction_type": "p2p_transfer",
            "channel": "mobile_app",
            "is_new_recipient": True,
            "customer_segment": "retail_standard",
            "transaction_frequency": 1.0,
            "minutes_since_device_change": 8.0,
        },
        {
            "id": 2,
            "transaction_code": "TXN-SH-2",
            "customer_code": "CUS-1",
            "recipient_code": "REC-B",
            "amount_kzt": 200_000.0,
            "timestamp": base_ts + timedelta(minutes=10),
            "transaction_type": "p2p_transfer",
            "channel": "mobile_app",
            "is_new_recipient": False,
            "customer_segment": "retail_standard",
            "transaction_frequency": 2.0,
            "minutes_since_device_change": 18.0,
        },
    ]
    s1 = apply_adversarial_shift(txs, seed=42)
    s2 = apply_adversarial_shift(txs, seed=42)
    assert s1 == s2
    pct1 = abs(s1[0]["amount_kzt"] - 100_000.0) / 100_000.0
    assert 0.099 <= pct1 <= 0.151
    gap_orig = 600.0
    gap_shifted = (s1[1]["timestamp"] - s1[0]["timestamp"]).total_seconds()
    assert 0.099 <= abs(gap_shifted - gap_orig) / gap_orig <= 0.151

    base_m = {"recall": 0.4, "precision": 0.85, "f1_score": 0.54, "false_positive_rate": 0.005, "false_positives": 1, "total_transactions": 200, "actual_risk_events": 15, "predicted_risk_events": 7}
    cand_m = {"recall": 0.8, "precision": 0.82, "f1_score": 0.81, "false_positive_rate": 0.01, "false_positives": 2, "total_transactions": 200, "actual_risk_events": 15, "predicted_risk_events": 14}
    val_cmp = {
        "baseline": base_m,
        "candidate": cand_m,
        "delta": {"recall": 0.4, "precision": -0.03, "f1_score": 0.27, "false_positive_rate": 0.005, "false_positives": 1},
    }
    v_mixed, _, rep_mixed = evaluate_evolution_verdict(
        val_cmp,
        val_cmp,
        adversarial_shift={"status": "evaluated", "passed": False, "recall_delta_vs_clean": -0.14, "fpr_delta_vs_clean": 0.005},
    )
    assert v_mixed == "mixed"
    assert rep_mixed["checks"]["adversarial_shift_ok"] is False

    v_rej, _, _ = evaluate_evolution_verdict(
        val_cmp,
        val_cmp,
        adversarial_shift={"status": "evaluated", "passed": False, "recall_delta_vs_clean": -0.32, "fpr_delta_vs_clean": 0.03},
    )
    assert v_rej == "rejected_regression"

    r_ds = client.post(
        "/api/datasets/generate",
        json={"name": "7-Scenario Shift Audit", "transaction_count": 1000, "customer_count": 100, "risk_ratio": 0.08, "seed": 314},
    )
    assert r_ds.status_code == 201
    ds = r_ds.json()
    assert len(ds["scenarios_json"]) == 7

    baseline_cfg_id = client.get("/api/defense/configurations").json()[0]["id"]
    r_exp = client.post(
        "/api/experiments",
        json={
            "name": "7-Scenario Shift Baseline",
            "dataset_id": ds["id"],
            "defense_config_id": baseline_cfg_id,
            "split_name": "all",
        },
    )
    assert r_exp.status_code == 201
    exp_id = r_exp.json()["id"]

    r_an = client.post("/api/evolution/analyze", json={"experiment_id": exp_id})
    assert r_an.status_code == 201
    evo_id = r_an.json()["id"]

    r_val = client.post("/api/evolution/validate", json={"evolution_run_id": evo_id})
    assert r_val.status_code == 200
    cmp_json = r_val.json()["comparison_json"]
    assert cmp_json["adversarial_shift"]["status"] == "evaluated"
    assert cmp_json["scenario_audit"]["totals_match_overall"] is True
    scen_types = {x["scenario_type"] for x in cmp_json["scenario_comparison"]}
    assert {"structuring_smurfing", "account_takeover_ato"}.issubset(scen_types)


def test_sqlite_wal_and_busy_timeout():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_file = Path(tmpdir) / "wal_test.db"
        url = f"sqlite:///{db_file.as_posix()}"
        eng = create_engine(url, connect_args={"check_same_thread": False, "timeout": 5.0})
        configure_sqlite_engine(eng)
        Base.metadata.create_all(bind=eng)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=eng)

        with eng.connect() as conn:
            journal_mode = str(conn.execute(text("PRAGMA journal_mode")).scalar()).lower()
            busy_timeout = int(conn.execute(text("PRAGMA busy_timeout")).scalar())
            assert journal_mode == "wal"
            assert busy_timeout == 5000

        def _write_cfg(idx: int) -> int:
            s = SessionLocal()
            try:
                cfg = DefenseConfiguration(
                    name=f"Concurrent-{idx}",
                    version=f"Defense-Test-{idx}",
                    description="WAL concurrency test",
                    is_baseline=False,
                    decision_threshold=55.0,
                    risk_levels_json={"low_max": 30.0, "medium_max": 55.0, "high_max": 80.0},
                    rules_config_json=DEFAULT_RULES_CONFIG,
                    changed_params_json=[],
                )
                s.add(cfg)
                s.commit()
                return cfg.id
            finally:
                s.close()

        with ThreadPoolExecutor(max_workers=6) as pool:
            ids = list(pool.map(_write_cfg, range(12)))
        assert len(ids) == 12
        eng.dispose()


def test_business_metrics_exact_sums_and_deltas(client: TestClient):
    preds = [
        {"transaction_id": 1, "amount_kzt": 150_000.0, "predicted_label": 1, "risk_score": 82.0, "risk_level": "critical", "routing_action": "block", "triggered_rules": []},  # TP
        {"transaction_id": 2, "amount_kzt": 45_000.0, "predicted_label": 0, "risk_score": 40.0, "risk_level": "medium", "routing_action": "review", "triggered_rules": []},   # FN + Review
        {"transaction_id": 3, "amount_kzt": 20_000.0, "predicted_label": 1, "risk_score": 60.0, "risk_level": "high", "routing_action": "block", "triggered_rules": []},     # FP
        {"transaction_id": 4, "amount_kzt": 10_000.0, "predicted_label": 0, "risk_score": 35.0, "risk_level": "medium", "routing_action": "review", "triggered_rules": []},   # TN + Review
        {"transaction_id": 5, "amount_kzt": 5_000.0, "predicted_label": 0, "risk_score": 5.0, "risk_level": "low", "routing_action": "allow", "triggered_rules": []},         # TN
    ]
    gt = {
        1: {"ground_truth_label": 1, "scenario_type": "unusual_amount"},
        2: {"ground_truth_label": 1, "scenario_type": "duplicate_payment"},
        3: {"ground_truth_label": 0, "scenario_type": "normal_activity"},
        4: {"ground_truth_label": 0, "scenario_type": "normal_activity"},
        5: {"ground_truth_label": 0, "scenario_type": "normal_activity"},
    }
    eval_out = evaluate_predictions(preds, gt, processing_time_ms=1.0)
    m = eval_out["metrics"]
    assert m["prevented_fraud_amount"] == pytest.approx(150_000.0)
    assert m["missed_fraud_amount"] == pytest.approx(45_000.0)
    assert m["false_decline_amount"] == pytest.approx(20_000.0)
    assert m["review_queue_count"] == 2
    assert m["review_queue_rate"] == pytest.approx(0.4)

    r_ds = client.post(
        "/api/datasets/generate",
        json={"name": "Business Metrics 600", "transaction_count": 600, "customer_count": 60, "risk_ratio": 0.08, "seed": 555},
    )
    assert r_ds.status_code == 201
    ds_id = r_ds.json()["id"]
    cfg_id = client.get("/api/defense/configurations").json()[0]["id"]
    r_exp = client.post(
        "/api/experiments",
        json={"name": "BM Check", "dataset_id": ds_id, "defense_config_id": cfg_id, "split_name": "evaluation"},
    )
    assert r_exp.status_code == 201
    exp = r_exp.json()

    rows = []
    page = 1
    while True:
        r_det = client.get(f"/api/experiments/{exp['id']}?page={page}&page_size=100")
        assert r_det.status_code == 200
        body = r_det.json()
        rows.extend(body["results"])
        if len(rows) >= body["total_results"] or not body["results"]:
            break
        page += 1
    tp_sum = round(sum(r["amount_kzt"] for r in rows if r["predicted_label"] == 1 and r["ground_truth_label"] == 1), 2)
    fn_sum = round(sum(r["amount_kzt"] for r in rows if r["predicted_label"] == 0 and r["ground_truth_label"] == 1), 2)
    fp_sum = round(sum(r["amount_kzt"] for r in rows if r["predicted_label"] == 1 and r["ground_truth_label"] == 0), 2)
    assert exp["metrics_json"]["prevented_fraud_amount"] == pytest.approx(tp_sum)
    assert exp["metrics_json"]["missed_fraud_amount"] == pytest.approx(fn_sum)
    assert exp["metrics_json"]["false_decline_amount"] == pytest.approx(fp_sum)

    r_an = client.post("/api/evolution/analyze", json={"experiment_id": exp["id"]})
    assert r_an.status_code == 201
    r_val = client.post("/api/evolution/validate", json={"evolution_run_id": r_an.json()["id"]})
    assert r_val.status_code == 200
    eval_slice = r_val.json()["comparison_json"]["evaluation_split"]
    delta = eval_slice["delta"]
    assert "delta_prevented_fraud_amount" in delta
    assert "delta_missed_fraud_amount" in delta
    assert "delta_false_decline_amount" in delta
    assert "delta_review_queue_count" in delta
    assert "delta_review_queue_rate" in delta
    assert delta["delta_prevented_fraud_amount"] == pytest.approx(
        round(eval_slice["candidate"]["prevented_fraud_amount"] - eval_slice["baseline"]["prevented_fraud_amount"], 2)
    )

    cand_exp_id = r_val.json()["final_candidate_experiment_id"]
    r_rep_json = client.get(f"/api/reports/{cand_exp_id}/export?format=json")
    assert r_rep_json.status_code == 200
    rep_data = r_rep_json.json()
    assert "business_metrics" in rep_data
    assert "prevented_fraud_amount" in rep_data["business_metrics"]
    assert "adversarial_shift" in rep_data
    scen_types = {s["scenario_type"] for s in rep_data["scenario_metrics"]}
    assert "structuring_smurfing" in scen_types
    assert "account_takeover_ato" in scen_types

    r_rep_csv = client.get(f"/api/reports/{cand_exp_id}/export?format=csv")
    assert r_rep_csv.status_code == 200
    assert "[BUSINESS_METRICS]" in r_rep_csv.text
    assert "[SCENARIO_METRICS]" in r_rep_csv.text
    assert "[ADVERSARIAL_SHIFT_CHECK]" in r_rep_csv.text
    assert "structuring_smurfing" in r_rep_csv.text
    assert "account_takeover_ato" in r_rep_csv.text

    r_rep_html = client.get(f"/api/reports/{cand_exp_id}/export?format=html")
    assert r_rep_html.status_code == 200
    assert "Финансовый эффект" in r_rep_html.text
    assert "Adversarial Shift Check" in r_rep_html.text
    assert "structuring_smurfing" in r_rep_html.text
    assert "account_takeover_ato" in r_rep_html.text


def test_decision_trace_persisted_and_returned(client: TestClient):
    engine = DefenseEngine(DEFAULT_RULES_CONFIG, decision_threshold=55.0)
    custs = {
        "CUS-T1": {
            "customer_code": "CUS-T1",
            "customer_type": "individual",
            "account_age_days": 120,
            "typical_amount_max_kzt": 100_000.0,
            "avg_amount_kzt": 40_000.0,
            "std_amount_kzt": 15_000.0,
        }
    }
    ts = datetime(2026, 11, 5, 14, 0, tzinfo=timezone.utc)
    preds = engine.evaluate_transactions(
        [
            {
                "id": 101,
                "transaction_code": "TXN-TRACE-1",
                "customer_code": "CUS-T1",
                "recipient_code": "REC-1",
                "amount_kzt": 600_000.0,
                "timestamp": ts,
                "transaction_type": "p2p_transfer",
                "channel": "mobile_app",
                "is_new_recipient": True,
                "customer_segment": "retail_standard",
                "transaction_frequency": 1.0,
                "split_name": "evaluation",
            }
        ],
        custs,
    )
    trace = preds[0]["decision_trace"]
    assert trace["risk_score"] == preds[0]["risk_score"]
    assert trace["decision_threshold"] == 55.0
    assert trace["decision"] in ("allow", "review", "block")
    rules_by_name = {r["rule_name"]: r for r in trace["rules"]}
    assert rules_by_name["unusual_amount"]["triggered"] is True
    assert rules_by_name["unusual_amount"]["score_contribution"] > 0
    assert rules_by_name["unusual_amount"]["actual_value"] == pytest.approx(6.0)
    assert rules_by_name["unusual_amount"]["threshold_value"] == pytest.approx(4.8)
    assert rules_by_name["duplicate_payment"]["triggered"] is False

    r_ds = client.post(
        "/api/datasets/generate",
        json={"name": "Trace Audit DS", "transaction_count": 400, "customer_count": 40, "risk_ratio": 0.08, "seed": 88},
    )
    ds_id = r_ds.json()["id"]
    cfg_id = client.get("/api/defense/configurations").json()[0]["id"]
    r_exp = client.post(
        "/api/experiments",
        json={"name": "Trace Exp", "dataset_id": ds_id, "defense_config_id": cfg_id, "split_name": "evaluation"},
    )
    exp_id = r_exp.json()["id"]

    r_det = client.get(f"/api/experiments/{exp_id}?page=1&page_size=5")
    assert r_det.status_code == 200
    first_res = r_det.json()["results"][0]
    assert isinstance(first_res["decision_trace"], dict)
    assert len(first_res["decision_trace"]["rules"]) >= 5

    r_intel = client.get(f"/api/intelligence/{exp_id}")
    assert r_intel.status_code == 200
    samples = r_intel.json()["transaction_inspector_samples"]
    assert len(samples) > 0
    assert "decision_trace" in samples[0]
    assert "rules" in samples[0]["decision_trace"]

    sample_code = samples[0]["transaction_code"]
    r_single = client.get(f"/api/intelligence/{exp_id}/transactions/{sample_code}")
    assert r_single.status_code == 200
    assert r_single.json()["decision_trace"]["risk_score"] == r_single.json()["risk_score"]
