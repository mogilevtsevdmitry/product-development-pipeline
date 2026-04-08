# Sova Plan 2: Telegram Bot Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Telegram bot core — aiogram 3 webhook integration with FastAPI, onboarding flow (/start with 152-FZ consent), main menu, quick expense input with regex parser, basic commands (/balance, /today, /help), referral system, settings UI, and user service layer.

**Architecture:** aiogram 3 Dispatcher with Router pattern. Handlers organized in separate files under `src/bot/handlers/`. Business logic in `src/services/`. Webhook registered on FastAPI app via lifespan events. SQLAlchemy async sessions for all DB operations.

**Tech Stack:** Python 3.12, FastAPI, aiogram 3 (Dispatcher + Router), SQLAlchemy 2.0 (async), pytest, pytest-asyncio, aiosqlite

**Spec:** `docs/superpowers/specs/2026-04-08-sova-financial-assistant-design.md`

**Depends on:** Plan 1 (Foundation) — completed

**Scope boundaries:** NO AI features (Plan 5), NO external integrations (Plan 3), NO billing/payments (Plan 4). Integration choice buttons in onboarding are UI-only stubs. Expense categorization uses regex patterns only (no LLM).

---

## File Structure

```
sova/src/
├── bot/
│   ├── __init__.py                    # (exists)
│   ├── setup.py                       # Rewrite: Dispatcher, Router registration, webhook setup
│   ├── middlewares/
│   │   ├── __init__.py
│   │   └── db_session.py              # Middleware: inject async DB session into handler data
│   ├── handlers/
│   │   ├── __init__.py
│   │   ├── start.py                   # /start — onboarding flow with consent + level selection
│   │   ├── menu.py                    # /menu — inline keyboard with main sections
│   │   ├── balance.py                 # /balance — show account balances
│   │   ├── today.py                   # /today — today's expenses summary
│   │   ├── help.py                    # /help — bot capabilities
│   │   ├── expense.py                 # Quick expense input: "кофе 350"
│   │   ├── invite.py                  # /invite — referral link generation + deep link handling
│   │   └── settings.py               # /settings — notification toggles, integration stubs
│   └── keyboards/
│       ├── __init__.py
│       └── common.py                  # Reusable inline keyboard builders
├── services/
│   ├── __init__.py
│   ├── user_service.py                # User CRUD: get_or_create, update_level, update_consent
│   ├── transaction_service.py         # Create transaction, get today's expenses
│   └── expense_parser.py              # Regex-based natural language expense parser
├── models/
│   └── user.py                        # Modify: add referral_code, referred_by, pd_consent_at fields
├── main.py                            # Modify: add lifespan for bot webhook registration
├── config.py                          # Modify: add webhook_path setting
└── ...

sova/tests/
├── conftest.py                        # Modify: add bot fixtures (mock Bot, mock Message)
├── test_expense_parser.py             # Unit tests for regex expense parser
├── test_user_service.py               # Tests for user CRUD operations
├── test_transaction_service.py        # Tests for transaction creation
├── test_handlers_start.py             # Tests for /start onboarding flow
├── test_handlers_menu.py              # Tests for /menu command
├── test_handlers_balance.py           # Tests for /balance command
├── test_handlers_today.py             # Tests for /today command
├── test_handlers_expense.py           # Tests for quick expense input
├── test_handlers_invite.py            # Tests for /invite and referral deep links
└── test_webhook.py                    # Tests for webhook endpoint integration
```

---

### Task 1: Update User Model — Add Referral & Consent Fields

**Files:**
- Modify: `sova/src/models/user.py`
- Modify: `sova/tests/test_models.py`

- [ ] **Step 1: Write failing test for new User fields**

Add to `tests/test_models.py`:

```python
async def test_user_referral_and_consent_fields(db):
    from datetime import datetime, timezone

    user = User(
        telegram_id=888,
        username="refuser",
        first_name="Ref",
        referral_code="ABC123",
        referred_by=None,
        pd_consent_at=datetime.now(timezone.utc),
        onboarding_completed=True,
    )
    db.add(user)
    await db.commit()

    result = await db.execute(select(User).where(User.telegram_id == 888))
    saved = result.scalar_one()
    assert saved.referral_code == "ABC123"
    assert saved.referred_by is None
    assert saved.pd_consent_at is not None
    assert saved.onboarding_completed is True
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_models.py::test_user_referral_and_consent_fields -v
```

Expected: FAIL — `TypeError: User() got an unexpected keyword argument 'referral_code'`

- [ ] **Step 3: Add new fields to User model**

```python
# sova/src/models/user.py
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_models.py::test_user_referral_and_consent_fields -v
```

Expected: PASS

- [ ] **Step 5: Run all existing model tests to ensure no regressions**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_models.py -v
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/models/user.py tests/test_models.py
git commit -m "feat(sova): add referral_code, referred_by, pd_consent_at, onboarding_completed to User model"
```

---

### Task 2: Config Update & Bot Setup Foundation

**Files:**
- Modify: `sova/src/config.py`
- Create: `sova/src/bot/middlewares/__init__.py`
- Create: `sova/src/bot/middlewares/db_session.py`
- Create: `sova/src/bot/handlers/__init__.py`
- Create: `sova/src/bot/keyboards/__init__.py`
- Create: `sova/src/bot/keyboards/common.py`
- Create: `sova/src/services/__init__.py`

- [ ] **Step 1: Update config.py with webhook_path**

```python
# sova/src/config.py
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://sova:sova@localhost:5432/sova"
    redis_url: str = "redis://localhost:6379/0"
    bot_token: str = ""
    anthropic_api_key: str = ""
    app_base_url: str = "http://localhost:8000"
    encryption_key: str = ""
    webhook_path: str = "/bot/webhook"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
```

- [ ] **Step 2: Create DB session middleware for aiogram**

```python
# sova/src/bot/middlewares/__init__.py
```

```python
# sova/src/bot/middlewares/db_session.py
from typing import Any, Awaitable, Callable

from aiogram import BaseMiddleware
from aiogram.types import TelegramObject
from sqlalchemy.ext.asyncio import async_sessionmaker


class DbSessionMiddleware(BaseMiddleware):
    def __init__(self, session_pool: async_sessionmaker):
        self.session_pool = session_pool

    async def __call__(
        self,
        handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
        event: TelegramObject,
        data: dict[str, Any],
    ) -> Any:
        async with self.session_pool() as session:
            data["db"] = session
            return await handler(event, data)
```

- [ ] **Step 3: Create keyboard builders**

```python
# sova/src/bot/keyboards/__init__.py
```

```python
# sova/src/bot/keyboards/common.py
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton


def consent_keyboard() -> InlineKeyboardMarkup:
    """152-FZ personal data consent keyboard."""
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="📋 Политика конфиденциальности",
            url="https://sova.app/privacy",
        )],
        [InlineKeyboardButton(
            text="✅ Принимаю",
            callback_data="consent:accept",
        )],
    ])


def integration_keyboard() -> InlineKeyboardMarkup:
    """Integration choice during onboarding."""
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🏦 Подключить ZenMoney", callback_data="integration:zenmoney")],
        [InlineKeyboardButton(text="💳 Подключить T-Bank", callback_data="integration:tbank")],
        [InlineKeyboardButton(text="▶️ Начать без интеграций", callback_data="integration:skip")],
    ])


def level_keyboard() -> InlineKeyboardMarkup:
    """User level selection during onboarding."""
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🌱 Я новичок", callback_data="level:beginner")],
        [InlineKeyboardButton(text="📊 Уже веду бюджет", callback_data="level:intermediate")],
        [InlineKeyboardButton(text="📈 Инвестирую активно", callback_data="level:advanced")],
    ])


