# Sova Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the Sova project foundation — project structure, Docker Compose, PostgreSQL schema, SQLAlchemy models, Alembic migrations, and basic Telegram auth.

**Architecture:** Modular monolith in Python 3.12. FastAPI serves both the Telegram webhook and REST API. SQLAlchemy 2.0 async with Alembic for migrations. Redis for task queue (arq). Docker Compose for local development with 6 services: app, ai-worker, cron-worker, trade-worker, postgres, redis.

**Tech Stack:** Python 3.12, FastAPI, aiogram 3, SQLAlchemy 2.0 (async), Alembic, PostgreSQL 16, Redis 7, Docker Compose, pytest, httpx

**Spec:** `docs/superpowers/specs/2026-04-08-sova-financial-assistant-design.md`

---

## File Structure

```
sova/
├── docker-compose.yml
├── Dockerfile
├── pyproject.toml
├── alembic.ini
├── alembic/
│   ├── env.py
│   └── versions/
│       └── 001_initial_schema.py
├── src/
│   ├── __init__.py
│   ├── main.py                    # FastAPI app entrypoint
│   ├── config.py                  # Settings from env vars (pydantic-settings)
│   ├── database.py                # Async engine, session factory
│   ├── models/
│   │   ├── __init__.py            # Re-exports all models
│   │   ├── base.py                # DeclarativeBase (avoids circular imports)
│   │   ├── user.py                # User model
│   │   ├── integration.py         # Integration model
│   │   ├── account.py             # Account model
│   │   ├── category.py            # Category model
│   │   ├── transaction.py         # Transaction model
│   │   ├── portfolio.py           # PortfolioPosition + PortfolioOperation
│   │   ├── goal.py                # Goal model
│   │   ├── billing.py             # BillingTransaction model
│   │   ├── ai_usage.py            # AIUsageLog model
│   │   ├── news.py                # NewsCache model
│   │   └── trade_order.py         # TradeOrder model
│   ├── api/
│   │   ├── __init__.py
│   │   ├── router.py              # Main API router aggregating all sub-routers
│   │   ├── auth.py                # POST /api/auth/telegram — Telegram Login Widget verification
│   │   └── health.py              # GET /health — healthcheck
│   ├── bot/
│   │   ├── __init__.py
│   │   └── setup.py               # aiogram Dispatcher + webhook setup
│   └── workers/
│       ├── __init__.py
│       ├── ai_worker.py           # arq worker for AI tasks (stub)
│       ├── cron_worker.py         # APScheduler cron tasks (stub)
│       └── trade_worker.py        # arq worker for trade tasks (stub)
├── tests/
│   ├── __init__.py
│   ├── conftest.py                # Fixtures: async db session, test client, test user
│   ├── test_health.py             # Healthcheck endpoint test
│   ├── test_models.py             # Model creation and constraints tests
│   └── test_auth.py               # Telegram auth verification tests
└── .env.example
```

---

### Task 1: Project Setup & Dependencies

**Files:**
- Create: `sova/pyproject.toml`
- Create: `sova/.env.example`
- Create: `sova/src/__init__.py`
- Create: `sova/src/config.py`
- Create: `sova/tests/__init__.py`

- [ ] **Step 1: Create project directory and pyproject.toml**

```bash
mkdir -p sova/src sova/tests
```

```toml
# sova/pyproject.toml
[project]
name = "sova"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "aiogram>=3.13.0",
    "sqlalchemy[asyncio]>=2.0.35",
    "asyncpg>=0.30.0",
    "alembic>=1.14.0",
    "redis>=5.2.0",
    "arq>=0.26.0",
    "pydantic-settings>=2.6.0",
    "cryptography>=43.0.0",
    "httpx>=0.27.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3.0",
    "pytest-asyncio>=0.24.0",
    "httpx>=0.27.0",
    "aiosqlite>=0.20.0",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.setuptools.packages.find]
where = ["."]
include = ["src*"]

[build-system]
requires = ["setuptools>=75.0"]
build-backend = "setuptools.backends._legacy:_Backend"
```

- [ ] **Step 2: Create .env.example**

```bash
# sova/.env.example
DATABASE_URL=postgresql+asyncpg://sova:sova@localhost:5432/sova
REDIS_URL=redis://localhost:6379/0
BOT_TOKEN=your-telegram-bot-token
ANTHROPIC_API_KEY=your-anthropic-api-key
APP_BASE_URL=http://localhost:8000
ENCRYPTION_KEY=your-32-byte-hex-key
```

