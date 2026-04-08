interface ProgressBarProps {
  percent: number;
  color?: string;
}

export function ProgressBar({ percent, color = '#F5A623' }: ProgressBarProps) {
  return (
    <div className="w-full h-2 bg-bg rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }}
      />
    </div>
  );
}
