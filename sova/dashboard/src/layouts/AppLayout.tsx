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

export function AppLayout() {
  const navigate = useNavigate();
  const user = getUser();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0D1117', display: 'flex' }}>
      {/* Desktop Sidebar - hidden on mobile via CSS */}
      <aside className="hidden lg:flex" style={{
        flexDirection: 'column', width: '240px', borderRight: '1px solid #30363D',
        padding: '16px', position: 'fixed', height: '100vh', backgroundColor: '#0D1117',
      }}>
        <div style={{ marginBottom: '32px', padding: '0 8px' }}>
          <SovaLogo size="sm" />
        </div>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '10px 12px', borderRadius: '8px', fontSize: '14px',
                fontWeight: 500, textDecoration: 'none', transition: 'all 0.15s',
                backgroundColor: isActive ? 'rgba(245,166,35,0.15)' : 'transparent',
                color: isActive ? '#F5A623' : '#8B949E',
              })}
            >
              <item.icon size={20} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* AI Balance widget */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ backgroundColor: '#1C2333', border: '1px solid #30363D', borderRadius: '12px', padding: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <Wallet size={16} color="#F5A623" />
              <span style={{ fontSize: '12px', color: '#8B949E' }}>AI-баланс</span>
            </div>
            <p style={{ fontSize: '14px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>42.50 ₽</p>
            <button style={{
              marginTop: '8px', width: '100%', fontSize: '12px',
              backgroundColor: 'rgba(245,166,35,0.15)', color: '#F5A623',
              padding: '6px', borderRadius: '6px', border: 'none', cursor: 'pointer',
            }}>
              Пополнить
            </button>
          </div>

          {/* User */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: '50%',
              backgroundColor: 'rgba(245,166,35,0.2)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              color: '#F5A623', fontSize: '14px', fontWeight: 600,
            }}>
              {user?.first_name?.[0] || 'U'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '14px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.first_name} {user?.last_name}
              </p>
            </div>
            <button
              onClick={handleLogout}
              style={{ background: 'none', border: 'none', color: '#8B949E', cursor: 'pointer', padding: '4px' }}
              title="Выйти"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, paddingBottom: '80px' }} className="lg:ml-60 lg:pb-6">
        {/* Mobile header */}
        <header className="lg:hidden" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 16px', borderBottom: '1px solid #30363D',
          position: 'sticky', top: 0, backgroundColor: '#0D1117', zIndex: 10,
          height: '56px',
        }}>
          <SovaLogo size="sm" />
          <div style={{
            width: '32px', height: '32px', borderRadius: '50%',
            backgroundColor: 'rgba(245,166,35,0.2)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: '#F5A623', fontSize: '14px', fontWeight: 600,
          }}>
            {user?.first_name?.[0] || 'U'}
          </div>
        </header>

        <div style={{ padding: '20px 16px', maxWidth: '1152px' }} className="lg:p-8">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
        backgroundColor: '#1C2333', borderTop: '1px solid #30363D',
        display: 'flex', justifyContent: 'space-around', alignItems: 'center',
        height: '64px', paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}>
        {mobileNav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            style={({ isActive }) => ({
              display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
              justifyContent: 'center', gap: '2px', minWidth: '56px',
              padding: '6px 0', fontSize: '10px', fontWeight: 500,
              textDecoration: 'none', transition: 'color 0.15s',
              color: isActive ? '#F5A623' : '#8B949E',
            })}
          >
            <item.icon size={22} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
