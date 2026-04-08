from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.category import Category
from src.models.transaction import Transaction


class TransactionService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def _find_category(self, category_name: str, user_id: int | None = None) -> Category | None:
        """Find category by name, preferring user-specific categories."""
        # Try exact match (system categories first)
        result = await self.db.execute(
            select(Category).where(
                Category.name == category_name,
                Category.user_id.is_(None),
            )
        )
        category = result.scalar_one_or_none()
        if category:
            return category

        # Try user-specific
        if user_id is not None:
            result = await self.db.execute(
                select(Category).where(
                    Category.name == category_name,
                    Category.user_id == user_id,
                )
            )
            category = result.scalar_one_or_none()
            if category:
                return category

        # Fallback to "Другое"
        result = await self.db.execute(
            select(Category).where(Category.name == "Другое")
        )
        return result.scalar_one_or_none()

    async def create_expense(
        self,
        user_id: int,
        amount: float,
        description: str,
        category_name: str,
        tag: str | None = None,
    ) -> Transaction:
        """Create a manual expense transaction.

        Amount is stored as negative (expense convention).
        """
        category = await self._find_category(category_name, user_id)

        tx = Transaction(
            user_id=user_id,
            amount=Decimal(str(-abs(amount))),
            currency="RUB",
            date=date.today(),
            description=description if not tag else f"{description} #{tag}",
            source="manual",
            category_id=category.id if category else None,
        )
        self.db.add(tx)
        await self.db.commit()
        await self.db.refresh(tx)
        return tx

    async def get_today_expenses(self, user_id: int) -> list[Transaction]:
        """Get all expenses for today."""
        result = await self.db.execute(
            select(Transaction).where(
                Transaction.user_id == user_id,
                Transaction.date == date.today(),
                Transaction.amount < 0,
            ).order_by(Transaction.created_at.desc())
        )
        return list(result.scalars().all())
