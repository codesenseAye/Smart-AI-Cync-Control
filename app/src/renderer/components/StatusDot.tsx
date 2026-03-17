interface StatusDotProps {
  status: string;
}

export function StatusDot({ status }: StatusDotProps) {
  return <span className={`status-dot ${status}`} />;
}
