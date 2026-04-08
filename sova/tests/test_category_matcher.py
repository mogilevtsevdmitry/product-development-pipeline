import pytest
from sqlalchemy import select

from src.models.user import User
from src.models.category import Category
from src.services.category_matcher import CategoryMatcher


@pytest.fixture
async def user(db):
    u = User(telegram_id=300, username="cmuser", first_name="CM")
    db.add(u)
    await db.commit()
    return u


@pytest.fixture
async def categories(db, user):
    """Seed system categories."""
    cats = []
    for name, icon, cat_type in [
        ("Еда", "\U0001f354", "expense"),
        ("Транспорт", "\U0001f697", "expense"),
        ("Развлечения", "\U0001f3ad", "expense"),
        ("Здоровье", "\U0001f48a", "expense"),
        ("Одежда", "\U0001f455", "expense"),
        ("Жильё", "\U0001f3e0", "expense"),
        ("Связь", "\U0001f4f1", "expense"),
        ("Образование", "\U0001f4da", "expense"),
        ("Красота", "\U0001f487", "expense"),
        ("Другое", "\U0001f4e6", "expense"),
        ("Зарплата", "\U0001f4b0", "income"),
    ]:
        cat = Category(name=name, icon=icon, type=cat_type)
        db.add(cat)
        cats.append(cat)
    await db.commit()
    return cats


def test_match_known_keyword(categories):
    matcher = CategoryMatcher()
    assert matcher.match("Кофе Хауз") == "Еда"
    assert matcher.match("Яндекс Такси") == "Транспорт"
    assert matcher.match("Netflix") == "Развлечения"
    assert matcher.match("Аптека Горздрав") == "Здоровье"


def test_match_unknown_falls_to_other(categories):
    matcher = CategoryMatcher()
    assert matcher.match("Что-то непонятное") == "Другое"


def test_match_case_insensitive(categories):
    matcher = CategoryMatcher()
    assert matcher.match("КОФЕ") == "Еда"
    assert matcher.match("Метро") == "Транспорт"


def test_match_zenmoney_category_name(categories):
    """ZenMoney categories often match ours directly."""
    matcher = CategoryMatcher()
    # Direct name match
    assert matcher.match_zenmoney_category("Еда") == "Еда"
    assert matcher.match_zenmoney_category("Транспорт") == "Транспорт"


def test_match_zenmoney_unknown_category(categories):
    matcher = CategoryMatcher()
    assert matcher.match_zenmoney_category("Хобби и увлечения") == "Другое"


def test_match_zenmoney_partial(categories):
    matcher = CategoryMatcher()
    # "Рестораны и кафе" should match "Еда" via keywords
    assert matcher.match_zenmoney_category("Рестораны и кафе") == "Еда"
    assert matcher.match_zenmoney_category("Автомобиль") == "Транспорт"
