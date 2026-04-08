"""Tests for trade service — create, confirm, cancel, timeout, limit, price deviation."""

import pytest
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from unittest.mock import AsyncMock, patch, MagicMock

from src.services.trade_service import (
    TradeService,
    TradeError,
    OrderNotFoundError,
    OrderExpiredError,
    PriceDeviationError,
    CONFIRMATION_TIMEOUT_SECONDS,
    DEFAULT_TRADE_LIMIT,
)
from src.models.trade_order import TradeOrder
from src.services.user_service import UserService


async def _create_user(db, user_id: int = 700001):
    """Create a test user."""
    service = UserService(db)
    await service.get_or_create(user_id, "trade_test", "TT")


# ------------------------------------------------------------------
# create_order
# ------------------------------------------------------------------


async def test_create_order(db):
    """Should create an order with pending_confirmation status."""
    await _create_user(db, 700001)
    service = TradeService(db)

    order = await service.create_order(
        user_id=700001,
        ticker="SBER",
        direction="buy",
        quantity=10,
        order_type="market",
    )

    assert order.id is not None
    assert order.status == "pending_confirmation"
    assert order.ticker == "SBER"
    assert order.direction == "buy"
    assert order.quantity == 10
    assert order.order_type == "market"
    assert order.price is None


async def test_create_limit_order(db):
    """Should create a limit order with price."""
    await _create_user(db, 700002)
    service = TradeService(db)

    order = await service.create_order(
        user_id=700002,
        ticker="GAZP",
        direction="sell",
        quantity=5,
        order_type="limit",
        price=Decimal("180.50"),
    )

    assert order.order_type == "limit"
    assert order.price == Decimal("180.50")


# ------------------------------------------------------------------
# confirm_order
# ------------------------------------------------------------------


async def test_confirm_order(db):
    """Should change status to submitted."""
    await _create_user(db, 700003)
    service = TradeService(db)

    order = await service.create_order(
        user_id=700003, ticker="SBER", direction="buy",
        quantity=1, order_type="market",
    )
    confirmed = await service.confirm_order(order.id)

    assert confirmed.status == "submitted"
    assert confirmed.confirmed_at is not None


async def test_confirm_nonexistent_order(db):
    """Should raise OrderNotFoundError for non-existent order."""
    service = TradeService(db)
    with pytest.raises(OrderNotFoundError):
        await service.confirm_order(uuid.uuid4())


# ------------------------------------------------------------------
# cancel_order
# ------------------------------------------------------------------


async def test_cancel_order(db):
    """Should change status to cancelled."""
    await _create_user(db, 700004)
    service = TradeService(db)

    order = await service.create_order(
        user_id=700004, ticker="SBER", direction="buy",
        quantity=1, order_type="market",
    )
    cancelled = await service.cancel_order(order.id)
    assert cancelled.status == "cancelled"


async def test_cancel_nonexistent_order(db):
    """Should raise OrderNotFoundError."""
    service = TradeService(db)
    with pytest.raises(OrderNotFoundError):
        await service.cancel_order(uuid.uuid4())


# ------------------------------------------------------------------
# Timeout
# ------------------------------------------------------------------


async def test_confirm_expired_order(db):
    """Should raise OrderExpiredError for orders past timeout."""
    await _create_user(db, 700005)
    service = TradeService(db)

    order = await service.create_order(
        user_id=700005, ticker="SBER", direction="buy",
        quantity=1, order_type="market",
    )

    # Manually set created_at to past
    order.created_at = datetime.now(timezone.utc) - timedelta(seconds=CONFIRMATION_TIMEOUT_SECONDS + 10)
    await db.commit()

    with pytest.raises(OrderExpiredError):
        await service.confirm_order(order.id)

    # Order should be cancelled
    await db.refresh(order)
    assert order.status == "cancelled"


# ------------------------------------------------------------------
# Trade limit check
# ------------------------------------------------------------------


async def test_trade_limit_within(db):
    """Should return True when within limit."""
    service = TradeService(db)
    assert service.check_trade_limit(Decimal("1000"), 10) is True  # 10k < 50k


async def test_trade_limit_exceeded(db):
    """Should return False when exceeding limit."""
    service = TradeService(db)
    assert service.check_trade_limit(Decimal("10000"), 10) is False  # 100k > 50k


async def test_trade_limit_custom(db):
    """Should respect custom trade limit."""
    service = TradeService(db)
    assert service.check_trade_limit(
        Decimal("1000"), 10, limit=Decimal("5000")
    ) is False  # 10k > 5k


# ------------------------------------------------------------------
# Price deviation
# ------------------------------------------------------------------


async def test_price_deviation_triggers_error(db):
    """Should raise PriceDeviationError when price changes >1%."""
    await _create_user(db, 700006)

    mock_client = AsyncMock()
    service = TradeService(db, tbank_client=mock_client)

    order = await service.create_order(
        user_id=700006, ticker="SBER", direction="buy",
        quantity=10, order_type="market", price=Decimal("100.00"),
    )

    # Mock get_current_price to return a price >1% different
    with patch.object(service, "get_current_price", return_value=Decimal("102.00")):
        with pytest.raises(PriceDeviationError) as exc_info:
            await service.confirm_order(order.id)
        assert exc_info.value.old_price == Decimal("100.00")
        assert exc_info.value.new_price == Decimal("102.00")


# ------------------------------------------------------------------
# get_pending_orders
# ------------------------------------------------------------------


async def test_get_pending_orders(db):
    """Should return only pending orders for the user."""
    await _create_user(db, 700007)
    service = TradeService(db)

    # Create two pending orders
    await service.create_order(
        user_id=700007, ticker="SBER", direction="buy",
        quantity=1, order_type="market",
    )
    order2 = await service.create_order(
        user_id=700007, ticker="GAZP", direction="sell",
        quantity=2, order_type="market",
    )
    # Confirm one
    await service.confirm_order(order2.id)

    pending = await service.get_pending_orders(700007)
    assert len(pending) == 1
    assert pending[0].ticker == "SBER"


# ------------------------------------------------------------------
# execute_order
# ------------------------------------------------------------------


async def test_execute_order_without_client(db):
    """Should fail when no T-Bank client configured."""
    await _create_user(db, 700008)
    service = TradeService(db, tbank_client=None)

    order = await service.create_order(
        user_id=700008, ticker="SBER", direction="buy",
        quantity=1, order_type="market",
    )
    await service.confirm_order(order.id)

    with pytest.raises(TradeError):
        await service.execute_order(order.id)
