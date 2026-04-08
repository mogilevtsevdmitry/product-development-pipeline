export const overviewData = {
  totalBalance: 542890,
  balanceChange: 2.4,
  portfolioValue: 284560,
  portfolioChange: -1.8,
  goals: [
    { id: 1, name: 'Отпуск в Таиланд', current: 120000, target: 200000, percent: 60, color: '#F5A623' },
    { id: 2, name: 'Запас прочности', current: 300000, target: 400000, percent: 75, color: '#3FB950' },
  ],
  recentTransactions: [
    { id: 1, description: 'Кофейня Barista', category: 'Питание', icon: 'coffee', amount: -285, date: '2026-04-07' },
    { id: 2, description: 'Зарплата', category: 'Доход', icon: 'banknote', amount: 120000, date: '2026-04-05' },
    { id: 3, description: 'Билет на поезд', category: 'Транспорт', icon: 'train-front', amount: -1850, date: '2026-04-04' },
    { id: 4, description: 'Яндекс Плюс', category: 'Подписки', icon: 'tv', amount: -299, date: '2026-04-03' },
    { id: 5, description: 'Перевод от Алексея', category: 'Доход', icon: 'arrow-down-left', amount: 5000, date: '2026-04-02' },
  ],
  incomeExpenseChart: [
    { month: 'Нояб', income: 130000, expense: 78000 },
    { month: 'Дек', income: 145000, expense: 92000 },
    { month: 'Янв', income: 120000, expense: 85000 },
    { month: 'Фев', income: 125000, expense: 71000 },
    { month: 'Мар', income: 132000, expense: 88000 },
    { month: 'Апр', income: 120000, expense: 42000 },
  ],
};

export const transactionsData = [
  { id: 1, date: '2026-04-07', description: 'Кофейня Barista', category: 'Питание', icon: 'coffee', amount: -285 },
  { id: 2, date: '2026-04-06', description: 'Яндекс Маршрут+', category: 'Транспорт', icon: 'navigation', amount: -450 },
  { id: 3, date: '2026-04-05', description: 'Зарплата', category: 'Доход', icon: 'banknote', amount: 120000 },
  { id: 4, date: '2026-04-05', description: 'Перекрёсток', category: 'Продукты', icon: 'shopping-cart', amount: -3420 },
  { id: 5, date: '2026-04-04', description: 'Билет на поезд', category: 'Транспорт', icon: 'train-front', amount: -1850 },
  { id: 6, date: '2026-04-03', description: 'Яндекс Плюс', category: 'Подписки', icon: 'tv', amount: -299 },
  { id: 7, date: '2026-04-02', description: 'Перевод от Алексея', category: 'Доход', icon: 'arrow-down-left', amount: 5000 },
  { id: 8, date: '2026-04-01', description: 'Аптека Ригла', category: 'Здоровье', icon: 'heart-pulse', amount: -780 },
  { id: 9, date: '2026-03-31', description: 'Ресторан Белуга', category: 'Рестораны', icon: 'utensils', amount: -4200 },
  { id: 10, date: '2026-03-30', description: 'DNS', category: 'Электроника', icon: 'monitor', amount: -15990 },
];

export const analyticsData = {
  categoryBreakdown: [
    { name: 'Питание', value: 12480, percent: 28, color: '#F5A623' },
    { name: 'Жилище', value: 24000, percent: 54, color: '#58A6FF' },
    { name: 'Транспорт', value: 5280, percent: 12, color: '#3FB950' },
    { name: 'Подписки', value: 1200, percent: 3, color: '#D29922' },
    { name: 'Здоровье', value: 780, percent: 2, color: '#F85149' },
    { name: 'Другое', value: 560, percent: 1, color: '#8B949E' },
  ],
  categoryTrends: [
    { month: 'Янв', food: 14200, housing: 24000, transport: 6800, other: 4500 },
    { month: 'Фев', food: 11800, housing: 24000, transport: 5200, other: 3800 },
    { month: 'Мар', food: 15600, housing: 24000, transport: 7100, other: 5200 },
    { month: 'Апр', food: 12480, housing: 24000, transport: 5280, other: 2540 },
  ],
  calendarData: generateCalendarData(),
  anomalies: [
    {
      id: 1,
      type: 'warning' as const,
      title: 'Повышенный расход',
      description: 'Расход на питание выше обычного на 45%',
    },
    {
      id: 2,
      type: 'success' as const,
      title: 'Хорошие новости!',
      description: 'Вы достигли цели по сбережениям раньше графика',
    },
  ],
};

function generateCalendarData() {
  const data: { date: string; amount: number }[] = [];
  for (let d = 1; d <= 30; d++) {
    const day = String(d).padStart(2, '0');
    const amount = Math.floor(Math.random() * 8000) + 500;
    data.push({ date: `2026-04-${day}`, amount });
  }
  return data;
}