- [ ] **Step 3: Create config.py**

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

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
```

- [ ] **Step 4: Create empty __init__.py files**

```python
# sova/src/__init__.py
# sova/tests/__init__.py
```

- [ ] **Step 5: Install dependencies and verify**

```bash
cd sova && pip install -e ".[dev]"
```

Expected: installs successfully, no errors.

- [ ] **Step 6: Commit**

```bash
git add sova/
git commit -m "feat(sova): initialize project with dependencies and config"
```

---

### Task 2: Database Connection & SQLAlchemy Setup

**Files:**
- Create: `sova/src/database.py`
- Test: `sova/tests/conftest.py`

- [ ] **Step 1: Write conftest.py with async DB fixtures**

```python
# sova/tests/conftest.py
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import StaticPool

from src.models import Base  # noqa: triggers all model imports for create_all


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
```

- [ ] **Step 2: Create database.py**

```python
# sova/src/database.py
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from src.config import settings

engine = create_async_engine(settings.database_url, echo=False)
async_session = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
```

- [ ] **Step 3: Commit**

```bash
git add sova/src/database.py sova/tests/conftest.py
git commit -m "feat(sova): add async database connection and test fixtures"
```

---

### Task 3: SQLAlchemy Models — Users, Integrations, Accounts

**Files:**
- Create: `sova/src/models/__init__.py`
- Create: `sova/src/models/user.py`
- Create: `sova/src/models/integration.py`
- Create: `sova/src/models/account.py`
- Test: `sova/tests/test_models.py`

- [ ] **Step 1: Write failing test for User model**

```python
# sova/tests/test_models.py
import pytest
from sqlalchemy import select

from src.models.user import User


async def test_create_user(db):
    user = User(telegram_id=123456789, username="testuser", first_name="Test")
    db.add(user)
    await db.commit()

    result = await db.execute(select(User).where(User.telegram_id == 123456789))
    saved = result.scalar_one()
    assert saved.username == "testuser"
    assert saved.level == "beginner"
    assert saved.ai_balance == 0
    assert saved.ai_balance_version == 0
    assert saved.timezone == "Europe/Moscow"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sova && python -m pytest tests/test_models.py::test_create_user -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'src.models'`

- [ ] **Step 3: Create models/base.py, models/__init__.py, and user.py**

```python
# sova/src/models/base.py
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
```

```python
# sova/src/models/__init__.py
from src.models.base import Base
from src.models.user import User
from src.models.integration import Integration
from src.models.account import Account

__all__ = ["Base", "User", "Integration", "Account"]
```

```python
# sova/src/models/user.py
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import BigInteger, String, Numeric, Integer, DateTime, JSON
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd sova && python -m pytest tests/test_models.py::test_create_user -v
```

Expected: PASS

- [ ] **Step 5: Write test for Integration model**

Add to `tests/test_models.py`:

```python
from src.models.integration import Integration


async def test_create_integration(db):
    user = User(telegram_id=111, username="u1", first_name="U")
    db.add(user)
    await db.commit()

    integration = Integration(
        user_id=111,
        type="zenmoney",
        access_token_encrypted=b"encrypted_token",
        status="active",
    )
    db.add(integration)
    await db.commit()

    result = await db.execute(select(Integration).where(Integration.user_id == 111))
    saved = result.scalar_one()
    assert saved.type == "zenmoney"
    assert saved.status == "active"
    assert saved.error_count == 0
```

- [ ] **Step 6: Create integration.py**

```python
# sova/src/models/integration.py
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
```

- [ ] **Step 7: Run test to verify it passes**

```bash
cd sova && python -m pytest tests/test_models.py::test_create_integration -v
```

Expected: PASS

- [ ] **Step 8: Write test for Account model**

Add to `tests/test_models.py`:

```python
from src.models.account import Account


async def test_create_account(db):
    user = User(telegram_id=222, username="u2", first_name="U2")
    db.add(user)
    await db.commit()

    account = Account(
        user_id=222, name="Tinkoff Black", currency="RUB",
        balance=Decimal("50000.00"), source="zenmoney", external_id="ext_123"
    )
    db.add(account)
    await db.commit()

    result = await db.execute(select(Account).where(Account.user_id == 222))
    saved = result.scalar_one()
    assert saved.name == "Tinkoff Black"
    assert saved.balance == Decimal("50000.00")
