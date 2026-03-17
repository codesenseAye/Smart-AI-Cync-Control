import { useState, type ReactNode } from "react";

interface IconButtonProps {
  title: string;
  onClick: () => void | Promise<void>;
  children: ReactNode;
  refreshable?: boolean;
}

export function IconButton({ title, onClick, children, refreshable }: IconButtonProps) {
  const [refreshing, setRefreshing] = useState(false);

  const handleClick = async () => {
    if (refreshable) {
      if (refreshing) return;
      setRefreshing(true);
      try {
        await onClick();
      } finally {
        setTimeout(() => setRefreshing(false), 400);
      }
    } else {
      onClick();
    }
  };

  return (
    <button
      className={`icon-btn${refreshing ? " refreshing" : ""}`}
      title={title}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}