def main_menu_keyboard() -> InlineKeyboardMarkup:
    """Main menu inline keyboard."""
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="💰 Баланс", callback_data="menu:balance"),
            InlineKeyboardButton(text="📊 Сегодня", callback_data="menu:today"),
        ],
        [
            InlineKeyboardButton(text="📈 Портфель", callback_data="menu:portfolio"),
            InlineKeyboardButton(text="🎯 Цели", callback_data="menu:goals"),
        ],
        [
            InlineKeyboardButton(text="🔔 Настройки", callback_data="menu:settings"),
            InlineKeyboardButton(text="💎 Баланс AI", callback_data="menu:ai_balance"),
        ],
        [InlineKeyboardButton(text="📖 Помощь", callback_data="menu:help")],
    ])


def settings_keyboard(notifications_enabled: bool = True) -> InlineKeyboardMarkup:
    """Settings menu keyboard."""
    notif_text = "🔕 Выключить уведомления" if notifications_enabled else "🔔 Включить уведомления"
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=notif_text, callback_data="settings:toggle_notifications")],
        [InlineKeyboardButton(text="🏦 Интеграции", callback_data="settings:integrations")],
        [InlineKeyboardButton(text="📊 Уровень", callback_data="settings:level")],
        [InlineKeyboardButton(text="◀️ Назад", callback_data="menu:back")],
    ])
```

- [ ] **Step 4: Create empty init files**

```python
# sova/src/bot/handlers/__init__.py
```

```python
# sova/src/services/__init__.py
```

- [ ] **Step 5: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/config.py src/bot/ src/services/
git commit -m "feat(sova): add bot middlewares, keyboards, and config webhook_path"
```

---

### Task 3: Expense Parser (Pure Logic, No DB)

**Files:**
- Create: `sova/src/services/expense_parser.py`
- Create: `sova/tests/test_expense_parser.py`

- [ ] **Step 1: Write failing tests for expense parser**

```python
# sova/tests/test_expense_parser.py
import pytest
from src.services.expense_parser import parse_expense, ParsedExpense


def test_simple_expense():
    result = parse_expense("кофе 350")
    assert result is not None
    assert result.amount == 350.0
    assert result.description == "кофе"
    assert result.category_name == "Еда"


def test_expense_with_category_hint():
    result = parse_expense("такси 600")
    assert result is not None
    assert result.amount == 600.0
    assert result.description == "такси"
    assert result.category_name == "Транспорт"


def test_expense_amount_first():
    result = parse_expense("350 кофе")
    assert result is not None
    assert result.amount == 350.0
    assert result.description == "кофе"


def test_expense_with_decimal():
    result = parse_expense("обед 450.50")
    assert result is not None
    assert result.amount == 450.50
    assert result.description == "обед"


def test_expense_groceries():
    result = parse_expense("продукты 2300")
    assert result is not None
    assert result.category_name == "Еда"


def test_expense_transport():
    result = parse_expense("метро 65")
    assert result is not None
    assert result.category_name == "Транспорт"


def test_expense_entertainment():
    result = parse_expense("кино 800")
    assert result is not None
    assert result.category_name == "Развлечения"


def test_expense_health():
    result = parse_expense("аптека 1200")
    assert result is not None
    assert result.category_name == "Здоровье"


def test_expense_clothing():
    result = parse_expense("одежда 5000")
    assert result is not None
    assert result.category_name == "Одежда"


def test_expense_unknown_category():
    result = parse_expense("штука 100")
    assert result is not None
    assert result.category_name == "Другое"


def test_expense_just_number_returns_none():
    result = parse_expense("350")
    assert result is None


def test_expense_no_number_returns_none():
    result = parse_expense("привет")
    assert result is None


def test_expense_empty_returns_none():
    result = parse_expense("")
    assert result is None


def test_expense_with_tag():
    result = parse_expense("такси 600 работа")
    assert result is not None
    assert result.amount == 600.0
    assert result.description == "такси"
    assert result.tag == "работа"


def test_expense_large_amount():
    result = parse_expense("аренда 45000")
    assert result is not None
    assert result.amount == 45000.0
    assert result.category_name == "Жильё"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_expense_parser.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'src.services.expense_parser'`

- [ ] **Step 3: Implement expense parser**

```python
# sova/src/services/expense_parser.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_expense_parser.py -v
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/services/expense_parser.py tests/test_expense_parser.py
git commit -m "feat(sova): add regex-based expense parser with category detection"
```

---

### Task 4: User Service — CRUD Operations

**Files:**
- Create: `sova/src/services/user_service.py`
- Create: `sova/tests/test_user_service.py`

- [ ] **Step 1: Write failing tests for user service**

```python
# sova/tests/test_user_service.py
import pytest
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import select

from src.models.user import User
from src.services.user_service import UserService


async def test_get_or_create_new_user(db):
    service = UserService(db)
    user, created = await service.get_or_create(
        telegram_id=100001,
        username="newuser",
        first_name="New",
    )
    assert created is True
    assert user.telegram_id == 100001
    assert user.username == "newuser"
    assert user.referral_code is not None
    assert len(user.referral_code) == 8
    assert user.onboarding_completed is False


async def test_get_or_create_existing_user(db):
    service = UserService(db)
    user1, created1 = await service.get_or_create(
        telegram_id=100002, username="existing", first_name="Ex",
    )
    assert created1 is True

    user2, created2 = await service.get_or_create(
        telegram_id=100002, username="existing_updated", first_name="Ex",
    )
    assert created2 is False
    assert user2.telegram_id == 100002
    # Username should be updated on subsequent calls
    assert user2.username == "existing_updated"


async def test_update_level(db):
    service = UserService(db)
    user, _ = await service.get_or_create(telegram_id=100003, username="u", first_name="U")
    assert user.level == "beginner"

    updated = await service.update_level(100003, "advanced")
    assert updated.level == "advanced"


async def test_set_consent(db):
    service = UserService(db)
    user, _ = await service.get_or_create(telegram_id=100004, username="u", first_name="U")
    assert user.pd_consent_at is None

    updated = await service.set_consent(100004)
    assert updated.pd_consent_at is not None


async def test_complete_onboarding(db):
    service = UserService(db)
    user, _ = await service.get_or_create(telegram_id=100005, username="u", first_name="U")
    assert user.onboarding_completed is False

    updated = await service.complete_onboarding(100005)
    assert updated.onboarding_completed is True
    assert updated.ai_balance == Decimal("0")  # Free credits granted in Plan 4


async def test_get_by_referral_code(db):
    service = UserService(db)
    user, _ = await service.get_or_create(telegram_id=100006, username="ref", first_name="R")
    code = user.referral_code

    found = await service.get_by_referral_code(code)
    assert found is not None
    assert found.telegram_id == 100006


async def test_get_by_referral_code_not_found(db):
    service = UserService(db)
    found = await service.get_by_referral_code("NONEXIST")
    assert found is None


async def test_record_referral(db):
    service = UserService(db)
    referrer, _ = await service.get_or_create(telegram_id=100007, username="referrer", first_name="R")
    referred, _ = await service.get_or_create(telegram_id=100008, username="referred", first_name="D")

    success = await service.record_referral(
        referred_user_id=100008,
        referrer_user_id=100007,
    )
    assert success is True

    # Reload both
    result = await db.execute(select(User).where(User.telegram_id == 100008))
    ref_user = result.scalar_one()
    assert ref_user.referred_by == 100007

    result = await db.execute(select(User).where(User.telegram_id == 100007))
    referrer_user = result.scalar_one()
    assert referrer_user.referral_count == 1


async def test_record_referral_max_limit(db):
    service = UserService(db)
    referrer, _ = await service.get_or_create(telegram_id=100009, username="maxref", first_name="M")
    # Set referral count to max (10)
    referrer.referral_count = 10
    await db.commit()

    referred, _ = await service.get_or_create(telegram_id=100010, username="d", first_name="D")
    success = await service.record_referral(
        referred_user_id=100010,
        referrer_user_id=100009,
    )
    assert success is False


async def test_get_notification_settings(db):
    service = UserService(db)
    user, _ = await service.get_or_create(telegram_id=100011, username="u", first_name="U")
    settings = await service.get_notification_settings(100011)
    assert isinstance(settings, dict)


async def test_toggle_notifications(db):
    service = UserService(db)
    user, _ = await service.get_or_create(telegram_id=100012, username="u", first_name="U")

    updated = await service.toggle_notifications(100012, enabled=False)
    assert updated.notification_settings.get("enabled") is False

    updated = await service.toggle_notifications(100012, enabled=True)
    assert updated.notification_settings.get("enabled") is True
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_user_service.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'src.services.user_service'`