```

Add `from decimal import Decimal` at the top of the file.

- [ ] **Step 9: Create account.py**

```python
# sova/src/models/account.py
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
```

- [ ] **Step 10: Run all model tests**

```bash
cd sova && python -m pytest tests/test_models.py -v
```

Expected: 3 tests PASS

- [ ] **Step 11: Commit**

```bash
git add sova/src/models/ sova/tests/test_models.py
git commit -m "feat(sova): add User, Integration, Account models with tests"
```

---

### Task 4: SQLAlchemy Models — Categories, Transactions

**Files:**
- Create: `sova/src/models/category.py`
- Create: `sova/src/models/transaction.py`
- Modify: `sova/src/models/__init__.py`
- Test: `sova/tests/test_models.py`

- [ ] **Step 1: Write failing test for Category model**

Add to `tests/test_models.py`:

```python
from src.models.category import Category


async def test_create_category(db):
    system_cat = Category(name="Еда", icon="🍔", type="expense")
    db.add(system_cat)
    await db.commit()

    result = await db.execute(select(Category).where(Category.name == "Еда"))
    saved = result.scalar_one()
    assert saved.user_id is None  # system category
    assert saved.type == "expense"
```

- [ ] **Step 2: Create category.py**

```python
# sova/src/models/category.py
import uuid

from sqlalchemy import BigInteger, String, ForeignKey, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.telegram_id"), nullable=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    icon: Mapped[str | None] = mapped_column(String, nullable=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("categories.id"), nullable=True)
    type: Mapped[str] = mapped_column(String, nullable=False)
```

- [ ] **Step 3: Write failing test for Transaction model**

Add to `tests/test_models.py`:

```python
from src.models.transaction import Transaction
from datetime import date


async def test_create_transaction(db):
    user = User(telegram_id=333, username="u3", first_name="U3")
    db.add(user)
    await db.commit()

    cat = Category(name="Транспорт", icon="🚕", type="expense")
    db.add(cat)
    await db.commit()

    tx = Transaction(
        user_id=333, category_id=cat.id, amount=Decimal("-600.00"),
        currency="RUB", date=date(2026, 4, 8), description="Такси",
        source="manual",
    )
    db.add(tx)
    await db.commit()

    result = await db.execute(select(Transaction).where(Transaction.user_id == 333))
    saved = result.scalar_one()
    assert saved.amount == Decimal("-600.00")
    assert saved.source == "manual"
```

- [ ] **Step 4: Create transaction.py**

```python
# sova/src/models/transaction.py
import uuid
from datetime import date as date_type, datetime, timezone
from decimal import Decimal

from sqlalchemy import BigInteger, String, Numeric, Date, DateTime, Text, ForeignKey, Uuid, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        UniqueConstraint("user_id", "source", "external_id", name="uq_transaction_source"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.telegram_id"), nullable=False)
    account_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("accounts.id"), nullable=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("categories.id"), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="RUB")
    date: Mapped[date_type] = mapped_column(Date, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String, nullable=False)
    external_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
```

- [ ] **Step 5: Update models/__init__.py**

```python
# sova/src/models/__init__.py
from src.models.base import Base
from src.models.user import User
from src.models.integration import Integration
from src.models.account import Account
from src.models.category import Category
from src.models.transaction import Transaction

__all__ = ["Base", "User", "Integration", "Account", "Category", "Transaction"]
```

- [ ] **Step 6: Run all tests**

```bash
cd sova && python -m pytest tests/test_models.py -v
```

Expected: 5 tests PASS

- [ ] **Step 7: Commit**

```bash
git add sova/src/models/ sova/tests/test_models.py
git commit -m "feat(sova): add Category and Transaction models with tests"
```

---

### Task 5: SQLAlchemy Models — Portfolio, Goals, Billing, AI Usage, News, Trade Orders

**Files:**
- Create: `sova/src/models/portfolio.py`
- Create: `sova/src/models/goal.py`
- Create: `sova/src/models/billing.py`
- Create: `sova/src/models/ai_usage.py`
- Create: `sova/src/models/news.py`
- Create: `sova/src/models/trade_order.py`
- Modify: `sova/src/models/__init__.py`
- Test: `sova/tests/test_models.py`

- [ ] **Step 1: Write failing tests for remaining models**

Add to `tests/test_models.py`:

```python
from src.models.portfolio import PortfolioPosition, PortfolioOperation
from src.models.goal import Goal
from src.models.billing import BillingTransaction
from src.models.ai_usage import AIUsageLog
from src.models.news import NewsCache
from src.models.trade_order import TradeOrder


