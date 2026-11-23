"""Report builder service for JSON, CSV, and printable HTML export of experiments and benchmarks."""

from __future__ import annotations

import csv
import html
import io
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from ..models import (
    BenchmarkRun,
    Dataset,
    DefenseConfiguration,
    EvolutionRun,
    Experiment,
    ExperimentResult,
    ExternalEvolutionRun,
    Recommendation,
)

SCENARIO_LABELS: Dict[str, str] = {
    "normal_activity": "Обычная активность (normal_activity)",
    "unusual_amount": "Необычная сумма (unusual_amount)",
    "new_recipient_risk": "Новый получатель (new_recipient_risk)",
    "duplicate_payment": "Повторный платёж (duplicate_payment)",
    "suspicious_sequence": "Подозрительная серия (suspicious_sequence)",
    "structuring_smurfing": "Дробление сумм / Smurfing (structuring_smurfing)",
    "account_takeover_ato": "Захват аккаунта / ATO (account_takeover_ato)",
}


def _scenario_label(scenario_type: str) -> str:
    return SCENARIO_LABELS.get(scenario_type, scenario_type)


def _fmt_kzt(val: Any) -> str:
    try:
        num = float(val or 0.0)
    except (TypeError, ValueError):
        num = 0.0
    return f"{num:,.0f}".replace(",", " ") + " ₸"