- [ ] **Step 3: Implement user service**

```python
# sova/src/services/user_service.py
import secrets
import string
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.user import User

MAX_REFERRALS = 10


def _generate_referral_code(length: int = 8) -> str:
    """Generate a random alphanumeric referral code."""
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


class UserService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_or_create(
        self,
        telegram_id: int,
        username: str | None = None,
        first_name: str | None = None,
    ) -> tuple[User, bool]:
        """Get existing user or create a new one.

        Returns (user, created) tuple.
        """
        result = await self.db.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        user = result.scalar_one_or_none()

        if user is not None:
            # Update username/first_name if changed
            if username is not None and user.username != username:
                user.username = username
            if first_name is not None and user.first_name != first_name:
                user.first_name = first_name
            await self.db.commit()
            await self.db.refresh(user)
            return user, False

        user = User(
            telegram_id=telegram_id,
            username=username,
            first_name=first_name,
            referral_code=_generate_referral_code(),
        )
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return user, True

    async def get_by_id(self, telegram_id: int) -> User | None:
        """Get user by telegram_id."""
        result = await self.db.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        return result.scalar_one_or_none()

    async def update_level(self, telegram_id: int, level: str) -> User:
        """Update user financial literacy level."""
        result = await self.db.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        user = result.scalar_one()
        user.level = level
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def set_consent(self, telegram_id: int) -> User:
        """Record 152-FZ personal data consent timestamp."""
        result = await self.db.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        user = result.scalar_one()
        user.pd_consent_at = datetime.now(timezone.utc)
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def complete_onboarding(self, telegram_id: int) -> User:
        """Mark onboarding as completed."""
        result = await self.db.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        user = result.scalar_one()
        user.onboarding_completed = True
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def get_by_referral_code(self, code: str) -> User | None:
        """Find user by referral code."""
        result = await self.db.execute(
            select(User).where(User.referral_code == code)
        )
        return result.scalar_one_or_none()

    async def record_referral(
        self, referred_user_id: int, referrer_user_id: int
    ) -> bool:
        """Record a referral. Returns False if referrer has hit max limit."""
        result = await self.db.execute(
            select(User).where(User.telegram_id == referrer_user_id)
        )
        referrer = result.scalar_one()

        if referrer.referral_count >= MAX_REFERRALS:
            return False

        result = await self.db.execute(
            select(User).where(User.telegram_id == referred_user_id)
        )
        referred = result.scalar_one()

        referred.referred_by = referrer_user_id
        referrer.referral_count += 1

        await self.db.commit()
        return True

    async def get_notification_settings(self, telegram_id: int) -> dict:
        """Get user notification settings."""
        user = await self.get_by_id(telegram_id)
        if user is None:
            return {}
        return user.notification_settings or {}

    async def toggle_notifications(self, telegram_id: int, enabled: bool) -> User:
        """Toggle notifications on/off."""
        result = await self.db.execute(
            select(User).where(User.telegram_id == telegram_id)
        )
        user = result.scalar_one()
        settings = dict(user.notification_settings or {})
        settings["enabled"] = enabled
        user.notification_settings = settings
        await self.db.commit()
        await self.db.refresh(user)
        return user
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_user_service.py -v
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/services/user_service.py tests/test_user_service.py
git commit -m "feat(sova): add UserService with get_or_create, referral, consent, notifications"
```

---

### Task 5: Transaction Service

**Files:**
- Create: `sova/src/services/transaction_service.py`
- Create: `sova/tests/test_transaction_service.py`

- [ ] **Step 1: Write failing tests for transaction service**

```python
# sova/tests/test_transaction_service.py
import pytest
from datetime import date, datetime, timezone
from decimal import Decimal
from sqlalchemy import select

from src.models.user import User
from src.models.category import Category
from src.models.transaction import Transaction
from src.services.transaction_service import TransactionService


@pytest.fixture
async def user_with_categories(db):
    """Create a test user and some categories."""
    user = User(telegram_id=200001, username="txuser", first_name="Tx")
    db.add(user)

    categories = [
        Category(name="Еда", icon="🍔", type="expense"),
        Category(name="Транспорт", icon="🚕", type="expense"),
        Category(name="Другое", icon="📦", type="expense"),
    ]
    for cat in categories:
        db.add(cat)
    await db.commit()
    return user, {c.name: c for c in categories}


async def test_create_expense(db, user_with_categories):
    user, cats = user_with_categories
    service = TransactionService(db)

    tx = await service.create_expense(
        user_id=user.telegram_id,
        amount=350.0,
        description="кофе",
        category_name="Еда",
    )
    assert tx is not None
    assert tx.amount == Decimal("-350.00")
    assert tx.source == "manual"
    assert tx.category_id == cats["Еда"].id


async def test_create_expense_unknown_category(db, user_with_categories):
    user, cats = user_with_categories
    service = TransactionService(db)

    tx = await service.create_expense(
        user_id=user.telegram_id,
        amount=100.0,
        description="штука",
        category_name="Несуществующая",
    )
    # Should create with "Другое" category
    assert tx is not None
    assert tx.category_id == cats["Другое"].id


async def test_create_expense_no_categories_exist(db):
    user = User(telegram_id=200002, username="nocats", first_name="No")
    db.add(user)
    await db.commit()

    service = TransactionService(db)
    tx = await service.create_expense(
        user_id=200002,
        amount=500.0,
        description="что-то",
        category_name="Еда",
    )
    # Should create without category
    assert tx is not None
    assert tx.category_id is None


async def test_get_today_expenses(db, user_with_categories):
    user, cats = user_with_categories
    service = TransactionService(db)

    # Create two expenses for today
    await service.create_expense(user.telegram_id, 350.0, "кофе", "Еда")
    await service.create_expense(user.telegram_id, 600.0, "такси", "Транспорт")

    expenses = await service.get_today_expenses(user.telegram_id)
    assert len(expenses) == 2
    total = sum(abs(e.amount) for e in expenses)
    assert total == Decimal("950.00")


async def test_get_today_expenses_empty(db):
    user = User(telegram_id=200003, username="empty", first_name="E")
    db.add(user)
    await db.commit()

    service = TransactionService(db)
    expenses = await service.get_today_expenses(200003)
    assert expenses == []
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_transaction_service.py -v
```

Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement transaction service**

```python
# sova/src/services/transaction_service.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_transaction_service.py -v
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/services/transaction_service.py tests/test_transaction_service.py
git commit -m "feat(sova): add TransactionService with create_expense and get_today_expenses"
```

---

### Task 6: Bot Setup — Dispatcher, Webhook, Lifespan

**Files:**
- Rewrite: `sova/src/bot/setup.py`
- Modify: `sova/src/main.py`
- Create: `sova/tests/test_webhook.py`

- [ ] **Step 1: Write failing test for webhook endpoint**

```python
# sova/tests/test_webhook.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient, ASGITransport

from src.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_webhook_endpoint_exists(client):
    """Webhook endpoint should exist and reject invalid updates."""
    resp = await client.post(
        "/bot/webhook",
        json={"update_id": 1, "message": {"message_id": 1, "date": 1, "chat": {"id": 1, "type": "private"}}},
    )
    # Should not return 404 (endpoint exists)
    assert resp.status_code != 404


async def test_health_still_works(client):
    """Ensure health endpoint still works after bot setup."""
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_webhook.py -v
```

