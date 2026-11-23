"""External Antifraud Testing, White-Box/Black-Box Weakness Detection, External Evolution, and Engine Comparison."""

from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Sequence
import httpx
from sqlalchemy.orm import Session

from ..models import (
    AntifraudEngine,
    Dataset,
    DefenseConfiguration,
    EngineComparison,
    Experiment,
    ExperimentResult,
    ExternalEvolutionRun,
    Recommendation,
    SyntheticTransaction,
)
from .antifraud_connector import (
    ExternalHttpConnector,
    match_and_normalize_predictions,
    parse_imported_predictions,
)
from .defense_evolution import (
    DEFAULT_GUARDRAILS,
    _collect_unfixed_weaknesses,
    _compare_metric_dicts,
    apply_adversarial_shift,
    compute_matched_scenario_comparison,
    evaluate_evolution_verdict,
    summarize_adversarial_shift,
)
from .evaluation_engine import evaluate_predictions
from .experiment_runner import run_experiment_pipeline

BUILTIN_ENGINES: List[Dict[str, Any]] = [
    {
        "code": "internal_vigilia",
        "name": "VIGILIA Internal Defense",
        "adapter_type": "internal",
        "diagnostic_mode": "white_box",
        "supports_config": True,
        "base_url": None,
        "protocol_version": "1.0",
        "active_profile": "baseline",
        "description": "Built-in transparent rule-based anti-fraud laboratory engine.",
        "is_builtin": True,
    },
    {
        "code": "external_b",
        "name": "External Antifraud B",
        "adapter_type": "external_api",
        "diagnostic_mode": "white_box",
        "supports_config": True,
        "base_url": "http://127.0.0.1:8010",
        "protocol_version": "1.0",
        "active_profile": "baseline",
        "description": "Independent local HTTP antifraud service (port 8010) with configurable test profiles.",
        "is_builtin": True,
    },
    {
        "code": "external_b_blackbox",
        "name": "External Antifraud B (Black-Box)",
        "adapter_type": "external_api",
        "diagnostic_mode": "black_box",
        "supports_config": False,
        "base_url": "http://127.0.0.1:8010",
        "protocol_version": "1.0",
        "active_profile": "baseline",
        "description": "External Antifraud B tested strictly in Black-Box mode without config access.",
        "is_builtin": True,
    },
    {
        "code": "mock_bank_ml",
        "name": "Mock Bank ML Antifraud (Port 8020)",
        "adapter_type": "external_api",
        "diagnostic_mode": "black_box",
        "supports_config": False,
        "base_url": "http://127.0.0.1:8020",
        "protocol_version": "1.0",
        "active_profile": "ml_baseline",
        "description": "Independent scikit-learn Bank ML antifraud microservice (port 8020) with Concept Drift.",
        "is_builtin": True,
    },
    {
        "code": "imported_predictions",
        "name": "Imported Predictions (CSV / JSON)",
        "adapter_type": "imported",
        "diagnostic_mode": "black_box",
        "supports_config": False,
        "base_url": None,
        "protocol_version": "1.0",
        "active_profile": "imported",
        "description": "Offline Black-Box evaluation of externally exported predictions matched by transaction_id.",
        "is_builtin": True,
    },
]


def seed_default_engines(db: Session) -> None:
    """Idempotently register built-in internal, external demo, and import adapters."""
    existing_codes = {row[0] for row in db.query(AntifraudEngine.code).all()}
    added = False
    for spec in BUILTIN_ENGINES:
        if spec["code"] not in existing_codes:
            db.add(AntifraudEngine(**spec))
            added = True
    if added:
        db.commit()


def check_engine_status(
    engine: AntifraudEngine,
    transport: Optional[httpx.BaseTransport] = None,
) -> Dict[str, Any]:
    if engine.adapter_type == "internal":
        return {
            "engine_id": engine.id,
            "code": engine.code,
            "name": engine.name,
            "adapter_type": engine.adapter_type,
            "diagnostic_mode": engine.diagnostic_mode,
            "supports_config": engine.supports_config,
            "online": True,
            "engine_version": "Defense v1.0+",
            "active_profile": engine.active_profile,
            "error": None,
        }
    if engine.adapter_type == "imported":
        return {
            "engine_id": engine.id,
            "code": engine.code,
            "name": engine.name,
            "adapter_type": engine.adapter_type,
            "diagnostic_mode": "black_box",
            "supports_config": False,
            "online": True,
            "engine_version": "CSV/JSON Import",
            "active_profile": "imported",
            "error": None,
        }
    if not engine.base_url:
        return {
            "engine_id": engine.id,
            "code": engine.code,
            "name": engine.name,
            "adapter_type": engine.adapter_type,
            "diagnostic_mode": engine.diagnostic_mode,
            "supports_config": engine.supports_config,
            "online": False,
            "engine_version": None,
            "active_profile": engine.active_profile,
            "error": "No base URL configured",
        }
    connector = ExternalHttpConnector(engine.base_url, transport=transport)
    health = connector.check_health()
    return {
        "engine_id": engine.id,
        "code": engine.code,
        "name": engine.name,
        "adapter_type": engine.adapter_type,
        "diagnostic_mode": engine.diagnostic_mode,
        "supports_config": engine.supports_config,
        "online": bool(health.get("online")),
        "engine_version": health.get("engine_version"),
        "active_profile": health.get("active_profile") or engine.active_profile,
        "error": health.get("error"),
    }


def _load_dataset_slice(
    db: Session,
    dataset_id: int,
    split_name: str,
    scenarios: Optional[Sequence[str]] = None,
) -> tuple[Dataset, List[SyntheticTransaction], Dict[int, Dict[str, Any]]]:
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise ValueError("Dataset not found")

    tx_q = db.query(SyntheticTransaction).filter(SyntheticTransaction.dataset_id == dataset_id)
    if split_name != "all":
        tx_q = tx_q.filter(SyntheticTransaction.split_name == split_name)
    if scenarios:
        tx_q = tx_q.filter(SyntheticTransaction.scenario_type.in_(list(scenarios)))

    tx_rows = tx_q.order_by(SyntheticTransaction.timestamp.asc(), SyntheticTransaction.id.asc()).all()
    gt_map = {
        row.id: {
            "ground_truth_label": row.ground_truth_label,
            "scenario_type": row.scenario_type,
        }
        for row in tx_rows
    }
    return dataset, tx_rows, gt_map


