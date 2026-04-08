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
