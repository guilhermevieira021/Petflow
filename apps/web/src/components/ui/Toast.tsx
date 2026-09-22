import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';

type ToastTone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_STYLES: Record<ToastTone, { icon: ReactNode; className: string }> = {
  success: {
    icon: <CheckCircle2 aria-hidden className="size-4 shrink-0 text-[var(--color-success)]" />,
    className: 'border-l-[var(--color-success)]',
  },
  error: {
    icon: <XCircle aria-hidden className="size-4 shrink-0 text-[var(--color-danger)]" />,
    className: 'border-l-[var(--color-danger)]',
  },
  info: {
    icon: <Info aria-hidden className="size-4 shrink-0 text-[var(--color-info)]" />,
    className: 'border-l-[var(--color-info)]',
  },
};

const AUTO_DISMISS_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current;
      nextId.current += 1;
      setItems((current) => [...current, { id, tone, message }]);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push('success', message),
      error: (message) => push('error', message),
      info: (message) => push('info', message),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/*
        role="status" + aria-live="polite": o aviso e anunciado por leitores de
        tela sem interromper o que a pessoa esta fazendo.
      */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-2.5',
              'rounded-[var(--radius-md)] border border-l-3 border-[var(--color-border)]',
              'bg-[var(--color-surface)] px-3.5 py-3 shadow-[var(--shadow-lg)]',
              TONE_STYLES[item.tone].className,
            )}
          >
            {TONE_STYLES[item.tone].icon}
            <p className="flex-1 text-[0.8125rem] leading-snug">{item.message}</p>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label="Fechar aviso"
              className="-m-1 rounded-[var(--radius-xs)] p-1 text-[var(--color-text-subtle)] transition-colors hover:text-[var(--color-text)]"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast precisa estar dentro de <ToastProvider>.');
  }
  return context;
}