def analyze_external_errors(
    eval_out: Dict[str, Any],
    diagnostic_mode: str,
    external_config: Optional[Dict[str, Any]] = None,
    completeness: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Generate honest White-Box or Black-Box weaknesses and verifiable recommendations
    strictly from observed predictions without fabricating unverified claims.
    """
    is_black_box = diagnostic_mode == "black_box"
    cfg_params = (external_config or {}).get("parameters") or (external_config or {})
    joined = eval_out["joined_results"]
    scenario_metrics = eval_out["scenario_metrics"]
    metrics = eval_out["metrics"]

    weaknesses: List[Dict[str, Any]] = []
    recommendations: List[Dict[str, Any]] = []

    if completeness and int(completeness.get("missing_count", 0)) > 0:
        missing_n = int(completeness["missing_count"])
        total_sent = int(completeness.get("total_sent", 0))
        weaknesses.append(
            {
                "scenario_type": "api_completeness",
                "issue_type": "incomplete_responses",
                "severity": "high",
                "title": "Неполные ответы внешнего сервиса",
                "error_count": missing_n,
                "actual_risk_events": 0,
                "sample_transaction_codes": list(completeness.get("missing_ids_sample", []))[:6],
                "explanation": (
                    f"По {missing_n} из {total_sent} отправленных операций ответы не получены; "
                    "пропущенные ответы не засчитывались как безопасные."
                ),
                "recommended_check": "Проверить таймауты, пакетную обработку и сопоставление transaction_id.",
            }
        )

    for sm in scenario_metrics:
        scen = sm["scenario_type"]
        scen_rows = [r for r in joined if r["scenario_type"] == scen]
        fn_rows = [r for r in scen_rows if r["ground_truth_label"] == 1 and r["predicted_label"] == 0]
        fp_rows = [r for r in scen_rows if r["ground_truth_label"] == 0 and r["predicted_label"] == 1]

        if sm["actual_risk_events"] > 0 and sm["false_negatives"] > 0:
            recall = float(sm["recall"])
            sev = "critical" if recall < 0.45 else ("high" if recall < 0.72 else "medium")
            sample_codes = [r["transaction_code"] for r in fn_rows[:6]]

            if is_black_box:
                explanation = (
                    f"Black-Box оценка: в сценарии «{scen}» пропущено {sm['false_negatives']} из {sm['actual_risk_events']} "
                    f"рискованных операций (обнаружение {recall:.1%}). Внутренние правила внешней системы недоступны: "
                    f"эти операции не достигли внешнего порога блокировки."
                )
                rec_check = (
                    f"Откалибровать внешний порог скоринга / зону Review или передать команде вендора кейсы ({', '.join(sample_codes[:3])})."
                )
                target_rule = f"hypothesis_{scen}"
            else:
                if scen == "duplicate_payment":
                    dup_win = cfg_params.get("duplicate_window_min", "?")
                    explanation = (
                        f"White-Box диагностика: пропущено {sm['false_negatives']} из {sm['actual_risk_events']} повторных платежей "
                        f"(текущее окно duplicate_window_min={dup_win} мин не охватывает более длинные повторы)."
                    )
                    rec_check = "Увеличить duplicate_window_min и допуск по сумме, затем проверить на validation."
                elif scen == "new_recipient_risk":
                    np_w = cfg_params.get("new_payee_weight", "?")
                    explanation = (
                        f"White-Box диагностика: пропущено {sm['false_negatives']} из {sm['actual_risk_events']} переводов новым получателям "
                        f"(new_payee_weight={np_w}, общий порог={cfg_params.get('decision_threshold', '?')})."
                    )
                    rec_check = "Усилить вес нового получателя и ночного контекста."
                elif scen == "unusual_amount":
                    scale = cfg_params.get("amount_tier_scale", "?")
                    explanation = (
                        f"White-Box диагностика: пропущено {sm['false_negatives']} из {sm['actual_risk_events']} необычных сумм "
                        f"(amount_tier_scale={scale} завышает базовый ориентир)."
                    )
                    rec_check = "Снизить amount_tier_scale и скорректировать amount_weight."
                elif scen == "suspicious_sequence":
                    vw = cfg_params.get("velocity_window_min", "?")
                    vm = cfg_params.get("velocity_min_tx", "?")
                    explanation = (
                        f"White-Box диагностика: пропущено {sm['false_negatives']} из {sm['actual_risk_events']} подозрительных серий "
                        f"(velocity_window_min={vw}, velocity_min_tx={vm})."
                    )
                    rec_check = "Расширить окно серии операций и снизить минимальное число событий в серии."
                elif scen == "structuring_smurfing":
                    sw = cfg_params.get("structuring_window_min", "?")
                    smn = cfg_params.get("structuring_min_tx", "?")
                    explanation = (
                        f"White-Box диагностика: пропущено {sm['false_negatives']} из {sm['actual_risk_events']} кейсов дробления (smurfing) "
                        f"(structuring_window_min={sw}, structuring_min_tx={smn})."
                    )
                    rec_check = "Расширить окно контроля дробления, снизить structuring_min_tx и усилить structuring_weight."
                elif scen == "account_takeover_ato":
                    aw = cfg_params.get("ato_window_min", "?")
                    awt = cfg_params.get("ato_weight", "?")
                    explanation = (
                        f"White-Box диагностика: пропущено {sm['false_negatives']} из {sm['actual_risk_events']} кейсов захвата аккаунта (ATO) "
                        f"(ato_window_min={aw}, ato_weight={awt})."
                    )
                    rec_check = "Увеличить окно связывания смены устройства/гео с переводом (ato_window_min) и ato_weight."
                else:
                    explanation = (
                        f"White-Box диагностика: пропущено {sm['false_negatives']} из {sm['actual_risk_events']} угроз в «{scen}»."
                    )
                    rec_check = "Откалибровать веса правил и порог решения."
                target_rule = scen

            weaknesses.append(
                {
                    "scenario_type": scen,
                    "issue_type": "missed_risk",
                    "severity": sev,
                    "title": f"Пропуски в сценарии {scen}",
                    "error_count": int(sm["false_negatives"]),
                    "actual_risk_events": int(sm["actual_risk_events"]),
                    "sample_transaction_codes": sample_codes,
                    "explanation": explanation,
                    "recommended_check": rec_check,
                }
            )
            recommendations.append(
                {
                    "target_rule": target_rule,
                    "issue_category": "black_box_hypothesis" if is_black_box else "missed_risk_tuning",
                    "severity": sev,
                    "title": f"Усилить проверку сценария {scen}",
                    "explanation": explanation,
                    "proposed_changes_json": {"sample_transactions": sample_codes},
                    "expected_impact": rec_check,
                }
            )

        if int(sm["false_positives"]) >= 2 or float(sm["false_positive_rate"]) > 0.015:
            fp_codes = [r["transaction_code"] for r in fp_rows[:6]]
            explanation = (
                f"Ошибочно заблокировано {sm['false_positives']} законных операций в сценарии «{scen}» "
                f"(FPR={float(sm['false_positive_rate']):.2%})."
            )
            weaknesses.append(
                {
                    "scenario_type": scen,
                    "issue_type": "false_positives",
                    "severity": "high" if float(sm["false_positive_rate"]) > 0.03 else "medium",
                    "title": f"Ложные блокировки в {scen}",
                    "error_count": int(sm["false_positives"]),
                    "actual_risk_events": int(sm["actual_risk_events"]),
                    "sample_transaction_codes": fp_codes,
                    "explanation": explanation,
                    "recommended_check": "Проверить граничные законные операции и ограничить рост FPR.",
                }
            )
            recommendations.append(
                {
                    "target_rule": f"fp_{scen}",
                    "issue_category": "false_positive_guardrail",
                    "severity": "medium",
                    "title": f"Снизить ложные блокировки в {scen}",
                    "explanation": explanation,
                    "proposed_changes_json": {"sample_transactions": fp_codes},
                    "expected_impact": "Уменьшение ложных срабатываний на законных операциях.",
                }
            )

    summary = (
        f"Проверено {metrics.get('total_transactions', 0)} операций "
        f"({metrics.get('actual_risk_events', 0)} рискованных). "
        f"Recall={metrics.get('recall', 0.0):.1%}, Precision={metrics.get('precision', 0.0):.1%}, "
        f"F1={metrics.get('f1_score', 0.0):.1%}, FPR={metrics.get('false_positive_rate', 0.0):.2%}."
    )
    return {
        "summary": summary,
        "weaknesses": weaknesses,
        "recommendations": recommendations,
    }


def _persist_external_experiment(
    db: Session,
    dataset: Dataset,
    engine: AntifraudEngine,
    name: str,
    split_name: str,
    scenarios: Sequence[str],
    eval_out: Dict[str, Any],
    processing_time_ms: float,
    engine_version_label: str,
    completeness: Dict[str, Any],
    external_config: Dict[str, Any],
    diag: Dict[str, Any],
) -> Experiment:
    # Maintain compatibility with existing DefenseConfiguration FK on experiments
    fallback_cfg = (
        db.query(DefenseConfiguration)
        .filter(DefenseConfiguration.is_baseline.is_(True))
        .order_by(DefenseConfiguration.id.asc())
        .first()
    ) or db.query(DefenseConfiguration).order_by(DefenseConfiguration.id.asc()).first()
    if not fallback_cfg:
        raise ValueError("Baseline DefenseConfiguration missing in database")

    exp = Experiment(
        name=name,
        dataset_id=dataset.id,
        defense_config_id=fallback_cfg.id,
        split_name=split_name,
        scenarios_json=list(scenarios),
        status="completed",
        processing_time_ms=round(processing_time_ms, 2),
        engine_id=engine.id,
        engine_name=engine.name,
        adapter_type=engine.adapter_type,
        diagnostic_mode=engine.diagnostic_mode,
        engine_version_label=engine_version_label,
        completeness_json=completeness,
        external_config_json=external_config if engine.diagnostic_mode == "white_box" else {},
        metrics_json=eval_out["metrics"],
        confusion_matrix_json=eval_out["confusion_matrix"],
        scenario_metrics_json=eval_out["scenario_metrics"],
        rule_impact_json=eval_out["rule_impact"],
        summary_text=diag["summary"],
    )
    db.add(exp)
    db.flush()

    result_objects = [
        ExperimentResult(
            experiment_id=exp.id,
            transaction_id=item["transaction_id"],
            transaction_code=item["transaction_code"],
            customer_code=item["customer_code"],
            recipient_code=item["recipient_code"],
            amount_kzt=item["amount_kzt"],
            timestamp=item["timestamp"],
            scenario_type=item["scenario_type"],
            split_name=item["split_name"],
            risk_score=item["risk_score"],
            risk_level=item["risk_level"],
            predicted_label=item["predicted_label"],
            ground_truth_label=item["ground_truth_label"],
            triggered_rules_json=item["triggered_rules"],
            decision_trace_json=item.get("decision_trace") or {},
            explanation=item["explanation"],
        )
        for item in eval_out["joined_results"]
    ]
    if result_objects:
        db.bulk_save_objects(result_objects)

    for rec in diag["recommendations"]:
        db.add(
            Recommendation(
                experiment_id=exp.id,
                target_rule=rec["target_rule"],
                issue_category=rec["issue_category"],
                severity=rec["severity"],
                title=rec["title"],
                explanation=rec["explanation"],
                proposed_changes_json=rec["proposed_changes_json"],
                expected_impact=rec["expected_impact"],
            )
        )

    db.commit()
    db.refresh(exp)
    return exp


def run_external_api_experiment(
    db: Session,
    engine: AntifraudEngine,
    dataset_id: int,
    name: str,
    split_name: str = "all",
    scenarios: Optional[Sequence[str]] = None,
    profile: Optional[str] = None,
    config_override: Optional[Dict[str, Any]] = None,
    transport: Optional[httpx.BaseTransport] = None,
) -> Experiment:
    if not engine.base_url:
        raise ValueError("External engine has no registered base URL")

    dataset, tx_rows, gt_map = _load_dataset_slice(db, dataset_id, split_name, scenarios)
    active_scenarios = list(scenarios) if scenarios else list(dataset.scenarios_json)
    connector = ExternalHttpConnector(engine.base_url, transport=transport)

    ext_config: Dict[str, Any] = {}
    if engine.diagnostic_mode == "white_box" and engine.supports_config:
        try:
            ext_config = connector.fetch_config(profile=profile or engine.active_profile)
            if config_override and isinstance(ext_config.get("parameters"), dict):
                merged = deepcopy(ext_config)
                merged["parameters"].update(config_override)
                ext_config = merged
        except Exception:
            ext_config = {}

    api_res = connector.analyze_transactions(
        tx_rows=tx_rows,
        profile=profile or engine.active_profile,
        config_override=config_override,
    )

    eval_out = evaluate_predictions(
        predictions=api_res["predictions"],
        ground_truth_by_tx_id=gt_map,
        processing_time_ms=api_res["processing_time_ms"],
    )
    diag = analyze_external_errors(
        eval_out=eval_out,
        diagnostic_mode=engine.diagnostic_mode,
        external_config=ext_config,
        completeness=api_res["completeness"],
    )
    return _persist_external_experiment(
        db=db,
        dataset=dataset,
        engine=engine,
        name=name,
        split_name=split_name,
        scenarios=active_scenarios,
        eval_out=eval_out,
        processing_time_ms=api_res["processing_time_ms"],
        engine_version_label=api_res["engine_version"],
        completeness=api_res["completeness"],
        external_config=ext_config,
        diag=diag,
    )


def run_imported_experiment(
    db: Session,
    engine: AntifraudEngine,
    dataset_id: int,
    name: str,
    file_format: str,
    content: str,
    version_label: str = "Imported v1",
    split_name: str = "all",
    scenarios: Optional[Sequence[str]] = None,
) -> Experiment:
    dataset, tx_rows, gt_map = _load_dataset_slice(db, dataset_id, split_name, scenarios)
    active_scenarios = list(scenarios) if scenarios else list(dataset.scenarios_json)

    raw_rows = parse_imported_predictions(file_format=file_format, content=content)
    normalized = match_and_normalize_predictions(expected_txs=tx_rows, raw_results=raw_rows)
    if normalized["completeness"]["evaluated_count"] == 0:
        raise ValueError(
            "No imported predictions matched the selected dataset transaction_id values."
        )

    eval_out = evaluate_predictions(
        predictions=normalized["predictions"],
        ground_truth_by_tx_id=gt_map,
        processing_time_ms=0.0,
    )
    diag = analyze_external_errors(
        eval_out=eval_out,
        diagnostic_mode="black_box",
        external_config={},
        completeness=normalized["completeness"],
    )
    return _persist_external_experiment(
        db=db,
        dataset=dataset,
        engine=engine,
        name=name,
        split_name=split_name,
        scenarios=active_scenarios,
        eval_out=eval_out,
        processing_time_ms=0.0,
        engine_version_label=version_label,
        completeness=normalized["completeness"],
        external_config={},
        diag=diag,
    )


def _build_external_candidate_overrides(
    base_params: Dict[str, Any],
    val_scenario_metrics: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    scen_map = {s["scenario_type"]: s for s in val_scenario_metrics}
    base_thresh = float(base_params.get("decision_threshold", 62.0))
    base_dup_win = int(base_params.get("duplicate_window_min", 10))
    base_dup_tol = float(base_params.get("duplicate_tolerance_pct", 0.01))
    base_np_w = float(base_params.get("new_payee_weight", 26.0))
    base_amt_scale = float(base_params.get("amount_tier_scale", 1.35))
    base_amt_w = float(base_params.get("amount_weight", 34.0))
    base_vel_win = int(base_params.get("velocity_window_min", 20))
    base_vel_min = int(base_params.get("velocity_min_tx", 4))
    base_vel_w = float(base_params.get("velocity_weight", 32.0))
    base_night = float(base_params.get("night_bonus", 10.0))
    base_struct_win = int(base_params.get("structuring_window_min", 20))
    base_struct_min = int(base_params.get("structuring_min_tx", 4))
    base_struct_w = float(base_params.get("structuring_weight", 24.0))
    base_ato_win = int(base_params.get("ato_window_min", 10))
    base_ato_w = float(base_params.get("ato_weight", 26.0))

    balanced_override: Dict[str, Any] = {}
    if scen_map.get("duplicate_payment", {}).get("false_negatives", 0) > 0:
        balanced_override["duplicate_window_min"] = min(60, max(base_dup_win + 25, 35))
        balanced_override["duplicate_tolerance_pct"] = round(min(0.05, max(base_dup_tol, 0.03)), 3)
    if scen_map.get("new_recipient_risk", {}).get("false_negatives", 0) > 0:
        balanced_override["new_payee_weight"] = round(min(44.0, base_np_w + 8.0), 1)
        balanced_override["night_bonus"] = round(min(20.0, base_night + 4.0), 1)
    if scen_map.get("unusual_amount", {}).get("false_negatives", 0) > 0:
        balanced_override["amount_tier_scale"] = round(max(0.85, base_amt_scale - 0.4), 2)
        balanced_override["amount_weight"] = round(min(46.0, base_amt_w + 4.0), 1)
    if scen_map.get("suspicious_sequence", {}).get("false_negatives", 0) > 0:
        balanced_override["velocity_window_min"] = min(60, max(base_vel_win + 25, 45))
        balanced_override["velocity_min_tx"] = max(3, base_vel_min - 1)
        balanced_override["velocity_weight"] = round(min(46.0, base_vel_w + 6.0), 1)
    if scen_map.get("structuring_smurfing", {}).get("false_negatives", 0) > 0:
        balanced_override["structuring_window_min"] = min(60, max(base_struct_win + 25, 45))
        balanced_override["structuring_min_tx"] = max(3, base_struct_min - 1)
        balanced_override["structuring_weight"] = round(min(46.0, base_struct_w + 16.0), 1)
    if scen_map.get("account_takeover_ato", {}).get("false_negatives", 0) > 0:
        balanced_override["ato_window_min"] = min(45, max(base_ato_win + 20, 30))
        balanced_override["ato_weight"] = round(min(44.0, base_ato_w + 12.0), 1)
    balanced_override["decision_threshold"] = round(max(50.0, base_thresh - 7.0), 1)

    return [
        {
            "key": "A",
            "name": "Candidate A — Threshold & Payee Calibration",
            "override": {
                "decision_threshold": round(max(50.0, base_thresh - 7.0), 1),
                "new_payee_weight": balanced_override.get("new_payee_weight", base_np_w),
                "amount_tier_scale": balanced_override.get("amount_tier_scale", base_amt_scale),
                "structuring_weight": balanced_override.get("structuring_weight", base_struct_w),
                "ato_weight": balanced_override.get("ato_weight", base_ato_w),
            },
        },
        {
            "key": "B",
            "name": "Candidate B — Temporal Window Expansion",
            "override": {
                "duplicate_window_min": balanced_override.get("duplicate_window_min", max(base_dup_win, 35)),
                "duplicate_tolerance_pct": balanced_override.get("duplicate_tolerance_pct", 0.03),
                "velocity_window_min": balanced_override.get("velocity_window_min", max(base_vel_win, 45)),
                "velocity_min_tx": balanced_override.get("velocity_min_tx", 3),
                "structuring_window_min": balanced_override.get("structuring_window_min", max(base_struct_win, 45)),
                "structuring_min_tx": balanced_override.get("structuring_min_tx", 3),
                "ato_window_min": balanced_override.get("ato_window_min", max(base_ato_win, 30)),
            },
        },
        {
            "key": "C",
            "name": "Candidate C — Balanced Multi-Factor",
            "override": balanced_override,
        },
    ]


_EXTERNAL_PARAM_CATALOG: Dict[str, Dict[str, str]] = {
    "duplicate_window_min": {
        "mechanism": "duplicate_payment",
        "purpose": "Временное окно (в минутах) для поиска повторного перевода тому же получателю с близкой суммой.",
        "higher_effect": "Расширение окна позволяет находить отложенные повторные переводы, разнесённые на большее время.",
        "lower_effect": "Сужение окна ограничивает поиск повторов коротким интервалом (меньше ложных дублей, выше шанс пропуска).",
        "side_effect": "Регулярные законные платежи одному получателю в пределах нового окна могут чаще классифицироваться как дубликаты.",
    },
    "duplicate_tolerance_pct": {
        "mechanism": "duplicate_payment",
        "purpose": "Допустимое относительное расхождение сумм (в долях от 0 до 1) при определении повторного платежа.",
        "higher_effect": "Увеличение допуска расширяет критерий совпадения и объединяет переводы со слегка изменёнными суммами.",
        "lower_effect": "Уменьшение допуска ужесточает требование к точности совпадения сумм (пропускает модифицированные суммы).",
        "side_effect": "Более широкий допуск повышает риск объединения независимых покупок с близкими чеками.",
    },
    "duplicate_weight": {
        "mechanism": "duplicate_payment",
        "purpose": "Вес правила повторного платежа, добавляемый к общему risk score при срабатывании детектора дублей.",
        "higher_effect": "Повышение веса усиливает вклад обнаруженного дубликата в итоговое решение о блокировке.",
        "lower_effect": "Снижение веса уменьшает влияние факта повтора, требуя подтверждения от других факторов.",
        "side_effect": "Высокий вес может блокировать единичный случайный повтор даже при чистом профиле клиента.",
    },
    "new_payee_weight": {
        "mechanism": "new_recipient_risk",
        "purpose": "Вес фактора первого перевода новому получателю с учётом сегмента клиента, канала и округлости суммы.",
        "higher_effect": "Увеличение веса повышает оценку риска при переводах новым получателям без истории.",
        "lower_effect": "Снижение веса смягчает реакцию на новых получателей.",
        "side_effect": "Может приводить к ложным остановкам законных первых переводов новым контрагентам и физлицам.",
    },
    "night_bonus": {
        "mechanism": "new_recipient_risk",
        "purpose": "Дополнительный балл риска за операции в ночное время (00:00–06:00), особенно новым получателям.",
        "higher_effect": "Увеличение ночной надбавки усиливает чувствительность к ночным операциям.",
        "lower_effect": "Уменьшение ночной надбавки ослабляет влияние времени суток на скоринг.",
        "side_effect": "Повышает вероятность ложных тревог для клиентов, совершающих реальные переводы в ночные часы.",
    },
    "amount_tier_scale": {
        "mechanism": "unusual_amount",
        "purpose": "Множитель базового ориентира суммы по сегменту и истории клиента (EWMA); задаёт границу аномальной суммы.",
        "higher_effect": "Увеличение множителя поднимает допустимую норму суммы и делает проверку более мягкой.",
        "lower_effect": "Снижение множителя опускает границу нормы, поэтому отклонения по сумме начинают фиксироваться раньше.",
        "side_effect": "Слишком низкий множитель увеличивает ложные срабатывания на законных крупных переводах.",
    },
    "amount_weight": {
        "mechanism": "unusual_amount",
        "purpose": "Базовый вес фактора аномальной суммы при превышении расчётного порога клиента.",
        "higher_effect": "Увеличение веса усиливает влияние скачка суммы на итоговый risk score.",
        "lower_effect": "Уменьшение веса снижает вклад фактора суммы в итоговое решение.",
        "side_effect": "Может вызывать ложные блокировки при разовых крупных покупках или выплатах.",
    },
    "velocity_window_min": {
        "mechanism": "suspicious_sequence",
        "purpose": "Длительность временного окна (в минутах) для подсчёта серии операций одного клиента.",
        "higher_effect": "Расширение окна объединяет более растянутые во времени серии переводов.",
        "lower_effect": "Сужение окна учитывает только быстрые всплески активности.",
        "side_effect": "При длинном окне обычная дневная активность клиента с несколькими платежами чаще набирает балл серии.",
    },
    "velocity_min_tx": {
        "mechanism": "suspicious_sequence",
        "purpose": "Минимальное число операций в окне для активации правила частой последовательности (velocity).",
        "higher_effect": "Увеличение минимального числа операций делает правило строже (требует более длинную серию).",
        "lower_effect": "Снижение порога числа операций делает правило чувствительнее: серия фиксируется при меньшем числе переводов.",
        "side_effect": "При низком значении 2–3 обычных последовательных перевода подряд могут запускать velocity-сигнал.",
    },
    "velocity_weight": {
        "mechanism": "suspicious_sequence",
        "purpose": "Вес фактора высокой частоты операций (velocity) в итоговом скоринге.",
        "higher_effect": "Увеличение веса усиливает вклад частой серии операций в риск-балл.",
        "lower_effect": "Снижение веса уменьшает влияние частоты операций на блокировку.",
        "side_effect": "Может приводить к ложным блокировкам активных пользователей в пиковые периоды.",
    },
    "decision_threshold": {
        "mechanism": "decision_threshold",
        "purpose": "Общий порог итогового risk score (0–100), после которого внешняя система относит операцию к рискованным.",
        "higher_effect": "Повышение общего порога уменьшает число блокировок (ниже FPR, но выше риск пропуска пограничных угроз).",
        "lower_effect": "Снижение общего порога переводит пограничные многофакторные операции в статус блокировки across-the-board.",
        "side_effect": "Снижает барьер срабатывания одновременно для всех сценариев и часто ведёт к росту ложных блокировок (FPR).",
    },
    "structuring_window_min": {
        "mechanism": "structuring_smurfing",
        "purpose": "Временное окно (в минутах) для выявления серии дробных переводов чуть ниже порога (smurfing).",
        "higher_effect": "Расширение окна связывает растянутые во времени серии дробления крупной суммы в единый паттерн.",
        "lower_effect": "Сужение окна учитывает только плотные серии дробления в коротком интервале.",
        "side_effect": "При слишком широком окне несколько обычных ежедневных платежей могут суммироваться в серию.",
    },
    "structuring_min_tx": {
        "mechanism": "structuring_smurfing",
        "purpose": "Минимальное число около-пороговых переводов в окне для активации детектора дробления (structuring).",
        "higher_effect": "Повышение порога требует более длинную цепочку дробления перед срабатыванием.",
        "lower_effect": "Снижение порога позволяет выявлять структурирование из 3 небольших переводов подряд.",
        "side_effect": "При низком числе переводов может чаще реагировать на обычные мелкие переводы.",
    },
    "structuring_weight": {
        "mechanism": "structuring_smurfing",
        "purpose": "Вес сигнала дробления (structuring/smurfing) в итоговом скоринге внешней системы.",
        "higher_effect": "Повышение веса усиливает вклад серии дробных платежей в итоговый risk score.",
        "lower_effect": "Снижение веса ослабляет срабатывание правила дробления.",
        "side_effect": "Избыточный вес может поднимать score при плотных бытовых расчётах.",
    },
    "ato_window_min": {
        "mechanism": "account_takeover_ato",
        "purpose": "Окно времени (в минутах) после смены устройства или геопозиции для контроля нетипичного перевода новому получателю.",
        "higher_effect": "Расширение окна ловит отложенный вывод средств после смены устройства или геолокации.",
        "lower_effect": "Сужение окна проверяет только мгновенные переводы сразу после входа с нового устройства.",
        "side_effect": "Может задевать клиентов, сменивших телефон или находящихся в поездке при крупном переводе.",
    },
    "ato_weight": {
        "mechanism": "account_takeover_ato",
        "purpose": "Вес сигнала захвата аккаунта (Account Takeover: смена устройства/гео + новый получатель + сумма).",
        "higher_effect": "Повышение веса ускоряет блокировку подозрительного вывода сразу после смены контекста входа.",
        "lower_effect": "Снижение веса требует больше дополнительных факторов риска перед блокировкой.",
        "side_effect": "Повышает риск ложной блокировки при легитимной смене смартфона клиентом.",
    },
    "block_threshold": {
        "mechanism": "black_box_routing",
        "purpose": "Внешний порог блокировки по risk_score, возвращённому Black-Box системой (внутренние правила вендора не меняются).",
        "higher_effect": "Повышение порога отсечения снижает ложные блокировки, переводя пограничные кейсы в зону Review или Allow.",
        "lower_effect": "Снижение внешнего порога перехватывает больше рискованных операций на уровне маршрутизации без доступа к правилам.",
        "side_effect": "Регулирует только внешнюю границу блокировки на базе возвращаемого risk_score и может увеличивать очередь проверки или FPR.",
    },
    "review_threshold": {
        "mechanism": "black_box_routing",
        "purpose": "Нижняя граница зоны ручной/дополнительной проверки (Review) для маршрутизации Allow / Review / Block в Black-Box режиме.",
        "higher_effect": "Повышение границы сужает поток в зону Review и оставляет больше операций в автоматическом Allow.",
        "lower_effect": "Снижение границы направляет больше пограничных операций на ручную проверку или 3DS/подтверждение.",
        "side_effect": "Увеличивает нагрузку на очередь аналитиков (Review queue), но не блокирует клиента напрямую.",
    },
}


def _build_external_param_details(
    base_params: Dict[str, Any],
    override: Dict[str, Any],
    val_scenario_metrics: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    scen_map = {s["scenario_type"]: s for s in (val_scenario_metrics or [])}
    is_multi = len(override) > 1
    details: List[Dict[str, Any]] = []
    for key, new_val in override.items():
        old_val = base_params.get(key)
        meta = _EXTERNAL_PARAM_CATALOG.get(key, {})
        mech = meta.get("mechanism", "decision_threshold")

        expected_effect = meta.get("higher_effect", "")
        if isinstance(old_val, (int, float)) and isinstance(new_val, (int, float)):
            if new_val < old_val:
                expected_effect = meta.get("lower_effect", expected_effect)
            elif new_val == old_val:
                expected_effect = "Значение не изменилось."

        linked_weakness: Optional[str] = None
        if mech != "decision_threshold" and mech in scen_map:
            sm = scen_map[mech]
            fn = int(sm.get("false_negatives", 0) or 0)
            act = int(sm.get("actual_risk_events", 0) or 0)
            fp = int(sm.get("false_positives", 0) or 0)
            if fn > 0:
                linked_weakness = f"{mech}: validation FN {fn}/{act}"
            elif fp > 0:
                linked_weakness = f"{mech}: validation FP {fp}"

        details.append(
            {
                "param": key,
                "mechanism": mech,
                "old_value": old_val,
                "new_value": new_val,
                "purpose": meta.get("purpose", ""),
                "expected_effect": expected_effect,
                "linked_weakness": linked_weakness,
                "side_effect": meta.get("side_effect", ""),
                "attribution_mode": "multi_param_joint" if is_multi else "single_param",
            }
        )
    return details


def _build_external_scenario_comparison(
    base_scenarios: List[Dict[str, Any]],
    cand_scenarios: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    scen_base_map = {s["scenario_type"]: s for s in (base_scenarios or [])}
    scen_cand_map = {s["scenario_type"]: s for s in (cand_scenarios or [])}
    scen_cmp: List[Dict[str, Any]] = []
    for sk in sorted(set(scen_base_map.keys()) | set(scen_cand_map.keys())):
        sb = scen_base_map.get(sk, {})
        sc = scen_cand_map.get(sk, {})
        actual_risk_events = sb.get("actual_risk_events", sc.get("actual_risk_events"))
        base_fn = sb.get("false_negatives") if "false_negatives" in sb else sb.get("fn")
        cand_fn = sc.get("false_negatives") if "false_negatives" in sc else sc.get("fn")
        base_fp = sb.get("false_positives") if "false_positives" in sb else sb.get("fp")
        cand_fp = sc.get("false_positives") if "false_positives" in sc else sc.get("fp")
        b_rec = sb.get("recall")
        c_rec = sc.get("recall")
        b_fpr = sb.get("false_positive_rate")
        c_fpr = sc.get("false_positive_rate")
        scen_cmp.append(
            {
                "scenario_type": sk,
                "actual_risk_events": int(actual_risk_events) if actual_risk_events is not None else None,
                "baseline_recall": b_rec,
                "candidate_recall": c_rec,
                "recall_delta": round(float(c_rec) - float(b_rec), 4) if (b_rec is not None and c_rec is not None) else None,
                "baseline_fpr": b_fpr,
                "candidate_fpr": c_fpr,
                "fpr_delta": round(float(c_fpr) - float(b_fpr), 4) if (b_fpr is not None and c_fpr is not None) else None,
                "baseline_fn": int(base_fn) if base_fn is not None else None,
                "candidate_fn": int(cand_fn) if cand_fn is not None else None,
                "fn_delta": (int(cand_fn) - int(base_fn)) if (base_fn is not None and cand_fn is not None) else None,
                "baseline_fp": int(base_fp) if base_fp is not None else None,
                "candidate_fp": int(cand_fp) if cand_fp is not None else None,
                "fp_delta": (int(cand_fp) - int(base_fp)) if (base_fp is not None and cand_fp is not None) else None,
            }
        )
    return scen_cmp


def _orm_rows_to_shifted_namespaces(
    tx_rows: Sequence[SyntheticTransaction],
    seed: int,
) -> Tuple[List[SimpleNamespace], Dict[int, Dict[str, Any]]]:
    """Perturb ORM transaction slices ±10–15% without touching ground truth or DB rows."""
    sanitized_dicts: List[Dict[str, Any]] = []
    gt_map: Dict[int, Dict[str, Any]] = {}
    for row in tx_rows:
        meta = row.metadata_json or {}
        sanitized_dicts.append(
            {
                "id": row.id,
                "transaction_code": row.transaction_code,
                "customer_code": row.customer_code,
                "recipient_code": row.recipient_code,
                "amount_kzt": row.amount_kzt,
                "timestamp": row.timestamp,
                "transaction_type": row.transaction_type,
                "channel": row.channel,
                "is_new_recipient": row.is_new_recipient,
                "customer_segment": row.customer_segment,
                "transaction_frequency": row.transaction_frequency,
                "split_name": getattr(row, "split_name", "evaluation"),
                "device_changed": bool(meta.get("device_changed", False)),
                "geo_changed": bool(meta.get("geo_changed", False)),
                "minutes_since_device_change": meta.get("minutes_since_device_change"),
            }
        )
        gt_map[row.id] = {
            "ground_truth_label": row.ground_truth_label,
            "scenario_type": row.scenario_type,
        }
    shifted = apply_adversarial_shift(sanitized_dicts, seed=seed)
    wrapped = [
        SimpleNamespace(
            **{
                **d,
                "metadata_json": {
                    "device_changed": d.get("device_changed", False),
                    "geo_changed": d.get("geo_changed", False),
                    "minutes_since_device_change": d.get("minutes_since_device_change"),
                },
            }
        )
        for d in shifted
    ]
    return wrapped, gt_map


def _apply_blackbox_policy_predictions(
    predictions: Sequence[Dict[str, Any]],
    block_threshold: float,
    review_threshold: Optional[float] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """
    Re-apply ONLY an external score cutoff & Allow/Review/Block routing policy
    over scores already returned by a Black-Box engine (internal vendor rules untouched).
    """
    rev_t = float(review_threshold if review_threshold is not None else max(0.0, block_threshold - 10.0))
    blk_t = float(block_threshold)
    adjusted: List[Dict[str, Any]] = []
    counts = {"allow": 0, "review": 0, "block": 0, "total": len(predictions)}

    for p in predictions:
        item = deepcopy(dict(p))
        raw_score = item.get("risk_score")
        if raw_score is not None:
            score = float(raw_score)
            if score >= blk_t:
                item["predicted_label"] = 1
                item["risk_level"] = "critical" if score >= max(80.0, blk_t + 15.0) else "high"
                item["routing_action"] = "block"
                counts["block"] += 1
            elif score >= rev_t:
                item["predicted_label"] = 0
                item["risk_level"] = "medium"
                item["routing_action"] = "review"
                counts["review"] += 1
            else:
                item["predicted_label"] = 0
                item["risk_level"] = "low"
                item["routing_action"] = "allow"
                counts["allow"] += 1
            base_trace = item.get("decision_trace") if isinstance(item.get("decision_trace"), dict) else {}
            item["decision_trace"] = {
                **base_trace,
                "risk_score": round(score, 2),
                "decision_threshold": round(blk_t, 2),
                "review_threshold": round(rev_t, 2),
                "decision": item["routing_action"],
                "predicted_label": item["predicted_label"],
                "rules": base_trace.get("rules", []),
            }
        else:
            is_blk = int(item.get("predicted_label", 0)) == 1
            item["routing_action"] = "block" if is_blk else "allow"
            counts["block" if is_blk else "allow"] += 1
            base_trace = item.get("decision_trace") if isinstance(item.get("decision_trace"), dict) else {}
            item["decision_trace"] = {
                **base_trace,
                "decision": item["routing_action"],
                "predicted_label": int(item.get("predicted_label", 0)),
                "rules": base_trace.get("rules", []),
            }
        adjusted.append(item)

    return adjusted, counts


def _persist_blackbox_policy_experiment(
    db: Session,
    engine: AntifraudEngine,
    dataset_id: int,
    tx_rows: Sequence[SyntheticTransaction],
    gt_map: Dict[int, Dict[str, Any]],
    raw_preds: Sequence[Dict[str, Any]],
    processing_time_ms: float,
    completeness: Optional[Dict[str, Any]],
    block_threshold: float,
    review_threshold: float,
    name: str,
    split_name: str,
    scenarios: Optional[Sequence[str]],
    version_label: str,
) -> Tuple[Experiment, Dict[str, Any]]:
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise ValueError("Dataset not found")
    adjusted_preds, routing_counts = _apply_blackbox_policy_predictions(
        raw_preds,
        block_threshold=block_threshold,
        review_threshold=review_threshold,
    )
    eval_out = evaluate_predictions(adjusted_preds, gt_map, processing_time_ms=processing_time_ms)
    diag = analyze_external_errors(
        eval_out=eval_out,
        diagnostic_mode="black_box",
        external_config={},
        completeness=completeness,
    )
    exp = _persist_external_experiment(
        db=db,
        dataset=dataset,
        engine=engine,
        name=name,
        split_name=split_name,
        scenarios=list(scenarios or dataset.scenarios_json),
        eval_out=eval_out,
        processing_time_ms=processing_time_ms,
        engine_version_label=version_label,
        completeness=completeness or {},
        external_config={},
        diag=diag,
    )
    return exp, routing_counts


def _build_blackbox_threshold_candidates(
    val_preds: Sequence[Dict[str, Any]],
    val_gt: Dict[int, Dict[str, Any]],
    val_scenario_metrics: Sequence[Dict[str, Any]],
    processing_time_ms: float,
) -> Tuple[Optional[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
    scored = [p for p in val_preds if p.get("risk_score") is not None]
    if len(scored) < max(5, len(val_preds) // 2):
        policy = {
            "scope": "external_threshold_and_routing_only",
            "internal_rules_modified": False,
            "has_risk_scores": False,
            "routing_supported": False,
            "reason": "External engine returned binary decisions without numeric risk_score; external threshold optimization is unavailable.",
        }
        return None, [], policy

    pos_scores = [float(p["risk_score"]) for p in scored if int(p.get("predicted_label", 0)) == 1]
    base_block = round(min(pos_scores), 1) if pos_scores else 60.0
    base_eval = evaluate_predictions(val_preds, val_gt, processing_time_ms)
    base_m = base_eval["metrics"]

    grid = sorted(
        set(
            [38.0, 42.0, 45.0, 48.0, 50.0, 52.0, 54.0, 56.0, 58.0, 60.0, 62.0, 65.0]
            + [round(base_block, 1)]
        )
    )
    best_t = base_block
    best_obj = -1e9
    for t in grid:
        adj, _ = _apply_blackbox_policy_predictions(val_preds, block_threshold=t)
        m = evaluate_predictions(adj, val_gt, processing_time_ms)["metrics"]
        obj = (
            float(m["f1_score"])
            + 0.15 * float(m["recall"])
            - 2.0 * float(m["false_positive_rate"])
            + (0.2 if float(m["false_positive_rate"]) <= float(DEFAULT_GUARDRAILS["max_fpr"]) else -0.25)
        )
        if obj > best_obj:
            best_obj = obj
            best_t = t

    t1_block = float(best_t)
    t1_review = round(max(25.0, t1_block - 10.0), 1)
    t2_block = round(min(70.0, max(t1_block + 3.0, base_block - 1.5)), 1)
    t2_review = round(max(25.0, t1_block - 12.0), 1)

    raw_cands = [
        {
            "key": "T1",
            "name": "Candidate T1 — Black-Box Score Cutoff",
            "override": {"block_threshold": t1_block, "review_threshold": t1_review},
        },
        {
            "key": "T2",
            "name": "Candidate T2 — Allow / Review / Block Routing",
            "override": {"block_threshold": t2_block, "review_threshold": t2_review},
        },
    ]

    evaluated: List[Dict[str, Any]] = []
    best_cand: Optional[Dict[str, Any]] = None
    best_cand_obj = -1e9
    base_snapshot = {"block_threshold": round(base_block, 1), "review_threshold": round(base_block, 1)}

    for cand in raw_cands:
        adj, routing_counts = _apply_blackbox_policy_predictions(
            val_preds,
            block_threshold=cand["override"]["block_threshold"],
            review_threshold=cand["override"]["review_threshold"],
        )
        c_eval = evaluate_predictions(adj, val_gt, processing_time_ms)
        c_m = c_eval["metrics"]
        c_cmp = _compare_metric_dicts(base_m, c_m)
        c_verdict, c_assess, c_gr = evaluate_evolution_verdict(
            val_cmp=c_cmp,
            eval_cmp=c_cmp,
            changed_params_count=len(cand["override"]),
        )
        p_details = _build_external_param_details(base_snapshot, cand["override"], val_scenario_metrics)
        entry = {
            "key": cand["key"],
            "name": cand["name"],
            "override": cand["override"],
            "param_details": p_details,
            "validation_metrics": c_m,
            "validation_delta": c_cmp["delta"],
            "validation_verdict": c_verdict,
            "validation_assessment": c_assess,
            "validation_unfixed_weaknesses": _collect_unfixed_weaknesses(c_eval["scenario_metrics"]),
            "guardrail_checks": c_gr["checks"],
            "routing_counts": routing_counts,
        }
        evaluated.append(entry)
        obj = float(c_m["f1_score"]) + 0.1 * float(c_m["recall"]) - 2.0 * float(c_m["false_positive_rate"])
        if obj > best_cand_obj:
            best_cand_obj = obj
            best_cand = entry

    sel = best_cand or evaluated[0]
    rc = sel["routing_counts"]
    total = max(1, int(rc["total"]))
    policy = {
        "scope": "external_threshold_and_routing_only",
        "internal_rules_modified": False,
        "has_risk_scores": True,
        "routing_supported": True,
        "baseline_block_threshold": round(base_block, 1),
        "recommended_block_threshold": sel["override"]["block_threshold"],
        "recommended_review_threshold": sel["override"]["review_threshold"],
        "routing_zones": {
            "allow": f"< {sel['override']['review_threshold']:.0f}",
            "review": f"{sel['override']['review_threshold']:.0f}–{sel['override']['block_threshold']:.0f}",
            "block": f">= {sel['override']['block_threshold']:.0f}",
        },
        "routing_counts": rc,
        "review_queue_share": round(float(rc["review"]) / total, 4),
    }
    return sel, evaluated, policy


def analyze_external_evolution(
    db: Session,
    baseline_experiment: Experiment,
    engine: AntifraudEngine,
    transport: Optional[httpx.BaseTransport] = None,
) -> ExternalEvolutionRun:
    """
    Step 1 (VIGILIA 3.4): Analyze baseline external test and tune bounded candidate overrides
    strictly on validation split (or prepare Black-Box hypotheses & recommendations).
    Held-out evaluation split is never touched here.
    """
    dataset = db.query(Dataset).filter(Dataset.id == baseline_experiment.dataset_id).first()
    if not dataset:
        raise ValueError("Dataset not found")

    is_configurable = (
        engine.adapter_type == "external_api"
        and engine.supports_config
        and engine.diagnostic_mode == "white_box"
        and bool(engine.base_url)
    )

    if not is_configurable:
        base_results = (
            db.query(ExperimentResult)
            .filter(ExperimentResult.experiment_id == baseline_experiment.id)
            .all()
        )
        fake_eval = {
            "metrics": baseline_experiment.metrics_json,
            "scenario_metrics": baseline_experiment.scenario_metrics_json,
            "joined_results": [
                {
                    "transaction_code": r.transaction_code,
                    "scenario_type": r.scenario_type,
                    "ground_truth_label": r.ground_truth_label,
                    "predicted_label": r.predicted_label,
                }
                for r in base_results
            ],
        }
        diag = analyze_external_errors(
            eval_out=fake_eval,
            diagnostic_mode="black_box",
            completeness=baseline_experiment.completeness_json,
        )

        bb_best: Optional[Dict[str, Any]] = None
        bb_candidates: List[Dict[str, Any]] = []
        bb_policy: Dict[str, Any] = {
            "scope": "external_threshold_and_routing_only",
            "internal_rules_modified": False,
            "has_risk_scores": False,
            "routing_supported": False,
            "vendor_recommendations_count": len(diag["recommendations"]),
            "reason": "Black-Box engine without live scoring endpoint; upload retest CSV/JSON after vendor rule update.",
        }
        bb_val_cmp: Optional[Dict[str, Any]] = None
        bb_baseline_snapshot: Dict[str, Any] = {}

        if engine.adapter_type == "external_api" and engine.base_url:
            _, val_txs, val_gt = _load_dataset_slice(
                db, dataset.id, "validation", baseline_experiment.scenarios_json
            )
            if val_txs:
                bb_connector = ExternalHttpConnector(engine.base_url, transport=transport)
                val_bb_api = bb_connector.analyze_transactions(
                    tx_rows=val_txs,
                    profile=engine.active_profile,
                )
                val_bb_eval = evaluate_predictions(
                    val_bb_api["predictions"], val_gt, val_bb_api["processing_time_ms"]
                )
                bb_best, bb_candidates, bb_policy = _build_blackbox_threshold_candidates(
                    val_preds=val_bb_api["predictions"],
                    val_gt=val_gt,
                    val_scenario_metrics=val_bb_eval["scenario_metrics"],
                    processing_time_ms=val_bb_api["processing_time_ms"],
                )
                bb_policy["vendor_recommendations_count"] = len(diag["recommendations"])
                if bb_best is not None:
                    bb_val_cmp = _compare_metric_dicts(val_bb_eval["metrics"], bb_best["validation_metrics"])
                    bb_baseline_snapshot = {
                        "block_threshold": bb_policy.get("baseline_block_threshold", 60.0),
                        "review_threshold": bb_policy.get("baseline_block_threshold", 60.0),
                    }

        run = ExternalEvolutionRun(
            engine_id=engine.id,
            baseline_experiment_id=baseline_experiment.id,
            candidate_experiment_id=None,
            mode="black_box_manual",
            baseline_label=baseline_experiment.engine_version_label or engine.name,
            candidate_label=(
                f"{baseline_experiment.engine_version_label or engine.name}-policy-{bb_best['key']}"
                if bb_best
                else ""
            ),
            baseline_config_snapshot_json=bb_baseline_snapshot,
            proposed_config_json=bb_best["override"] if bb_best else {},
            candidates_json=bb_candidates,
            weaknesses_json=diag["weaknesses"],
            recommendations_json=diag["recommendations"],
            comparison_json={
                "baseline_version": baseline_experiment.engine_version_label or engine.name,
                "candidate_version": (
                    f"{baseline_experiment.engine_version_label or engine.name}-policy-{bb_best['key']}"
                    if bb_best
                    else ""
                ),
                "selected_candidate_key": bb_best["key"] if bb_best else None,
                "selected_candidate_name": bb_best["name"] if bb_best else None,
                "validation_split": bb_val_cmp,
                "validation_unfixed_weaknesses": bb_best.get("validation_unfixed_weaknesses", []) if bb_best else [],
                "param_details": bb_best.get("param_details", []) if bb_best else [],
                "black_box_policy": bb_policy,
                "guardrails": DEFAULT_GUARDRAILS,
                "failed_transactions": [
                    {
                        "transaction_code": r.transaction_code,
                        "scenario_type": r.scenario_type,
                        "outcome": "FN" if r.ground_truth_label == 1 else "FP",
                        "amount_kzt": r.amount_kzt,
                    }
                    for r in base_results
                    if r.predicted_label != r.ground_truth_label
                ][:30],
            },
            verdict="awaiting_retest",
            tradeoff_assessment=(
                "Black-Box оптимизация подготовила внешний порог блокировки и маршрутизацию Allow / Review / Block (без изменения внутренних правил) и рекомендации вендору."
                if bb_best
                else "Рекомендации команде вендора подготовлены. Внешние пороги без числового risk_score не калибруются — ожидается повторная проверка новой версии."
            ),
            status="awaiting_retest",
        )
        db.add(run)
        db.commit()
        db.refresh(run)
        return run

    # Mode 1: Configurable External Engine (White-Box safe per-request config override on validation split)
    connector = ExternalHttpConnector(engine.base_url, transport=transport)
    cfg_payload = connector.fetch_config(profile=engine.active_profile)
    base_params = cfg_payload.get("parameters") or {}
    base_version = str(cfg_payload.get("engine_version") or baseline_experiment.engine_version_label or "baseline")

    _, val_txs, val_gt = _load_dataset_slice(
        db, dataset.id, "validation", baseline_experiment.scenarios_json
    )
    val_base_api = connector.analyze_transactions(
        tx_rows=val_txs, profile=engine.active_profile
    )
    val_base_eval = evaluate_predictions(
        val_base_api["predictions"], val_gt, val_base_api["processing_time_ms"]
    )
    base_val_m = val_base_eval["metrics"]

    raw_candidates = _build_external_candidate_overrides(
        base_params=base_params,
        val_scenario_metrics=val_base_eval["scenario_metrics"],
    )

    evaluated_cands: List[Dict[str, Any]] = []
    best_cand = raw_candidates[-1]
    best_score = -1e9

    for cand in raw_candidates:
        c_api = connector.analyze_transactions(
            tx_rows=val_txs,
            profile=engine.active_profile,
            config_override=cand["override"],
        )
        c_eval = evaluate_predictions(c_api["predictions"], val_gt, c_api["processing_time_ms"])
        c_m = c_eval["metrics"]
        c_cmp = _compare_metric_dicts(base_val_m, c_m)
        c_verdict, c_assess, c_gr = evaluate_evolution_verdict(
            val_cmp=c_cmp,
            eval_cmp=c_cmp,
            changed_params_count=len(cand["override"]),
        )
        passes = c_verdict in ("improved", "mixed") and c_gr["checks"]["fpr_ok"]
        obj = (
            float(c_m["f1_score"])
            + 0.15 * float(c_m["recall"])
            - 2.0 * float(c_m["false_positive_rate"])
            + (0.25 if passes else -0.25)
        )
        if obj > best_score:
            best_score = obj
            best_cand = cand

        c_unfixed = _collect_unfixed_weaknesses(c_eval["scenario_metrics"])
        c_param_details = _build_external_param_details(
            base_params=base_params,
            override=cand["override"],
            val_scenario_metrics=val_base_eval["scenario_metrics"],
        )

        evaluated_cands.append(
            {
                "key": cand["key"],
                "name": cand["name"],
                "override": cand["override"],
                "param_details": c_param_details,
                "validation_metrics": c_m,
                "validation_delta": c_cmp["delta"],
                "validation_verdict": c_verdict,
                "validation_assessment": c_assess,
                "validation_unfixed_weaknesses": c_unfixed,
                "guardrail_checks": c_gr["checks"],
            }
        )

    val_best_entry = next(c for c in evaluated_cands if c["key"] == best_cand["key"])
    val_cmp_final = _compare_metric_dicts(base_val_m, val_best_entry["validation_metrics"])
    diag_base = analyze_external_errors(
        eval_out=val_base_eval,
        diagnostic_mode="white_box",
        external_config=cfg_payload,
        completeness=val_base_api["completeness"],
    )
    cand_version_label = f"{base_version}-tuned-{best_cand['key']}"

    run = ExternalEvolutionRun(
        engine_id=engine.id,
        baseline_experiment_id=baseline_experiment.id,
        candidate_experiment_id=None,
        mode="configurable_white_box",
        baseline_label=base_version,
        candidate_label=cand_version_label,
        baseline_config_snapshot_json=base_params,
        proposed_config_json=best_cand["override"],
        candidates_json=evaluated_cands,
        weaknesses_json=diag_base["weaknesses"],
        recommendations_json=diag_base["recommendations"],
        comparison_json={
            "baseline_version": base_version,
            "candidate_version": cand_version_label,
            "selected_candidate_key": best_cand["key"],
            "selected_candidate_name": best_cand["name"],
            "validation_split": val_cmp_final,
            "validation_unfixed_weaknesses": val_best_entry.get("validation_unfixed_weaknesses", []),
            "param_details": val_best_entry.get("param_details", []),
            "white_box_policy": {"scope": "internal_engine_parameters", "internal_rules_modified": True},
            "guardrails": DEFAULT_GUARDRAILS,
        },
        verdict="pending_validation",
        tradeoff_assessment="Предложены изменения параметров по validation split. Нажмите «Проверить предложенные изменения» для независимой проверки на evaluation split.",
        status="analyzed",
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def validate_external_evolution(
    db: Session,
    evo_run: ExternalEvolutionRun,
    candidate_key: Optional[str] = None,
    transport: Optional[httpx.BaseTransport] = None,
) -> ExternalEvolutionRun:
    """
    Step 2 (VIGILIA 4.0): Evaluate baseline vs selected candidate on the held-out evaluation split,
    run Adversarial Shift Check (±10–15% amount & timing perturbation), persist both eval experiments
    for exact tx diff, and update the ExternalEvolutionRun.

    - White-Box mode evaluates modified internal engine rules via config_override.
    - Black-Box mode NEVER modifies internal engine rules: when scored responses are available
      on a live Black-Box API, it validates ONLY the external score cutoff (block_threshold)
      and Allow / Review / Block routing policy.
    """
    baseline_experiment = db.query(Experiment).filter(Experiment.id == evo_run.baseline_experiment_id).first()
    engine = db.query(AntifraudEngine).filter(AntifraudEngine.id == evo_run.engine_id).first()
    if not baseline_experiment or not engine:
        raise ValueError("Baseline experiment or external engine not found")

    cands = evo_run.candidates_json or []
    bb_policy = deepcopy((evo_run.comparison_json or {}).get("black_box_policy") or {})

    if evo_run.mode == "black_box_manual":
        if not cands or not bb_policy.get("has_risk_scores") or engine.adapter_type != "external_api" or not engine.base_url:
            raise ValueError("Black-Box external evolution requires manual retest via CSV/JSON or updated profile")

        target_key = candidate_key or (evo_run.comparison_json or {}).get("selected_candidate_key")
        chosen = next((c for c in cands if c.get("key") == target_key), cands[0])
        override = chosen.get("override") or evo_run.proposed_config_json or {}
        block_t = float(override.get("block_threshold", bb_policy.get("recommended_block_threshold", 55.0)))
        review_t = float(override.get("review_threshold", bb_policy.get("recommended_review_threshold", max(25.0, block_t - 10.0))))

        connector = ExternalHttpConnector(engine.base_url, transport=transport)
        base_version = str(evo_run.baseline_label or engine.name)

        # Pure Black-Box evaluation: NO config_override or config inspection
        eval_base_exp = run_external_api_experiment(
            db=db,
            engine=engine,
            dataset_id=baseline_experiment.dataset_id,
            name=f"[Evo-BB-Base] {engine.name}",
            split_name="evaluation",
            scenarios=baseline_experiment.scenarios_json,
            profile=engine.active_profile,
            transport=transport,
        )

        dataset, eval_txs, eval_gt = _load_dataset_slice(
            db, baseline_experiment.dataset_id, "evaluation", baseline_experiment.scenarios_json
        )
        raw_eval_api = connector.analyze_transactions(tx_rows=eval_txs, profile=engine.active_profile)
        cand_version_label = f"{base_version}-policy-{chosen['key']}"
        eval_cand_exp, eval_routing_counts = _persist_blackbox_policy_experiment(
            db=db,
            engine=engine,
            dataset_id=baseline_experiment.dataset_id,
            tx_rows=eval_txs,
            gt_map=eval_gt,
            raw_preds=raw_eval_api["predictions"],
            processing_time_ms=raw_eval_api["processing_time_ms"],
            completeness=raw_eval_api["completeness"],
            block_threshold=block_t,
            review_threshold=review_t,
            name=f"[Evo-BB-Policy] {engine.name} ({chosen['key']})",
            split_name="evaluation",
            scenarios=baseline_experiment.scenarios_json,
            version_label=cand_version_label,
        )

        # Full-dataset policy check if original baseline covered 'all'
        _, full_txs, full_gt = _load_dataset_slice(
            db, baseline_experiment.dataset_id, baseline_experiment.split_name, baseline_experiment.scenarios_json
        )
        raw_full_api = connector.analyze_transactions(tx_rows=full_txs, profile=engine.active_profile)
        cand_full_exp, _ = _persist_blackbox_policy_experiment(
            db=db,
            engine=engine,
            dataset_id=baseline_experiment.dataset_id,
            tx_rows=full_txs,
            gt_map=full_gt,
            raw_preds=raw_full_api["predictions"],
            processing_time_ms=raw_full_api["processing_time_ms"],
            completeness=raw_full_api["completeness"],
            block_threshold=block_t,
            review_threshold=review_t,
            name=f"[Evo-BB] {engine.name} ({chosen['key']})",
            split_name=baseline_experiment.split_name,
            scenarios=baseline_experiment.scenarios_json,
            version_label=cand_version_label,
        )

        # Adversarial Shift Check on perturbed evaluation slice (Black-Box external scores)
        shift_seed = int(getattr(dataset, "seed", 42) or 42) + int(evo_run.id)
        if eval_txs:
            shifted_ns, shifted_gt = _orm_rows_to_shifted_namespaces(eval_txs, seed=shift_seed)
            shifted_raw_api = connector.analyze_transactions(tx_rows=shifted_ns, profile=engine.active_profile)
            base_shifted_m = evaluate_predictions(
                shifted_raw_api["predictions"], shifted_gt, shifted_raw_api["processing_time_ms"]
            )["metrics"]
            cand_shifted_preds, _ = _apply_blackbox_policy_predictions(
                shifted_raw_api["predictions"], block_threshold=block_t, review_threshold=review_t
            )
            cand_shifted_m = evaluate_predictions(
                cand_shifted_preds, shifted_gt, shifted_raw_api["processing_time_ms"]
            )["metrics"]
            adversarial_shift = summarize_adversarial_shift(
                cand_clean_metrics=eval_cand_exp.metrics_json,
                cand_shifted_metrics=cand_shifted_m,
                base_shifted_metrics=base_shifted_m,
                guardrails=DEFAULT_GUARDRAILS,
                tx_count=len(eval_txs),
                seed=shift_seed,
            )
        else:
            adversarial_shift = {"status": "unavailable", "passed": True, "reason": "No evaluation transactions."}

        val_cmp_final = (evo_run.comparison_json or {}).get("validation_split") or _compare_metric_dicts(
            eval_base_exp.metrics_json, eval_cand_exp.metrics_json
        )
        eval_cmp_final = _compare_metric_dicts(eval_base_exp.metrics_json, eval_cand_exp.metrics_json)
        verdict, assessment, gr_report = evaluate_evolution_verdict(
            val_cmp=val_cmp_final,
            eval_cmp=eval_cmp_final,
            changed_params_count=len(override),
            adversarial_shift=adversarial_shift,
        )
        scen_bundle = compute_matched_scenario_comparison(
            db=db,
            baseline_experiment_id=eval_base_exp.id,
            candidate_experiment_id=eval_cand_exp.id,
        )
        total_rc = max(1, int(eval_routing_counts["total"]))
        bb_policy.update(
            {
                "scope": "external_threshold_and_routing_only",
                "internal_rules_modified": False,
                "has_risk_scores": True,
                "routing_supported": True,
                "recommended_block_threshold": block_t,
                "recommended_review_threshold": review_t,
                "routing_zones": {
                    "allow": f"< {review_t:.0f}",
                    "review": f"{review_t:.0f}–{block_t:.0f}",
                    "block": f">= {block_t:.0f}",
                },
                "routing_counts": eval_routing_counts,
                "review_queue_share": round(float(eval_routing_counts["review"]) / total_rc, 4),
            }
        )

        evo_run.candidate_experiment_id = cand_full_exp.id
        evo_run.candidate_label = cand_version_label
        evo_run.proposed_config_json = {"block_threshold": block_t, "review_threshold": review_t}
        evo_run.comparison_json = {
            **(evo_run.comparison_json or {}),
            "baseline_version": base_version,
            "candidate_version": cand_version_label,
            "selected_candidate_key": chosen["key"],
            "selected_candidate_name": chosen["name"],
            "final_baseline_experiment_id": eval_base_exp.id,
            "final_candidate_experiment_id": eval_cand_exp.id,
            "validation_split": val_cmp_final,
            "evaluation_split": eval_cmp_final,
            "scenario_comparison": scen_bundle["items"],
            "scenario_audit": scen_bundle["audit"],
            "param_details": chosen.get("param_details") or (evo_run.comparison_json or {}).get("param_details", []),
            "validation_unfixed_weaknesses": chosen.get("validation_unfixed_weaknesses", []),
            "evaluation_remaining_weaknesses": _collect_unfixed_weaknesses(eval_cand_exp.scenario_metrics_json),
            "black_box_policy": bb_policy,
            "adversarial_shift": adversarial_shift,
            "guardrails": DEFAULT_GUARDRAILS,
            "guardrail_report": gr_report,
        }
        evo_run.verdict = verdict
        evo_run.tradeoff_assessment = assessment
        evo_run.status = "completed"
        db.commit()
        db.refresh(evo_run)
        return evo_run

    # Mode 1: Configurable White-Box external engine (edits internal engine parameters via config_override)
    if not engine.base_url:
        raise ValueError("Baseline experiment or reachable external engine not found")

    if not cands:
        raise ValueError("No candidate configurations available for validation")

    target_key = candidate_key or (evo_run.comparison_json or {}).get("selected_candidate_key")
    chosen = next((c for c in cands if c.get("key") == target_key), cands[-1])
    override = chosen.get("override") or evo_run.proposed_config_json or {}

    connector = ExternalHttpConnector(engine.base_url, transport=transport)
    cfg_payload = connector.fetch_config(profile=engine.active_profile)
    base_version = str(cfg_payload.get("engine_version") or evo_run.baseline_label or "baseline")

    # Persist baseline & candidate evaluation split experiments so transaction-level diff works cleanly
    eval_base_exp = run_external_api_experiment(
        db=db,
        engine=engine,
        dataset_id=baseline_experiment.dataset_id,
        name=f"[Evo-Ext-Base] {engine.name}",
        split_name="evaluation",
        scenarios=baseline_experiment.scenarios_json,
        profile=engine.active_profile,
        transport=transport,
    )
    eval_cand_exp = run_external_api_experiment(
        db=db,
        engine=engine,
        dataset_id=baseline_experiment.dataset_id,
        name=f"[Evo-Ext-Cand] {engine.name} ({chosen['key']})",
        split_name="evaluation",
        scenarios=baseline_experiment.scenarios_json,
        profile=engine.active_profile,
        config_override=override,
        transport=transport,
    )

    val_cmp_final = (evo_run.comparison_json or {}).get("validation_split") or _compare_metric_dicts(
        chosen.get("validation_metrics") or eval_base_exp.metrics_json,
        chosen.get("validation_metrics") or eval_cand_exp.metrics_json,
    )
    eval_cmp_final = _compare_metric_dicts(eval_base_exp.metrics_json, eval_cand_exp.metrics_json)

    # Adversarial Shift Check (±10–15% amounts & intervals) on evaluation slice
    dataset, eval_txs, _ = _load_dataset_slice(
        db, baseline_experiment.dataset_id, "evaluation", baseline_experiment.scenarios_json
    )
    shift_seed = int(getattr(dataset, "seed", 42) or 42) + int(evo_run.id)
    if eval_txs:
        shifted_ns, shifted_gt = _orm_rows_to_shifted_namespaces(eval_txs, seed=shift_seed)
        base_sh_api = connector.analyze_transactions(
            tx_rows=shifted_ns,
            profile=engine.active_profile,
        )
        cand_sh_api = connector.analyze_transactions(
            tx_rows=shifted_ns,
            profile=engine.active_profile,
            config_override=override,
        )
        base_sh_m = evaluate_predictions(base_sh_api["predictions"], shifted_gt, base_sh_api["processing_time_ms"])["metrics"]
        cand_sh_m = evaluate_predictions(cand_sh_api["predictions"], shifted_gt, cand_sh_api["processing_time_ms"])["metrics"]
        adversarial_shift = summarize_adversarial_shift(
            cand_clean_metrics=eval_cand_exp.metrics_json,
            cand_shifted_metrics=cand_sh_m,
            base_shifted_metrics=base_sh_m,
            guardrails=DEFAULT_GUARDRAILS,
            tx_count=len(eval_txs),
            seed=shift_seed,
        )
    else:
        adversarial_shift = {"status": "unavailable", "passed": True, "reason": "No evaluation transactions."}

    verdict, assessment, gr_report = evaluate_evolution_verdict(
        val_cmp=val_cmp_final,
        eval_cmp=eval_cmp_final,
        changed_params_count=len(override),
        adversarial_shift=adversarial_shift,
    )

    # Full-dataset candidate check for user inspection/history
    cand_full_exp = run_external_api_experiment(
        db=db,
        engine=engine,
        dataset_id=baseline_experiment.dataset_id,
        name=f"[Evo-Ext] {engine.name} ({chosen['key']})",
        split_name=baseline_experiment.split_name,
        scenarios=baseline_experiment.scenarios_json,
        profile=engine.active_profile,
        config_override=override,
        transport=transport,
    )

    scen_bundle = compute_matched_scenario_comparison(
        db=db,
        baseline_experiment_id=eval_base_exp.id,
        candidate_experiment_id=eval_cand_exp.id,
    )
    scen_cmp = scen_bundle["items"]
    scen_audit = scen_bundle["audit"]
    eval_remaining_weaknesses = _collect_unfixed_weaknesses(eval_cand_exp.scenario_metrics_json)

    cand_version_label = f"{base_version}-tuned-{chosen['key']}"
    evo_run.candidate_experiment_id = cand_full_exp.id
    evo_run.candidate_label = cand_version_label
    evo_run.proposed_config_json = override
    evo_run.comparison_json = {
        **(evo_run.comparison_json or {}),
        "baseline_version": base_version,
        "candidate_version": cand_version_label,
        "selected_candidate_key": chosen["key"],
        "selected_candidate_name": chosen["name"],
        "final_baseline_experiment_id": eval_base_exp.id,
        "final_candidate_experiment_id": eval_cand_exp.id,
        "validation_split": val_cmp_final,
        "evaluation_split": eval_cmp_final,
        "scenario_comparison": scen_cmp,
        "scenario_audit": scen_audit,
        "param_details": chosen.get("param_details") or (evo_run.comparison_json or {}).get("param_details", []),
        "validation_unfixed_weaknesses": chosen.get("validation_unfixed_weaknesses", []),
        "evaluation_remaining_weaknesses": eval_remaining_weaknesses,
        "white_box_policy": {"scope": "internal_engine_parameters", "internal_rules_modified": True},
        "adversarial_shift": adversarial_shift,
        "guardrails": DEFAULT_GUARDRAILS,
        "guardrail_report": gr_report,
    }
    evo_run.verdict = verdict
    evo_run.tradeoff_assessment = assessment
    evo_run.status = "completed"
    db.commit()
    db.refresh(evo_run)
    return evo_run


def run_external_evolution(
    db: Session,
    baseline_experiment: Experiment,
    engine: AntifraudEngine,
    transport: Optional[httpx.BaseTransport] = None,
) -> ExternalEvolutionRun:
    """
    Backward-compatible one-shot wrapper executing analysis + held-out validation.
    Mode 1 (Configurable White-Box): Tune & verify bounded candidate overrides on validation,
    then evaluate baseline vs selected candidate on held-out evaluation split.
    Mode 2 (Black-Box): Prepare verifiable recommendations & failed test cases; await manual retest.
    """
    run = analyze_external_evolution(
        db=db,
        baseline_experiment=baseline_experiment,
        engine=engine,
        transport=transport,
    )
    if run.mode == "configurable_white_box":
        return validate_external_evolution(db=db, evo_run=run, transport=transport)
    return run


def retest_external_blackbox(
    db: Session,
    evo_run: ExternalEvolutionRun,
    engine: AntifraudEngine,
    file_format: Optional[str] = None,
    content: Optional[str] = None,
    version_label: str = "Updated v2",
    profile: Optional[str] = None,
    transport: Optional[httpx.BaseTransport] = None,
) -> ExternalEvolutionRun:
    """
    Re-evaluate an updated Black-Box external engine (via CSV/JSON upload or updated local service profile)
    on the exact same dataset & split as the baseline experiment.
    """
    base_exp = db.query(Experiment).filter(Experiment.id == evo_run.baseline_experiment_id).first()
    if not base_exp:
        raise ValueError("Baseline experiment not found")

    if file_format and content is not None:
        cand_exp = run_imported_experiment(
            db=db,
            engine=engine,
            dataset_id=base_exp.dataset_id,
            name=f"[Retest] {engine.name} ({version_label})",
            file_format=file_format,
            content=content,
            version_label=version_label,
            split_name=base_exp.split_name,
            scenarios=base_exp.scenarios_json,
        )
    elif engine.adapter_type == "external_api" and engine.base_url:
        cand_exp = run_external_api_experiment(
            db=db,
            engine=engine,
            dataset_id=base_exp.dataset_id,
            name=f"[Retest] {engine.name} ({profile or 'updated'})",
            split_name=base_exp.split_name,
            scenarios=base_exp.scenarios_json,
            profile=profile or "updated",
            transport=transport,
        )
    else:
        raise ValueError("Provide CSV/JSON predictions or a reachable external API engine for retest")

    adversarial_shift: Dict[str, Any] = {
        "status": "unavailable",
        "passed": True,
        "reason": "Static CSV/JSON retest cannot re-score perturbed transactions offline.",
    }
    if not (file_format and content is not None) and engine.adapter_type == "external_api" and engine.base_url:
        dataset, eval_txs, eval_gt = _load_dataset_slice(
            db, base_exp.dataset_id, "evaluation", base_exp.scenarios_json
        )
        if eval_txs:
            shift_seed = int(getattr(dataset, "seed", 42) or 42) + int(evo_run.id)
            shifted_ns, shifted_gt = _orm_rows_to_shifted_namespaces(eval_txs, seed=shift_seed)
            sh_conn = ExternalHttpConnector(engine.base_url, transport=transport)
            cand_clean_eval_m = cand_exp.metrics_json
            if base_exp.split_name != "evaluation":
                clean_eval_api = sh_conn.analyze_transactions(tx_rows=eval_txs, profile=profile or "updated")
                cand_clean_eval_m = evaluate_predictions(
                    clean_eval_api["predictions"], eval_gt, clean_eval_api["processing_time_ms"]
                )["metrics"]
            base_sh_api = sh_conn.analyze_transactions(tx_rows=shifted_ns, profile=engine.active_profile)
            cand_sh_api = sh_conn.analyze_transactions(tx_rows=shifted_ns, profile=profile or "updated")
            base_sh_m = evaluate_predictions(base_sh_api["predictions"], shifted_gt, base_sh_api["processing_time_ms"])["metrics"]
            cand_sh_m = evaluate_predictions(cand_sh_api["predictions"], shifted_gt, cand_sh_api["processing_time_ms"])["metrics"]
            adversarial_shift = summarize_adversarial_shift(
                cand_clean_metrics=cand_clean_eval_m,
                cand_shifted_metrics=cand_sh_m,
                base_shifted_metrics=base_sh_m,
                guardrails=DEFAULT_GUARDRAILS,
                tx_count=len(eval_txs),
                seed=shift_seed,
            )

    cmp_slice = _compare_metric_dicts(base_exp.metrics_json, cand_exp.metrics_json)
    verdict, assessment, gr_report = evaluate_evolution_verdict(
        val_cmp=cmp_slice,
        eval_cmp=cmp_slice,
        changed_params_count=1,
        adversarial_shift=adversarial_shift,
    )
    scen_bundle = compute_matched_scenario_comparison(
        db=db,
        baseline_experiment_id=base_exp.id,
        candidate_experiment_id=cand_exp.id,
    )
    scen_cmp = scen_bundle["items"]
    scen_audit = scen_bundle["audit"]
    eval_remaining_weaknesses = _collect_unfixed_weaknesses(cand_exp.scenario_metrics_json)

    evo_run.candidate_experiment_id = cand_exp.id
    evo_run.candidate_label = cand_exp.engine_version_label or version_label
    evo_run.comparison_json = {
        **(evo_run.comparison_json or {}),
        "baseline_version": evo_run.baseline_label,
        "candidate_version": evo_run.candidate_label,
        "final_baseline_experiment_id": base_exp.id,
        "final_candidate_experiment_id": cand_exp.id,
        "evaluation_split": cmp_slice,
        "scenario_comparison": scen_cmp,
        "scenario_audit": scen_audit,
        "evaluation_remaining_weaknesses": eval_remaining_weaknesses,
        "adversarial_shift": adversarial_shift,
        "guardrails": DEFAULT_GUARDRAILS,
        "guardrail_report": gr_report,
    }
    evo_run.verdict = verdict
    evo_run.tradeoff_assessment = assessment
    evo_run.status = "completed"
    db.commit()
    db.refresh(evo_run)
    return evo_run


def compare_two_engines(
    db: Session,
    dataset_id: int,
    split_name: str,
    left_engine: Optional[AntifraudEngine] = None,
    right_engine: Optional[AntifraudEngine] = None,
    left_experiment_id: Optional[int] = None,
    right_experiment_id: Optional[int] = None,
    transport: Optional[httpx.BaseTransport] = None,
) -> EngineComparison:
    """
    Compare two antifraud engines on the exact same dataset & split without single-metric bias.
    """
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise ValueError("Dataset not found")

    def resolve_exp(
        exp_id: Optional[int], eng: Optional[AntifraudEngine]
    ) -> Experiment:
        if exp_id is not None:
            found = db.query(Experiment).filter(Experiment.id == exp_id).first()
            if not found:
                raise ValueError(f"Experiment #{exp_id} not found")
            if found.dataset_id != dataset_id or found.split_name != split_name:
                raise ValueError(
                    "Both compared experiments must evaluate the exact same dataset and split."
                )
            return found
        if eng is None:
            raise ValueError("Engine or experiment_id must be provided for comparison")
        if eng.adapter_type == "internal":
            base_cfg = (
                db.query(DefenseConfiguration)
                .filter(DefenseConfiguration.is_baseline.is_(True))
                .order_by(DefenseConfiguration.id.asc())
                .first()
            )
            if not base_cfg:
                raise ValueError("Baseline DefenseConfiguration not found")
            return run_experiment_pipeline(
                db=db,
                dataset=dataset,
                defense_config=base_cfg,
                name=f"[Compare] {eng.name} ({base_cfg.version})",
                split_name=split_name,
                scenarios=dataset.scenarios_json,
            )
        if eng.adapter_type == "external_api":
            return run_external_api_experiment(
                db=db,
                engine=eng,
                dataset_id=dataset_id,
                name=f"[Compare] {eng.name}",
                split_name=split_name,
                scenarios=dataset.scenarios_json,
                transport=transport,
            )
        raise ValueError("Imported engines must be compared via an existing experiment_id")

    left_exp = resolve_exp(left_experiment_id, left_engine)
    right_exp = resolve_exp(right_experiment_id, right_engine)

    lm = left_exp.metrics_json
    rm = right_exp.metrics_json
    left_label = f"{left_exp.engine_name} ({left_exp.engine_version_label or 'baseline'})"
    right_label = f"{right_exp.engine_name} ({right_exp.engine_version_label or 'external'})"

    rec_diff_pp = round((float(rm.get("recall", 0.0)) - float(lm.get("recall", 0.0))) * 100, 2)
    fpr_diff_pp = round(
        (float(rm.get("false_positive_rate", 0.0)) - float(lm.get("false_positive_rate", 0.0))) * 100,
        2,
    )

    l_scen = {s["scenario_type"]: s for s in (left_exp.scenario_metrics_json or [])}
    r_scen = {s["scenario_type"]: s for s in (right_exp.scenario_metrics_json or [])}
    scenario_rows = []
    for sk in sorted(set(l_scen.keys()) | set(r_scen.keys())):
        ls = l_scen.get(sk, {})
        rs = r_scen.get(sk, {})
        scenario_rows.append(
            {
                "scenario_type": sk,
                "left_recall": ls.get("recall", 0.0),
                "right_recall": rs.get("recall", 0.0),
                "left_fpr": ls.get("false_positive_rate", 0.0),
                "right_fpr": rs.get("false_positive_rate", 0.0),
            }
        )

    summary_text = (
        f"{left_label}: Recall={float(lm.get('recall', 0)):.1%}, FPR={float(lm.get('false_positive_rate', 0)):.2%}, F1={float(lm.get('f1_score', 0)):.1%}. "
        f"{right_label}: Recall={float(rm.get('recall', 0)):.1%}, FPR={float(rm.get('false_positive_rate', 0)):.2%}, F1={float(rm.get('f1_score', 0)):.1%}. "
        f"Trade-off delta (Right vs Left): Recall {rec_diff_pp:+.1f} pp, FPR {fpr_diff_pp:+.2f} pp."
    )

    comp = EngineComparison(
        name=f"{left_exp.engine_name} vs {right_exp.engine_name}",
        dataset_id=dataset_id,
        split_name=split_name,
        left_experiment_id=left_exp.id,
        right_experiment_id=right_exp.id,
        comparison_json={
            "left": {
                "experiment_id": left_exp.id,
                "engine_name": left_exp.engine_name,
                "version": left_exp.engine_version_label or "baseline",
                "metrics": lm,
                "completeness": left_exp.completeness_json or {},
            },
            "right": {
                "experiment_id": right_exp.id,
                "engine_name": right_exp.engine_name,
                "version": right_exp.engine_version_label or "external",
                "metrics": rm,
                "completeness": right_exp.completeness_json or {},
            },
            "scenario_comparison": scenario_rows,
            "recall_diff_pp": rec_diff_pp,
            "fpr_diff_pp": fpr_diff_pp,
        },
        summary_text=summary_text,
    )
    db.add(comp)
    db.commit()
    db.refresh(comp)
    return comp
