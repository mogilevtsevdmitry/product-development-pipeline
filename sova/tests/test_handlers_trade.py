"""Tests for trade bot handlers — parse, confirm, cancel, disclaimer."""

import pytest
import uuid
from decimal import Decimal
from unittest.mock import AsyncMock, patch, MagicMock

from src.bot.handlers.trade import (
    handle_trade_text,
    handle_trade_confirm,
    handle_trade_cancel,
    LEGAL_DISCLAIMER,
    ORDER_EXPIRED_TEXT,
)
from src.services.user_service import UserService
from src.services.trade_service import TradeService


async def _create_user(db, user_id: int = 900001):
    service = UserService(db)
    await service.get_or_create(user_id, "handler_trade", "HT")


# ------------------------------------------------------------------
# Trade text handler
# ------------------------------------------------------------------


async def test_trade_text_shows_order_preview(db, make_message):
    """Should show order preview with disclaimer for trade commands."""
    await _create_user(db, 900001)

    message = make_message(text="купить SBER 10 лотов", user_id=900001)
    await handle_trade_text(message, db)

    message.answer.assert_called_once()
    call_text = message.answer.call_args[0][0]
    assert "SBER" in call_text
    assert "10" in call_text
    assert LEGAL_DISCLAIMER in call_text
    # Should have inline keyboard
    assert message.answer.call_args[1].get("reply_markup") is not None


async def test_trade_text_non_trade_does_nothing(db, make_message):
    """Non-trade text should not trigger any response."""
    await _create_user(db, 900002)

    message = make_message(text="привет мир", user_id=900002)
    await handle_trade_text(message, db)

    message.answer.assert_not_called()


async def test_trade_text_shows_limit_warning(db, make_message):
    """Should show limit warning for high-value orders."""
    await _create_user(db, 900003)

    # Limit order with total > 50,000
    message = make_message(text="купить SBER 100 лотов по 1000", user_id=900003)
    await handle_trade_text(message, db)

    message.answer.assert_called_once()
    call_text = message.answer.call_args[0][0]
    assert "превышает" in call_text
    assert LEGAL_DISCLAIMER in call_text


# ------------------------------------------------------------------
# Confirm callback
# ------------------------------------------------------------------


async def test_trade_confirm_success(db, make_callback):
    """Should confirm and show submitted status."""
    await _create_user(db, 900004)
    service = TradeService(db)
    order = await service.create_order(
        user_id=900004, ticker="SBER", direction="buy",
        quantity=1, order_type="market",
    )

    callback = make_callback(
        data=f"trade_confirm:{order.id}",
        user_id=900004,
    )
    await handle_trade_confirm(callback, db)

    callback.message.edit_text.assert_called_once()
    call_text = callback.message.edit_text.call_args[0][0]
    assert "отправлена на исполнение" in call_text
    assert LEGAL_DISCLAIMER in call_text


# ------------------------------------------------------------------
# Cancel callback
# ------------------------------------------------------------------


async def test_trade_cancel(db, make_callback):
    """Should cancel the order."""
    await _create_user(db, 900005)
    service = TradeService(db)
    order = await service.create_order(
        user_id=900005, ticker="SBER", direction="buy",
        quantity=1, order_type="market",
    )

    callback = make_callback(
        data=f"trade_cancel:{order.id}",
        user_id=900005,
    )
    await handle_trade_cancel(callback, db)

    callback.answer.assert_called_once_with("Отменено")
    callback.message.edit_text.assert_called_once_with("Заявка отменена.")
