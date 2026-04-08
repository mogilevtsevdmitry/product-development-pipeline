import { type ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg';
}

const paddingValues = {
  sm: '16px',
  md: '20px',
  lg: '24px',
};

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  return (
    <div
      className={className}
      style={{
        backgroundColor: '#1C2333',
        border: '1px solid #30363D',
        borderRadius: '16px',
        padding: paddingValues[padding],
      }}
    >
      {children}
    </div>
  );
}
