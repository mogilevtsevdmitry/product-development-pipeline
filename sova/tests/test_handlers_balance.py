import pytest
from decimal import Decimal

from src.models.user import User
from src.models.account import Account
from src.services.user_service import UserService
from src.bot.handlers.balance import cmd_balance, on_balance_callback


async def test_balance_no_accounts(db, make_message):
    """User with no accounts should see appropriate message."""
    service = UserService(db)
    await service.get_or_create(500001, "nobal", "N")

    msg = make_message(text="/balance", user_id=500001)
    await cmd_balance(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    assert "нет" in call_text.lower() or "счет" in call_text.lower()


async def test_balance_with_accounts(db, make_message):
    """User with accounts should see their balances."""
    service = UserService(db)
    await service.get_or_create(500002, "bal", "B")

    acc1 = Account(user_id=500002, name="Tinkoff Black", currency="RUB",
                   balance=Decimal("50000.00"), source="manual")
    acc2 = Account(user_id=500002, name="Savings", currency="RUB",
                   balance=Decimal("200000.00"), source="manual")
    db.add(acc1)
    db.add(acc2)
    await db.commit()

    msg = make_message(text="/balance", user_id=500002)
    await cmd_balance(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    assert "Tinkoff Black" in call_text
    assert "50" in call_text  # part of 50000


async def test_balance_callback(db, make_callback):
    """Menu callback for balance should work."""
    service = UserService(db)
    await service.get_or_create(500003, "cbal", "C")

    cb = make_callback(data="menu:balance", user_id=500003)
    await on_balance_callback(cb, db=db)

    cb.message.edit_text.assert_called_once()
    cb.answer.assert_called_once()
