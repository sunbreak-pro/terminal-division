import React, { useEffect, useState, useCallback } from "react";
import { useCurrentTheme, useThemeConfig } from "../../stores/themeStore";

type Listener = (message: string) => void;

const listeners = new Set<Listener>();

export function showErrorToast(message: string): void {
  for (const listener of listeners) listener(message);
}

interface ToastEntry {
  id: number;
  message: string;
}

let nextId = 1;

export const ErrorToastHost: React.FC = () => {
  const theme = useCurrentTheme();
  const config = useThemeConfig();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const listener: Listener = (message) => {
      const id = nextId++;
      setToasts((prev) => [...prev, { id, message }]);
      setTimeout(() => dismiss(id), 4000);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [dismiss]);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        zIndex: 10000,
        pointerEvents: "none",
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            backgroundColor: theme.colors.headerBackground,
            color: theme.colors.text,
            border: `1px solid ${theme.colors.danger}`,
            borderRadius: config.borderRadius,
            padding: `${config.spacing.sm} ${config.spacing.md}`,
            fontSize: 12,
            maxWidth: 360,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            pointerEvents: "auto",
            cursor: "pointer",
          }}
          onClick={() => dismiss(toast.id)}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
};
