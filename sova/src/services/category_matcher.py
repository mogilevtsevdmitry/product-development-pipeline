"""Keyword-based category matching.

Reuses keyword database from expense_parser for consistency.
Used for mapping ZenMoney categories and transaction descriptions
to our internal category system.

AI-based mapping is deferred to Plan 5.
"""
from src.services.expense_parser import CATEGORY_KEYWORDS, _KEYWORD_TO_CATEGORY

# Additional mappings for ZenMoney category names -> our categories
_ZENMONEY_CATEGORY_MAP: dict[str, str] = {
    # Direct matches
    "Еда": "Еда",
    "Продукты": "Еда",
    "Рестораны": "Еда",
    "Рестораны и кафе": "Еда",
    "Кафе и рестораны": "Еда",
    "Фастфуд": "Еда",
    "Транспорт": "Транспорт",
    "Автомобиль": "Транспорт",
    "Такси": "Транспорт",
    "Общественный транспорт": "Транспорт",
    "Бензин": "Транспорт",
    "Развлечения": "Развлечения",
    "Кино": "Развлечения",
    "Отдых и развлечения": "Развлечения",
    "Здоровье": "Здоровье",
    "Медицина": "Здоровье",
    "Аптека": "Здоровье",
    "Спорт": "Здоровье",
    "Фитнес": "Здоровье",
    "Одежда": "Одежда",
    "Одежда и обувь": "Одежда",
    "Жильё": "Жильё",
    "Аренда": "Жильё",
    "ЖКХ": "Жильё",
    "Коммунальные услуги": "Жильё",
    "Ремонт": "Жильё",
    "Связь": "Связь",
    "Интернет": "Связь",
    "Телефон": "Связь",
    "Образование": "Образование",
    "Книги": "Образование",
    "Красота": "Красота",
    "Красота и здоровье": "Красота",
    "Зарплата": "Зарплата",
    "Доход": "Зарплата",
}


class CategoryMatcher:
    """Match transaction descriptions or external category names to our categories."""

    def match(self, description: str) -> str:
        """Match a transaction description to a category using keywords.

        Uses the same keyword database as expense_parser.
        Returns category name string (e.g. "Еда", "Транспорт").
        Falls back to "Другое" if no match.
        """
        desc_lower = description.lower().strip()

        # Exact keyword match
        if desc_lower in _KEYWORD_TO_CATEGORY:
            return _KEYWORD_TO_CATEGORY[desc_lower]

        # Substring match -- check if any keyword is contained in description
        for keyword, category in _KEYWORD_TO_CATEGORY.items():
            if keyword in desc_lower:
                return category

        return "Другое"

    def match_zenmoney_category(self, zm_category_name: str) -> str:
        """Match a ZenMoney category name to our category.

        First tries direct mapping, then keyword-based fallback.
        Returns category name string.
        """
        # Direct mapping lookup
        if zm_category_name in _ZENMONEY_CATEGORY_MAP:
            return _ZENMONEY_CATEGORY_MAP[zm_category_name]

        # Try keyword-based matching on the category name itself
        return self.match(zm_category_name)
