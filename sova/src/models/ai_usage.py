import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import BigInteger, String, Numeric, Integer, DateTime, ForeignKey, Uuid
from sqlalchemy.orm import Mapped, mapped_column
from src.models.base import Base

class AIUsageLog(Base):
    __tablename__ = "ai_usage_log"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.telegram_id"), nullable=False)
    query_type: Mapped[str] = mapped_column(String, nullable=False)
    cost: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    tokens_used: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
