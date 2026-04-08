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
        [
            InlineKeyboardButton(text="📰 Новости", callback_data="menu:news"),
            InlineKeyboardButton(text="📖 Помощь", callback_data="menu:help"),
        ],
    ])


def integrations_keyboard(
    zm_status: str | None = None,
    tb_status: str | None = None,
) -> InlineKeyboardMarkup:
    """Integration management keyboard.

    Args:
        zm_status: ZenMoney integration status (None=not connected, active, error, disconnected)
        tb_status: T-Bank integration status
    """
    buttons = []

    # ZenMoney
    if zm_status == "active":
        buttons.append([InlineKeyboardButton(text="✅ ZenMoney подключён", callback_data="integration:zm_status")])
    elif zm_status == "error":
        buttons.append([InlineKeyboardButton(text="⚠️ ZenMoney (ошибка)", callback_data="integration:zm_reconnect")])
    else:
        buttons.append([InlineKeyboardButton(text="🏦 Подключить ZenMoney", callback_data="integration:zm_connect")])

    # T-Bank
    if tb_status == "active":
        buttons.append([InlineKeyboardButton(text="✅ T-Bank Invest подключён", callback_data="integration:tb_status")])
    elif tb_status == "error":
        buttons.append([InlineKeyboardButton(text="⚠️ T-Bank Invest (ошибка)", callback_data="integration:tb_reconnect")])
    else:
        buttons.append([InlineKeyboardButton(text="💳 Подключить T-Bank Invest", callback_data="integration:tb_connect")])

    buttons.append([InlineKeyboardButton(text="◀️ Назад", callback_data="menu:settings")])
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def settings_keyboard(notifications_enabled: bool = True) -> InlineKeyboardMarkup:
    """Settings menu keyboard."""
    notif_text = "🔕 Выключить уведомления" if notifications_enabled else "🔔 Включить уведомления"
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=notif_text, callback_data="settings:toggle_notifications")],
        [InlineKeyboardButton(text="🏦 Интеграции", callback_data="settings:integrations")],
        [InlineKeyboardButton(text="📊 Уровень", callback_data="settings:level")],
        [InlineKeyboardButton(text="◀️ Назад", callback_data="menu:back")],
    ])
