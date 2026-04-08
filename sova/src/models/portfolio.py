import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import BigInteger, String, Numeric, DateTime, Integer, ForeignKey, Uuid
from sqlalchemy.orm import Mapped, mapped_column
from src.models.base import Base

class PortfolioPosition(Base):
    __tablename__ = "portfolio_positions"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.telegram_id"), nullable=False)
    ticker: Mapped[str] = mapped_column(String, nullable=False)
    figi: Mapped[str | None] = mapped_column(String, nullable=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(12, 6), nullable=True)
    avg_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    current_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    sector: Mapped[str | None] = mapped_column(String, nullable=True)
    asset_type: Mapped[str | None] = mapped_column(String, nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class PortfolioOperation(Base):
    __tablename__ = "portfolio_operations"
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.telegram_id"), nullable=False)
    ticker: Mapped[str] = mapped_column(String, nullable=False)
    operation_type: Mapped[str] = mapped_column(String, nullable=False)
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    price: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    total: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
