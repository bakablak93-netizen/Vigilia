"""Dataset generation and inspection endpoints."""

from collections import Counter
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import Dataset, SyntheticTransaction, VirtualCustomer
from ..schemas import DatasetDetailResponse, DatasetGenerateRequest, DatasetSummary, TransactionView
from ..services.simulator import generate_synthetic_dataset

router = APIRouter(prefix="/api/datasets", tags=["datasets"])


@router.post("/generate", response_model=DatasetSummary, status_code=status.HTTP_201_CREATED)
def generate_dataset(payload: DatasetGenerateRequest, db: Session = Depends(get_db)):
    settings = get_settings()
    if payload.transaction_count > settings.max_transactions:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"transaction_count cannot exceed {settings.max_transactions}",
        )
    if payload.customer_count > settings.max_customers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"customer_count cannot exceed {settings.max_customers}",
        )

    customers, transactions = generate_synthetic_dataset(
        transaction_count=payload.transaction_count,
        customer_count=payload.customer_count,
        risk_ratio=payload.risk_ratio,
        scenarios=payload.scenarios,
        seed=payload.seed,
    )

    split_counts = dict(Counter(t.split_name for t in transactions))
    actual_risk_count = sum(t.ground_truth_label for t in transactions)

    dataset = Dataset(
        name=payload.name,
        description=payload.description,
        seed=payload.seed,
        transaction_count=len(transactions),
        customer_count=len(customers),
        risk_ratio=payload.risk_ratio,
        actual_risk_count=actual_risk_count,
        scenarios_json=payload.scenarios,
        split_counts_json=split_counts,
    )
    db.add(dataset)
    db.flush()

    db.bulk_save_objects(
        [
            VirtualCustomer(
                dataset_id=dataset.id,
                customer_code=c.customer_code,
                customer_type=c.customer_type,
                activity_category=c.activity_category,
                customer_segment=c.customer_segment,
                account_age_days=c.account_age_days,
                typical_amount_min_kzt=c.typical_amount_min_kzt,
                typical_amount_max_kzt=c.typical_amount_max_kzt,
                avg_amount_kzt=c.avg_amount_kzt,
                std_amount_kzt=c.std_amount_kzt,
                avg_tx_frequency_per_day=c.avg_tx_frequency_per_day,
                known_recipients_json=c.known_recipients_json,
            )
            for c in customers
        ]
    )

    db.bulk_save_objects(
        [
            SyntheticTransaction(
                dataset_id=dataset.id,
                transaction_code=t.transaction_code,
                customer_code=t.customer_code,
                recipient_code=t.recipient_code,
                amount_kzt=t.amount_kzt,
                timestamp=t.timestamp,
                transaction_type=t.transaction_type,
                channel=t.channel,
                is_new_recipient=t.is_new_recipient,
                customer_segment=t.customer_segment,
                transaction_frequency=t.transaction_frequency,
                scenario_type=t.scenario_type,
                split_name=t.split_name,
                ground_truth_label=t.ground_truth_label,
                metadata_json=t.metadata_json,
            )
            for t in transactions
        ]
    )

    db.commit()
    db.refresh(dataset)
    return dataset


@router.get("", response_model=List[DatasetSummary])
def list_datasets(db: Session = Depends(get_db)):
    return db.query(Dataset).order_by(Dataset.created_at.desc(), Dataset.id.desc()).all()


@router.get("/{dataset_id}", response_model=DatasetDetailResponse)
def get_dataset(
    dataset_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    scenario: Optional[str] = Query(default=None),
    split_name: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found")

    query = db.query(SyntheticTransaction).filter(SyntheticTransaction.dataset_id == dataset_id)
    if scenario:
        query = query.filter(SyntheticTransaction.scenario_type == scenario)
    if split_name:
        query = query.filter(SyntheticTransaction.split_name == split_name)

    total = query.count()
    rows = (
        query.order_by(SyntheticTransaction.timestamp.asc(), SyntheticTransaction.id.asc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return DatasetDetailResponse(
        dataset=DatasetSummary.model_validate(dataset),
        transactions=[TransactionView.model_validate(r) for r in rows],
        total_transactions=total,
        page=page,
        page_size=page_size,
    )
