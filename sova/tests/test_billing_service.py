"""Tests for BillingService — top-up, charge, withdraw, balance."""

import pytest
from decimal import Decimal

from src.models.user import User
from src.models.billing import BillingTransaction
from src.models.ai_usage import AIUsageLog
from src.services.user_service import UserService
from src.services.billing_service import (
    BillingService,
    InsufficientBalanceError,
    InsufficientWithdrawalError,
    FREE_CREDITS_AMOUNT,
)


async def _create_user(db, user_id: int = 500001) -> User:
    """Helper to create a test user."""
    service = UserService(db)
    user, _ = await service.get_or_create(user_id, "billing_test", "BT")
    return user


# ------------------------------------------------------------------
# grant_free_credits
# ------------------------------------------------------------------


async def test_grant_free_credits(db):
    """Should create topup transaction and increase balance."""
    await _create_user(db, 500001)
    billing = BillingService(db)

    tx = await billing.grant_free_credits(500001)

    assert tx is not None
    assert tx.type == "topup"
    assert tx.amount == FREE_CREDITS_AMOUNT
    assert tx.status == "completed"
    assert tx.idempotency_key == "free_credits_500001"

    balance = await billing.get_balance(500001)
    assert balance == FREE_CREDITS_AMOUNT


async def test_grant_free_credits_idempotent(db):
    """Second call should return None and not double balance."""
    await _create_user(db, 500002)
    billing = BillingService(db)

    tx1 = await billing.grant_free_credits(500002)
    assert tx1 is not None

    tx2 = await billing.grant_free_credits(500002)
    assert tx2 is None

    balance = await billing.get_balance(500002)
    assert balance == FREE_CREDITS_AMOUNT  # Not doubled


# ------------------------------------------------------------------
# topup
# ------------------------------------------------------------------


async def test_topup(db):
    """Should create transaction and increase balance."""
    await _create_user(db, 500003)
    billing = BillingService(db)

    tx = await billing.topup(
        user_id=500003,
        amount=Decimal("100.00"),
        stars_amount=50,
        provider_tx_id="tg_pay_123",
        idempotency_key="topup_500003_123",
    )

    assert tx is not None
    assert tx.type == "topup"
    assert tx.amount == Decimal("100.00")
    assert tx.stars_amount == 50
    assert tx.status == "completed"

    balance = await billing.get_balance(500003)
    assert balance == Decimal("100.00")


async def test_topup_idempotent(db):
    """Duplicate idempotency_key should return None."""
    await _create_user(db, 500004)
    billing = BillingService(db)

    tx1 = await billing.topup(500004, Decimal("300.00"), 150, "tg_pay_456", "topup_500004_456")
    assert tx1 is not None

    tx2 = await billing.topup(500004, Decimal("300.00"), 150, "tg_pay_456", "topup_500004_456")
    assert tx2 is None

    balance = await billing.get_balance(500004)
    assert balance == Decimal("300.00")


# ------------------------------------------------------------------
# charge
# ------------------------------------------------------------------


async def test_charge_success(db):
    """Should deduct balance and create usage log."""
    await _create_user(db, 500005)
    billing = BillingService(db)

    await billing.grant_free_credits(500005)
    log = await billing.charge(500005, Decimal("5.00"), "insight", tokens_used=100)

    assert log is not None
    assert log.query_type == "insight"
    assert log.cost == Decimal("5.00")
    assert log.tokens_used == 100

    balance = await billing.get_balance(500005)
    assert balance == FREE_CREDITS_AMOUNT - Decimal("5.00")


async def test_charge_increments_version(db):
    """Charge should increment ai_balance_version."""
    user = await _create_user(db, 500006)
    billing = BillingService(db)
    initial_version = user.ai_balance_version

    await billing.grant_free_credits(500006)
    await billing.charge(500006, Decimal("3.00"), "chat")

    await db.refresh(user)
    assert user.ai_balance_version == initial_version + 1


async def test_charge_insufficient_balance(db):
    """Should raise InsufficientBalanceError when balance too low."""
    await _create_user(db, 500007)
    billing = BillingService(db)

    # User has 0 balance
    with pytest.raises(InsufficientBalanceError):
        await billing.charge(500007, Decimal("10.00"), "insight")


# ------------------------------------------------------------------
# withdraw
# ------------------------------------------------------------------


async def test_withdraw_success(db):
    """Should decrease balance and create withdrawal transaction."""
    await _create_user(db, 500008)
    billing = BillingService(db)

    await billing.topup(500008, Decimal("200.00"), 100, "tg_w1", "topup_w1")

    tx = await billing.withdraw(500008, Decimal("100.00"))

    assert tx.type == "withdrawal"
    assert tx.amount == Decimal("100.00")
    assert tx.status == "completed"

    balance = await billing.get_balance(500008)
    assert balance == Decimal("100.00")


async def test_withdraw_insufficient(db):
    """Should raise InsufficientWithdrawalError when amount > available."""
    await _create_user(db, 500009)
    billing = BillingService(db)

    await billing.topup(500009, Decimal("100.00"), 50, "tg_w2", "topup_w2")
    # Charge 80 so available_for_withdrawal = 100 - 80 = 20
    await billing.charge(500009, Decimal("80.00"), "digest")

    with pytest.raises(InsufficientWithdrawalError):
        await billing.withdraw(500009, Decimal("50.00"))


# ------------------------------------------------------------------
# get_balance / has_sufficient_balance
# ------------------------------------------------------------------


async def test_get_balance_zero_for_new_user(db):
    """New user should have zero balance."""
    await _create_user(db, 500010)
    billing = BillingService(db)
    assert await billing.get_balance(500010) == Decimal("0")


async def test_has_sufficient_balance(db):
    """Should return True/False based on balance vs cost."""
    await _create_user(db, 500011)
    billing = BillingService(db)

    assert await billing.has_sufficient_balance(500011, Decimal("1.00")) is False

    await billing.grant_free_credits(500011)
    assert await billing.has_sufficient_balance(500011, Decimal("50.00")) is True
    assert await billing.has_sufficient_balance(500011, Decimal("51.00")) is False


# ------------------------------------------------------------------
# get_available_for_withdrawal
# ------------------------------------------------------------------


async def test_get_available_for_withdrawal(db):
    """Should calculate: topups - charges - withdrawals."""
    await _create_user(db, 500012)
    billing = BillingService(db)

    await billing.topup(500012, Decimal("300.00"), 150, "tg_a1", "topup_a1")
    await billing.charge(500012, Decimal("50.00"), "insight")
    await billing.withdraw(500012, Decimal("100.00"))

    available = await billing.get_available_for_withdrawal(500012)
    # 300 - 50 - 100 = 150
    assert available == Decimal("150.00")


# ------------------------------------------------------------------
# get_history
# ------------------------------------------------------------------


async def test_get_history(db):
    """Should return combined billing + usage history sorted by date."""
    await _create_user(db, 500013)
    billing = BillingService(db)

    await billing.topup(500013, Decimal("100.00"), 50, "tg_h1", "topup_h1")
    await billing.charge(500013, Decimal("5.00"), "chat")
    await billing.charge(500013, Decimal("8.00"), "portfolio")

    history = await billing.get_history(500013, limit=10)

    assert len(history) == 3
    # Most recent first
    types = [h["type"] for h in history]
    assert "topup" in types
    assert "charge" in types
