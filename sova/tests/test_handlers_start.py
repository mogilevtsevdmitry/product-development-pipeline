import pytest
from unittest.mock import AsyncMock, patch

from src.models.user import User
from src.services.user_service import UserService
from src.bot.handlers.start import cmd_start, on_consent_accept, on_level_select, on_integration_choice


async def test_start_new_user(db, make_message):
    """New user should see welcome message and consent keyboard."""
    msg = make_message(text="/start", user_id=300001, username="starter", first_name="Star")

    await cmd_start(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    assert "Сова" in call_text or "сова" in call_text.lower()

    # Check user was created
    service = UserService(db)
    user = await service.get_by_id(300001)
    assert user is not None
    assert user.onboarding_completed is False


async def test_start_existing_completed_user(db, make_message):
    """Existing user with completed onboarding should see menu."""
    service = UserService(db)
    user, _ = await service.get_or_create(300002, "existing", "Ex")
    await service.set_consent(300002)
    await service.complete_onboarding(300002)

    msg = make_message(text="/start", user_id=300002, username="existing", first_name="Ex")
    await cmd_start(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    # Should show welcome back or menu, not onboarding
    assert "С возвращением" in call_text or "меню" in call_text.lower() or "Меню" in call_text


async def test_start_with_referral_deep_link(db, make_message):
    """User starting with referral code in deep link."""
    # Create referrer first
    service = UserService(db)
    referrer, _ = await service.get_or_create(300003, "referrer", "R")
    ref_code = referrer.referral_code

    msg = make_message(text=f"/start ref_{ref_code}", user_id=300004, username="newref", first_name="N")
    await cmd_start(msg, db=db)

    # Referred user should be created with referred_by set
    user = await service.get_by_id(300004)
    assert user is not None
    assert user.referred_by == 300003


async def test_consent_accept(db, make_callback):
    """Accepting consent should record timestamp and show integration choice."""
    service = UserService(db)
    await service.get_or_create(300005, "consent", "C")

    cb = make_callback(data="consent:accept", user_id=300005, username="consent", first_name="C")
    await on_consent_accept(cb, db=db)

    user = await service.get_by_id(300005)
    assert user.pd_consent_at is not None

    cb.message.edit_text.assert_called_once()


async def test_level_select(db, make_callback):
    """Selecting level should update user and complete onboarding."""
    service = UserService(db)
    await service.get_or_create(300006, "level", "L")
    await service.set_consent(300006)

    cb = make_callback(data="level:advanced", user_id=300006, username="level", first_name="L")
    await on_level_select(cb, db=db)

    user = await service.get_by_id(300006)
    assert user.level == "advanced"
    assert user.onboarding_completed is True

    cb.message.edit_text.assert_called_once()
    call_text = cb.message.edit_text.call_args[0][0]
    assert "5" in call_text  # 5 free credits mentioned


async def test_integration_choice_skip(db, make_callback):
    """Skipping integrations should proceed to level selection."""
    service = UserService(db)
    await service.get_or_create(300007, "skip", "S")
    await service.set_consent(300007)

    cb = make_callback(data="integration:skip", user_id=300007, username="skip", first_name="S")
    await on_integration_choice(cb, db=db)

    cb.message.edit_text.assert_called_once()
    # Should show level keyboard
