interface BadgeProps {
  value: string;
  variant: 'success' | 'error' | 'warning' | 'info';
}

const variants = {
  success: 'bg-success/20 text-success',
  error: 'bg-error/20 text-error',
  warning: 'bg-warning/20 text-warning',
  info: 'bg-info/20 text-info',
};

export function Badge({ value, variant }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${variants[variant]}`}
    >
      {value}
    </span>
  );
}
