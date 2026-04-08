import pytest
from src.models.user import User
from src.services.user_service import UserService
from src.bot.handlers.menu import cmd_menu, on_menu_callback, on_coming_soon


async def test_menu_command(db, make_message):
    """Menu command should show inline keyboard."""
    service = UserService(db)
    await service.get_or_create(400001, "menu", "M")

    msg = make_message(text="/menu", user_id=400001, username="menu", first_name="M")
    await cmd_menu(msg, db=db)

    msg.answer.assert_called_once()
    call_kwargs = msg.answer.call_args
    assert call_kwargs.kwargs.get("reply_markup") is not None


async def test_menu_back_callback(db, make_callback):
    """Back button should re-show the menu."""
    service = UserService(db)
    await service.get_or_create(400002, "back", "B")

    cb = make_callback(data="menu:back", user_id=400002, username="back", first_name="B")
    await on_menu_callback(cb, db=db)

    cb.message.edit_text.assert_called_once()
    cb.answer.assert_called_once()


async def test_coming_soon_portfolio(db, make_callback):
    """Portfolio stub should show coming soon message."""
    cb = make_callback(data="menu:portfolio")
    await on_coming_soon(cb, db=db)

    cb.message.edit_text.assert_called_once()
    call_text = cb.message.edit_text.call_args[0][0]
    assert "Портфель" in call_text
    cb.answer.assert_called_once()


async def test_coming_soon_goals(db, make_callback):
    """Goals stub should show coming soon message."""
    cb = make_callback(data="menu:goals")
    await on_coming_soon(cb, db=db)

    call_text = cb.message.edit_text.call_args[0][0]
    assert "Цели" in call_text


async def test_ai_balance_not_in_coming_soon(db, make_callback):
    """AI balance is no longer a stub — handled by billing router."""
    # menu:ai_balance was removed from the coming_soon set
    # It is now handled by src.bot.handlers.billing.on_ai_balance_callback
    from src.bot.handlers.menu import COMING_SOON_TEXT
    assert "menu:ai_balance" not in COMING_SOON_TEXT
