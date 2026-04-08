"""Tests for AI bot handlers — intent detection, /digest, confirmation flow."""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from decimal import Decimal

from src.bot.handlers.ai import (
    detect_ai_intent,
    handle_digest_command,
    handle_ai_text,
    handle_ai_confirm,
    handle_ai_cancel,
    COST_CONFIRMATION_TEXT,
    INSUFFICIENT_BALANCE_TEXT,
    PROCESSING_TEXT,
)
from src.services.user_service import UserService
from src.services.billing_service import BillingService


async def _create_funded_user(db, user_id: int = 600001, balance: Decimal = Decimal("100")):
    service = UserService(db)
    await service.get_or_create(user_id, "handler_test", "HT")
    billing = BillingService(db)
    await billing.topup(user_id, balance, 50, "tg_h", f"topup_h_{user_id}")


# ------------------------------------------------------------------
# detect_ai_intent
# ------------------------------------------------------------------


def test_detect_finances_intent():
    """Should detect 'что с моими финансами' as analyze_finances."""
    qt, extra = detect_ai_intent("Что с моими финансами?")
    assert qt == "analyze_finances"


def test_detect_portfolio_intent():
    """Should detect portfolio analysis intent."""
    qt, extra = detect_ai_intent("Расскажи про мой портфель")
    assert qt == "analyze_portfolio"


def test_detect_ticker_intent():
    """Should detect ticker analysis with ticker symbol."""
    qt, extra = detect_ai_intent("Расскажи про SBER")
    assert qt == "analyze_ticker"
    assert extra == "SBER"


def test_detect_expenses_intent():
    """Should detect expense analysis intent."""
    qt, extra = detect_ai_intent("Куда уходят деньги?")
    assert qt == "analyze_expenses"


def test_detect_digest_intent():
    """Should detect digest intent."""
    qt, extra = detect_ai_intent("Дайджест")
    assert qt == "generate_digest"


def test_no_intent_for_random_text():
    """Should return None for non-AI text."""
    qt, extra = detect_ai_intent("кофе 350")
    assert qt is None
    assert extra is None


def test_no_intent_for_empty_text():
    """Should return None for empty text."""
    qt, extra = detect_ai_intent("")
    assert qt is None


# ------------------------------------------------------------------
# /digest command
# ------------------------------------------------------------------


async def test_digest_insufficient_balance(db, make_message):
    """Should show insufficient balance message."""
    service = UserService(db)
    await service.get_or_create(600002, "dig_test", "DT")

    message = make_message(text="/digest", user_id=600002)
    await handle_digest_command(message, db)

    message.answer.assert_called_once()
    call_text = message.answer.call_args[0][0]
    assert "Недостаточно средств" in call_text


async def test_digest_shows_confirmation(db, make_message):
    """Should show cost confirmation for funded user."""
    await _create_funded_user(db, 600003)

    message = make_message(text="/digest", user_id=600003)
    await handle_digest_command(message, db)

    message.answer.assert_called_once()
    call_text = message.answer.call_args[0][0]
    assert "12" in call_text  # cost is 12 rub
    # Should have inline keyboard
    assert message.answer.call_args[1].get("reply_markup") is not None


# ------------------------------------------------------------------
# AI text handler
# ------------------------------------------------------------------


async def test_ai_text_shows_confirmation(db, make_message):
    """AI intent message should show cost confirmation."""
    await _create_funded_user(db, 600004)

    message = make_message(text="Что с моими финансами?", user_id=600004)
    await handle_ai_text(message, db)

    message.answer.assert_called_once()
    call_text = message.answer.call_args[0][0]
    assert "5" in call_text  # analyze_finances costs 5


async def test_ai_text_no_intent_does_nothing(db, make_message):
    """Non-AI text should not trigger any response."""
    await _create_funded_user(db, 600005)

    message = make_message(text="кофе 350", user_id=600005)
    await handle_ai_text(message, db)

    message.answer.assert_not_called()


# ------------------------------------------------------------------
# Callback: cancel
# ------------------------------------------------------------------


async def test_ai_cancel(make_callback):
    """Cancel callback should edit message."""
    callback = make_callback(data="ai_cancel")
    await handle_ai_cancel(callback)

    callback.answer.assert_called_once_with("Отменено")
    callback.message.edit_text.assert_called_once_with("Запрос отменён.")
