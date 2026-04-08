"""Maps ZenMoney API data to our internal model fields.

Does NOT create ORM objects directly -- returns dicts suitable for
constructing Account/Transaction models. This keeps the mapper
testable without a database.
"""
from datetime import date
from decimal import Decimal

from src.services.category_matcher import CategoryMatcher


class ZenMoneyMapper:
    """Maps ZenMoney API responses to our data model fields."""

    def __init__(self) -> None:
        self._category_matcher = CategoryMatcher()

    def build_tag_lookup(self, zm_tags: list[dict]) -> dict[str, str]:
        """Build tag_id -> title lookup from ZenMoney tags."""
        return {tag["id"]: tag["title"] for tag in zm_tags}

    def build_instrument_lookup(self, zm_instruments: list[dict]) -> dict[int, dict]:
        """Build instrument_id -> instrument dict lookup."""
        return {inst["id"]: inst for inst in zm_instruments}

    def map_account(
        self, zm_account: dict, instruments: dict[int, dict], user_id: int
    ) -> dict:
        """Map a ZenMoney account to our Account model fields.

        Returns dict with keys: user_id, name, currency, balance, source, external_id.
        """
        instrument_id = zm_account.get("instrument")
        currency = "RUB"
        if instrument_id and instrument_id in instruments:
            currency = instruments[instrument_id].get("shortTitle", "RUB")

        return {
            "user_id": user_id,
            "name": zm_account["title"],
            "currency": currency,
            "balance": Decimal(str(zm_account.get("balance", 0))),
            "source": "zenmoney",
            "external_id": str(zm_account["id"]),
        }

    def map_transaction(
        self, zm_tx: dict, tags: dict[str, str], user_id: int
    ) -> dict | None:
        """Map a ZenMoney transaction to our Transaction model fields.

        Returns None for transfers (income > 0 AND outcome > 0 with different accounts).
        Returns dict with keys: user_id, amount, currency, date, description,
            source, external_id, category_name.
        """
        income = zm_tx.get("income", 0) or 0
        outcome = zm_tx.get("outcome", 0) or 0
        income_account = zm_tx.get("incomeAccount")
        outcome_account = zm_tx.get("outcomeAccount")

        # Skip transfers between own accounts
        if income > 0 and outcome > 0 and income_account != outcome_account:
            return None

        # Determine amount: negative for expenses, positive for income
        if outcome > 0:
            amount = Decimal(str(-abs(outcome)))
        else:
            amount = Decimal(str(abs(income)))

        # Resolve category from tags
        tag_ids = zm_tx.get("tag") or []
        category_name = "Другое"
        if tag_ids and isinstance(tag_ids, list):
            for tag_id in tag_ids:
                if tag_id in tags:
                    category_name = self._category_matcher.match_zenmoney_category(
                        tags[tag_id]
                    )
                    break

        # If no category from tags, try matching description
        comment = zm_tx.get("comment")
        if category_name == "Другое" and comment:
            category_name = self._category_matcher.match(comment)

        return {
            "user_id": user_id,
            "amount": amount,
            "currency": "RUB",
            "date": date.fromisoformat(zm_tx["date"]),
            "description": comment,
            "source": "zenmoney",
            "external_id": str(zm_tx["id"]),
            "category_name": category_name,
        }
