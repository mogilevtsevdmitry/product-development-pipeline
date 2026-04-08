import pytest
from src.services.user_service import UserService
from src.bot.handlers.invite import cmd_invite


async def test_invite_generates_link(db, make_message):
    """Invite command should show referral link."""
    service = UserService(db)
    user, _ = await service.get_or_create(800001, "inviter", "I")

    msg = make_message(text="/invite", user_id=800001)
    await cmd_invite(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    assert user.referral_code in call_text
    assert "t.me" in call_text


async def test_invite_shows_referral_count(db, make_message):
    """Should show how many referrals the user has."""
    service = UserService(db)
    user, _ = await service.get_or_create(800002, "counted", "C")
    user.referral_count = 3
    await db.commit()

    msg = make_message(text="/invite", user_id=800002)
    await cmd_invite(msg, db=db)

    call_text = msg.answer.call_args[0][0]
    assert "3" in call_text
