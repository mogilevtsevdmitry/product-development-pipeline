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
    <div style={{ backgroundColor: '#1C2333', border: '1px solid #30363D', borderRadius: '8px', padding: '12px' }}>
      <p style={{ color: '#8B949E', marginBottom: '4px', fontSize: '12px' }}>{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color, fontSize: '13px' }}>
          {p.name}: {formatRub(p.value)} ₽
        </p>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const d = overviewData;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Balance Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
        <Card>
          <p style={{ color: '#8B949E', fontSize: '13px', marginBottom: '4px' }}>Общий баланс</p>
          <p style={{ fontSize: '32px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            ₽ {formatRub(d.totalBalance)}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
            <Badge value={formatPercent(d.balanceChange)} variant="success" />
            <span style={{ color: '#8B949E', fontSize: '12px' }}>за 30 дней</span>
          </div>
        </Card>

        <Card>
          <p style={{ color: '#8B949E', fontSize: '13px', marginBottom: '4px' }}>Стоимость портфеля</p>
          <p style={{ fontSize: '32px', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            ₽ {formatRub(d.portfolioValue)}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
            <Badge value={formatPercent(d.portfolioChange)} variant="error" />
            <span style={{ color: '#8B949E', fontSize: '12px' }}>за день</span>
          </div>
        </Card>
      </div>

      {/* Income vs Expense Chart */}
      <Card>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Доходы vs Расходы (30 дней)</h3>
        <div style={{ height: '240px' }}>
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
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '12px' }}>Мои цели</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {d.goals.map((goal) => (
            <Card key={goal.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <p style={{ fontWeight: 500, fontSize: '15px' }}>{goal.name}</p>
                <span style={{ color: '#8B949E', fontSize: '14px', fontVariantNumeric: 'tabular-nums' }}>{goal.percent}%</span>
              </div>
              <ProgressBar percent={goal.percent} color={goal.color} />
              <p style={{ color: '#8B949E', fontSize: '12px', marginTop: '8px', fontVariantNumeric: 'tabular-nums' }}>
                ₽ {formatRub(goal.current)} / ₽ {formatRub(goal.target)}
              </p>
            </Card>
          ))}
        </div>
      </div>

      {/* Recent Transactions */}
      <Card>
        <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Последние транзакции</h3>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {d.recentTransactions.map((tx, i) => (
            <div
              key={tx.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 0',
                borderBottom: i < d.recentTransactions.length - 1 ? '1px solid #30363D' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '10px',
                  backgroundColor: '#0D1117', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <CategoryIcon icon={tx.icon} size={18} className="text-text-secondary" />
                </div>
                <div>
                  <p style={{ fontSize: '14px', fontWeight: 500 }}>{tx.description}</p>
                  <p style={{ fontSize: '12px', color: '#8B949E' }}>{tx.category}</p>
                </div>
              </div>
              <span style={{
                fontSize: '14px', fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                color: tx.amount < 0 ? '#F85149' : '#3FB950'
              }}>
                {tx.amount < 0 ? '-' : '+'}₽ {formatRub(Math.abs(tx.amount))}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
