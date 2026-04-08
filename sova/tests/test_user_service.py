import pytest
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import select

from src.models.user import User
from src.services.user_service import UserService


async def test_get_or_create_new_user(db):
    service = UserService(db)
    user, created = await service.get_or_create(
        telegram_id=100001,
        username="newuser",
        first_name="New",
    )
    assert created is True
    assert user.telegram_id == 100001
    assert user.username == "newuser"
    assert user.referral_code is not None
    assert len(user.referral_code) == 8
    assert user.onboarding_completed is False


async def test_get_or_create_existing_user(db):
    service = UserService(db)
    user1, created1 = await service.get_or_create(
        telegram_id=100002, username="existing", first_name="Ex",
    )
    assert created1 is True

    user2, created2 = await service.get_or_create(
        telegram_id=100002, username="existing_updated", first_name="Ex",
    )
    assert created2 is False
    assert user2.telegram_id == 100002
    # Username should be updated on subsequent calls
    assert user2.username == "existing_updated"


async def test_update_level(db):
    service = UserService(db)
    user, _ = await service.get_or_create(telegram_id=100003, username="u", first_name="U")
    assert user.level == "beginner"

    updated = await service.update_level(100003, "advanced")
    assert updated.level == "advanced"


async def test_set_consent(db):
    service = UserService(db)
    user, _ = await service.get_or_create(telegram_id=100004, username="u", first_name="U")
    assert user.pd_consent_at is None

    updated = await service.set_consent(100004)
    assert updated.pd_consent_at is not None


async def test_complete_onboarding(db):
    service = UserService(db)
    user, _ = await service.get_or_create(telegram_id=100005, username="u", first_name="U")
    assert user.onboarding_completed is False

    updated = await service.complete_onboarding(100005)
    assert updated.onboarding_completed is True
    assert updated.ai_balance == Decimal("0")  # Free credits granted in Plan 4


async def test_get_by_referral_code(db):
    service = UserService(db)
    user, _ = await service.get_or_create(telegram_id=100006, username="ref", first_name="R")
    code = user.referral_code

    found = await service.get_by_referral_code(code)
    assert found is not None
    assert found.telegram_id == 100006


async def test_get_by_referral_code_not_found(db):
    service = UserService(db)
    found = await service.get_by_referral_code("NONEXIST")
    assert found is None


async def test_record_referral(db):
    service = UserService(db)
    referrer, _ = await service.get_or_create(telegram_id=100007, username="referrer", first_name="R")
    referred, _ = await service.get_or_create(telegram_id=100008, username="referred", first_name="D")

    success = await service.record_referral(
        referred_user_id=100008,
        referrer_user_id=100007,
    )
    assert success is True

    # Reload both
    result = await db.execute(select(User).where(User.telegram_id == 100008))
    ref_user = result.scalar_one()
    assert ref_user.referred_by == 100007

    result = await db.execute(select(User).where(User.telegram_id == 100007))
    referrer_user = result.scalar_one()
    assert referrer_user.referral_count == 1


async def test_record_referral_max_limit(db):
    service = UserService(db)
    referrer, _ = await service.get_or_create(telegram_id=100009, username="maxref", first_name="M")
    # Set referral count to max (10)
    referrer.referral_count = 10
    await db.commit()

    referred, _ = await service.get_or_create(telegram_id=100010, username="d", first_name="D")
    success = await service.record_referral(
        referred_user_id=100010,
        referrer_user_id=100009,
    )
    assert success is False


async def test_get_notification_settings(db):
    service = UserService(db)
    user, _ = await service.get_or_create(telegram_id=100011, username="u", first_name="U")
    settings = await service.get_notification_settings(100011)
    assert isinstance(settings, dict)


async def test_toggle_notifications(db):
    service = UserService(db)
    user, _ = await service.get_or_create(telegram_id=100012, username="u", first_name="U")

    updated = await service.toggle_notifications(100012, enabled=False)
    assert updated.notification_settings.get("enabled") is False

    updated = await service.toggle_notifications(100012, enabled=True)
    assert updated.notification_settings.get("enabled") is True
