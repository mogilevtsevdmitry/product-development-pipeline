"""Tests for trade worker — execute, fail, rate limit."""

import pytest
import time
from unittest.mock import AsyncMock, patch, MagicMock
from decimal import Decimal

from src.workers.trade_worker import (
    execute_trade,
    _check_rate_limit,
    _user_order_times,
    MAX_ORDERS_PER_MINUTE,
)
from src.services.trade_service import TradeService, TradeError
from src.services.user_service import UserService


async def _create_user(db, user_id: int = 800001):
    service = UserService(db)
    await service.get_or_create(user_id, "worker_test", "WT")


# ------------------------------------------------------------------
# Rate limiting
# ------------------------------------------------------------------


def test_rate_limit_allows_within_limit():
    """Should allow orders within rate limit."""
    _user_order_times.clear()
    user_id = 999001
    for _ in range(MAX_ORDERS_PER_MINUTE):
        assert _check_rate_limit(user_id) is True


def test_rate_limit_blocks_over_limit():
    """Should block orders exceeding rate limit."""
    _user_order_times.clear()
    user_id = 999002
    for _ in range(MAX_ORDERS_PER_MINUTE):
        _check_rate_limit(user_id)
    assert _check_rate_limit(user_id) is False


# ------------------------------------------------------------------
# execute_trade
# ------------------------------------------------------------------


async def test_execute_trade_success(db):
    """Should execute a submitted order successfully."""
    await _create_user(db, 800001)
    service = TradeService(db)
    order = await service.create_order(
        user_id=800001, ticker="SBER", direction="buy",
        quantity=1, order_type="market",
    )
    await service.confirm_order(order.id)

    # Mock TBank client
    mock_tbank = AsyncMock()
    mock_tbank._resolve_account_id = AsyncMock(return_value="acc123")
    mock_tbank._request = AsyncMock(return_value={"orderId": "tbank_order_123"})
    mock_tbank.sandbox = True

    with patch(
        "src.workers.trade_worker._get_user_tbank_client",
        return_value=mock_tbank,
    ), patch("src.workers.trade_worker.async_session") as mock_session_factory:
        # Use the real db session
        mock_ctx = mock_session_factory.return_value.__aenter__ = AsyncMock(return_value=db)
        mock_session_factory.return_value.__aexit__ = AsyncMock(return_value=False)

        _user_order_times.clear()
        result = await execute_trade({}, str(order.id), 800001)

    assert result["ok"] is True
    assert result["status"] == "executed"


async def test_execute_trade_invalid_order_id():
    """Should return error for invalid order ID."""
    _user_order_times.clear()
    result = await execute_trade({}, "not-a-uuid", 800002)
    assert result["ok"] is False
    assert "Invalid order_id" in result["error"]


async def test_execute_trade_rate_limited():
    """Should return error when rate limited."""
    _user_order_times.clear()
    user_id = 800003
    # Fill up rate limit
    for _ in range(MAX_ORDERS_PER_MINUTE):
        _check_rate_limit(user_id)

    result = await execute_trade({}, str("00000000-0000-4000-8000-000000000001"), user_id)
    assert result["ok"] is False
    assert result["error"] == "rate_limit_exceeded"
