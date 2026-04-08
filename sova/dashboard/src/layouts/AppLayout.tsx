import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ArrowLeftRight, BarChart3, Briefcase,
  Target, Newspaper, Settings, Wallet, MoreHorizontal, LogOut,
} from 'lucide-react';
import { SovaLogo } from '../components/SovaLogo';
import { getUser, logout } from '../lib/auth';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Главная' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Транзакции' },
  { to: '/analytics', icon: BarChart3, label: 'Аналитика' },
  { to: '/portfolio', icon: Briefcase, label: 'Портфель' },
  { to: '/goals', icon: Target, label: 'Цели' },
  { to: '/news', icon: Newspaper, label: 'Новости' },
  { to: '/settings', icon: Settings, label: 'Настройки' },
];

const mobileNav = [
  { to: '/', icon: LayoutDashboard, label: 'Главная' },
  { to: '/analytics', icon: BarChart3, label: 'Аналитика' },
  { to: '/portfolio', icon: Briefcase, label: 'Портфель' },
  { to: '/news', icon: Newspaper, label: 'Новости' },
  { to: '/more', icon: MoreHorizontal, label: 'Ещё' },
];

function NavItem({ to, icon: Icon, label }: { to: string; icon: any; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
          isActive
            ? 'bg-primary/15 text-primary'
            : 'text-text-secondary hover:text-text hover:bg-card-hover'
        }`
      }
    >
      <Icon size={20} />
      <span>{label}</span>
    </NavLink>
  );
}

export function AppLayout() {
  const navigate = useNavigate();
  const user = getUser();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-bg flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-60 border-r border-card-border p-4 fixed h-screen">
        <div className="mb-8 px-2">
          <SovaLogo size="sm" />
        </div>

        <nav className="flex-1 space-y-1">
          {navItems.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>

        {/* AI Balance widget */}
        <div className="mt-auto space-y-3">
          <div className="bg-card border border-card-border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Wallet size={16} className="text-primary" />
              <span className="text-xs text-text-secondary">AI-баланс</span>
            </div>
            <p className="text-sm font-semibold tabular-nums">42.50 ₽</p>
            <button className="mt-2 w-full text-xs bg-primary/15 text-primary hover:bg-primary/25 py-1.5 rounded-md transition-colors cursor-pointer">
              Пополнить
            </button>
          </div>

          {/* User */}
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-semibold">
              {user?.first_name?.[0] || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {user?.first_name} {user?.last_name}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="text-text-secondary hover:text-error transition-colors cursor-pointer"
              title="Выйти"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 lg:ml-60 pb-20 lg:pb-6">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between p-4 border-b border-card-border sticky top-0 bg-bg z-10">
          <SovaLogo size="sm" />
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-semibold">
              {user?.first_name?.[0] || 'U'}
            </div>
          </div>
        </header>

        <div className="p-4 lg:p-6 max-w-6xl">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-card border-t border-card-border flex justify-around py-2 z-20">
        {mobileNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-2 py-1 text-xs transition-colors ${
                isActive ? 'text-primary' : 'text-text-secondary'
              }`
            }
          >
            <item.icon size={22} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
