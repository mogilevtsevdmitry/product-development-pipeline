"""Dashboard API endpoints — mock data for MVP."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/dashboard")


@router.get("/overview")
async def overview():
    return {
        "totalBalance": 542890,
        "balanceChange": 2.4,
        "portfolioValue": 284560,
        "portfolioChange": -1.8,
        "goals": [
            {"id": 1, "name": "Отпуск в Таиланд", "current": 120000, "target": 200000, "percent": 60},
            {"id": 2, "name": "Запас прочности", "current": 300000, "target": 400000, "percent": 75},
        ],
        "recentTransactions": [
            {"id": 1, "description": "Кофейня Barista", "category": "Питание", "amount": -285, "date": "2026-04-07"},
            {"id": 2, "description": "Зарплата", "category": "Доход", "amount": 120000, "date": "2026-04-05"},
            {"id": 3, "description": "Билет на поезд", "category": "Транспорт", "amount": -1850, "date": "2026-04-04"},
            {"id": 4, "description": "Яндекс Плюс", "category": "Подписки", "amount": -299, "date": "2026-04-03"},
            {"id": 5, "description": "Перевод от Алексея", "category": "Доход", "amount": 5000, "date": "2026-04-02"},
        ],
    }


@router.get("/transactions")
async def transactions():
    return {
        "items": [
            {"id": 1, "date": "2026-04-07", "description": "Кофейня Barista", "category": "Питание", "amount": -285},
            {"id": 2, "date": "2026-04-06", "description": "Яндекс Маршрут+", "category": "Транспорт", "amount": -450},
            {"id": 3, "date": "2026-04-05", "description": "Зарплата", "category": "Доход", "amount": 120000},
            {"id": 4, "date": "2026-04-05", "description": "Перекрёсток", "category": "Продукты", "amount": -3420},
            {"id": 5, "date": "2026-04-04", "description": "Билет на поезд", "category": "Транспорт", "amount": -1850},
            {"id": 6, "date": "2026-04-03", "description": "Яндекс Плюс", "category": "Подписки", "amount": -299},
            {"id": 7, "date": "2026-04-02", "description": "Перевод от Алексея", "category": "Доход", "amount": 5000},
            {"id": 8, "date": "2026-04-01", "description": "Аптека Ригла", "category": "Здоровье", "amount": -780},
            {"id": 9, "date": "2026-03-31", "description": "Ресторан Белуга", "category": "Рестораны", "amount": -4200},
            {"id": 10, "date": "2026-03-30", "description": "DNS", "category": "Электроника", "amount": -15990},
        ],
        "total": 10,
    }


@router.get("/analytics")
async def analytics():
    return {
        "categoryBreakdown": [
            {"name": "Питание", "value": 12480, "percent": 28, "color": "#F5A623"},
            {"name": "Жилище", "value": 24000, "percent": 54, "color": "#58A6FF"},
            {"name": "Транспорт", "value": 5280, "percent": 12, "color": "#3FB950"},
            {"name": "Подписки", "value": 1200, "percent": 3, "color": "#D29922"},
            {"name": "Здоровье", "value": 780, "percent": 2, "color": "#F85149"},
        ],
        "categoryTrends": [
            {"month": "Янв", "food": 14200, "housing": 24000, "transport": 6800, "other": 4500},
            {"month": "Фев", "food": 11800, "housing": 24000, "transport": 5200, "other": 3800},
            {"month": "Мар", "food": 15600, "housing": 24000, "transport": 7100, "other": 5200},
            {"month": "Апр", "food": 12480, "housing": 24000, "transport": 5280, "other": 2540},
        ],
    }
