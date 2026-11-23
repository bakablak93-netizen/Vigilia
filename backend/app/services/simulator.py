"""Virtual Bank Simulator 2.0: stratified, diverse, reproducible synthetic banking generator & quality checks."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import random
from typing import Any, Dict, List, Sequence, Tuple

import numpy as np


SCENARIO_CATALOG: List[Dict[str, str]] = [
    {
        "key": "normal_activity",
        "code": "A",
        "name": "Normal Activity",
        "name_ru": "Обычная активность",
        "description": "Routine transactions within typical customer amounts, hours, and known recipients, including normal boundary operations.",
        "description_ru": "Обычные операции с типичными суммами, временем и известными получателями, включая нормальные пограничные платежи.",
        "target_rule": "baseline",
    },
    {
        "key": "unusual_amount",
        "code": "B",
        "name": "Unusual Transaction Amount",
        "name_ru": "Необычная сумма операции",
        "description": "Transactions significantly deviating from the virtual customer's historical amount profile (both legitimate large payments and risky P2P outliers).",
        "description_ru": "Операции с существенным отклонением от типичного профиля сумм клиента (включая как законные крупные покупки, так и рискованные выбросы).",
        "target_rule": "unusual_amount",
    },
    {
        "key": "new_recipient_risk",
        "code": "C",
        "name": "New Recipient Risk",
        "name_ru": "Риск нового получателя",
        "description": "Transfers to previously unseen recipients, combining legitimate onboarding payments with elevated-risk contextual transfers.",
        "description_ru": "Переводы новым получателям: как легитимные разовые оплаты, так и переводы с сопутствующими факторами риска.",
        "target_rule": "new_recipient_risk",
    },
    {
        "key": "duplicate_payment",
        "code": "D",
        "name": "Duplicate Payment",
        "name_ru": "Повторяющийся платёж",
        "description": "Repeated or nearly identical transactions to the same recipient within a short time window.",
        "description_ru": "Повторяющиеся или практически идентичные операции одному получателю в коротком временном окне.",
        "target_rule": "duplicate_payment",
    },
    {
        "key": "suspicious_sequence",
        "code": "E",
        "name": "Suspicious Transaction Sequence",
        "name_ru": "Подозрительная последовательность",
        "description": "Atypical transaction bursts, nocturnal cascades, and rapid multi-recipient sequences (including legitimate business batches).",
        "description_ru": "Нетипичные серии и частота операций, ночные каскады и быстрые переводы (включая законные пакетные выплаты бизнеса).",
        "target_rule": "suspicious_sequence",
    },
    {
        "key": "structuring_smurfing",
        "code": "F",
        "name": "Structuring / Smurfing",
        "name_ru": "Дробление платежей (Smurfing)",
        "description": "Splitting a large transfer into 3–5 smaller payments just below standard single-transaction risk thresholds within a short window.",
        "description_ru": "Дробление крупной суммы на серию из 3–5 переводов чуть ниже стандартного порога риска в коротком окне времени.",
        "target_rule": "structuring_smurfing",
    },
    {
        "key": "account_takeover_ato",
        "code": "G",
        "name": "Account Takeover (ATO)",
        "name_ru": "Захват аккаунта (ATO)",
        "description": "Device or geo location shift followed rapidly by an atypical transfer to a previously unseen recipient.",
        "description_ru": "Смена устройства или геолокации с быстрым переводом новому получателю на нетипичную сумму.",
        "target_rule": "account_takeover_ato",
    },
]

INDIVIDUAL_CATEGORIES = [
    "salary_household",
    "retail_consumer",
    "freelance_services",
    "travel_lifestyle",
    "digital_creator",
]

SMALL_BUSINESS_CATEGORIES = [
    "retail_trade",
    "local_services",
    "cafe_hospitality",
    "e_commerce_merchant",
]

MEDIUM_BUSINESS_CATEGORIES = [
    "logistics_supply",
    "it_consulting",
    "wholesale_distribution",
    "manufacturing_b2b",
]

TRANSACTION_TYPES = ["p2p_transfer", "merchant_payment", "bill_payment", "b2b_invoice"]
CHANNELS = ["mobile_app", "web_banking", "card_pos", "api_gateway"]


@dataclass
class GeneratedCustomer:
    customer_code: str
    customer_type: str
    activity_category: str
    customer_segment: str
    account_age_days: int
    typical_amount_min_kzt: float
    typical_amount_max_kzt: float
    avg_amount_kzt: float
    std_amount_kzt: float
    avg_tx_frequency_per_day: float
    known_recipients_json: List[str]


@dataclass
class GeneratedTransaction:
    transaction_code: str
    customer_code: str
    recipient_code: str
    amount_kzt: float
    timestamp: datetime
    transaction_type: str
    channel: str
    is_new_recipient: bool
    customer_segment: str
    transaction_frequency: float
    scenario_type: str
    split_name: str
    ground_truth_label: int
    metadata_json: Dict[str, Any]


def _pick_split(index: int) -> str:
    """Deterministic stratified split cycle: 20% calibration (0,1), 40% validation (2,3,4,5), 40% evaluation (6,7,8,9)."""
    pos = index % 10
    if pos in (0, 1):
        return "calibration"
    if pos in (2, 3, 4, 5):
        return "validation"
    return "evaluation"


def _generate_customers(
    rng: random.Random,
    np_rng: np.random.Generator,
    customer_count: int,
) -> List[GeneratedCustomer]:
    customers: List[GeneratedCustomer] = []
    recipient_pool = [f"REC-{i:05d}" for i in range(1, max(300, customer_count * 4) + 1)]

    for idx in range(1, customer_count + 1):
        roll = rng.random()
        if roll < 0.72:
            customer_type = "individual"
            activity = rng.choice(INDIVIDUAL_CATEGORIES)
            seg_roll = rng.random()
            if seg_roll < 0.18:
                segment = "retail_affluent"
                base = rng.uniform(18_000, 65_000)
            elif seg_roll < 0.35:
                segment = "young_digital"
                base = rng.uniform(2_500, 14_000)
            else:
                segment = "retail_standard"
                base = rng.uniform(4_000, 24_000)
            min_amt = float(round(base, -2))
            max_amt = float(round(min_amt * rng.uniform(3.5, 8.0), -2))
            freq = round(rng.uniform(0.4, 3.0), 2)
            # Mix of short-history (<60d) and long-history accounts
            age_days = rng.randint(12, 75) if rng.random() < 0.22 else rng.randint(90, 2100)
            known_count = rng.randint(3, 8)
        elif roll < 0.90:
            customer_type = "small_business"
            activity = rng.choice(SMALL_BUSINESS_CATEGORIES)
            segment = "sme_business"
            min_amt = float(round(rng.uniform(20_000, 85_000), -2))
            max_amt = float(round(min_amt * rng.uniform(4.5, 10.0), -2))
            freq = round(rng.uniform(1.2, 4.5), 2)
            age_days = rng.randint(30, 1500)
            known_count = rng.randint(5, 10)
        else:
            customer_type = "medium_business"
            activity = rng.choice(MEDIUM_BUSINESS_CATEGORIES)
            segment = "mid_market_enterprise" if rng.random() < 0.6 else "corporate"
            min_amt = float(round(rng.uniform(75_000, 220_000), -2))
            max_amt = float(round(min_amt * rng.uniform(5.5, 13.0), -2))
            freq = round(rng.uniform(2.0, 6.5), 2)
            age_days = rng.randint(180, 2600)
            known_count = rng.randint(6, 14)

        avg_amt = round((min_amt + max_amt) * 0.45, 2)
        std_amt = round(max(1000.0, (max_amt - min_amt) * 0.24), 2)
        known = rng.sample(recipient_pool, known_count)

        customers.append(
            GeneratedCustomer(
                customer_code=f"CUS-{idx:04d}",
                customer_type=customer_type,
                activity_category=activity,
                customer_segment=segment,
                account_age_days=age_days,
                typical_amount_min_kzt=min_amt,
                typical_amount_max_kzt=max_amt,
                avg_amount_kzt=avg_amt,
                std_amount_kzt=std_amt,
                avg_tx_frequency_per_day=freq,
                known_recipients_json=known,
            )
        )
    _ = float(np_rng.random())
    return customers


def generate_synthetic_dataset(
    transaction_count: int = 1000,
    customer_count: int = 100,
    risk_ratio: float = 0.05,
    scenarios: Sequence[str] | None = None,
    seed: int = 42,
) -> Tuple[List[GeneratedCustomer], List[GeneratedTransaction]]:
    """
    Generate a reproducible, stratified synthetic banking dataset with customer profiles
    and multi-scenario transactions split into calibration (20%), validation (40%),
    and evaluation (40%).
    """
    selected = list(scenarios) if scenarios else [s["key"] for s in SCENARIO_CATALOG]
    rng = random.Random(seed)
    np_rng = np.random.default_rng(seed)

    customers = _generate_customers(rng, np_rng, customer_count)
    base_start = datetime(2026, 11, 1, 6, 0, 0, tzinfo=timezone.utc)
    new_recipient_pool = [f"REC-EXT-{i:05d}" for i in range(1, max(500, transaction_count) + 1)]

    target_risk_total = max(1, round(transaction_count * risk_ratio)) if risk_ratio > 0 else 0
    non_normal = [s for s in selected if s != "normal_activity"]

    # Store event groups bucketed by (scenario_type, group_has_risk) for stratified split assignment
    stratified_buckets: Dict[Tuple[str, int], List[List[Dict[str, Any]]]] = defaultdict(list)

    def make_timestamp(day_offset: int, night: bool = False) -> datetime:
        hour = rng.randint(0, 4) if night else rng.randint(8, 22)
        minute = rng.randint(0, 59)
        second = rng.randint(0, 59)
        return base_start + timedelta(days=day_offset, hours=hour, minutes=minute, seconds=second)

    def is_biz(cust: GeneratedCustomer) -> bool:
        return cust.customer_type in ("business", "small_business", "medium_business")

    def make_normal_tx(cust: GeneratedCustomer, ts: datetime, label: int = 0) -> Dict[str, Any]:
        # Include ~12% normal boundary operations (near upper limit or new merchant)
        is_boundary = label == 0 and rng.random() < 0.12
        if is_boundary:
            amt = float(round(cust.typical_amount_max_kzt * rng.uniform(0.92, 1.35), 2))
            is_new = rng.random() < 0.25
            pattern = "normal_boundary_operation"
        else:
            amt = float(
                round(
                    np.clip(
                        np_rng.normal(cust.avg_amount_kzt, cust.std_amount_kzt),
                        cust.typical_amount_min_kzt,
                        cust.typical_amount_max_kzt,
                    ),
                    2,
                )
            )
            is_new = rng.random() < 0.08
            pattern = "routine_activity"

        rec = rng.choice(new_recipient_pool) if is_new else rng.choice(cust.known_recipients_json)
        tx_type = "b2b_invoice" if is_biz(cust) else rng.choice(TRANSACTION_TYPES[:3])
        channel = rng.choice(["mobile_app", "web_banking", "card_pos"])
        dev_chg = label == 0 and rng.random() < 0.04
        geo_chg = label == 0 and rng.random() < 0.03
        mins_dev = round(rng.uniform(140.0, 2400.0), 1) if (dev_chg or geo_chg) else None
        return {
            "customer": cust,
            "recipient_code": rec,
            "amount_kzt": max(500.0, amt),
            "timestamp": ts,
            "transaction_type": tx_type,
            "channel": channel,
            "is_new_recipient": is_new,
            "scenario_type": "normal_activity",
            "ground_truth_label": label,
            "metadata_json": {
                "pattern": pattern,
                "device_changed": dev_chg,
                "geo_changed": geo_chg,
                "minutes_since_device_change": mins_dev,
            },
        }

    risk_allocated = 0
    tx_allocated = 0

    if non_normal:
        per_scen_risk = max(1, target_risk_total // len(non_normal))
        remainder = target_risk_total - per_scen_risk * len(non_normal)

        for s_idx, scen in enumerate(non_normal):
            scen_risk_quota = per_scen_risk + (1 if s_idx < remainder else 0)
            scen_legit_quota = max(2, round(scen_risk_quota * 0.55))

            if scen == "unusual_amount":
                for r_idx, is_risk in enumerate(([1] * scen_risk_quota) + ([0] * scen_legit_quota)):
                    cust = rng.choice(customers)
                    day = rng.randint(0, 12)
                    if is_risk:
                        # ~25% of risky unusual_amount events are subtle borderline anomalies (2.6x-3.5x via web_banking)
                        is_stealth = (r_idx % 4 == 0)
                        if is_stealth:
                            mult = rng.uniform(2.6, 3.45)
                            night = False
                            is_new = False
                            rec = rng.choice(cust.known_recipients_json)
                            channel = "web_banking"
                            tx_type = "merchant_payment"
                            pattern = "stealth_amount_outlier_risk"
                        else:
                            mult = rng.uniform(3.75, 9.2)
                            night = rng.random() < 0.45
                            is_new = rng.random() < 0.58
                            rec = rng.choice(new_recipient_pool) if is_new else rng.choice(cust.known_recipients_json)
                            channel = rng.choice(["mobile_app", "api_gateway"])
                            tx_type = "p2p_transfer"
                            pattern = "high_amount_outlier_risk"
                    else:
                        mult = rng.uniform(2.7, 5.4)
                        night = False
                        is_new = rng.random() < 0.15
                        rec = rng.choice(new_recipient_pool) if is_new else rng.choice(cust.known_recipients_json)
                        channel = rng.choice(["web_banking", "card_pos"])
                        tx_type = "b2b_invoice" if is_biz(cust) else "merchant_payment"
                        pattern = "legitimate_major_purchase"
                    amt = float(round(cust.typical_amount_max_kzt * mult, 2))
                    stratified_buckets[(scen, is_risk)].append(
                        [
                            {
                                "customer": cust,
                                "recipient_code": rec,
                                "amount_kzt": max(15_000.0, amt),
                                "timestamp": make_timestamp(day, night=night),
                                "transaction_type": tx_type,
                                "channel": channel,
                                "is_new_recipient": is_new,
                                "scenario_type": "unusual_amount",
                                "ground_truth_label": is_risk,
                                "metadata_json": {"pattern": pattern, "multiplier_vs_max": round(mult, 2)},
                            }
                        ]
                    )
                    tx_allocated += 1
                    risk_allocated += is_risk

            elif scen == "new_recipient_risk":
                for is_risk in ([1] * scen_risk_quota) + ([0] * scen_legit_quota):
                    cust = rng.choice(customers)
                    day = rng.randint(0, 12)
                    rec = rng.choice(new_recipient_pool)
                    if is_risk:
                        mult = rng.uniform(1.6, 4.2)
                        night = rng.random() < 0.55
                        channel = rng.choice(["mobile_app", "api_gateway"])
                        amt = float(round(cust.avg_amount_kzt * mult * 1.8, 2))
                        pattern = "new_recipient_risky_context"
                    else:
                        mult = rng.uniform(0.5, 1.35)
                        night = False
                        channel = rng.choice(["web_banking", "card_pos", "mobile_app"])
                        amt = float(round(cust.avg_amount_kzt * mult, 2))
                        pattern = "legitimate_new_payee"
                    stratified_buckets[(scen, is_risk)].append(
                        [
                            {
                                "customer": cust,
                                "recipient_code": rec,
                                "amount_kzt": max(2_500.0, amt),
                                "timestamp": make_timestamp(day, night=night),
                                "transaction_type": "p2p_transfer",
                                "channel": channel,
                                "is_new_recipient": True,
                                "scenario_type": "new_recipient_risk",
                                "ground_truth_label": is_risk,
                                "metadata_json": {"pattern": pattern},
                            }
                        ]
                    )
                    tx_allocated += 1
                    risk_allocated += is_risk

            elif scen == "duplicate_payment":
                for is_risk in ([1] * scen_risk_quota) + ([0] * scen_legit_quota):
                    cust = rng.choice(customers)
                    day = rng.randint(0, 12)
                    ts0 = make_timestamp(day, night=(is_risk == 1 and rng.random() < 0.35))
                    rec = (
                        rng.choice(new_recipient_pool)
                        if (is_risk and rng.random() < 0.55)
                        else rng.choice(cust.known_recipients_json)
                    )
                    if is_risk:
                        base_amt = float(
                            round(rng.uniform(cust.avg_amount_kzt * 0.95, cust.typical_amount_max_kzt * 1.45), 2)
                        )
                        delay_min = rng.randint(3, 18)
                    else:
                        base_amt = float(
                            round(rng.uniform(cust.typical_amount_min_kzt * 0.6, cust.avg_amount_kzt * 0.75), 2)
                        )
                        delay_min = rng.randint(1, 5)
                    dup_amt = float(round(base_amt * rng.uniform(0.99, 1.01), 2))
                    pair = [
                        {
                            "customer": cust,
                            "recipient_code": rec,
                            "amount_kzt": base_amt,
                            "timestamp": ts0,
                            "transaction_type": "p2p_transfer" if is_risk else "merchant_payment",
                            "channel": "mobile_app",
                            "is_new_recipient": rec.startswith("REC-EXT"),
                            "scenario_type": "duplicate_payment",
                            "ground_truth_label": 0,
                            "metadata_json": {"pattern": "duplicate_origin"},
                        },
                        {
                            "customer": cust,
                            "recipient_code": rec,
                            "amount_kzt": dup_amt,
                            "timestamp": ts0 + timedelta(minutes=delay_min),
                            "transaction_type": "p2p_transfer" if is_risk else "merchant_payment",
                            "channel": "mobile_app",
                            "is_new_recipient": rec.startswith("REC-EXT"),
                            "scenario_type": "duplicate_payment",
                            "ground_truth_label": is_risk,
                            "metadata_json": {
                                "pattern": "duplicate_replay_risk" if is_risk else "legitimate_retry",
                                "delay_minutes": delay_min,
                            },
                        },
                    ]
                    stratified_buckets[(scen, is_risk)].append(pair)
                    tx_allocated += 2
                    risk_allocated += is_risk

            elif scen == "suspicious_sequence":
                risk_rem = scen_risk_quota
                indiv_customers = [c for c in customers if not is_biz(c)] or customers
                while risk_rem > 0:
                    cust = rng.choice(indiv_customers)
                    day = rng.randint(0, 12)
                    burst_len = min(4, max(3, risk_rem + 1))
                    ts0 = make_timestamp(day, night=rng.random() < 0.65)
                    burst: List[Dict[str, Any]] = []
                    for b_i in range(burst_len):
                        is_tx_risk = 1 if (b_i >= 1 and risk_rem > 0) else 0
                        if is_tx_risk:
                            risk_rem -= 1
                            risk_allocated += 1
                        rec = rng.choice(new_recipient_pool)
                        amt = float(round(cust.typical_amount_max_kzt * rng.uniform(1.1, 2.8), 2))
                        burst.append(
                            {
                                "customer": cust,
                                "recipient_code": rec,
                                "amount_kzt": amt,
                                "timestamp": ts0 + timedelta(minutes=b_i * rng.randint(2, 6)),
                                "transaction_type": "p2p_transfer",
                                "channel": "mobile_app" if b_i % 2 == 0 else "api_gateway",
                                "is_new_recipient": True,
                                "scenario_type": "suspicious_sequence",
                                "ground_truth_label": is_tx_risk,
                                "metadata_json": {"pattern": "rapid_drain_sequence", "burst_step": b_i + 1},
                            }
                        )
                    stratified_buckets[(scen, 1)].append(burst)
                    tx_allocated += len(burst)

                biz_customers = [c for c in customers if is_biz(c)] or customers
                for _ in range(max(2, scen_legit_quota // 2)):
                    cust = rng.choice(biz_customers)
                    day = rng.randint(0, 12)
                    ts0 = make_timestamp(day, night=False)
                    burst = []
                    for b_i in range(3):
                        rec = rng.choice(cust.known_recipients_json)
                        amt = float(round(rng.uniform(cust.typical_amount_min_kzt, cust.typical_amount_max_kzt), 2))
                        burst.append(
                            {
                                "customer": cust,
                                "recipient_code": rec,
                                "amount_kzt": amt,
                                "timestamp": ts0 + timedelta(minutes=b_i * rng.randint(4, 9)),
                                "transaction_type": "b2b_invoice",
                                "channel": "web_banking",
                                "is_new_recipient": False,
                                "scenario_type": "suspicious_sequence",
                                "ground_truth_label": 0,
                                "metadata_json": {"pattern": "legitimate_business_batch", "burst_step": b_i + 1},
                            }
                        )
                    stratified_buckets[(scen, 0)].append(burst)
                    tx_allocated += len(burst)

            elif scen == "structuring_smurfing":
                risk_rem = scen_risk_quota
                indiv_customers = [c for c in customers if not is_biz(c)] or customers
                while risk_rem > 0:
                    cust = rng.choice(indiv_customers)
                    day = rng.randint(0, 12)
                    risk_in_burst = min(3 if risk_rem >= 4 else (2 if risk_rem >= 2 else 1), risk_rem)
                    if transaction_count < 150:
                        risk_in_burst = 1
                    burst_len = min(5, max(3, 2 + risk_in_burst))
                    ts0 = make_timestamp(day, night=rng.random() < 0.25)
                    primary_rec = (
                        rng.choice(new_recipient_pool)
                        if rng.random() < 0.72
                        else rng.choice(cust.known_recipients_json)
                    )
                    cur_ts = ts0
                    burst: List[Dict[str, Any]] = []
                    for b_i in range(burst_len):
                        if b_i > 0:
                            cur_ts = cur_ts + timedelta(minutes=rng.randint(5, 10))
                        # Final slice(s) cross the cumulative structuring boundary
                        is_tx_risk = 1 if (b_i >= burst_len - risk_in_burst and risk_rem > 0) else 0
                        if is_tx_risk:
                            risk_rem -= 1
                            risk_allocated += 1
                        # Each slice stays below standard single-tx outlier thresholds
                        amt = float(round(cust.typical_amount_max_kzt * rng.uniform(0.76, 0.96), -2))
                        rec = (
                            primary_rec
                            if rng.random() < 0.8
                            else rng.choice(new_recipient_pool)
                        )
                        burst.append(
                            {
                                "customer": cust,
                                "recipient_code": rec,
                                "amount_kzt": max(8_000.0, amt),
                                "timestamp": cur_ts,
                                "transaction_type": "p2p_transfer",
                                "channel": rng.choice(["mobile_app", "web_banking"]),
                                "is_new_recipient": rec.startswith("REC-EXT"),
                                "scenario_type": "structuring_smurfing",
                                "ground_truth_label": is_tx_risk,
                                "metadata_json": {
                                    "pattern": "structured_smurfing_split",
                                    "burst_step": b_i + 1,
                                    "burst_total": burst_len,
                                    "device_changed": False,
                                    "geo_changed": False,
                                },
                            }
                        )
                    stratified_buckets[(scen, 1)].append(burst)
                    tx_allocated += len(burst)

                for _ in range(max(2, scen_legit_quota // 2)):
                    cust = rng.choice(customers)
                    day = rng.randint(0, 12)
                    ts0 = make_timestamp(day, night=False)
                    cur_ts = ts0
                    burst = []
                    for b_i in range(3):
                        if b_i > 0:
                            cur_ts = cur_ts + timedelta(minutes=rng.randint(18, 42))
                        rec = rng.choice(cust.known_recipients_json)
                        amt = float(round(cust.typical_amount_max_kzt * rng.uniform(0.24, 0.45), -2))
                        burst.append(
                            {
                                "customer": cust,
                                "recipient_code": rec,
                                "amount_kzt": max(1_500.0, amt),
                                "timestamp": cur_ts,
                                "transaction_type": rng.choice(["merchant_payment", "bill_payment"]),
                                "channel": rng.choice(["card_pos", "web_banking"]),
                                "is_new_recipient": False,
                                "scenario_type": "structuring_smurfing",
                                "ground_truth_label": 0,
                                "metadata_json": {
                                    "pattern": "legitimate_routine_errands",
                                    "burst_step": b_i + 1,
                                    "burst_total": 3,
                                    "device_changed": False,
                                    "geo_changed": False,
                                },
                            }
                        )
                    stratified_buckets[(scen, 0)].append(burst)
                    tx_allocated += len(burst)

            elif scen == "account_takeover_ato":
                for r_idx, is_risk in enumerate(([1] * scen_risk_quota) + ([0] * scen_legit_quota)):
                    cust = rng.choice(customers)
                    day = rng.randint(0, 12)
                    if is_risk:
                        night = rng.random() < 0.42
                        is_new = True
                        rec = rng.choice(new_recipient_pool)
                        # ~25% within baseline 10m window; ~75% in 11-28m post device/geo shift
                        mins_after_shift = (
                            round(rng.uniform(2.0, 9.5), 1)
                            if (r_idx % 4 == 0)
                            else round(rng.uniform(11.0, 28.0), 1)
                        )
                        geo_chg = rng.random() < 0.85
                        mult = rng.uniform(1.85, 3.65)
                        amt = float(round(cust.typical_amount_max_kzt * mult, 2))
                        tx_type = "p2p_transfer"
                        channel = rng.choice(["mobile_app", "web_banking", "api_gateway"])
                        pattern = "account_takeover_rapid_cashout"
                    else:
                        # Legitimate customer using new phone or traveling: routine amount, older shift, or known payee
                        night = False
                        is_new = rng.random() < 0.30
                        rec = rng.choice(new_recipient_pool) if is_new else rng.choice(cust.known_recipients_json)
                        mins_after_shift = round(rng.uniform(95.0, 1440.0), 1)
                        geo_chg = rng.random() < 0.65
                        mult = rng.uniform(0.45, 1.05)
                        amt = float(round(cust.avg_amount_kzt * mult, 2))
                        tx_type = rng.choice(["merchant_payment", "bill_payment"])
                        channel = rng.choice(["mobile_app", "web_banking"])
                        pattern = "legitimate_travel_or_new_device"

                    stratified_buckets[(scen, is_risk)].append(
                        [
                            {
                                "customer": cust,
                                "recipient_code": rec,
                                "amount_kzt": max(2_000.0, amt),
                                "timestamp": make_timestamp(day, night=night),
                                "transaction_type": tx_type,
                                "channel": channel,
                                "is_new_recipient": is_new,
                                "scenario_type": "account_takeover_ato",
                                "ground_truth_label": is_risk,
                                "metadata_json": {
                                    "pattern": pattern,
                                    "device_changed": True,
                                    "geo_changed": geo_chg,
                                    "minutes_since_device_change": mins_after_shift,
                                    "multiplier_vs_max": round(mult, 2),
                                },
                            }
                        ]
                    )
                    tx_allocated += 1
                    risk_allocated += is_risk

    remaining = transaction_count - tx_allocated
    if remaining > 0:
        normal_risk_needed = max(0, target_risk_total - risk_allocated) if "normal_activity" in selected else 0
        for i in range(remaining):
            cust = rng.choice(customers)
            day = rng.randint(0, 13)
            is_risk = 1 if i < normal_risk_needed else 0
            ts = make_timestamp(day, night=(is_risk == 1))
            tx = make_normal_tx(cust, ts, label=is_risk)
            if is_risk:
                tx["amount_kzt"] = float(round(cust.typical_amount_max_kzt * rng.uniform(2.8, 4.4), 2))
                tx["is_new_recipient"] = True
                tx["recipient_code"] = rng.choice(new_recipient_pool)
                tx["metadata_json"] = {"pattern": "subtle_normal_outlier"}
            stratified_buckets[("normal_activity", is_risk)].append([tx])

    # Assign splits strictly stratified within each (scenario_type, risk_flag) bucket
    # Offset starting cursor so small buckets still hit calibration(0,1), validation(2..5), evaluation(6..9) evenly
    STRATA_CYCLE = [
        "validation",
        "evaluation",
        "calibration",
        "validation",
        "evaluation",
        "validation",
        "evaluation",
        "calibration",
        "validation",
        "evaluation",
    ]
    flat_records: List[Dict[str, Any]] = []
    for bucket_key in sorted(stratified_buckets.keys()):
        groups = stratified_buckets[bucket_key]
        rng.shuffle(groups)
        for g_idx, group in enumerate(groups):
            split = STRATA_CYCLE[g_idx % len(STRATA_CYCLE)]
            for item in group:
                item["split_name"] = split
                flat_records.append(item)

    if len(flat_records) > transaction_count:
        normal_indices = [
            i
            for i, r in enumerate(flat_records)
            if r["scenario_type"] == "normal_activity" and r["ground_truth_label"] == 0
        ]
        to_remove = set()
        for idx in normal_indices:
            if len(flat_records) - len(to_remove) <= transaction_count:
                break
            to_remove.add(idx)
        flat_records = [r for i, r in enumerate(flat_records) if i not in to_remove]
        if len(flat_records) > transaction_count:
            flat_records = flat_records[:transaction_count]

    flat_records.sort(key=lambda r: r["timestamp"])

    cust_history_times: Dict[str, List[datetime]] = {}
    transactions: List[GeneratedTransaction] = []

    for idx, rec in enumerate(flat_records, start=1):
        cust: GeneratedCustomer = rec["customer"]
        ts: datetime = rec["timestamp"]
        hist = cust_history_times.setdefault(cust.customer_code, [])
        cutoff_24h = ts - timedelta(hours=24)
        recent_24h = sum(1 for t in hist if t >= cutoff_24h)
        hist.append(ts)

        transactions.append(
            GeneratedTransaction(
                transaction_code=f"TXN-{idx:06d}",
                customer_code=cust.customer_code,
                recipient_code=rec["recipient_code"],
                amount_kzt=float(round(max(100.0, rec["amount_kzt"]), 2)),
                timestamp=ts,
                transaction_type=rec["transaction_type"],
                channel=rec["channel"],
                is_new_recipient=bool(rec["is_new_recipient"]),
                customer_segment=cust.customer_segment,
                transaction_frequency=float(recent_24h + 1),
                scenario_type=rec["scenario_type"],
                split_name=rec["split_name"],
                ground_truth_label=int(rec["ground_truth_label"]),
                metadata_json=rec["metadata_json"],
            )
        )

    return customers, transactions


def verify_dataset_quality(
    customers: Sequence[GeneratedCustomer],
    transactions: Sequence[GeneratedTransaction],
    expected_risk_ratio: float = 0.05,
) -> Dict[str, Any]:
    """
    Programmatic quality and anti-leakage verification for synthetic banking datasets.
    """
    total_tx = len(transactions)
    if total_tx == 0:
        return {"valid": False, "reason": "Empty transaction list"}

    actual_risk = sum(t.ground_truth_label for t in transactions)
    observed_ratio = actual_risk / total_tx

    # 1. Check customer and amount diversity
    customer_types = {c.customer_type for c in customers}
    segments = {c.customer_segment for c in customers}
    unique_amounts = len({round(t.amount_kzt, 0) for t in transactions})

    # 2. Check chronological ordering & unique IDs
    timestamps = [t.timestamp for t in transactions]
    is_chronological = timestamps == sorted(timestamps)
    unique_codes = len({t.transaction_code for t in transactions}) == total_tx

    # 3. Check absence of single-field trivial leakage (no observable boolean/category alone equals label)
    new_rec_risk = [t.ground_truth_label for t in transactions if t.is_new_recipient]
    known_rec_risk = [t.ground_truth_label for t in transactions if not t.is_new_recipient]
    no_trivial_leakage = (
        any(l == 0 for l in new_rec_risk)
        and any(l == 1 for l in new_rec_risk)
        and any(l == 1 for l in known_rec_risk)
    )

    # 4. Check split balance
    splits = defaultdict(list)
    for t in transactions:
        splits[t.split_name].append(t)
    splits_populated = all(s in splits and len(splits[s]) > 0 for s in ("calibration", "validation", "evaluation"))
    eval_has_risk = sum(t.ground_truth_label for t in splits["evaluation"]) > 0

    return {
        "valid": bool(
            is_chronological
            and unique_codes
            and no_trivial_leakage
            and splits_populated
            and eval_has_risk
            and abs(observed_ratio - expected_risk_ratio) <= 0.025
        ),
        "total_transactions": total_tx,
        "actual_risk_count": actual_risk,
        "observed_risk_ratio": round(observed_ratio, 4),
        "customer_types": sorted(customer_types),
        "customer_segments": sorted(segments),
        "unique_amount_buckets": unique_amounts,
        "is_chronological": is_chronological,
        "unique_codes": unique_codes,
        "no_trivial_leakage": no_trivial_leakage,
        "split_counts": {k: len(v) for k, v in splits.items()},
        "split_risk_counts": {k: sum(t.ground_truth_label for t in v) for k, v in splits.items()},
    }
