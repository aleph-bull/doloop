import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export interface ToastItem {
  id: number;
  message: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn';
}

interface ToastApi {
  toast: (message: ReactNode, opts?: { tone?: ToastItem['tone']; durationMs?: number }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const toast = useCallback<ToastApi['toast']>((message, opts) => {
    const id = ++seq.current;
    setItems((list) => [...list, { id, message, tone: opts?.tone ?? 'neutral' }]);
    window.setTimeout(() => {
      setItems((list) => list.filter((t) => t.id !== id));
    }, opts?.durationMs ?? 3500);
  }, []);

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="glass glass-strong toast">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
