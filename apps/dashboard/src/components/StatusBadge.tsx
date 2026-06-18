interface StatusBadgeProps {
  label: string;
  className: string;
}

export function StatusBadge({ label, className }: StatusBadgeProps) {
  return <span className={`badge ${className}`}>{label}</span>;
}
