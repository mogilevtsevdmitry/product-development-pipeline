"""Tests for billing bot handlers — balance, topup, history, withdraw."""

import pytest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

from src.services.user_service import UserService
from src.services.billing_service import BillingService
from src.bot.handlers.billing import (
    cmd_ai_balance,
    on_ai_balance_callback,
    cmd_ai_history,
    cmd_withdraw,
    on_withdraw_confirm,
    on_withdraw_cancel,
    on_pre_checkout,
    on_successful_payment,
)


async def _setup_user_with_balance(db, user_id: int, balance: Decimal = Decimal("0")):
    """Create user, optionally with balance via topup."""
    user_service = UserService(db)
    user, _ = await user_service.get_or_create(user_id, "billing_h", "BH")
    if balance > 0:
        billing = BillingService(db)
        await billing.topup(user_id, balance, 50, f"tg_{user_id}", f"topup_{user_id}")
    return user


# ------------------------------------------------------------------
# /ai_balance + menu:ai_balance
# ------------------------------------------------------------------


async def test_cmd_ai_balance(db, make_message):
    """Should show balance text and keyboard."""
    await _setup_user_with_balance(db, 600001, Decimal("150.00"))

    msg = make_message(text="/ai_balance", user_id=600001)
    await cmd_ai_balance(msg, db=db)

    msg.answer.assert_called_once()
    text = msg.answer.call_args[0][0]
    assert "150.00" in text
    assert "AI-баланс" in text
    # Should have reply_markup
    assert msg.answer.call_args[1].get("reply_markup") is not None


async def test_on_ai_balance_callback(db, make_callback):
    """Menu callback should show balance."""
    await _setup_user_with_balance(db, 600002, Decimal("200.00"))

    cb = make_callback(data="menu:ai_balance", user_id=600002)
    await on_ai_balance_callback(cb, db=db)

    cb.message.edit_text.assert_called_once()
    text = cb.message.edit_text.call_args[0][0]
    assert "200.00" in text


# ------------------------------------------------------------------
# /ai_history
# ------------------------------------------------------------------


async def test_cmd_ai_history_empty(db, make_message):
    """Empty history should show appropriate message."""
    await _setup_user_with_balance(db, 600003)

    msg = make_message(text="/ai_history", user_id=600003)
    await cmd_ai_history(msg, db=db)

    msg.answer.assert_called_once()
    text = msg.answer.call_args[0][0]
    assert "пуста" in text.lower() or "История" in text


async def test_cmd_ai_history_with_data(db, make_message):
    """Should show history entries."""
    await _setup_user_with_balance(db, 600004, Decimal("100.00"))
    billing = BillingService(db)
    await billing.charge(600004, Decimal("5.00"), "chat")

    msg = make_message(text="/ai_history", user_id=600004)
    await cmd_ai_history(msg, db=db)

    msg.answer.assert_called_once()
    text = msg.answer.call_args[0][0]
    assert "Пополнение" in text or "Списание" in text


# ------------------------------------------------------------------
# /withdraw
# ------------------------------------------------------------------


async def test_cmd_withdraw_insufficient(db, make_message):
    """Withdraw with balance below minimum should show message."""
    await _setup_user_with_balance(db, 600005, Decimal("30.00"))

    msg = make_message(text="/withdraw", user_id=600005)
    await cmd_withdraw(msg, db=db)

    msg.answer.assert_called_once()
    text = msg.answer.call_args[0][0]
    assert "50" in text  # MIN_WITHDRAWAL


async def test_cmd_withdraw_sufficient(db, make_message):
    """Withdraw with sufficient balance should show confirmation."""
    await _setup_user_with_balance(db, 600006, Decimal("200.00"))

    msg = make_message(text="/withdraw", user_id=600006)
    await cmd_withdraw(msg, db=db)

    msg.answer.assert_called_once()
    text = msg.answer.call_args[0][0]
    assert "200.00" in text
    assert msg.answer.call_args[1].get("reply_markup") is not None


# ------------------------------------------------------------------
# Withdraw confirm/cancel
# ------------------------------------------------------------------


async def test_on_withdraw_confirm(db, make_callback):
    """Confirming withdrawal should decrease balance."""
    await _setup_user_with_balance(db, 600007, Decimal("300.00"))

    cb = make_callback(data="billing:withdraw_confirm:300.00", user_id=600007)
    await on_withdraw_confirm(cb, db=db)

    cb.message.edit_text.assert_called_once()
    text = cb.message.edit_text.call_args[0][0]
    assert "Вывод" in text or "выполнен" in text

    billing = BillingService(db)
    balance = await billing.get_balance(600007)
    assert balance == Decimal("0.00")


async def test_on_withdraw_cancel(db, make_callback):
    """Cancel withdrawal should return to balance screen."""
    await _setup_user_with_balance(db, 600008, Decimal("100.00"))

    cb = make_callback(data="billing:withdraw_cancel", user_id=600008)
    await on_withdraw_cancel(cb, db=db)

    cb.message.edit_text.assert_called_once()
    text = cb.message.edit_text.call_args[0][0]
    assert "AI-баланс" in text


# ------------------------------------------------------------------
# Pre-checkout + successful payment
# ------------------------------------------------------------------


async def test_on_pre_checkout(db):
    """Pre-checkout should always respond ok=True."""
    query = AsyncMock()
    query.answer = AsyncMock()

    await on_pre_checkout(query, db=db)

    query.answer.assert_called_once_with(ok=True)


async def test_on_successful_payment(db, make_message):
    """Successful payment should top up balance."""
    await _setup_user_with_balance(db, 600009)

    msg = make_message(user_id=600009)
    msg.successful_payment = MagicMock()
    msg.successful_payment.invoice_payload = "topup_600009_300"
    msg.successful_payment.telegram_payment_charge_id = "charge_abc_123"
    msg.content_type = "successful_payment"

    await on_successful_payment(msg, db=db)

    billing = BillingService(db)
    balance = await billing.get_balance(600009)
    assert balance == Decimal("300.00")

    msg.answer.assert_called_once()
    text = msg.answer.call_args[0][0]
    assert "300" in text