async def test_create_portfolio_position(db):
    user = User(telegram_id=444, username="u4", first_name="U4")
    db.add(user)
    await db.commit()

    pos = PortfolioPosition(
        user_id=444, ticker="SBER", figi="BBG004730N88", name="Сбербанк",
        quantity=Decimal("10.0"), avg_price=Decimal("280.50"),
        current_price=Decimal("285.00"), sector="financials",
        asset_type="stock", currency="RUB",
    )
    db.add(pos)
    await db.commit()

    result = await db.execute(select(PortfolioPosition).where(PortfolioPosition.user_id == 444))
    saved = result.scalar_one()
    assert saved.ticker == "SBER"
    assert saved.quantity == Decimal("10.0")


async def test_create_goal(db):
    user = User(telegram_id=555, username="u5", first_name="U5")
    db.add(user)
    await db.commit()

    goal = Goal(
        user_id=555, name="Отпуск", target_amount=Decimal("200000.00"),
    )
    db.add(goal)
    await db.commit()

    result = await db.execute(select(Goal).where(Goal.user_id == 555))
    saved = result.scalar_one()
    assert saved.status == "active"
    assert saved.current_amount == Decimal("0")


async def test_create_billing_transaction(db):
    user = User(telegram_id=666, username="u6", first_name="U6")
    db.add(user)
    await db.commit()

    bt = BillingTransaction(
        user_id=666, type="topup", amount=Decimal("300.00"),
        stars_amount=150, status="completed", idempotency_key="tg_pay_001",
    )
    db.add(bt)
    await db.commit()

    result = await db.execute(select(BillingTransaction).where(BillingTransaction.user_id == 666))
    saved = result.scalar_one()
    assert saved.type == "topup"
    assert saved.stars_amount == 150


async def test_create_trade_order(db):
    user = User(telegram_id=777, username="u7", first_name="U7")
    db.add(user)
    await db.commit()

    order = TradeOrder(
        user_id=777, ticker="GAZP", direction="buy",
        order_type="market", quantity=5,
    )
    db.add(order)
    await db.commit()

    result = await db.execute(select(TradeOrder).where(TradeOrder.user_id == 777))
    saved = result.scalar_one()
    assert saved.status == "pending_confirmation"
    assert saved.direction == "buy"
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd sova && python -m pytest tests/test_models.py -v -k "portfolio or goal or billing or trade"
```

Expected: FAIL — imports not found

- [ ] **Step 3: Create portfolio.py**

```python
# sova/src/models/portfolio.py
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
```

- [ ] **Step 4: Create goal.py**

```python
# sova/src/models/goal.py
import uuid
from datetime import datetime, timezone, date
from decimal import Decimal

from sqlalchemy import BigInteger, String, Numeric, Date, DateTime, Text, ForeignKey, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.telegram_id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    target_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    current_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String, default="active")
    ai_recommendation: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
