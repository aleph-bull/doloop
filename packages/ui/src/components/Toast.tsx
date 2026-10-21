import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export interface ToastItem {
  id: number;
  message: ReactNode;
  tone?: 'neutral' | 'ok' | 'warn';
  /** Playing its exit; removed once that has run. */
  leaving?: boolean;
}

interface ToastApi {
  /** Shows a toast. The function it returns takes it away early, for toasts with buttons. */
  toast: (
    message: ReactNode,
    opts?: { tone?: ToastItem['tone']; durationMs?: number },
  ) => () => void;
}

/** How long the exit animation is given before the toast is taken out of the list. */
const LEAVE_MS = 260;

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  // It fades for a moment, then goes. Leaving twice (closed early, then timed out) is harmless.
  const leave = useCallback((id: number) => {
    setItems((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    window.setTimeout(() => {
      setItems((list) => list.filter((t) => t.id !== id));
    }, LEAVE_MS);
  }, []);

  const toast = useCallback<ToastApi['toast']>(
    (message, opts) => {
      const id = ++seq.current;
      setItems((list) => [...list, { id, message, tone: opts?.tone ?? 'neutral' }]);
      const shownFor = Math.max(LEAVE_MS, opts?.durationMs ?? 3500);
      window.setTimeout(() => leave(id), shownFor - LEAVE_MS);
      return () => leave(id);
    },
    [leave],
  );

  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`glass glass-strong toast${t.leaving ? ' is-leaving' : ''}`}>
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
