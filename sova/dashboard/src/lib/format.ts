const currencyFormatter = new Intl.NumberFormat('ru-RU', {
  style: 'decimal',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatCurrency(value: number): string {
  const formatted = currencyFormatter.format(Math.abs(value));
  const sign = value < 0 ? '-' : value > 0 ? '+' : '';
  return `${sign}${formatted}`;
}

export function formatRub(value: number): string {
  const formatted = currencyFormatter.format(Math.abs(value));
  return `${formatted}`;
}

export function formatRubSigned(value: number): string {
  const formatted = currencyFormatter.format(Math.abs(value));
  const sign = value < 0 ? '-' : '+';
  return `${sign}\u20BD ${formatted}`;
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function formatShortCurrency(value: number): string {
  if (value >= 1000) {
    return `${Math.round(value / 1000)}k`;
  }
  return String(value);
}
