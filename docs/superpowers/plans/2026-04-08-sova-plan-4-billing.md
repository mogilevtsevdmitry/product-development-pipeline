# Plan 4: Billing (Telegram Stars)

**Дата:** 2026-04-08
**Статус:** В работе

## Контекст

Реализация биллинга для AI-функций Совы: пополнение баланса через Telegram Stars, списание за AI-запросы, вывод средств. Модели (BillingTransaction, AIUsageLog, User.ai_balance) уже существуют.

## Задачи

### 1. BillingService (`src/services/billing_service.py`)

Методы:
- `grant_free_credits(user_id, amount=50.00)` — начисление бонуса при регистрации, idempotency_key = `free_credits_{user_id}`
- `topup(user_id, amount, stars_amount, provider_tx_id, idempotency_key)` — пополнение через Stars
- `charge(user_id, cost, query_type, tokens_used)` — списание с optimistic locking (ai_balance_version)
- `withdraw(user_id, amount)` — вывод: проверка available_balance, создание транзакции
- `get_balance(user_id)` — текущий ai_balance
- `get_available_for_withdrawal(user_id)` — topups(completed) - charges - withdrawals(completed)
- `get_history(user_id, limit=10)` — объединённая история billing_transactions + ai_usage_log
- `has_sufficient_balance(user_id, cost)` — проверка баланса >= cost

### 2. Bot handlers (`src/bot/handlers/billing.py`)

- `/ai_balance` command + `menu:ai_balance` callback — показ баланса + кнопки пополнения
- Topup flow: pre_checkout_query + successful_payment handlers
- `/ai_history` command — последние 10 операций
- `/withdraw` command — показ доступной суммы + подтверждение

### 3. Billing keyboards (`src/bot/keyboards/billing.py`)

- `ai_balance_keyboard()` — кнопки [+100р] [+300р] [+500р] + история + вывод
- `withdraw_confirm_keyboard(amount)` — [Подтвердить вывод] [Отмена]

### 4. Обновление /start

В `on_level_select` после `complete_onboarding` вызывать `billing_service.grant_free_credits()`.

### 5. Регистрация в setup.py

Добавить `billing_router` в `register_handlers()`.

## Тесты (~20 штук)

### test_billing_service.py (~12 тестов):
1. grant_free_credits — создаёт транзакцию, увеличивает баланс
2. grant_free_credits — идемпотентность (повторный вызов не удваивает)
3. topup — создаёт транзакцию, увеличивает баланс
4. topup — идемпотентность
5. charge — списывает баланс, создаёт ai_usage_log
6. charge — optimistic locking version increment
7. charge — insufficient balance raises error
8. withdraw — уменьшает баланс
9. withdraw — insufficient available raises error
10. get_balance — возвращает текущий баланс
11. get_available_for_withdrawal — корректный расчёт
12. get_history — объединённый список

### test_handlers_billing.py (~8 тестов):
1. cmd_ai_balance — показывает баланс
2. on_ai_balance_callback — из меню
3. cmd_ai_history — показывает историю
4. cmd_withdraw — показывает доступную сумму
5. on_withdraw_confirm — выполняет вывод
6. on_withdraw_cancel — отменяет
7. on_pre_checkout — отвечает ok
8. on_successful_payment — пополняет баланс

## Порядок реализации

1. BillingService + тесты сервиса
2. Keyboards
3. Bot handlers + тесты хендлеров
4. Обновление /start + регистрация в setup.py
5. Полный прогон тестов
