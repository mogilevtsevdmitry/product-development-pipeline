import uuid
from datetime import datetime, timezone, date
from sqlalchemy import BigInteger, String, Date, DateTime, Integer, Text, ForeignKey, LargeBinary, Uuid
from sqlalchemy.orm import Mapped, mapped_column
from src.models.base import Base

class Integration(Base):
    __tablename__ = "integrations"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.telegram_id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    access_token_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    refresh_token_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sync_from_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String, default="active")
