import { useState } from 'react';
import { Search, Download } from 'lucide-react';
import { Card } from '../components/Card';
import { CategoryIcon } from '../components/CategoryIcon';
import { formatRub, formatDate } from '../lib/format';
import { transactionsData } from '../lib/mockData';

const filterChips = ['Апрель 2026', 'Все категории', 'Все счета'];

export function TransactionsPage() {
  const [search, setSearch] = useState('');
  const [activeChip, setActiveChip] = useState(0);

  const filtered = transactionsData.filter(
    (tx) =>
      tx.description.toLowerCase().includes(search.toLowerCase()) ||
      tx.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <h2 className="text-2xl font-bold">Транзакции</h2>
        <button className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-bg font-semibold py-2.5 px-5 rounded-lg text-sm transition-colors cursor-pointer">
          <Download size={16} />
          Экспорт CSV
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
        <input
          type="text"
          placeholder="Поиск по описанию..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-card border border-card-border rounded-lg py-3 pl-10 pr-4 text-sm text-text placeholder:text-text-secondary focus:outline-none focus:border-primary transition-colors"
        />
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-text-secondary">Фильтры:</span>
        {filterChips.map((chip, i) => (
          <button
            key={chip}
            onClick={() => setActiveChip(i)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer ${
              i === activeChip
                ? 'bg-primary/20 text-primary border border-primary/30'
                : 'bg-card border border-card-border text-text-secondary hover:text-text'
            }`}
          >
            {chip}
          </button>
        ))}
      </div>

      {/* Table */}
      <Card padding="sm">
        {/* Desktop table */}
        <div className="hidden sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-text-secondary">
                <th className="text-left py-3 px-4 font-medium">Дата</th>
                <th className="text-left py-3 px-4 font-medium">Описание</th>
                <th className="text-left py-3 px-4 font-medium">Категория</th>
                <th className="text-right py-3 px-4 font-medium">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx, i) => (
                <tr
                  key={tx.id}
                  className={`border-b border-card-border last:border-0 hover:bg-card-hover transition-colors ${
                    i % 2 === 0 ? '' : 'bg-bg/30'
                  }`}
                >
                  <td className="py-3 px-4 text-text-secondary tabular-nums">
                    {formatDate(tx.date)}
                  </td>
                  <td className="py-3 px-4">{tx.description}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <CategoryIcon icon={tx.icon} size={16} className="text-text-secondary" />
                      <span>{tx.category}</span>
                    </div>
                  </td>
                  <td
                    className={`py-3 px-4 text-right font-semibold tabular-nums ${
                      tx.amount < 0 ? 'text-error' : 'text-success'
                    }`}
                  >
                    {tx.amount < 0 ? '-' : '+'}₽ {formatRub(Math.abs(tx.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="sm:hidden space-y-2 p-2">
          {filtered.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between py-3 px-3 rounded-lg bg-bg/30"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-bg flex items-center justify-center">
                  <CategoryIcon icon={tx.icon} size={18} className="text-text-secondary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{tx.description}</p>
                  <p className="text-xs text-text-secondary">
                    {tx.category} &middot; {formatDate(tx.date)}
                  </p>
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
