import pytest
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, patch

from sqlalchemy import select

from src.models.user import User
from src.models.account import Account
from src.models.category import Category
from src.models.transaction import Transaction
from src.models.integration import Integration
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.zenmoney.sync import ZenMoneySyncService

TEST_KEY = "a" * 64


@pytest.fixture
def encryption():
    return EncryptionService(TEST_KEY)


@pytest.fixture
async def user(db):
    u = User(telegram_id=500, username="syncuser", first_name="Sync")
    db.add(u)
    await db.commit()
    return u


@pytest.fixture
async def categories(db):
    for name, icon, cat_type in [
        ("Еда", "🍔", "expense"),
        ("Транспорт", "🚗", "expense"),
        ("Другое", "📦", "expense"),
    ]:
        db.add(Category(name=name, icon=icon, type=cat_type))
    await db.commit()


@pytest.fixture
async def integration(db, user, encryption):
    svc = IntegrationService(db, encryption)
    return await svc.create(
        user_id=user.telegram_id,
        integration_type="zenmoney",
        access_token="zm-token",
        refresh_token="zm-refresh",
    )


def _make_diff_response():
    return {
        "serverTimestamp": 1700000000,
        "instrument": [{"id": 1, "shortTitle": "RUB"}],
        "account": [
            {
                "id": "acc-1",
                "title": "Tinkoff Black",
                "balance": 50000.0,
                "instrument": 1,
                "type": "ccard",
            },
        ],
        "transaction": [
            {
                "id": "tx-1",
                "date": "2025-12-01",
                "income": 0,
                "outcome": 350.0,
                "incomeAccount": "acc-1",
                "outcomeAccount": "acc-1",
                "comment": "Кофе",
                "tag": ["cat-food"],
            },
            {
                "id": "tx-2",
                "date": "2025-12-01",
                "income": 0,
                "outcome": 600.0,
                "incomeAccount": "acc-1",
                "outcomeAccount": "acc-1",
                "comment": "Такси",
                "tag": ["cat-transport"],
            },
        ],
        "tag": [
            {"id": "cat-food", "title": "Еда"},
            {"id": "cat-transport", "title": "Транспорт"},
        ],
    }


async def test_full_sync_creates_accounts_and_transactions(
    db, user, integration, encryption, categories
):
    sync_svc = ZenMoneySyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.diff.return_value = _make_diff_response()

    with patch("src.services.zenmoney.sync.ZenMoneyClient", return_value=mock_client):
        await sync_svc.sync(integration)

    # Check accounts created
    result = await db.execute(select(Account).where(Account.user_id == user.telegram_id))
    accounts = list(result.scalars().all())
    assert len(accounts) == 1
    assert accounts[0].name == "Tinkoff Black"
    assert accounts[0].external_id == "acc-1"

    # Check transactions created
    result = await db.execute(
        select(Transaction)
        .where(Transaction.user_id == user.telegram_id)
        .order_by(Transaction.external_id)
    )
    transactions = list(result.scalars().all())
    assert len(transactions) == 2
    assert transactions[0].external_id == "tx-1"
    assert transactions[0].amount == Decimal("-350.00")
    assert transactions[1].external_id == "tx-2"
    assert transactions[1].amount == Decimal("-600.00")


async def test_incremental_sync_skips_existing(
    db, user, integration, encryption, categories
):
    """Second sync with same data should not duplicate."""
    sync_svc = ZenMoneySyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.diff.return_value = _make_diff_response()

    with patch("src.services.zenmoney.sync.ZenMoneyClient", return_value=mock_client):
        await sync_svc.sync(integration)
        await sync_svc.sync(integration)  # second sync

    result = await db.execute(
        select(Transaction).where(Transaction.user_id == user.telegram_id)
    )
    transactions = list(result.scalars().all())
    assert len(transactions) == 2  # no duplicates


async def test_sync_updates_existing_account_balance(
    db, user, integration, encryption, categories
):
    sync_svc = ZenMoneySyncService(db, encryption)

    resp1 = _make_diff_response()
    resp2 = _make_diff_response()
    resp2["account"][0]["balance"] = 45000.0  # balance changed

    mock_client = AsyncMock()
    mock_client.diff.side_effect = [resp1, resp2]

    with patch("src.services.zenmoney.sync.ZenMoneyClient", return_value=mock_client):
        await sync_svc.sync(integration)
        await sync_svc.sync(integration)

    result = await db.execute(
        select(Account).where(Account.user_id == user.telegram_id)
    )
    account = result.scalar_one()
    assert account.balance == Decimal("45000.00")


async def test_sync_records_error_on_api_failure(
    db, user, integration, encryption, categories
):
    sync_svc = ZenMoneySyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.diff.side_effect = Exception("API timeout")

    with patch("src.services.zenmoney.sync.ZenMoneyClient", return_value=mock_client):
        await sync_svc.sync(integration)

    # Integration should have error recorded
    await db.refresh(integration)
    assert integration.error_count == 1
    assert "API timeout" in integration.last_error


async def test_sync_skips_transfer_transactions(
    db, user, integration, encryption, categories
):
    """Transfer transactions (different accounts) should be skipped."""
    sync_svc = ZenMoneySyncService(db, encryption)

    diff_resp = _make_diff_response()
    # Add a transfer transaction
    diff_resp["transaction"].append(
        {
            "id": "tx-transfer",
            "date": "2025-12-01",
            "income": 5000.0,
            "outcome": 5000.0,
            "incomeAccount": "acc-1",
            "outcomeAccount": "acc-2",
            "comment": "Перевод",
            "tag": [],
        }
    )

    mock_client = AsyncMock()
    mock_client.diff.return_value = diff_resp

    with patch("src.services.zenmoney.sync.ZenMoneyClient", return_value=mock_client):
        await sync_svc.sync(integration)

    result = await db.execute(
        select(Transaction).where(Transaction.user_id == user.telegram_id)
    )
    transactions = list(result.scalars().all())
    # Should only have 2 non-transfer transactions
    assert len(transactions) == 2
    external_ids = {t.external_id for t in transactions}
    assert "tx-transfer" not in external_ids


async def test_sync_records_success(db, user, integration, encryption, categories):
    """After successful sync, integration should have last_synced_at updated."""
    sync_svc = ZenMoneySyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.diff.return_value = _make_diff_response()

    with patch("src.services.zenmoney.sync.ZenMoneyClient", return_value=mock_client):
        await sync_svc.sync(integration)

    await db.refresh(integration)
    assert integration.last_synced_at is not None
    assert integration.error_count == 0
    assert integration.status == "active"
