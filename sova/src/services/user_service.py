import secrets
import string
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.user import User

MAX_REFERRALS = 10


def _generate_referral_code(length: int = 8) -> str:
    """Generate a random alphanumeric referral code."""
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


class UserService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_or_create(
        self,
        telegram_id: int,
        username: str | None = None,
        first_name: str | None = None,
    ) -> tuple[User, bool]:
        """Get existing user or create a new one.

        Returns (user, created) tuple.
        """
        result = await self.db.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        user = result.scalar_one_or_none()

        if user is not None:
            # Update username/first_name if changed
            if username is not None and user.username != username:
                user.username = username
            if first_name is not None and user.first_name != first_name:
                user.first_name = first_name
            await self.db.commit()
            await self.db.refresh(user)
            return user, False

        user = User(
            telegram_id=telegram_id,
            username=username,
            first_name=first_name,
            referral_code=_generate_referral_code(),
        )
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return user, True

    async def get_by_id(self, telegram_id: int) -> User | None:
        """Get user by telegram_id."""
        result = await self.db.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        return result.scalar_one_or_none()

    async def update_level(self, telegram_id: int, level: str) -> User:
        """Update user financial literacy level."""
        result = await self.db.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        user = result.scalar_one()
        user.level = level
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def set_consent(self, telegram_id: int) -> User:
        """Record 152-FZ personal data consent timestamp."""
        result = await self.db.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        user = result.scalar_one()
        user.pd_consent_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def complete_onboarding(self, telegram_id: int) -> User:
        """Mark onboarding as completed."""
        result = await self.db.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        user = result.scalar_one()
        user.onboarding_completed = True
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def get_by_referral_code(self, code: str) -> User | None:
        """Find user by referral code."""
        result = await self.db.execute(
            select(User).where(User.referral_code == code)
        )
        return result.scalar_one_or_none()

    async def record_referral(
        self, referred_user_id: int, referrer_user_id: int
    ) -> bool:
        """Record a referral. Returns False if referrer has hit max limit."""
        result = await self.db.execute(
            select(User).where(User.telegram_id == referrer_user_id)
        )
        referrer = result.scalar_one()

        if referrer.referral_count >= MAX_REFERRALS:
            return False

        result = await self.db.execute(
            select(User).where(User.telegram_id == referred_user_id)
        )
        referred = result.scalar_one()

        referred.referred_by = referrer_user_id
        referrer.referral_count += 1

        await self.db.commit()
        return True

    async def get_notification_settings(self, telegram_id: int) -> dict:
        """Get user notification settings."""
        user = await self.get_by_id(telegram_id)
        if user is None:
            return {}
        return user.notification_settings or {}

    async def toggle_notifications(self, telegram_id: int, enabled: bool) -> User:
        """Toggle notifications on/off."""
        result = await self.db.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        user = result.scalar_one()
        settings = dict(user.notification_settings or {})
        settings["enabled"] = enabled
        user.notification_settings = settings
        await self.db.commit()
        await self.db.refresh(user)
        return user
