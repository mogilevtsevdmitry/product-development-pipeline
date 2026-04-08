import { useNavigate } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { SovaLogo } from '../components/SovaLogo';
import { mockLogin } from '../lib/auth';

export function LoginPage() {
  const navigate = useNavigate();

  const handleLogin = () => {
    mockLogin();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
      <div className="flex flex-col items-center gap-6 w-full max-w-sm">
        <SovaLogo size="lg" />

        <p className="text-text-secondary text-base text-center">
          Персональный AI-финансовый аналитик
        </p>

        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-3 bg-primary hover:bg-primary-hover text-bg font-semibold py-4 px-6 rounded-xl text-lg transition-colors cursor-pointer"
        >
          <MessageCircle size={22} />
          Войти через Telegram
        </button>

        <div className="flex gap-6 mt-4">
          <a href="#" className="text-info text-sm hover:underline">
            Политика конфиденциальности
          </a>
          <a href="#" className="text-info text-sm hover:underline">
            Условия использования
          </a>
        </div>
      </div>
    </div>
  );
}
