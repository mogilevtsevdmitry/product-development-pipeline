"""AI Context Builder — gathers user financial data for LLM context."""

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import select, func, extract, case
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.user import User
from src.models.transaction import Transaction
from src.models.account import Account
from src.models.goal import Goal
from src.models.portfolio import PortfolioPosition


class ContextBuilder:
    """Builds structured context from user financial data for LLM queries."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def build_context(self, user_id: int) -> str:
        """Build complete financial context for a user.

        Gathers profile, financial summary, balances, goals, and portfolio.
        Returns formatted text string for inclusion in LLM prompt.
        """
        parts: list[str] = []

        # 1. User profile
        profile = await self._get_user_profile(user_id)
        if profile:
            parts.append(profile)

        # 2. Financial summary (last 3 months)
        summary = await self._get_financial_summary(user_id)
        if summary:
            parts.append(summary)

        # 3. Current balances
        balances = await self._get_balances(user_id)
        if balances:
            parts.append(balances)

        # 4. Active goals
        goals = await self._get_active_goals(user_id)
        if goals:
            parts.append(goals)

        # 5. Portfolio positions
        portfolio = await self._get_portfolio(user_id)
        if portfolio:
            parts.append(portfolio)

        if not parts:
            return "Данные пользователя пока отсутствуют."

        return "\n\n".join(parts)

    async def _get_user_profile(self, user_id: int) -> str | None:
        """Get basic user profile info."""
        result = await self.db.execute(
            select(User).where(User.telegram_id == user_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            return None

        level_labels = {
            "beginner": "Новичок",
            "intermediate": "Средний уровень",
            "advanced": "Продвинутый",
        }
        level_label = level_labels.get(user.level, user.level)

        return (
            f"[Профиль пользователя]\n"
            f"Уровень: {level_label}\n"
            f"Часовой пояс: {user.timezone}"
        )

    async def _get_financial_summary(self, user_id: int) -> str | None:
        """Get income/expense summary for the last 3 months, aggregated by category."""
        three_months_ago = date.today() - timedelta(days=90)

        # Total income (positive amounts)
        income_result = await self.db.execute(
            select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                Transaction.user_id == user_id,
                Transaction.date >= three_months_ago,
                Transaction.amount > 0,
            )
        )
        total_income = Decimal(str(income_result.scalar()))

        # Total expenses (negative amounts)
        expense_result = await self.db.execute(
            select(func.coalesce(func.sum(Transaction.amount), 0)).where(
                Transaction.user_id == user_id,
                Transaction.date >= three_months_ago,
                Transaction.amount < 0,
            )
        )
        total_expenses = abs(Decimal(str(expense_result.scalar())))

        # Monthly breakdown
        monthly_result = await self.db.execute(
            select(
                extract("year", Transaction.date).label("year"),
                extract("month", Transaction.date).label("month"),
                func.sum(
                    case(
                        (Transaction.amount > 0, Transaction.amount),
                        else_=0,
                    )
                ).label("income"),
                func.sum(
                    case(
                        (Transaction.amount < 0, func.abs(Transaction.amount)),
                        else_=0,
                    )
                ).label("expenses"),
            ).where(
                Transaction.user_id == user_id,
                Transaction.date >= three_months_ago,
            ).group_by("year", "month").order_by("year", "month")
        )
        months = list(monthly_result.all())

        lines = [
            f"[Финансовая сводка за 3 месяца]",
            f"Доходы: {total_income:,.2f} ₽",
            f"Расходы: {total_expenses:,.2f} ₽",
            f"Баланс: {total_income - total_expenses:+,.2f} ₽",
        ]

        if months:
            lines.append("\nПо месяцам:")
            for row in months:
                month_names = {
                    1: "Янв", 2: "Фев", 3: "Мар", 4: "Апр",
                    5: "Май", 6: "Июн", 7: "Июл", 8: "Авг",
                    9: "Сен", 10: "Окт", 11: "Ноя", 12: "Дек",
                }
                m_name = month_names.get(int(row.month), str(row.month))
                inc = Decimal(str(row.income or 0))
                exp = Decimal(str(row.expenses or 0))
                lines.append(f"  {m_name}: +{inc:,.2f} / -{exp:,.2f}")

        if total_income == 0 and total_expenses == 0:
            return None

        return "\n".join(lines)

    async def _get_balances(self, user_id: int) -> str | None:
        """Get current account balances."""
        result = await self.db.execute(
            select(Account).where(Account.user_id == user_id)
        )
        accounts = list(result.scalars().all())

        if not accounts:
            return None

        lines = ["[Текущие балансы]"]
        for acc in accounts:
            lines.append(f"  {acc.name}: {acc.balance:,.2f} {acc.currency}")

        return "\n".join(lines)

    async def _get_active_goals(self, user_id: int) -> str | None:
        """Get active savings goals."""
        result = await self.db.execute(
            select(Goal).where(
                Goal.user_id == user_id,
                Goal.status == "active",
            )
        )
        goals = list(result.scalars().all())

        if not goals:
            return None

        lines = ["[Активные цели]"]
        for goal in goals:
            progress = (
                (goal.current_amount / goal.target_amount * 100)
                if goal.target_amount > 0
                else 0
            )
            deadline_str = goal.deadline.isoformat() if goal.deadline else "без срока"
            lines.append(
                f"  {goal.name}: {goal.current_amount:,.2f} / {goal.target_amount:,.2f} ₽ "
                f"({progress:.0f}%) — до {deadline_str}"
            )

        return "\n".join(lines)

    async def _get_portfolio(self, user_id: int) -> str | None:
        """Get portfolio positions."""
        result = await self.db.execute(
            select(PortfolioPosition).where(
                PortfolioPosition.user_id == user_id,
                PortfolioPosition.quantity > 0,
            )
        )
        positions = list(result.scalars().all())

        if not positions:
            return None

        lines = ["[Инвестиционный портфель]"]
        total_value = Decimal("0")
        for pos in positions:
            value = pos.quantity * pos.current_price
            total_value += value
            pnl = value - (pos.quantity * pos.avg_price) if pos.avg_price else Decimal("0")
            lines.append(
                f"  {pos.ticker} ({pos.name}): {pos.quantity} шт. x {pos.current_price:,.2f} = "
                f"{value:,.2f} ₽ (P&L: {pnl:+,.2f})"
            )

        lines.append(f"  ИТОГО: {total_value:,.2f} ₽")

        return "\n".join(lines)
