import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  children?: ReactNode;
}

export function SectionHeader({ title, children }: SectionHeaderProps) {
  return (
    <div className="settings-header">
      <h2>{title}</h2>
      {children && <div className="settings-actions">{children}</div>}
    </div>
  );
}