def _sanitize_csv_cell(value: Any) -> Any:
    """Protect exported CSV cells against spreadsheet formula injection (=, +, -, @, tab, cr)."""
    if isinstance(value, str) and value and value[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


def build_experiment_report(db: Session, experiment: Experiment) -> Dict[str, Any]:
    dataset = db.query(Dataset).filter(Dataset.id == experiment.dataset_id).first()
    defense = (
        db.query(DefenseConfiguration)
        .filter(DefenseConfiguration.id == experiment.defense_config_id)
        .first()
    )
    recs = (
        db.query(Recommendation)
        .filter(Recommendation.experiment_id == experiment.id)
        .all()
    )
    evo = (
        db.query(EvolutionRun)
        .filter(
            (EvolutionRun.baseline_experiment_id == experiment.id)
            | (EvolutionRun.final_candidate_experiment_id == experiment.id)
        )
        .order_by(EvolutionRun.id.desc())
        .first()
    )
    ext_evo = (
        None
        if evo
        else db.query(ExternalEvolutionRun)
        .filter(
            (ExternalEvolutionRun.baseline_experiment_id == experiment.id)
            | (ExternalEvolutionRun.final_candidate_experiment_id == experiment.id)
        )
        .order_by(ExternalEvolutionRun.id.desc())
        .first()
    )

    metrics = experiment.metrics_json or {}
    comp_json = (
        (evo.comparison_json if evo else None)
        or (ext_evo.comparison_json if ext_evo else None)
        or {}
    )
    deltas = comp_json.get("deltas") or {}
    adv_shift = comp_json.get("adversarial_shift")

    business_metrics: Dict[str, Any] = {
        "prevented_fraud_amount": float(metrics.get("prevented_fraud_amount", 0.0)),
        "missed_fraud_amount": float(metrics.get("missed_fraud_amount", 0.0)),
        "false_decline_amount": float(metrics.get("false_decline_amount", 0.0)),
        "review_queue_count": int(metrics.get("review_queue_count", 0)),
        "review_queue_rate": float(metrics.get("review_queue_rate", 0.0)),
    }
    if deltas:
        business_metrics["deltas"] = {
            "delta_prevented_fraud_amount": deltas.get("delta_prevented_fraud_amount"),
            "delta_missed_fraud_amount": deltas.get("delta_missed_fraud_amount"),
            "delta_false_decline_amount": deltas.get("delta_false_decline_amount"),
            "delta_review_queue_count": deltas.get("delta_review_queue_count"),
            "delta_review_queue_rate": deltas.get("delta_review_queue_rate"),
        }

    scenario_metrics_enriched = []
    for s in experiment.scenario_metrics_json or []:
        row = dict(s)
        row.setdefault("scenario_label", _scenario_label(str(s.get("scenario_type", ""))))
        scenario_metrics_enriched.append(row)

    evolution_context: Optional[Dict[str, Any]] = None
    if evo:
        evolution_context = {
            "kind": "internal_evolution",
            "evolution_run_id": evo.id,
            "verdict": evo.verdict,
            "selected_candidate_key": evo.selected_candidate_key,
            "tradeoff_assessment": evo.tradeoff_assessment,
            "comparison": evo.comparison_json,
            "guardrails": evo.guardrails_json,
            "adversarial_shift": adv_shift,
        }
    elif ext_evo:
        evolution_context = {
            "kind": "external_evolution",
            "evolution_run_id": ext_evo.id,
            "mode": ext_evo.mode,
            "verdict": comp_json.get("verdict") or ext_evo.status,
            "selected_candidate_key": comp_json.get("selected_candidate_key"),
            "tradeoff_assessment": comp_json.get("tradeoff_assessment"),
            "comparison": ext_evo.comparison_json,
            "adversarial_shift": adv_shift,
        }

    return {
        "report_metadata": {
            "platform": "VIGILIA 4.0 — Intelligent Bank Defense Laboratory",
            "experiment_id": experiment.id,
            "experiment_name": experiment.name,
            "created_at": experiment.created_at.isoformat(),
            "disclaimer": (
                "Generated from isolated synthetic Virtual Bank Simulator data. "
                "Does not represent real customer data or production bank infrastructure."
            ),
        },
        "dataset": {
            "id": dataset.id if dataset else None,
            "name": dataset.name if dataset else None,
            "seed": dataset.seed if dataset else None,
            "transaction_count": dataset.transaction_count if dataset else None,
            "customer_count": dataset.customer_count if dataset else None,
            "risk_ratio": dataset.risk_ratio if dataset else None,
            "split_name": experiment.split_name,
        },
        "defense_configuration": {
            "id": defense.id if defense else None,
            "name": experiment.engine_name if experiment.adapter_type != "internal" else (defense.name if defense else None),
            "version": experiment.engine_version_label or (defense.version if defense else None),
            "adapter_type": experiment.adapter_type,
            "diagnostic_mode": experiment.diagnostic_mode,
            "decision_threshold": (
                experiment.external_config_json.get("decision_threshold")
                if experiment.adapter_type != "internal"
                else (defense.decision_threshold if defense else None)
            ),
            "rules_config": (
                experiment.external_config_json
                if experiment.adapter_type != "internal"
                else (defense.rules_config_json if defense else {})
            ),
            "changed_params": defense.changed_params_json if defense else [],
        },
        "completeness": experiment.completeness_json or {},
        "metrics": metrics,
        "business_metrics": business_metrics,
        "adversarial_shift": adv_shift,
        "confusion_matrix": experiment.confusion_matrix_json,
        "scenario_metrics": scenario_metrics_enriched,
        "rule_impact": experiment.rule_impact_json,
        "summary": experiment.summary_text,
        "recommendations": [
            {
                "target_rule": r.target_rule,
                "issue_category": r.issue_category,
                "severity": r.severity,
                "title": r.title,
                "explanation": r.explanation,
                "proposed_changes": r.proposed_changes_json,
                "expected_impact": r.expected_impact,
            }
            for r in recs
        ],
        "evolution_context": evolution_context,
    }


def build_experiment_csv(db: Session, experiment: Experiment) -> str:
    results = (
        db.query(ExperimentResult)
        .filter(ExperimentResult.experiment_id == experiment.id)
        .order_by(ExperimentResult.timestamp.asc(), ExperimentResult.id.asc())
        .all()
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "transaction_code",
            "customer_code",
            "recipient_code",
            "amount_kzt",
            "timestamp",
            "scenario_type",
            "split_name",
            "risk_score",
            "risk_level",
            "predicted_label",
            "ground_truth_label",
            "triggered_rules",
            "explanation",
        ]
    )
    for r in results:
        rules_str = "|".join(tr["rule"] for tr in (r.triggered_rules_json or []))
        writer.writerow(
            [
                _sanitize_csv_cell(r.transaction_code),
                _sanitize_csv_cell(r.customer_code),
                _sanitize_csv_cell(r.recipient_code),
                r.amount_kzt,
                r.timestamp.isoformat(),
                _sanitize_csv_cell(r.scenario_type),
                _sanitize_csv_cell(r.split_name),
                r.risk_score,
                _sanitize_csv_cell(r.risk_level),
                r.predicted_label,
                r.ground_truth_label,
                _sanitize_csv_cell(rules_str),
                _sanitize_csv_cell(r.explanation),
            ]
        )

    rep = build_experiment_report(db, experiment)
    biz = rep.get("business_metrics") or {}
    biz_deltas = biz.get("deltas") or {}
    writer.writerow([])
    writer.writerow(["[BUSINESS_METRICS]"])
    writer.writerow(["metric", "value", "evolution_delta"])
    writer.writerow(["prevented_fraud_amount", biz.get("prevented_fraud_amount", 0.0), biz_deltas.get("delta_prevented_fraud_amount", "")])
    writer.writerow(["missed_fraud_amount", biz.get("missed_fraud_amount", 0.0), biz_deltas.get("delta_missed_fraud_amount", "")])
    writer.writerow(["false_decline_amount", biz.get("false_decline_amount", 0.0), biz_deltas.get("delta_false_decline_amount", "")])
    writer.writerow(["review_queue_count", biz.get("review_queue_count", 0), biz_deltas.get("delta_review_queue_count", "")])
    writer.writerow(["review_queue_rate", biz.get("review_queue_rate", 0.0), biz_deltas.get("delta_review_queue_rate", "")])

    writer.writerow([])
    writer.writerow(["[SCENARIO_METRICS]"])
    writer.writerow([
        "scenario_type",
        "scenario_label",
        "total_transactions",
        "actual_risk_events",
        "true_positives",
        "false_positives",
        "false_negatives",
        "recall",
        "precision",
        "f1_score",
        "false_positive_rate",
    ])
    for s in rep.get("scenario_metrics") or []:
        writer.writerow([
            _sanitize_csv_cell(s.get("scenario_type", "")),
            _sanitize_csv_cell(s.get("scenario_label", "")),
            s.get("total_transactions", 0),
            s.get("actual_risk_events", 0),
            s.get("true_positives", 0),
            s.get("false_positives", 0),
            s.get("false_negatives", 0),
            s.get("recall", 0.0),
            s.get("precision", 0.0),
            s.get("f1_score", 0.0),
            s.get("false_positive_rate", 0.0),
        ])

    adv = rep.get("adversarial_shift")
    if adv:
        clean_m = adv.get("candidate_clean_metrics") or {}
        shifted_m = adv.get("candidate_shifted_metrics") or {}
        writer.writerow([])
        writer.writerow(["[ADVERSARIAL_SHIFT_CHECK]"])
        writer.writerow([
            "status",
            "passed",
            "clean_recall",
            "shifted_recall",
            "recall_delta_vs_clean",
            "shifted_fpr",
            "fpr_delta_vs_clean",
            "recall_gain_vs_baseline_shifted",
            "reason",
        ])
        writer.writerow([
            _sanitize_csv_cell(adv.get("status", "")),
            adv.get("passed", ""),
            clean_m.get("recall", ""),
            shifted_m.get("recall", ""),
            adv.get("recall_delta_vs_clean", ""),
            shifted_m.get("false_positive_rate", ""),
            adv.get("fpr_delta_vs_clean", ""),
            adv.get("recall_gain_vs_baseline_shifted", ""),
            _sanitize_csv_cell(adv.get("reason", "")),
        ])

    return buf.getvalue()


