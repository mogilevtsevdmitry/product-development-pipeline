import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { ProgressBar } from '../components/ProgressBar';
import { CategoryIcon } from '../components/CategoryIcon';
import { formatRub, formatPercent } from '../lib/format';
import { overviewData } from '../lib/mockData';

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-card-border rounded-lg p-3 text-sm shadow-lg">
      <p className="text-text-secondary mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {formatRub(p.value)} ₽
        </p>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const d = overviewData;

  return (
    <div className="space-y-6">
      {/* Balance Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <p className="text-text-secondary text-sm mb-1">Общий баланс</p>
          <p className="text-3xl font-bold tabular-nums">
            ₽ {formatRub(d.totalBalance)}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <Badge value={formatPercent(d.balanceChange)} variant="success" />
            <span className="text-text-secondary text-xs">за 30 дней</span>
          </div>
        </Card>

        <Card>
          <p className="text-text-secondary text-sm mb-1">Стоимость портфеля</p>
          <p className="text-3xl font-bold tabular-nums">
            ₽ {formatRub(d.portfolioValue)}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <Badge
              value={formatPercent(d.portfolioChange)}
              variant="error"
            />
            <span className="text-text-secondary text-xs">за день</span>
          </div>
        </Card>
      </div>

      {/* Income vs Expense Chart */}
      <Card>
        <h3 className="text-lg font-semibold mb-4">Доходы vs Расходы (30 дней)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={d.incomeExpenseChart} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363D" vertical={false} />
              <XAxis dataKey="month" stroke="#8B949E" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#8B949E" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v / 1000}k`} />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
              <Bar dataKey="income" name="Доходы" fill="#3FB950" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expense" name="Расходы" fill="#F85149" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Goals */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Мои цели</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {d.goals.map((goal) => (
            <Card key={goal.id}>
              <div className="flex justify-between items-start mb-3">
                <p className="font-medium">{goal.name}</p>
                <span className="text-text-secondary text-sm tabular-nums">{goal.percent}%</span>
              </div>
              <ProgressBar percent={goal.percent} color={goal.color} />
              <p className="text-text-secondary text-xs mt-2 tabular-nums">
                ₽ {formatRub(goal.current)} / ₽ {formatRub(goal.target)}
              </p>
            </Card>
          ))}
        </div>
      </div>

      {/* Recent Transactions */}
      <Card>
        <h3 className="text-lg font-semibold mb-4">Последние транзакции</h3>
        <div className="space-y-3">
          {d.recentTransactions.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between py-2 border-b border-card-border last:border-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-bg flex items-center justify-center">
                  <CategoryIcon icon={tx.icon} size={18} className="text-text-secondary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{tx.description}</p>
                  <p className="text-xs text-text-secondary">{tx.category}</p>
                </div>
              </div>
              <span
                className={`text-sm font-semibold tabular-nums ${
                  tx.amount < 0 ? 'text-error' : 'text-success'
                }`}
              >
                {tx.amount < 0 ? '-' : '+'}₽ {formatRub(Math.abs(tx.amount))}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
