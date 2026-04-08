import pytest
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import select

from src.models.user import User
from src.models.integration import Integration
from src.models.portfolio import PortfolioPosition, PortfolioOperation
from src.services.encryption_service import EncryptionService
from src.services.integration_service import IntegrationService
from src.services.tbank.sync import TBankSyncService

TEST_KEY = "a" * 64


@pytest.fixture
def encryption():
    return EncryptionService(TEST_KEY)


@pytest.fixture
async def user(db):
    u = User(telegram_id=600, username="tbuser", first_name="TB")
    db.add(u)
    await db.commit()
    return u


@pytest.fixture
async def integration(db, user, encryption):
    svc = IntegrationService(db, encryption)
    return await svc.create(
        user_id=user.telegram_id,
        integration_type="tbank_invest",
        access_token="tb-token",
    )


def _make_positions():
    return [
        {
            "figi": "BBG004730N88",
            "instrument_type": "share",
            "quantity": Decimal("10"),
            "avg_price": Decimal("285.00"),
            "current_price": Decimal("290.50"),
            "currency": "rub",
        },
    ]


def _make_operations():
    return [
        {
            "id": "op-1",
            "figi": "BBG004730N88",
            "operation_type": "buy",
            "quantity": 10,
            "price": Decimal("285.00"),
            "total": Decimal("-28500.00"),
            "date": datetime(2025, 12, 1, 10, 0, 0, tzinfo=timezone.utc),
        },
        {
            "id": "op-2",
            "figi": "BBG004730N88",
            "operation_type": "dividend",
            "quantity": 0,
            "price": Decimal("0"),
            "total": Decimal("1200.00"),
            "date": datetime(2025, 12, 15, tzinfo=timezone.utc),
        },
    ]


def _make_instrument_info():
    return {
        "BBG004730N88": {"ticker": "SBER", "name": "Sberbank", "sector": "financial"},
    }


async def test_sync_creates_positions(db, user, integration, encryption):
    sync_svc = TBankSyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.get_portfolio.return_value = _make_positions()
    mock_client.get_operations.return_value = _make_operations()

    with patch("src.services.tbank.sync.TBankClient", return_value=mock_client):
        with patch.object(sync_svc, "_get_instrument_info", new_callable=AsyncMock, return_value=_make_instrument_info()):
            await sync_svc.sync(integration)

    result = await db.execute(select(PortfolioPosition).where(PortfolioPosition.user_id == user.telegram_id))
    positions = list(result.scalars().all())
    assert len(positions) == 1
    assert positions[0].ticker == "SBER"
    assert positions[0].quantity == Decimal("10")
    assert positions[0].avg_price == Decimal("285.00")
    assert positions[0].current_price == Decimal("290.50")


async def test_sync_creates_operations(db, user, integration, encryption):
    sync_svc = TBankSyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.get_portfolio.return_value = _make_positions()
    mock_client.get_operations.return_value = _make_operations()

    with patch("src.services.tbank.sync.TBankClient", return_value=mock_client):
        with patch.object(sync_svc, "_get_instrument_info", new_callable=AsyncMock, return_value=_make_instrument_info()):
            await sync_svc.sync(integration)

    result = await db.execute(
        select(PortfolioOperation).where(PortfolioOperation.user_id == user.telegram_id)
    )
    operations = list(result.scalars().all())
    assert len(operations) == 2
    assert operations[0].operation_type == "buy"
    assert operations[1].operation_type == "dividend"


async def test_sync_updates_existing_positions(db, user, integration, encryption):
    """Second sync should update positions, not duplicate."""
    sync_svc = TBankSyncService(db, encryption)

    mock_client = AsyncMock()
    positions1 = _make_positions()
    positions2 = _make_positions()
    positions2[0]["current_price"] = Decimal("295.00")

    mock_client.get_portfolio.side_effect = [positions1, positions2]
    mock_client.get_operations.return_value = []

    with patch("src.services.tbank.sync.TBankClient", return_value=mock_client):
        with patch.object(sync_svc, "_get_instrument_info", new_callable=AsyncMock, return_value=_make_instrument_info()):
            await sync_svc.sync(integration)
            await sync_svc.sync(integration)

    result = await db.execute(select(PortfolioPosition).where(PortfolioPosition.user_id == user.telegram_id))
    positions = list(result.scalars().all())
    assert len(positions) == 1
    assert positions[0].current_price == Decimal("295.00")


async def test_sync_deduplicates_operations(db, user, integration, encryption):
    """Running sync twice should not duplicate operations."""
    sync_svc = TBankSyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.get_portfolio.return_value = []
    mock_client.get_operations.return_value = _make_operations()

    with patch("src.services.tbank.sync.TBankClient", return_value=mock_client):
        with patch.object(sync_svc, "_get_instrument_info", new_callable=AsyncMock, return_value=_make_instrument_info()):
            await sync_svc.sync(integration)
            await sync_svc.sync(integration)

    result = await db.execute(
        select(PortfolioOperation).where(PortfolioOperation.user_id == user.telegram_id)
    )
    operations = list(result.scalars().all())
    assert len(operations) == 2  # not 4


async def test_sync_records_error_on_failure(db, user, integration, encryption):
    sync_svc = TBankSyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.get_portfolio.side_effect = Exception("API error")

    with patch("src.services.tbank.sync.TBankClient", return_value=mock_client):
        await sync_svc.sync(integration)

    await db.refresh(integration)
    assert integration.error_count == 1
    assert "API error" in integration.last_error


async def test_sync_records_success(db, user, integration, encryption):
    """After successful sync, integration should have updated last_synced_at."""
    sync_svc = TBankSyncService(db, encryption)

    mock_client = AsyncMock()
    mock_client.get_portfolio.return_value = []
    mock_client.get_operations.return_value = []

    with patch("src.services.tbank.sync.TBankClient", return_value=mock_client):
        with patch.object(sync_svc, "_get_instrument_info", new_callable=AsyncMock, return_value={}):
            await sync_svc.sync(integration)

    await db.refresh(integration)
    assert integration.error_count == 0
    assert integration.last_synced_at is not None
    assert integration.status == "active"
