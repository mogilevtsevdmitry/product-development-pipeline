import re
from dataclasses import dataclass


@dataclass
class ParsedExpense:
    amount: float
    description: str
    category_name: str
    tag: str | None = None


# Keyword -> category mapping (lowercase)
CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "Еда": [
        "кофе", "обед", "ужин", "завтрак", "продукты", "еда", "перекус",
        "ресторан", "кафе", "пицца", "суши", "бургер", "магазин",
        "пятёрочка", "перекрёсток", "ашан", "лента", "дикси", "вкусвилл",
        "макдональдс", "бургеркинг", "kfc", "доставка еды",
    ],
    "Транспорт": [
        "такси", "метро", "автобус", "бензин", "заправка", "парковка",
        "каршеринг", "электричка", "яндекс такси", "убер", "bolt",
        "трамвай", "троллейбус", "проезд",
    ],
    "Развлечения": [
        "кино", "театр", "концерт", "бар", "клуб", "игра", "подписка",
        "netflix", "spotify", "кинотеатр", "музей", "выставка",
    ],
    "Здоровье": [
        "аптека", "врач", "стоматолог", "больница", "лекарства",
        "анализы", "медицина", "спортзал", "фитнес",
    ],
    "Одежда": [
        "одежда", "обувь", "джинсы", "куртка", "футболка", "платье",
        "zara", "hm", "uniqlo",
    ],
    "Жильё": [
        "аренда", "квартплата", "коммуналка", "жкх", "ремонт",
        "мебель", "ипотека",
    ],
    "Связь": [
        "телефон", "интернет", "связь", "мтс", "билайн", "мегафон", "теле2",
    ],
    "Образование": [
        "книга", "курс", "обучение", "учёба", "репетитор",
    ],
    "Красота": [
        "парикмахерская", "салон", "маникюр", "косметика", "барбершоп",
    ],
}

# Build reverse lookup: keyword -> category
_KEYWORD_TO_CATEGORY: dict[str, str] = {}
for category, keywords in CATEGORY_KEYWORDS.items():
    for kw in keywords:
        _KEYWORD_TO_CATEGORY[kw] = category

# Pattern: "description amount [tag]" or "amount description [tag]"
_PATTERN_DESC_AMOUNT = re.compile(
    r"^(?P<desc>[а-яёa-z\s]+?)\s+(?P<amount>\d+(?:[.,]\d{1,2})?)"
    r"(?:\s+(?P<tag>[а-яёa-z]+))?$",
    re.IGNORECASE,
)
_PATTERN_AMOUNT_DESC = re.compile(
    r"^(?P<amount>\d+(?:[.,]\d{1,2})?)\s+(?P<desc>[а-яёa-z\s]+?)"
    r"(?:\s+(?P<tag>[а-яёa-z]+))?$",
    re.IGNORECASE,
)


def _detect_category(description: str) -> str:
    """Detect expense category from description using keyword matching."""
    desc_lower = description.lower().strip()
    # Try exact match first
    if desc_lower in _KEYWORD_TO_CATEGORY:
        return _KEYWORD_TO_CATEGORY[desc_lower]
    # Try substring match
    for keyword, category in _KEYWORD_TO_CATEGORY.items():
        if keyword in desc_lower or desc_lower in keyword:
            return category
    return "Другое"


def parse_expense(text: str) -> ParsedExpense | None:
    """Parse natural language expense input.

    Supported formats:
        "кофе 350"          -> description="кофе", amount=350
        "350 кофе"          -> description="кофе", amount=350
        "такси 600 работа"  -> description="такси", amount=600, tag="работа"
        "обед 450.50"       -> description="обед", amount=450.50

    Returns None if text cannot be parsed as an expense.
    """
    if not text or not text.strip():
        return None

    text = text.strip()

    # Try "desc amount [tag]" pattern first
    match = _PATTERN_DESC_AMOUNT.match(text)
    if not match:
        # Try "amount desc [tag]" pattern
        match = _PATTERN_AMOUNT_DESC.match(text)

    if not match:
        return None

    desc = match.group("desc").strip()
    amount_str = match.group("amount").replace(",", ".")
    tag = match.group("tag")

    if not desc:
        return None

    try:
        amount = float(amount_str)
    except ValueError:
        return None

    if amount <= 0:
        return None

    category = _detect_category(desc)

    return ParsedExpense(
        amount=amount,
        description=desc,
        category_name=category,
        tag=tag.strip() if tag else None,
    )
