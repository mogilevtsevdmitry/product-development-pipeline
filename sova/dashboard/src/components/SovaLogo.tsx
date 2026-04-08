import { Shield } from 'lucide-react';

interface SovaLogoProps {
  size?: 'sm' | 'md' | 'lg';
}

const sizes = {
  sm: { icon: 20, text: 'text-lg' },
  md: { icon: 28, text: 'text-2xl' },
  lg: { icon: 40, text: 'text-4xl' },
};

export function SovaLogo({ size = 'md' }: SovaLogoProps) {
  const s = sizes[size];
  return (
    <div className="flex items-center gap-2">
      <Shield size={s.icon} className="text-primary" fill="currentColor" />
      <span className={`${s.text} font-bold text-text`}>Сова</span>
    </div>
  );
}
