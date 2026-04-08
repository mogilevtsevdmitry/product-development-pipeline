import { Shield } from 'lucide-react';
import { useLocation } from 'react-router-dom';

const titles: Record<string, string> = {
  '/portfolio': 'Портфель',
  '/goals': 'Цели',
  '/news': 'Новости',
  '/settings': 'Настройки',
  '/more': 'Ещё',
};

export function PlaceholderPage() {
  const location = useLocation();
  const title = titles[location.pathname] || 'Страница';

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-20 h-20 rounded-2xl bg-card border border-card-border flex items-center justify-center mb-6">
        <Shield size={36} className="text-primary" />
      </div>
      <h2 className="text-2xl font-bold mb-2">{title}</h2>
      <p className="text-text-secondary max-w-sm">
        Этот раздел появится в следующей версии. Следите за обновлениями!
      </p>
    </div>
  );
}
