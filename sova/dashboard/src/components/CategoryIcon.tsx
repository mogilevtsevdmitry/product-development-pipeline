import {
  Coffee, Banknote, TrainFront, Tv, ArrowDownLeft,
  ShoppingCart, HeartPulse, Utensils, Monitor, Navigation,
  Home, Briefcase, Gamepad2, GraduationCap, Fuel,
  type LucideIcon,
} from 'lucide-react';

const iconMap: Record<string, LucideIcon> = {
  'coffee': Coffee,
  'banknote': Banknote,
  'train-front': TrainFront,
  'tv': Tv,
  'arrow-down-left': ArrowDownLeft,
  'shopping-cart': ShoppingCart,
  'heart-pulse': HeartPulse,
  'utensils': Utensils,
  'monitor': Monitor,
  'navigation': Navigation,
  'home': Home,
  'briefcase': Briefcase,
  'gamepad-2': Gamepad2,
  'graduation-cap': GraduationCap,
  'fuel': Fuel,
};

interface CategoryIconProps {
  icon: string;
  size?: number;
  className?: string;
}

export function CategoryIcon({ icon, size = 18, className = '' }: CategoryIconProps) {
  const Icon = iconMap[icon] || Coffee;
  return <Icon size={size} className={className} />;
}
