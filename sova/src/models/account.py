import uuid
from decimal import Decimal
from sqlalchemy import BigInteger, String, Numeric, ForeignKey, Uuid, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from src.models.base import Base

class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("user_id", "source", "external_id", name="uq_account_source"),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.telegram_id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="RUB")
    balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=True)
    source: Mapped[str] = mapped_column(String, nullable=False)
    external_id: Mapped[str | None] = mapped_column(String, nullable=True)