Expected: FAIL — webhook endpoint returns 404

- [ ] **Step 3: Rewrite bot/setup.py with Dispatcher and Router registration**

```python
# sova/src/bot/setup.py
from aiogram import Bot, Dispatcher, Router
from aiogram.types import Update
from fastapi import FastAPI, Request

from src.config import settings
from src.database import async_session
from src.bot.middlewares.db_session import DbSessionMiddleware

# Bot instance (None if no token configured — for testing)
bot = Bot(token=settings.bot_token) if settings.bot_token else None

# Dispatcher with router
dp = Dispatcher()

# Main router — all handler routers will be included here
main_router = Router(name="main")
dp.include_router(main_router)

# Register DB session middleware
dp.update.middleware(DbSessionMiddleware(session_pool=async_session))


def register_handlers() -> None:
    """Import and register all handler routers.

    Called during app startup to avoid circular imports.
    """
    from src.bot.handlers.start import router as start_router
    from src.bot.handlers.menu import router as menu_router
    from src.bot.handlers.balance import router as balance_router
    from src.bot.handlers.today import router as today_router
    from src.bot.handlers.help import router as help_router
    from src.bot.handlers.expense import router as expense_router
    from src.bot.handlers.invite import router as invite_router
    from src.bot.handlers.settings import router as settings_router

    main_router.include_router(start_router)
    main_router.include_router(menu_router)
    main_router.include_router(balance_router)
    main_router.include_router(today_router)
    main_router.include_router(help_router)
    main_router.include_router(invite_router)
    main_router.include_router(settings_router)
    # Expense router is last — it catches plain text messages
    main_router.include_router(expense_router)


def setup_webhook_route(app: FastAPI) -> None:
    """Register the webhook endpoint on the FastAPI app."""

    @app.post(settings.webhook_path)
    async def bot_webhook(request: Request):
        if bot is None:
            return {"ok": False, "error": "Bot not configured"}
        update = Update.model_validate(await request.json(), context={"bot": bot})
        await dp.feed_update(bot=bot, update=update)
        return {"ok": True}
```

- [ ] **Step 4: Update main.py with lifespan and webhook route**

```python
# sova/src/main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.api.router import api_router
from src.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App lifespan: setup bot webhook on startup, cleanup on shutdown."""
    from src.bot.setup import bot, register_handlers, setup_webhook_route

    register_handlers()
    setup_webhook_route(app)

    # Set webhook if bot is configured and base URL is not localhost
    if bot and "localhost" not in settings.app_base_url:
        webhook_url = f"{settings.app_base_url}{settings.webhook_path}"
        await bot.set_webhook(webhook_url)

    yield

    # Cleanup
    if bot:
        await bot.session.close()


app = FastAPI(title="Sova", version="0.1.0", lifespan=lifespan)
app.include_router(api_router)
```

- [ ] **Step 5: Create stub handler files (empty routers)**

Create minimal stub handlers so that `register_handlers()` does not fail on import:

```python
# sova/src/bot/handlers/start.py
from aiogram import Router

router = Router(name="start")
```

```python
# sova/src/bot/handlers/menu.py
from aiogram import Router

router = Router(name="menu")
```

```python
# sova/src/bot/handlers/balance.py
from aiogram import Router

router = Router(name="balance")
```

```python
# sova/src/bot/handlers/today.py
from aiogram import Router

router = Router(name="today")
```

```python
# sova/src/bot/handlers/help.py
from aiogram import Router

router = Router(name="help")
```

```python
# sova/src/bot/handlers/expense.py
from aiogram import Router

router = Router(name="expense")
```

```python
# sova/src/bot/handlers/invite.py
from aiogram import Router

router = Router(name="invite")
```

```python
# sova/src/bot/handlers/settings.py
from aiogram import Router

router = Router(name="settings")
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_webhook.py tests/test_health.py -v
```

Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/bot/ src/main.py tests/test_webhook.py
git commit -m "feat(sova): add aiogram Dispatcher with webhook on FastAPI, handler stubs"
```

---

### Task 7: Bot Test Fixtures

**Files:**
- Modify: `sova/tests/conftest.py`

- [ ] **Step 1: Add bot-related test fixtures to conftest.py**

```python
# sova/tests/conftest.py
import pytest
from unittest.mock import AsyncMock, MagicMock
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

from src.models import Base


@pytest.fixture
async def db_engine():
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest.fixture
async def db(db_engine) -> AsyncSession:
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session


@pytest.fixture
def mock_bot():
    """Mock aiogram Bot for testing handlers."""
    bot = AsyncMock()
    bot.id = 123456789
    bot.token = "test:token"
    return bot


@pytest.fixture
def make_message(mock_bot):
    """Factory fixture for creating mock Message objects."""
    def _make(
        text: str = "",
        chat_id: int = 1,
        user_id: int = 1,
        username: str = "testuser",
        first_name: str = "Test",
    ):
        message = AsyncMock()
        message.text = text
        message.chat = MagicMock()
        message.chat.id = chat_id
        message.chat.type = "private"
        message.from_user = MagicMock()
        message.from_user.id = user_id
        message.from_user.username = username
        message.from_user.first_name = first_name
        message.bot = mock_bot
        message.answer = AsyncMock()
        message.reply = AsyncMock()
        return message
    return _make


@pytest.fixture
def make_callback(mock_bot):
    """Factory fixture for creating mock CallbackQuery objects."""
    def _make(
        data: str = "",
        chat_id: int = 1,
        user_id: int = 1,
        username: str = "testuser",
        first_name: str = "Test",
    ):
        callback = AsyncMock()
        callback.data = data
        callback.from_user = MagicMock()
        callback.from_user.id = user_id
        callback.from_user.username = username
        callback.from_user.first_name = first_name
        callback.message = AsyncMock()
        callback.message.chat = MagicMock()
        callback.message.chat.id = chat_id
        callback.message.bot = mock_bot
        callback.message.edit_text = AsyncMock()
        callback.message.answer = AsyncMock()
        callback.answer = AsyncMock()
        callback.bot = mock_bot
        return callback
    return _make
```

- [ ] **Step 2: Run existing tests to ensure fixtures don't break anything**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/ -v
```

Expected: all existing tests PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add tests/conftest.py
git commit -m "feat(sova): add bot test fixtures — mock_bot, make_message, make_callback"
```

---

### Task 8: /start Handler — Onboarding Flow

**Files:**
- Rewrite: `sova/src/bot/handlers/start.py`
- Create: `sova/tests/test_handlers_start.py`

- [ ] **Step 1: Write failing tests for /start handler**

```python
# sova/tests/test_handlers_start.py
import pytest
from unittest.mock import AsyncMock, patch

from src.models.user import User
from src.services.user_service import UserService
from src.bot.handlers.start import cmd_start, on_consent_accept, on_level_select, on_integration_choice