def build_printable_html_report(db: Session, experiment: Experiment) -> str:
    rep = build_experiment_report(db, experiment)
    m = rep["metrics"]
    biz = rep.get("business_metrics") or {}
    biz_deltas = biz.get("deltas") or {}
    adv = rep.get("adversarial_shift")
    ds = rep["dataset"]
    df = rep["defense_configuration"]

    def _fmt_delta_kzt(val: Any) -> str:
        if val is None or val == "":
            return ""
        num = float(val)
        sign = "+" if num >= 0 else "-"
        return f"{sign}{_fmt_kzt(abs(num))}"

    scen_rows_html = ""
    for s in rep["scenario_metrics"]:
        sc_type = str(s.get("scenario_type", ""))
        sc_label = str(s.get("scenario_label") or _scenario_label(sc_type))
        scen_rows_html += (
            f"<tr>"
            f"<td><strong>{html.escape(sc_label)}</strong></td>"
            f"<td class='num'>{s['total_transactions']}</td>"
            f"<td class='num'>{s['actual_risk_events']}</td>"
            f"<td class='num'>{s['true_positives']}</td>"
            f"<td class='num'>{s['false_positives']}</td>"
            f"<td class='num'>{s['false_negatives']}</td>"
            f"<td class='num'>{float(s['recall']) * 100:.1f}%</td>"
            f"<td class='num'>{float(s['precision']) * 100:.1f}%</td>"
            f"<td class='num'>{float(s['f1_score']) * 100:.1f}%</td>"
            f"<td class='num'>{float(s['false_positive_rate']) * 100:.2f}%</td>"
            f"</tr>"
        )

    rec_rows_html = ""
    for r in rep["recommendations"]:
        rec_rows_html += (
            f"<li><strong>[{html.escape(r['target_rule'])}] {html.escape(r['title'])}</strong>: "
            f"{html.escape(r['explanation'])}</li>"
        )

    adv_html = ""
    if adv:
        st = str(adv.get("status", ""))
        passed = bool(adv.get("passed"))
        if st != "evaluated":
            badge_cls = "badge-muted"
            badge_txt = "Недоступно (статический импорт)"
        elif passed:
            badge_cls = "badge-good"
            badge_txt = "Устойчиво к сдвигу (±10–15%)"
        else:
            badge_cls = "badge-bad"
            badge_txt = "Чувствительность к сдвигу"

        clean_m = adv.get("candidate_clean_metrics") or {}
        shifted_m = adv.get("candidate_shifted_metrics") or {}
        adv_cards_html = ""
        if st == "evaluated" and clean_m and shifted_m:
            rec_delta = float(adv.get("recall_delta_vs_clean") or 0.0) * 100
            fpr_delta = float(adv.get("fpr_delta_vs_clean") or 0.0) * 100
            vs_base = float(adv.get("recall_gain_vs_baseline_shifted") or 0.0) * 100
            adv_cards_html = f"""
            <div class="grid">
              <div class="card"><div class="label">Clean Recall</div><div class="val">{float(clean_m.get('recall', 0)) * 100:.1f}%</div></div>
              <div class="card"><div class="label">Shifted Recall</div><div class="val">{float(shifted_m.get('recall', 0)) * 100:.1f}% <span class="sub">({rec_delta:+.1f}%)</span></div></div>
              <div class="card"><div class="label">Shifted FPR</div><div class="val">{float(shifted_m.get('false_positive_rate', 0)) * 100:.2f}% <span class="sub">({fpr_delta:+.2f}%)</span></div></div>
              <div class="card"><div class="label">К базе на сдвиге</div><div class="val val-good">{vs_base:+.1f} п.п.</div></div>
            </div>
            """
        reason_txt = html.escape(str(adv.get("reason") or ""))
        adv_html = f"""
        <h2>Adversarial Shift Check (±10–15%) <span class="badge {badge_cls}">{badge_txt}</span></h2>
        {adv_cards_html}
        {f'<p style="font-size:12px;color:#526068;">{reason_txt}</p>' if reason_txt else ''}
        """

    rev_count = int(biz.get("review_queue_count", 0))
    rev_rate_pct = float(biz.get("review_queue_rate", 0.0)) * 100
    d_prev = _fmt_delta_kzt(biz_deltas.get("delta_prevented_fraud_amount"))
    d_miss = _fmt_delta_kzt(biz_deltas.get("delta_missed_fraud_amount"))
    d_fp = _fmt_delta_kzt(biz_deltas.get("delta_false_decline_amount"))
    d_rev = biz_deltas.get("delta_review_queue_count")
    d_rev_str = f" ({int(d_rev):+d})" if d_rev is not None else ""

    return f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>VIGILIA Report #{experiment.id} — {html.escape(experiment.name)}</title>
  <style>
    body {{ font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17262E; background: #FFFFFF; margin: 32px; line-height: 1.5; }}
    .header {{ border-bottom: 2px solid #008F36; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }}
    h1 {{ margin: 0; font-size: 22px; color: #10241B; }}
    h2 {{ font-size: 15px; color: #10241B; border-bottom: 1px solid #E4E9ED; padding-bottom: 6px; margin-top: 26px; display: flex; align-items: center; gap: 10px; }}
    .meta {{ font-size: 12px; color: #5C6B73; }}
    .grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 14px 0; }}
    .card {{ border: 1px solid #E4E9ED; border-radius: 10px; padding: 12px 14px; background: #F7FAF8; }}
    .card-danger {{ background: #FFF6F6; border-color: #F5C2C7; }}
    .card-good {{ background: #F2FBF5; border-color: #B7E4C7; }}
    .card .label {{ font-size: 11px; color: #5C6B73; text-transform: uppercase; letter-spacing: 0.03em; font-weight: 600; }}
    .card .val {{ font-size: 20px; font-weight: 700; color: #142B34; margin-top: 4px; font-variant-numeric: tabular-nums; }}
    .card .val-good {{ color: #008F36; }}
    .card .val-danger {{ color: #C92A3A; }}
    .card .sub {{ font-size: 12px; font-weight: 600; color: #5C6B73; }}
    .badge {{ display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }}
    .badge-good {{ background: #E6F7EC; color: #007F30; }}
    .badge-bad {{ background: #FDECEC; color: #C92A3A; }}
    .badge-muted {{ background: #EEF1F3; color: #5C6B73; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 12px; }}
    th, td {{ border: 1px solid #E4E9ED; padding: 8px 10px; text-align: left; }}
    th {{ background: #F6F8FA; color: #5C6B73; text-transform: uppercase; font-size: 11px; }}
    td.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
    .disclaimer {{ margin-top: 28px; padding: 12px; border: 1px solid #E4E9ED; border-radius: 8px; font-size: 11px; color: #5C6B73; background: #F6F8FA; }}
    @media print {{ .no-print {{ display: none; }} body {{ margin: 12px; }} }}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>VIGILIA 4.0 — Intelligent Bank Defense Laboratory</h1>
      <div class="meta">Experiment Report #{experiment.id}: {html.escape(experiment.name)}</div>
    </div>
    <div class="meta" style="text-align:right;">
      <div>Defense: <strong>{html.escape(str(df.get('version')))}</strong> (Threshold {df.get('decision_threshold')})</div>
      <div>Dataset: {html.escape(str(ds.get('name')))} (Seed {ds.get('seed')}, Split: {html.escape(str(ds.get('split_name')))})</div>
    </div>
  </div>
  <button class="no-print" onclick="window.print()" style="padding:8px 16px;background:#008F36;color:#fff;border:none;border-radius:999px;font-weight:600;cursor:pointer;">Print / Save PDF</button>

  <h2>Ключевые метрики защиты</h2>
  <div class="grid">
    <div class="card"><div class="label">Recall</div><div class="val">{float(m.get('recall', 0)) * 100:.1f}%</div></div>
    <div class="card"><div class="label">Precision</div><div class="val">{float(m.get('precision', 0)) * 100:.1f}%</div></div>
    <div class="card"><div class="label">F1 Score</div><div class="val">{float(m.get('f1_score', 0)) * 100:.1f}%</div></div>
    <div class="card"><div class="label">False Positive Rate</div><div class="val">{float(m.get('false_positive_rate', 0)) * 100:.2f}%</div></div>
  </div>

  <h2>Финансовый эффект и нагрузка Review</h2>
  <div class="grid">
    <div class="card card-good">
      <div class="label">Заблокированный фрод</div>
      <div class="val val-good">{_fmt_kzt(biz.get('prevented_fraud_amount', 0))}</div>
      {f'<div class="sub">Изменение: {d_prev}</div>' if d_prev else ''}
    </div>
    <div class="card {'card-danger' if float(biz.get('missed_fraud_amount', 0)) > 0 else 'card-good'}">
      <div class="label">Пропущенный фрод</div>
      <div class="val {'val-danger' if float(biz.get('missed_fraud_amount', 0)) > 0 else 'val-good'}">{_fmt_kzt(biz.get('missed_fraud_amount', 0))}</div>
      {f'<div class="sub">Изменение: {d_miss}</div>' if d_miss else ''}
    </div>
    <div class="card">
      <div class="label">Ложные отказы</div>
      <div class="val">{_fmt_kzt(biz.get('false_decline_amount', 0))}</div>
      {f'<div class="sub">Изменение: {d_fp}</div>' if d_fp else ''}
    </div>
    <div class="card">
      <div class="label">Очередь Review</div>
      <div class="val">{rev_count} <span class="sub">({rev_rate_pct:.1f}%){d_rev_str}</span></div>
    </div>
  </div>

  {adv_html}

  <h2>Confusion Matrix & Volume</h2>
  <p style="font-size:13px;">
    Total Transactions: <strong>{m.get('total_transactions')}</strong> |
    Actual Risk Events: <strong>{m.get('actual_risk_events')}</strong> |
    TP: <strong>{m.get('true_positives')}</strong> |
    FP: <strong>{m.get('false_positives')}</strong> |
    FN: <strong>{m.get('false_negatives')}</strong> |
    TN: <strong>{m.get('true_negatives')}</strong>
  </p>

  <h2>Scenario Effectiveness Breakdown</h2>
  <table>
    <thead>
      <tr>
        <th>Scenario</th><th>Total</th><th>Actual Risk</th><th>TP</th><th>FP</th><th>FN</th><th>Recall</th><th>Precision</th><th>F1</th><th>FPR</th>
      </tr>
    </thead>
    <tbody>{scen_rows_html}</tbody>
  </table>

  <h2>Analytical Summary & Rule Recommendations</h2>
  <p style="font-size:13px;">{html.escape(rep['summary'])}</p>
  <ul style="font-size:12px;">{rec_rows_html or '<li>No parameter changes recommended.</li>'}</ul>

  <div class="disclaimer">{html.escape(rep['report_metadata']['disclaimer'])}</div>
</body>
</html>"""


def build_benchmark_csv(bm: BenchmarkRun) -> str:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "seed",
            "split_name",
            "base_recall",
            "base_precision",
            "base_f1",
            "base_fpr",
            "base_tp",
            "base_fp",
            "base_fn",
            "cand_recall",
            "cand_precision",
            "cand_f1",
            "cand_fpr",
            "cand_tp",
            "cand_fp",
            "cand_fn",
            "recall_delta",
            "f1_delta",
            "fpr_delta",
        ]
    )
    for row in bm.per_seed_results_json or []:
        b = row.get("baseline") or {}
        c = row.get("candidate") or {}
        d = row.get("delta") or {}
        writer.writerow(
            [
                row.get("seed"),
                row.get("split_name"),
                b.get("recall"),
                b.get("precision"),
                b.get("f1_score"),
                b.get("false_positive_rate"),
                b.get("true_positives"),
                b.get("false_positives"),
                b.get("false_negatives"),
                c.get("recall", ""),
                c.get("precision", ""),
                c.get("f1_score", ""),
                c.get("false_positive_rate", ""),
                c.get("true_positives", ""),
                c.get("false_positives", ""),
                c.get("false_negatives", ""),
                d.get("recall", ""),
                d.get("f1_score", ""),
                d.get("false_positive_rate", ""),
            ]
        )
    return buf.getvalue()