```

- [ ] **Step 5: Create billing.py**

```python
# sova/src/models/billing.py
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import BigInteger, String, Numeric, Integer, DateTime, ForeignKey, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class BillingTransaction(Base):
    __tablename__ = "billing_transactions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.telegram_id"), nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    stars_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")
    provider_tx_id: Mapped[str | None] = mapped_column(String, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String, unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

- [ ] **Step 6: Create ai_usage.py**

```python
# sova/src/models/ai_usage.py
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
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
```

- [ ] **Step 7: Create news.py**

```python
# sova/src/models/news.py
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, DateTime, Text, JSON, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class NewsCache(Base):
    __tablename__ = "news_cache"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    source: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    affected_tickers: Mapped[list | None] = mapped_column(JSON, nullable=True)  # list of ticker strings
    sentiment: Mapped[str | None] = mapped_column(String, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

- [ ] **Step 8: Create trade_order.py**

```python
# sova/src/models/trade_order.py
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import BigInteger, String, Numeric, Integer, DateTime, ForeignKey, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base


class TradeOrder(Base):
    __tablename__ = "trade_orders"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.telegram_id"), nullable=False)
    ticker: Mapped[str] = mapped_column(String, nullable=False)
    direction: Mapped[str] = mapped_column(String, nullable=False)
    order_type: Mapped[str] = mapped_column(String, default="market")
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    price: Mapped[Decimal | None] = mapped_column(Numeric(12, 4), nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending_confirmation")
    tbank_order_id: Mapped[str | None] = mapped_column(String, nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    executed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
```

- [ ] **Step 9: Update models/__init__.py with all models**

```python
# sova/src/models/__init__.py
from src.models.base import Base
from src.models.user import User
from src.models.integration import Integration
from src.models.account import Account
from src.models.category import Category
from src.models.transaction import Transaction
from src.models.portfolio import PortfolioPosition, PortfolioOperation
from src.models.goal import Goal
from src.models.billing import BillingTransaction
from src.models.ai_usage import AIUsageLog
from src.models.news import NewsCache
from src.models.trade_order import TradeOrder

__all__ = [
    "Base", "User", "Integration", "Account", "Category", "Transaction",
    "PortfolioPosition", "PortfolioOperation", "Goal", "BillingTransaction",
    "AIUsageLog", "NewsCache", "TradeOrder",
]
```

- [ ] **Step 10: Run all model tests**

```bash
cd sova && python -m pytest tests/test_models.py -v
```

Expected: 9 tests PASS

- [ ] **Step 11: Commit**

```bash
git add sova/src/models/ sova/tests/test_models.py
git commit -m "feat(sova): add all remaining models — Portfolio, Goal, Billing, AI, News, TradeOrder"
```

---

### Task 6: Alembic Setup & Initial Migration

**Files:**
- Create: `sova/alembic.ini`
- Create: `sova/alembic/env.py`
- Create: `sova/alembic/versions/001_initial_schema.py`

- [ ] **Step 1: Initialize alembic**

```bash
cd sova && alembic init alembic
```

- [ ] **Step 2: Edit alembic.ini — set sqlalchemy.url placeholder**

Replace `sqlalchemy.url` line in `sova/alembic.ini`:

```ini
sqlalchemy.url = postgresql://sova:sova@localhost:5432/sova
```

- [ ] **Step 3: Edit alembic/env.py — import models for autogenerate**

Replace the contents of `sova/alembic/env.py`:

```python
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from src.models.base import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

- [ ] **Step 4: Generate initial migration**

**Note:** This step requires a running PostgreSQL. Start it first:
```bash
cd sova && docker compose up -d postgres
# Wait for healthy, then:
cd sova && alembic revision --autogenerate -m "initial schema"
cd sova && docker compose down
```

Expected: creates migration file in `alembic/versions/`

- [ ] **Step 5: Verify migration file contains all 11 tables**

Check generated file contains: `users`, `integrations`, `accounts`, `categories`, `transactions`, `portfolio_positions`, `portfolio_operations`, `goals`, `billing_transactions`, `ai_usage_log`, `news_cache`, `trade_orders`.

- [ ] **Step 6: Commit**

```bash
git add sova/alembic.ini sova/alembic/
git commit -m "feat(sova): add Alembic setup with initial migration for all 11 tables"
```

---

### Task 7: FastAPI App, Health Endpoint, Bot Webhook Stub

**Files:**
- Create: `sova/src/main.py`
- Create: `sova/src/api/__init__.py`
- Create: `sova/src/api/router.py`
- Create: `sova/src/api/health.py`
- Create: `sova/src/bot/__init__.py`
- Create: `sova/src/bot/setup.py`
- Test: `sova/tests/test_health.py`

- [ ] **Step 1: Write failing test for healthcheck**

```python
# sova/tests/test_health.py
import pytest
from httpx import AsyncClient, ASGITransport

from src.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "version" in data
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sova && python -m pytest tests/test_health.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'src.main'`

- [ ] **Step 3: Create health.py**

```python
# sova/src/api/__init__.py
```

```python
# sova/src/api/health.py
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
```

- [ ] **Step 4: Create router.py**

```python
# sova/src/api/router.py
from fastapi import APIRouter

from src.api.health import router as health_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
```

- [ ] **Step 5: Create bot/setup.py stub**

```python
# sova/src/bot/__init__.py
```

```python
# sova/src/bot/setup.py
from aiogram import Bot, Dispatcher

from src.config import settings

bot = Bot(token=settings.bot_token) if settings.bot_token else None
dp = Dispatcher()
```

- [ ] **Step 6: Create main.py**

```python
# sova/src/main.py
from fastapi import FastAPI

from src.api.router import api_router

app = FastAPI(title="Sova", version="0.1.0")
app.include_router(api_router)
```

- [ ] **Step 7: Run test to verify it passes**

```bash
cd sova && python -m pytest tests/test_health.py -v
```

Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add sova/src/main.py sova/src/api/ sova/src/bot/ sova/tests/test_health.py
git commit -m "feat(sova): add FastAPI app with healthcheck and bot stub"
```

---

### Task 8: Telegram Auth Endpoint

**Files:**
- Create: `sova/src/api/auth.py`
- Modify: `sova/src/api/router.py`
- Test: `sova/tests/test_auth.py`

- [ ] **Step 1: Write failing test for Telegram auth**

```python
# sova/tests/test_auth.py
import hashlib
import hmac
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch

from src.main import app


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def make_telegram_auth_data(bot_token: str, data: dict) -> dict:
    """Generate valid Telegram Login Widget auth data."""
    check_data = sorted(
        f"{k}={v}" for k, v in data.items() if k != "hash"
    )
    check_string = "\n".join(check_data)
    secret_key = hashlib.sha256(bot_token.encode()).digest()
    hash_value = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()
    return {**data, "hash": hash_value}


BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"


@patch("src.api.auth.time")
@patch("src.api.auth.settings")
async def test_telegram_auth_valid(mock_settings, mock_time, client):
    mock_settings.bot_token = BOT_TOKEN
    mock_time.time.return_value = 1712534400 + 100  # 100 seconds after auth_date

    auth_data = make_telegram_auth_data(BOT_TOKEN, {
        "id": "123456789",
        "first_name": "Dmitry",
        "username": "dmitry",
        "auth_date": "1712534400",
    })

    resp = await client.post("/api/auth/telegram", json=auth_data)
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["telegram_id"] == 123456789


@patch("src.api.auth.settings")
async def test_telegram_auth_invalid_hash(mock_settings, client):
    mock_settings.bot_token = BOT_TOKEN

    resp = await client.post("/api/auth/telegram", json={
        "id": "123456789",
        "first_name": "Dmitry",
        "username": "dmitry",
        "auth_date": "1712534400",
        "hash": "invalid_hash",
    })
    assert resp.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sova && python -m pytest tests/test_auth.py -v
```

Expected: FAIL

- [ ] **Step 3: Create auth.py**

```python
# sova/src/api/auth.py
import hashlib
import hmac
import time
import uuid

from fastapi import APIRouter, HTTPException

from src.config import settings

router = APIRouter(prefix="/api/auth")

# Simple JWT-like token (for MVP; replace with proper JWT later)
_tokens: dict[str, int] = {}  # token -> telegram_id


def verify_telegram_auth(data: dict) -> bool:
    """Verify Telegram Login Widget data."""
    check_hash = data.pop("hash", "")
    check_data = sorted(f"{k}={v}" for k, v in data.items())
    check_string = "\n".join(check_data)
    secret_key = hashlib.sha256(settings.bot_token.encode()).digest()
    computed = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()
    data["hash"] = check_hash
    return hmac.compare_digest(computed, check_hash)


@router.post("/telegram")
async def telegram_login(data: dict):
    if not verify_telegram_auth(data):
        raise HTTPException(status_code=401, detail="Invalid auth data")

    auth_date = int(data.get("auth_date", 0))
    if time.time() - auth_date > 86400:
        raise HTTPException(status_code=401, detail="Auth data expired")

    telegram_id = int(data["id"])
    token = uuid.uuid4().hex
    _tokens[token] = telegram_id

    return {"token": token, "telegram_id": telegram_id}
```

- [ ] **Step 4: Update router.py to include auth**

```python
# sova/src/api/router.py
from fastapi import APIRouter

from src.api.health import router as health_router
from src.api.auth import router as auth_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["health"])
api_router.include_router(auth_router, tags=["auth"])
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd sova && python -m pytest tests/test_auth.py -v
```

Expected: 2 tests PASS

- [ ] **Step 6: Commit**

```bash
git add sova/src/api/auth.py sova/src/api/router.py sova/tests/test_auth.py
git commit -m "feat(sova): add Telegram Login Widget auth endpoint"
```

---

### Task 9: Worker Stubs

**Files:**
- Create: `sova/src/workers/__init__.py`
- Create: `sova/src/workers/ai_worker.py`
- Create: `sova/src/workers/cron_worker.py`
- Create: `sova/src/workers/trade_worker.py`

- [ ] **Step 1: Create worker stubs**

```python
# sova/src/workers/__init__.py
```

```python
# sova/src/workers/ai_worker.py
"""AI Worker — processes LLM tasks from Redis queue.
Stub: will be implemented in Plan 4 (AI System).
"""
import asyncio
import logging

logger = logging.getLogger(__name__)


async def main():
    logger.info("AI Worker started (stub)")
    while True:
        await asyncio.sleep(60)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
```

```python
# sova/src/workers/cron_worker.py
"""Cron Worker — periodic tasks (sync, news, digests).
Stub: will be implemented in Plan 3 (Integrations) and Plan 7 (News).
"""
import asyncio
import logging

logger = logging.getLogger(__name__)


async def main():
    logger.info("Cron Worker started (stub)")
    while True:
        await asyncio.sleep(60)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
```

```python
# sova/src/workers/trade_worker.py
"""Trade Worker — executes trade orders via T-Bank API.
Stub: will be implemented in Plan 5 (Trading).
"""
import asyncio
import logging

logger = logging.getLogger(__name__)


async def main():
    logger.info("Trade Worker started (stub)")
    while True:
        await asyncio.sleep(60)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
```

- [ ] **Step 2: Commit**

```bash
git add sova/src/workers/
git commit -m "feat(sova): add worker stubs for AI, Cron, and Trade workers"
```

---

### Task 10: Docker Compose & Dockerfile

**Files:**
- Create: `sova/Dockerfile`
- Create: `sova/docker-compose.yml`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
# sova/Dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml .
COPY src/ src/
RUN pip install --no-cache-dir .

COPY . .

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Create docker-compose.yml**

```yaml
# sova/docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: sova
      POSTGRES_USER: sova
      POSTGRES_PASSWORD: sova
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sova"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  app:
    build: .
    ports:
      - "8000:8000"
    env_file: .env
    environment:
      DATABASE_URL: postgresql+asyncpg://sova:sova@postgres:5432/sova
      REDIS_URL: redis://redis:6379/0
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload

  ai-worker:
    build: .
    env_file: .env
    environment:
      DATABASE_URL: postgresql+asyncpg://sova:sova@postgres:5432/sova
      REDIS_URL: redis://redis:6379/0
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: python -m src.workers.ai_worker

  cron-worker:
    build: .
    env_file: .env
    environment:
      DATABASE_URL: postgresql+asyncpg://sova:sova@postgres:5432/sova
      REDIS_URL: redis://redis:6379/0
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: python -m src.workers.cron_worker

  trade-worker:
    build: .
    env_file: .env
    environment:
      DATABASE_URL: postgresql+asyncpg://sova:sova@postgres:5432/sova
      REDIS_URL: redis://redis:6379/0
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    command: python -m src.workers.trade_worker

volumes:
  pgdata:
```

- [ ] **Step 3: Verify docker-compose config is valid**

```bash
cd sova && docker compose config --quiet
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add sova/Dockerfile sova/docker-compose.yml
git commit -m "feat(sova): add Dockerfile and Docker Compose with all 6 services"
```

---

### Task 11: Run Full Test Suite & Verify

- [ ] **Step 1: Run all tests**

```bash
cd sova && python -m pytest tests/ -v
```

Expected: All tests PASS (healthcheck + models + auth)

- [ ] **Step 2: Build Docker image**

```bash
cd sova && docker compose build app
```

Expected: builds successfully

- [ ] **Step 3: Start infrastructure and verify healthcheck**

```bash
cd sova && docker compose up -d postgres redis
# Wait for healthy
cd sova && docker compose up -d app
# Test healthcheck
curl http://localhost:8000/health
```

Expected: `{"status":"ok","version":"0.1.0"}`

- [ ] **Step 4: Run migration against real DB**

```bash
cd sova && docker compose exec app alembic upgrade head
```

Expected: migration applies, all 11 tables created

- [ ] **Step 5: Stop services**

```bash
cd sova && docker compose down
```

- [ ] **Step 6: Final commit if any fixes were needed**

```bash
git add -A sova/ && git commit -m "fix(sova): fixes from integration testing"
```