async def test_start_new_user(db, make_message):
    """New user should see welcome message and consent keyboard."""
    msg = make_message(text="/start", user_id=300001, username="starter", first_name="Star")

    await cmd_start(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    assert "Сова" in call_text or "сова" in call_text.lower()

    # Check user was created
    service = UserService(db)
    user = await service.get_by_id(300001)
    assert user is not None
    assert user.onboarding_completed is False


async def test_start_existing_completed_user(db, make_message):
    """Existing user with completed onboarding should see menu."""
    service = UserService(db)
    user, _ = await service.get_or_create(300002, "existing", "Ex")
    await service.set_consent(300002)
    await service.complete_onboarding(300002)

    msg = make_message(text="/start", user_id=300002, username="existing", first_name="Ex")
    await cmd_start(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    # Should show welcome back or menu, not onboarding
    assert "С возвращением" in call_text or "меню" in call_text.lower() or "Меню" in call_text


async def test_start_with_referral_deep_link(db, make_message):
    """User starting with referral code in deep link."""
    # Create referrer first
    service = UserService(db)
    referrer, _ = await service.get_or_create(300003, "referrer", "R")
    ref_code = referrer.referral_code

    msg = make_message(text=f"/start ref_{ref_code}", user_id=300004, username="newref", first_name="N")
    await cmd_start(msg, db=db)

    # Referred user should be created with referred_by set
    user = await service.get_by_id(300004)
    assert user is not None
    assert user.referred_by == 300003


async def test_consent_accept(db, make_callback):
    """Accepting consent should record timestamp and show integration choice."""
    service = UserService(db)
    await service.get_or_create(300005, "consent", "C")

    cb = make_callback(data="consent:accept", user_id=300005, username="consent", first_name="C")
    await on_consent_accept(cb, db=db)

    user = await service.get_by_id(300005)
    assert user.pd_consent_at is not None

    cb.message.edit_text.assert_called_once()


async def test_level_select(db, make_callback):
    """Selecting level should update user and complete onboarding."""
    service = UserService(db)
    await service.get_or_create(300006, "level", "L")
    await service.set_consent(300006)

    cb = make_callback(data="level:advanced", user_id=300006, username="level", first_name="L")
    await on_level_select(cb, db=db)

    user = await service.get_by_id(300006)
    assert user.level == "advanced"
    assert user.onboarding_completed is True

    cb.message.edit_text.assert_called_once()
    call_text = cb.message.edit_text.call_args[0][0]
    assert "5" in call_text  # 5 free credits mentioned


async def test_integration_choice_skip(db, make_callback):
    """Skipping integrations should proceed to level selection."""
    service = UserService(db)
    await service.get_or_create(300007, "skip", "S")
    await service.set_consent(300007)

    cb = make_callback(data="integration:skip", user_id=300007, username="skip", first_name="S")
    await on_integration_choice(cb, db=db)

    cb.message.edit_text.assert_called_once()
    # Should show level keyboard
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_handlers_start.py -v
```

Expected: FAIL

- [ ] **Step 3: Implement /start handler**

```python
# sova/src/bot/handlers/start.py
from aiogram import Router, F
from aiogram.filters import CommandStart
from aiogram.types import Message, CallbackQuery
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.user_service import UserService
from src.bot.keyboards.common import (
    consent_keyboard,
    integration_keyboard,
    level_keyboard,
    main_menu_keyboard,
)

router = Router(name="start")


WELCOME_TEXT = (
    "🦉 Привет! Я Сова — твой персональный финансовый помощник.\n\n"
    "Я помогу разобраться в финансах: отслеживать расходы, "
    "анализировать траты и управлять инвестициями.\n\n"
    "Для начала мне нужно твоё согласие на обработку данных."
)

WELCOME_BACK_TEXT = (
    "🦉 С возвращением, {name}! Вот твоё меню:"
)

CONSENT_ACCEPTED_TEXT = (
    "✅ Спасибо! Теперь выбери, хочешь ли подключить сервисы для автоматического импорта данных:"
)

INTEGRATION_STUB_TEXT = (
    "🔧 Подключение {service} будет доступно в следующем обновлении.\n\n"
    "А пока выбери свой уровень:"
)

LEVEL_SELECTED_TEXT = (
    "🦉 Отлично! Ты выбрал уровень: {level_text}.\n\n"
    "🎁 Тебе начислено 5 бесплатных AI-запросов, чтобы ты мог оценить возможности Совы.\n\n"
    "Готово! Отправь /menu чтобы открыть главное меню, "
    "или просто напиши трату — например, «кофе 350»."
)

LEVEL_NAMES = {
    "beginner": "🌱 Новичок",
    "intermediate": "📊 Веду бюджет",
    "advanced": "📈 Активный инвестор",
}


@router.message(CommandStart())
async def cmd_start(message: Message, db: AsyncSession) -> None:
    """Handle /start command — onboarding or welcome back."""
    service = UserService(db)
    user_id = message.from_user.id
    username = message.from_user.username
    first_name = message.from_user.first_name

    # Parse deep link referral code: /start ref_ABCD1234
    referral_code = None
    if message.text and " " in message.text:
        payload = message.text.split(" ", 1)[1]
        if payload.startswith("ref_"):
            referral_code = payload[4:]

    user, created = await service.get_or_create(user_id, username, first_name)

    # Handle referral if new user
    if created and referral_code:
        referrer = await service.get_by_referral_code(referral_code)
        if referrer and referrer.telegram_id != user_id:
            await service.record_referral(user_id, referrer.telegram_id)

    # Existing user with completed onboarding
    if user.onboarding_completed:
        name = first_name or username or "друг"
        await message.answer(
            WELCOME_BACK_TEXT.format(name=name),
            reply_markup=main_menu_keyboard(),
        )
        return

    # New or incomplete onboarding — show consent
    await message.answer(WELCOME_TEXT, reply_markup=consent_keyboard())


@router.callback_query(F.data == "consent:accept")
async def on_consent_accept(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle consent acceptance — record and show integration choice."""
    service = UserService(db)
    await service.set_consent(callback.from_user.id)

    await callback.message.edit_text(
        CONSENT_ACCEPTED_TEXT,
        reply_markup=integration_keyboard(),
    )
    await callback.answer()


@router.callback_query(F.data.startswith("integration:"))
async def on_integration_choice(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle integration choice during onboarding."""
    choice = callback.data.split(":")[1]

    if choice == "skip":
        await callback.message.edit_text(
            "Выбери свой уровень финансовой грамотности:",
            reply_markup=level_keyboard(),
        )
    elif choice in ("zenmoney", "tbank"):
        service_name = "ZenMoney" if choice == "zenmoney" else "T-Bank"
        await callback.message.edit_text(
            INTEGRATION_STUB_TEXT.format(service=service_name),
            reply_markup=level_keyboard(),
        )

    await callback.answer()


@router.callback_query(F.data.startswith("level:"))
async def on_level_select(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle level selection — complete onboarding."""
    level = callback.data.split(":")[1]
    service = UserService(db)

    await service.update_level(callback.from_user.id, level)
    await service.complete_onboarding(callback.from_user.id)

    level_text = LEVEL_NAMES.get(level, level)
    await callback.message.edit_text(LEVEL_SELECTED_TEXT.format(level_text=level_text))
    await callback.answer()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_handlers_start.py -v
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/bot/handlers/start.py tests/test_handlers_start.py
git commit -m "feat(sova): add /start onboarding handler — welcome, consent, level selection, referral deep link"
```

---

### Task 9: /menu Handler

**Files:**
- Rewrite: `sova/src/bot/handlers/menu.py`
- Create: `sova/tests/test_handlers_menu.py`

- [ ] **Step 1: Write failing tests for /menu handler**

```python
# sova/tests/test_handlers_menu.py
import pytest
from src.models.user import User
from src.services.user_service import UserService
from src.bot.handlers.menu import cmd_menu, on_menu_callback


async def test_menu_command(db, make_message):
    """Menu command should show inline keyboard."""
    service = UserService(db)
    await service.get_or_create(400001, "menu", "M")

    msg = make_message(text="/menu", user_id=400001, username="menu", first_name="M")
    await cmd_menu(msg, db=db)

    msg.answer.assert_called_once()
    call_kwargs = msg.answer.call_args
    assert call_kwargs.kwargs.get("reply_markup") is not None


async def test_menu_back_callback(db, make_callback):
    """Back button should re-show the menu."""
    service = UserService(db)
    await service.get_or_create(400002, "back", "B")

    cb = make_callback(data="menu:back", user_id=400002, username="back", first_name="B")
    await on_menu_callback(cb, db=db)

    cb.message.edit_text.assert_called_once()
    cb.answer.assert_called_once()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_handlers_menu.py -v
```

Expected: FAIL

- [ ] **Step 3: Implement /menu handler**

```python
# sova/src/bot/handlers/menu.py
from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from sqlalchemy.ext.asyncio import AsyncSession

from src.bot.keyboards.common import main_menu_keyboard

router = Router(name="menu")

MENU_TEXT = "🦉 Главное меню — выбери раздел:"


@router.message(Command("menu"))
async def cmd_menu(message: Message, db: AsyncSession) -> None:
    """Show main menu with inline keyboard."""
    await message.answer(MENU_TEXT, reply_markup=main_menu_keyboard())


@router.callback_query(F.data == "menu:back")
async def on_menu_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle back-to-menu navigation."""
    await callback.message.edit_text(MENU_TEXT, reply_markup=main_menu_keyboard())
    await callback.answer()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_handlers_menu.py -v
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/bot/handlers/menu.py tests/test_handlers_menu.py
git commit -m "feat(sova): add /menu handler with inline keyboard"
```

---

### Task 10: /balance Handler

**Files:**
- Rewrite: `sova/src/bot/handlers/balance.py`
- Create: `sova/tests/test_handlers_balance.py`

- [ ] **Step 1: Write failing tests for /balance handler**

```python
# sova/tests/test_handlers_balance.py
import pytest
from decimal import Decimal

from src.models.user import User
from src.models.account import Account
from src.services.user_service import UserService
from src.bot.handlers.balance import cmd_balance, on_balance_callback


async def test_balance_no_accounts(db, make_message):
    """User with no accounts should see appropriate message."""
    service = UserService(db)
    await service.get_or_create(500001, "nobal", "N")

    msg = make_message(text="/balance", user_id=500001)
    await cmd_balance(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    assert "нет" in call_text.lower() or "счет" in call_text.lower()


async def test_balance_with_accounts(db, make_message):
    """User with accounts should see their balances."""
    service = UserService(db)
    await service.get_or_create(500002, "bal", "B")

    acc1 = Account(user_id=500002, name="Tinkoff Black", currency="RUB",
                   balance=Decimal("50000.00"), source="manual")
    acc2 = Account(user_id=500002, name="Savings", currency="RUB",
                   balance=Decimal("200000.00"), source="manual")
    db.add(acc1)
    db.add(acc2)
    await db.commit()

    msg = make_message(text="/balance", user_id=500002)
    await cmd_balance(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    assert "Tinkoff Black" in call_text
    assert "50" in call_text  # part of 50000


async def test_balance_callback(db, make_callback):
    """Menu callback for balance should work."""
    service = UserService(db)
    await service.get_or_create(500003, "cbal", "C")

    cb = make_callback(data="menu:balance", user_id=500003)
    await on_balance_callback(cb, db=db)

    cb.message.edit_text.assert_called_once()
    cb.answer.assert_called_once()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_handlers_balance.py -v
```

Expected: FAIL

- [ ] **Step 3: Implement /balance handler**

```python
# sova/src/bot/handlers/balance.py
from decimal import Decimal

from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account import Account
from src.bot.keyboards.common import main_menu_keyboard

router = Router(name="balance")

NO_ACCOUNTS_TEXT = (
    "🦉 У тебя пока нет счетов.\n\n"
    "Подключи ZenMoney или T-Bank в настройках, "
    "чтобы счета появились автоматически."
)


def _format_balance(accounts: list[Account]) -> str:
    """Format account balances for display."""
    lines = ["💰 *Баланс по счетам:*\n"]
    total = Decimal("0")
    for acc in accounts:
        balance = acc.balance or Decimal("0")
        total += balance
        sign = "+" if balance >= 0 else ""
        lines.append(f"  {acc.name}: {balance:,.2f} {acc.currency}")
    lines.append(f"\n📊 Итого: {total:,.2f} ₽")
    return "\n".join(lines)


@router.message(Command("balance"))
async def cmd_balance(message: Message, db: AsyncSession) -> None:
    """Show account balances."""
    result = await db.execute(
        select(Account).where(Account.user_id == message.from_user.id)
    )
    accounts = list(result.scalars().all())

    if not accounts:
        await message.answer(NO_ACCOUNTS_TEXT)
        return

    await message.answer(_format_balance(accounts))


@router.callback_query(F.data == "menu:balance")
async def on_balance_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle balance callback from menu."""
    result = await db.execute(
        select(Account).where(Account.user_id == callback.from_user.id)
    )
    accounts = list(result.scalars().all())

    text = NO_ACCOUNTS_TEXT if not accounts else _format_balance(accounts)
    await callback.message.edit_text(text)
    await callback.answer()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_handlers_balance.py -v
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/bot/handlers/balance.py tests/test_handlers_balance.py
git commit -m "feat(sova): add /balance handler — show account balances"
```

---

### Task 11: /today Handler

**Files:**
- Rewrite: `sova/src/bot/handlers/today.py`
- Create: `sova/tests/test_handlers_today.py`

- [ ] **Step 1: Write failing tests for /today handler**

```python
# sova/tests/test_handlers_today.py
import pytest
from decimal import Decimal
from datetime import date

from src.models.user import User
from src.models.category import Category
from src.models.transaction import Transaction
from src.services.user_service import UserService
from src.bot.handlers.today import cmd_today, on_today_callback


async def test_today_no_expenses(db, make_message):
    """No expenses today should show appropriate message."""
    service = UserService(db)
    await service.get_or_create(600001, "today", "T")

    msg = make_message(text="/today", user_id=600001)
    await cmd_today(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    assert "нет" in call_text.lower() or "пусто" in call_text.lower() or "трат" in call_text.lower()


async def test_today_with_expenses(db, make_message):
    """Show today's expenses summary."""
    service = UserService(db)
    await service.get_or_create(600002, "today2", "T2")

    cat = Category(name="Еда", icon="🍔", type="expense")
    db.add(cat)
    await db.commit()

    tx1 = Transaction(
        user_id=600002, amount=Decimal("-350.00"), currency="RUB",
        date=date.today(), description="кофе", source="manual", category_id=cat.id,
    )
    tx2 = Transaction(
        user_id=600002, amount=Decimal("-600.00"), currency="RUB",
        date=date.today(), description="такси", source="manual",
    )
    db.add(tx1)
    db.add(tx2)
    await db.commit()

    msg = make_message(text="/today", user_id=600002)
    await cmd_today(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    assert "950" in call_text  # total
    assert "кофе" in call_text


async def test_today_callback(db, make_callback):
    """Menu callback for today should work."""
    service = UserService(db)
    await service.get_or_create(600003, "tcb", "T")

    cb = make_callback(data="menu:today", user_id=600003)
    await on_today_callback(cb, db=db)

    cb.message.edit_text.assert_called_once()
    cb.answer.assert_called_once()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_handlers_today.py -v
```

Expected: FAIL

- [ ] **Step 3: Implement /today handler**

```python
# sova/src/bot/handlers/today.py
from datetime import date
from decimal import Decimal

from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.transaction import Transaction

router = Router(name="today")

NO_EXPENSES_TEXT = "🦉 Сегодня трат нет. Хороший день для экономии!"


def _format_today(transactions: list[Transaction]) -> str:
    """Format today's expenses for display."""
    total = sum(abs(tx.amount) for tx in transactions)
    lines = [f"📊 *Траты за сегодня:* {total:,.2f} ₽\n"]
    for tx in transactions:
        desc = tx.description or "Без описания"
        lines.append(f"  • {desc}: {abs(tx.amount):,.2f} ₽")
    lines.append(f"\nВсего операций: {len(transactions)}")
    return "\n".join(lines)


async def _get_today_text(db: AsyncSession, user_id: int) -> str:
    result = await db.execute(
        select(Transaction).where(
            Transaction.user_id == user_id,
            Transaction.date == date.today(),
            Transaction.amount < 0,
        ).order_by(Transaction.created_at.desc())
    )
    transactions = list(result.scalars().all())
    if not transactions:
        return NO_EXPENSES_TEXT
    return _format_today(transactions)


@router.message(Command("today"))
async def cmd_today(message: Message, db: AsyncSession) -> None:
    """Show today's expenses."""
    text = await _get_today_text(db, message.from_user.id)
    await message.answer(text)


@router.callback_query(F.data == "menu:today")
async def on_today_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle today callback from menu."""
    text = await _get_today_text(db, callback.from_user.id)
    await callback.message.edit_text(text)
    await callback.answer()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_handlers_today.py -v
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/bot/handlers/today.py tests/test_handlers_today.py
git commit -m "feat(sova): add /today handler — show today's expenses"
```

---

### Task 12: /help Handler

**Files:**
- Rewrite: `sova/src/bot/handlers/help.py`

- [ ] **Step 1: Implement /help handler**

```python
# sova/src/bot/handlers/help.py
from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from sqlalchemy.ext.asyncio import AsyncSession

router = Router(name="help")

HELP_TEXT = (
    "🦉 *Что умеет Сова:*\n\n"
    "📝 *Быстрый ввод расходов*\n"
    "Просто напиши: «кофе 350» или «такси 600 работа»\n\n"
    "📋 *Команды:*\n"
    "/menu — главное меню\n"
    "/balance — баланс по счетам\n"
    "/today — траты за сегодня\n"
    "/invite — пригласить друга\n"
    "/help — эта справка\n\n"
    "🔗 *Интеграции:*\n"
    "Подключи ZenMoney или T-Bank для автоматического импорта транзакций.\n\n"
    "🤖 *AI-функции:*\n"
    "Спроси «Что с моими финансами?» или «Куда уходят деньги?» "
    "для AI-аналитики (платные запросы).\n\n"
    "💡 Вопросы? Напиши @sova_support"
)


@router.message(Command("help"))
async def cmd_help(message: Message, db: AsyncSession) -> None:
    """Show help text."""
    await message.answer(HELP_TEXT)


@router.callback_query(F.data == "menu:help")
async def on_help_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle help callback from menu."""
    await callback.message.edit_text(HELP_TEXT)
    await callback.answer()
```

- [ ] **Step 2: Run a quick smoke test**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -c "from src.bot.handlers.help import cmd_help, HELP_TEXT; print('OK:', len(HELP_TEXT), 'chars')"
```

Expected: prints OK with character count

- [ ] **Step 3: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/bot/handlers/help.py
git commit -m "feat(sova): add /help handler with bot capabilities overview"
```

---

### Task 13: Quick Expense Input Handler

**Files:**
- Rewrite: `sova/src/bot/handlers/expense.py`
- Create: `sova/tests/test_handlers_expense.py`

- [ ] **Step 1: Write failing tests for expense handler**

```python
# sova/tests/test_handlers_expense.py
import pytest
from decimal import Decimal
from datetime import date
from sqlalchemy import select

from src.models.user import User
from src.models.category import Category
from src.models.transaction import Transaction
from src.services.user_service import UserService
from src.bot.handlers.expense import handle_expense_text


@pytest.fixture
async def expense_user(db):
    service = UserService(db)
    user, _ = await service.get_or_create(700001, "expense", "E")
    # Create default categories
    for name, icon in [("Еда", "🍔"), ("Транспорт", "🚕"), ("Другое", "📦")]:
        db.add(Category(name=name, icon=icon, type="expense"))
    await db.commit()
    return user


async def test_expense_text_parsed(db, make_message, expense_user):
    """Valid expense text should create a transaction."""
    msg = make_message(text="кофе 350", user_id=700001)
    await handle_expense_text(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    assert "350" in call_text
    assert "Еда" in call_text or "кофе" in call_text

    # Verify transaction was created
    result = await db.execute(
        select(Transaction).where(Transaction.user_id == 700001)
    )
    tx = result.scalar_one()
    assert tx.amount == Decimal("-350.00")


async def test_expense_text_with_tag(db, make_message, expense_user):
    """Expense with tag should be recorded."""
    msg = make_message(text="такси 600 работа", user_id=700001)
    await handle_expense_text(msg, db=db)

    msg.answer.assert_called_once()
    result = await db.execute(
        select(Transaction).where(Transaction.user_id == 700001)
    )
    tx = result.scalar_one()
    assert "#работа" in tx.description


async def test_expense_text_not_parsed(db, make_message, expense_user):
    """Non-expense text should be silently ignored."""
    msg = make_message(text="привет как дела", user_id=700001)
    await handle_expense_text(msg, db=db)

    # Should not answer for unparseable text (handler returns without responding)
    msg.answer.assert_not_called()
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_handlers_expense.py -v
```

Expected: FAIL

- [ ] **Step 3: Implement expense handler**

```python
# sova/src/bot/handlers/expense.py
from aiogram import Router, F
from aiogram.types import Message
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.expense_parser import parse_expense
from src.services.transaction_service import TransactionService

router = Router(name="expense")

EXPENSE_RECORDED_TEXT = (
    "✅ Записано!\n"
    "  {description}: {amount:,.2f} ₽\n"
    "  Категория: {category}"
)


@router.message(F.text, ~F.text.startswith("/"))
async def handle_expense_text(message: Message, db: AsyncSession) -> None:
    """Try to parse plain text as an expense entry.

    This handler has low priority — it only catches messages that
    are NOT commands (don't start with /).
    """
    parsed = parse_expense(message.text)
    if parsed is None:
        # Not an expense — silently ignore (could be free text for AI in Plan 5)
        return

    service = TransactionService(db)
    tx = await service.create_expense(
        user_id=message.from_user.id,
        amount=parsed.amount,
        description=parsed.description,
        category_name=parsed.category_name,
        tag=parsed.tag,
    )

    await message.answer(
        EXPENSE_RECORDED_TEXT.format(
            description=parsed.description,
            amount=parsed.amount,
            category=parsed.category_name,
        )
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_handlers_expense.py -v
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/bot/handlers/expense.py tests/test_handlers_expense.py
git commit -m "feat(sova): add quick expense input handler — natural language parsing"
```

---

### Task 14: /invite Handler — Referral System

**Files:**
- Rewrite: `sova/src/bot/handlers/invite.py`
- Create: `sova/tests/test_handlers_invite.py`

- [ ] **Step 1: Write failing tests for /invite handler**

```python
# sova/tests/test_handlers_invite.py
import pytest
from src.services.user_service import UserService
from src.bot.handlers.invite import cmd_invite


async def test_invite_generates_link(db, make_message):
    """Invite command should show referral link."""
    service = UserService(db)
    user, _ = await service.get_or_create(800001, "inviter", "I")

    msg = make_message(text="/invite", user_id=800001)
    await cmd_invite(msg, db=db)

    msg.answer.assert_called_once()
    call_text = msg.answer.call_args[0][0]
    assert user.referral_code in call_text
    assert "t.me" in call_text


async def test_invite_shows_referral_count(db, make_message):
    """Should show how many referrals the user has."""
    service = UserService(db)
    user, _ = await service.get_or_create(800002, "counted", "C")
    user.referral_count = 3
    await db.commit()

    msg = make_message(text="/invite", user_id=800002)
    await cmd_invite(msg, db=db)

    call_text = msg.answer.call_args[0][0]
    assert "3" in call_text
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_handlers_invite.py -v
```

Expected: FAIL

- [ ] **Step 3: Implement /invite handler**

```python
# sova/src/bot/handlers/invite.py
from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.user_service import UserService

router = Router(name="invite")

INVITE_TEXT = (
    "🦉 *Пригласи друга в Сову!*\n\n"
    "Когда друг зарегистрируется по твоей ссылке, "
    "вы оба получите 50₽ на AI-баланс.\n\n"
    "🔗 Твоя ссылка:\n"
    "https://t.me/SovaFinBot?start=ref_{code}\n\n"
    "📊 Приглашено: {count}/10\n\n"
    "💡 Поделись ссылкой с друзьями!"
)


@router.message(Command("invite"))
async def cmd_invite(message: Message, db: AsyncSession) -> None:
    """Show referral link and stats."""
    service = UserService(db)
    user = await service.get_by_id(message.from_user.id)

    if user is None:
        await message.answer("🦉 Сначала отправь /start для регистрации.")
        return

    await message.answer(
        INVITE_TEXT.format(
            code=user.referral_code,
            count=user.referral_count,
        )
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/test_handlers_invite.py -v
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/bot/handlers/invite.py tests/test_handlers_invite.py
git commit -m "feat(sova): add /invite handler — referral link generation"
```

---

### Task 15: Settings Handler

**Files:**
- Rewrite: `sova/src/bot/handlers/settings.py`

- [ ] **Step 1: Implement settings handler**

```python
# sova/src/bot/handlers/settings.py
from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from sqlalchemy.ext.asyncio import AsyncSession

from src.services.user_service import UserService
from src.bot.keyboards.common import settings_keyboard, level_keyboard, main_menu_keyboard

router = Router(name="settings")

SETTINGS_TEXT = "🔔 *Настройки:*\nВыбери, что хочешь изменить:"

INTEGRATIONS_STUB_TEXT = (
    "🏦 *Интеграции:*\n\n"
    "Подключение ZenMoney и T-Bank будет доступно в следующем обновлении.\n\n"
    "Следи за обновлениями!"
)


@router.message(Command("settings"))
async def cmd_settings(message: Message, db: AsyncSession) -> None:
    """Show settings menu."""
    service = UserService(db)
    settings = await service.get_notification_settings(message.from_user.id)
    enabled = settings.get("enabled", True)
    await message.answer(SETTINGS_TEXT, reply_markup=settings_keyboard(enabled))


@router.callback_query(F.data == "menu:settings")
async def on_settings_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle settings from menu."""
    service = UserService(db)
    settings = await service.get_notification_settings(callback.from_user.id)
    enabled = settings.get("enabled", True)
    await callback.message.edit_text(SETTINGS_TEXT, reply_markup=settings_keyboard(enabled))
    await callback.answer()


@router.callback_query(F.data == "settings:toggle_notifications")
async def on_toggle_notifications(callback: CallbackQuery, db: AsyncSession) -> None:
    """Toggle notification on/off."""
    service = UserService(db)
    current = await service.get_notification_settings(callback.from_user.id)
    currently_enabled = current.get("enabled", True)
    new_state = not currently_enabled

    await service.toggle_notifications(callback.from_user.id, new_state)

    status = "включены ✅" if new_state else "выключены 🔕"
    await callback.message.edit_text(
        f"🔔 Уведомления {status}",
        reply_markup=settings_keyboard(new_state),
    )
    await callback.answer()


@router.callback_query(F.data == "settings:integrations")
async def on_integrations(callback: CallbackQuery, db: AsyncSession) -> None:
    """Show integrations stub."""
    await callback.message.edit_text(
        INTEGRATIONS_STUB_TEXT,
        reply_markup=settings_keyboard(),
    )
    await callback.answer()


@router.callback_query(F.data == "settings:level")
async def on_change_level(callback: CallbackQuery, db: AsyncSession) -> None:
    """Show level selection."""
    await callback.message.edit_text(
        "Выбери свой уровень:",
        reply_markup=level_keyboard(),
    )
    await callback.answer()
```

- [ ] **Step 2: Quick import test**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -c "from src.bot.handlers.settings import cmd_settings; print('OK')"
```

Expected: prints OK

- [ ] **Step 3: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/bot/handlers/settings.py
git commit -m "feat(sova): add /settings handler — notifications toggle, integrations stub"
```

---

### Task 16: Stub Handlers for Menu Callbacks (Portfolio, Goals, AI Balance)

**Files:**
- Modify: `sova/src/bot/handlers/menu.py`

- [ ] **Step 1: Add stub callbacks for unimplemented menu items**

Add to `sova/src/bot/handlers/menu.py`:

```python
# sova/src/bot/handlers/menu.py
from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from sqlalchemy.ext.asyncio import AsyncSession

from src.bot.keyboards.common import main_menu_keyboard

router = Router(name="menu")

MENU_TEXT = "🦉 Главное меню — выбери раздел:"

COMING_SOON_TEXT = {
    "menu:portfolio": "📈 *Портфель*\n\nРаздел будет доступен после подключения T-Bank.",
    "menu:goals": "🎯 *Цели*\n\nУправление целями будет доступно в следующем обновлении.",
    "menu:ai_balance": "💎 *AI-баланс*\n\nУправление балансом будет доступно в следующем обновлении.",
}


@router.message(Command("menu"))
async def cmd_menu(message: Message, db: AsyncSession) -> None:
    """Show main menu with inline keyboard."""
    await message.answer(MENU_TEXT, reply_markup=main_menu_keyboard())


@router.callback_query(F.data == "menu:back")
async def on_menu_callback(callback: CallbackQuery, db: AsyncSession) -> None:
    """Handle back-to-menu navigation."""
    await callback.message.edit_text(MENU_TEXT, reply_markup=main_menu_keyboard())
    await callback.answer()


@router.callback_query(F.data.in_({"menu:portfolio", "menu:goals", "menu:ai_balance"}))
async def on_coming_soon(callback: CallbackQuery, db: AsyncSession) -> None:
    """Stub handler for not-yet-implemented menu sections."""
    text = COMING_SOON_TEXT.get(callback.data, "🔧 Раздел в разработке")
    await callback.message.edit_text(text, reply_markup=main_menu_keyboard())
    await callback.answer()
```

- [ ] **Step 2: Run all tests to verify nothing broke**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/ -v
```

Expected: all tests PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add src/bot/handlers/menu.py
git commit -m "feat(sova): add stub callbacks for portfolio, goals, ai_balance menu items"
```

---

### Task 17: Full Integration Test — Run All Tests

- [ ] **Step 1: Run the complete test suite**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && .venv/bin/python -m pytest tests/ -v --tb=short
```

Expected: all tests PASS — including:
- `test_models.py` — model creation tests (10+)
- `test_expense_parser.py` — expense parsing (15+)
- `test_user_service.py` — user CRUD (12+)
- `test_transaction_service.py` — transaction creation (5+)
- `test_handlers_start.py` — onboarding flow (6+)
- `test_handlers_menu.py` — menu (2+)
- `test_handlers_balance.py` — balance (3+)
- `test_handlers_today.py` — today expenses (3+)
- `test_handlers_expense.py` — expense input (3+)
- `test_handlers_invite.py` — referral (2+)
- `test_webhook.py` — webhook endpoint (2+)
- `test_health.py` — healthcheck (1+)
- `test_auth.py` — telegram auth (2+)

- [ ] **Step 2: Final commit**

```bash
cd /Users/dmitry/Agents/Product\ Development\ Pipeline/sova && git add -A
git commit -m "feat(sova): complete Plan 2 — Telegram bot core with all handlers and tests"
```

---

## Summary

Plan 2 delivers:

1. **User model updates** — referral_code, referred_by, pd_consent_at, onboarding_completed fields
2. **Bot setup** — aiogram 3 Dispatcher with Router pattern, webhook on FastAPI, DB session middleware
3. **Onboarding** — /start with welcome, 152-FZ consent, integration choice (stub), level selection, referral deep link handling
4. **Main menu** — /menu with 7 inline buttons, stub handlers for unimplemented sections
5. **Expense parser** — regex-based natural language parsing: "кофе 350" -> category + amount
6. **Expense input handler** — plain text messages parsed as expenses, saved to DB
7. **Basic commands** — /balance (account list), /today (today's expenses), /help (capabilities)
8. **Referral system** — /invite with unique code, deep link handling, 10 referral cap
9. **Settings** — notification toggle, integration management (stub), level change
10. **Service layer** — UserService (CRUD, referral, consent), TransactionService (create, query)
11. **Test coverage** — 60+ tests across all components
