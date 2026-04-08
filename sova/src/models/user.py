from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import BigInteger, String, Numeric, Integer, DateTime, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from src.models.base import Base

class User(Base):
    __tablename__ = "users"
    telegram_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str | None] = mapped_column(String, nullable=True)
    first_name: Mapped[str | None] = mapped_column(String, nullable=True)
    level: Mapped[str] = mapped_column(String, default="beginner")
    ai_balance: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    ai_balance_version: Mapped[int] = mapped_column(Integer, default=0)
    timezone: Mapped[str] = mapped_column(String, default="Europe/Moscow")
    notification_settings: Mapped[dict] = mapped_column(JSON, default=dict)
    referral_code: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    referred_by: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    referral_count: Mapped[int] = mapped_column(Integer, default=0)
    pd_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
