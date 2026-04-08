import { useState } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card } from '../components/Card';
import { formatRub } from '../lib/format';
import { analyticsData } from '../lib/mockData';

const periods = ['Месяц', 'Квартал', 'Год'];

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  return (
    <div className="bg-card border border-card-border rounded-lg p-3 text-sm shadow-lg">
      <p className="font-medium">{d.name}</p>
      <p style={{ color: d.payload?.color || d.color }}>₽ {formatRub(d.value)}</p>
    </div>
  );
}

function StackedTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-card-border rounded-lg p-3 text-sm shadow-lg">
      <p className="text-text-secondary mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: ₽ {formatRub(p.value)}
        </p>
      ))}
    </div>
  );
}

function ExpenseCalendar() {
  const { calendarData } = analyticsData;
  const maxAmount = Math.max(...calendarData.map((d) => d.amount));

  return (
    <div className="grid grid-cols-7 gap-1.5">
      {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => (
        <div key={day} className="text-center text-xs text-text-secondary pb-1">
          {day}
        </div>
      ))}
      {/* Offset for April 2026 starting on Wednesday */}
      {[null, null].map((_, i) => (
        <div key={`empty-${i}`} />
      ))}
      {calendarData.map((d, i) => {
        const intensity = d.amount / maxAmount;
        const opacity = 0.15 + intensity * 0.85;
        return (
          <div
            key={i}
            className="aspect-square rounded-sm flex items-center justify-center text-xs tabular-nums"
            style={{ backgroundColor: `rgba(245, 166, 35, ${opacity})` }}
            title={`${d.date}: ₽${formatRub(d.amount)}`}
          >
            {i + 1}
          </div>
        );
      })}
    </div>
  );
}

export function AnalyticsPage() {
  const [period, setPeriod] = useState(0);
  const { categoryBreakdown, categoryTrends, anomalies } = analyticsData;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h2 className="text-2xl font-bold">Аналитика</h2>
        <div className="flex bg-card border border-card-border rounded-lg overflow-hidden">
          {periods.map((p, i) => (
            <button
              key={p}
              onClick={() => setPeriod(i)}
              className={`px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                i === period
                  ? 'bg-primary text-bg'
                  : 'text-text-secondary hover:text-text'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Category breakdown + Top categories */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="text-lg font-semibold mb-4">Расходы по категориям</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryBreakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                  animationBegin={0}
                  animationDuration={800}
                >
                  {categoryBreakdown.map((entry, i) => (
                    <Cell key={i} fill={entry.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-semibold mb-4">Топ категорий</h3>
          <div className="space-y-4">
            {categoryBreakdown.slice(0, 5).map((cat) => (
              <div key={cat.name} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="text-sm">{cat.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold tabular-nums">
                    ₽ {formatRub(cat.value)}
                  </span>
                  <span className="text-xs text-text-secondary tabular-nums w-8 text-right">
                    {cat.percent}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Trends + Calendar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <h3 className="text-lg font-semibold mb-4">Тренд по категориям</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryTrends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#30363D" vertical={false} />
                <XAxis dataKey="month" stroke="#8B949E" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#8B949E" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `${v / 1000}k`} />
                <Tooltip content={<StackedTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                <Bar dataKey="food" name="Питание" stackId="a" fill="#F5A623" />
                <Bar dataKey="housing" name="Жилище" stackId="a" fill="#58A6FF" />
                <Bar dataKey="transport" name="Транспорт" stackId="a" fill="#3FB950" />
                <Bar dataKey="other" name="Другое" stackId="a" fill="#8B949E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-semibold mb-4">Календарь расходов</h3>
          <ExpenseCalendar />
        </Card>
      </div>

      {/* Anomalies */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Аномалии и рекомендации</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {anomalies.map((a) => (
            <div
              key={a.id}
              className={`flex items-start gap-3 p-4 rounded-xl border ${
                a.type === 'warning'
                  ? 'bg-error/10 border-error/30'
                  : 'bg-success/10 border-success/30'
              }`}
            >
              {a.type === 'warning' ? (
                <AlertCircle size={20} className="text-error mt-0.5 shrink-0" />
              ) : (
                <CheckCircle2 size={20} className="text-success mt-0.5 shrink-0" />
              )}
              <div>
                <p className="font-medium text-sm">{a.title}</p>
                <p className="text-text-secondary text-xs mt-0.5">{a.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
