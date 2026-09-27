import { normalizeScannedCode } from '@petflow/contracts';
import { ScanBarcode, Volume2, VolumeX } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

/**
 * Leitura de codigo de barras -- componente reutilizavel.
 *
 * Fontes suportadas hoje: leitores USB/Bluetooth em modo TECLADO (HID) e
 * digitacao manual. O leitor "digita" o codigo muito rapido e manda Enter (ou
 * Tab); nenhum SDK ou fabricante especifico. A leitura rapida e distinguida da
 * digitacao pelo intervalo entre teclas, e informada em `source`.
 *
 * Preparado para novas fontes (camera do celular, equipamentos especificos):
 * qualquer fonte so precisa chamar `onScan(codigo, fonte)`.
 */

export type BarcodeSource = 'scanner' | 'keyboard' | 'camera';
export type ScanFeedback = 'idle' | 'found' | 'not-found' | 'error';

/** `at` muda a cada leitura: dois "encontrado" seguidos tocam dois bips. */
export interface ScanFeedbackState {
  kind: ScanFeedback;
  at: number;
}

export interface BarcodeScannerInputHandle {
  focus: () => void;
}

/** Media abaixo disso (ms entre teclas) = leitor, nao pessoa digitando. */
const SCANNER_KEY_INTERVAL_MS = 35;
const SOUND_STORAGE_KEY = 'petflow:scanner-sound';

function readSoundPreference(): boolean {
  try {
    return localStorage.getItem(SOUND_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

let audioContext: AudioContext | null = null;

/** Bip curto via Web Audio (sem arquivo). Falha silenciosa se o navegador bloquear. */
function beep(kind: 'ok' | 'warn'): void {
  try {
    audioContext ??= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.frequency.value = kind === 'ok' ? 1320 : 330;
    gain.gain.value = 0.06;
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + (kind === 'ok' ? 0.08 : 0.22));
  } catch {
    // Sem audio: o feedback visual continua.
  }
}

function isEditable(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (element as HTMLElement).isContentEditable;
}

export const BarcodeScannerInput = forwardRef<
  BarcodeScannerInputHandle,
  {
    onScan: (code: string, source: BarcodeSource) => void;
    /** Resultado da ultima leitura -- muda a cor e o som. */
    feedback?: ScanFeedbackState;
    busy?: boolean;
    disabled?: boolean;
    label?: string;
    /**
     * Captura o leitor mesmo com o foco fora de qualquer campo (ex.: depois de
     * clicar num botao). Nunca interfere quando outro campo esta em edicao.
     */
    captureWhenUnfocused?: boolean;
    className?: string;
  }
>(function BarcodeScannerInput(
  { onScan, feedback, busy = false, disabled = false, label = 'Bipar ou digitar código de barras', captureWhenUnfocused = true, className },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [sound, setSound] = useState(readSoundPreference);
  const keyTimes = useRef<number[]>([]);

  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }), []);

  const emit = useCallback(
    (raw: string, times: number[]) => {
      const code = normalizeScannedCode(raw);
      if (!code) return;
      const intervals = times.slice(1).map((time, index) => time - (times[index] ?? time));
      const average = intervals.length ? intervals.reduce((sum, item) => sum + item, 0) / intervals.length : Infinity;
      onScan(code, code.length >= 4 && average < SCANNER_KEY_INTERVAL_MS ? 'scanner' : 'keyboard');
    },
    [onScan],
  );

  function submit(): void {
    emit(value, keyTimes.current);
    setValue('');
    keyTimes.current = [];
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' || (event.key === 'Tab' && value.trim())) {
      event.preventDefault();
      submit();
      return;
    }
    if (event.key.length === 1) keyTimes.current.push(performance.now());
  }

  // Leitor com o foco "perdido": teclas rapidas terminadas em Enter, fora de
  // campos editaveis, viram uma leitura e devolvem o foco ao campo.
  useEffect(() => {
    if (!captureWhenUnfocused || disabled) return;
    let buffer = '';
    let times: number[] = [];
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditable(document.activeElement)) return;
      const now = performance.now();
      if (times.length && now - (times[times.length - 1] ?? now) > 100) {
        buffer = '';
        times = [];
      }
      if (event.key === 'Enter') {
        if (buffer.length >= 4) {
          event.preventDefault();
          emit(buffer, times);
          inputRef.current?.focus();
        }
        buffer = '';
        times = [];
        return;
      }
      if (event.key.length === 1) {
        buffer += event.key;
        times.push(now);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [captureWhenUnfocused, disabled, emit]);

  const kind = feedback?.kind ?? 'idle';
  useEffect(() => {
    if (!sound || !feedback || feedback.kind === 'idle') return;
    beep(feedback.kind === 'found' ? 'ok' : 'warn');
    // So a nova leitura (feedback.at) toca; ligar o som nao repete o ultimo bip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedback?.at]);

  function toggleSound(): void {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem(SOUND_STORAGE_KEY, next ? 'on' : 'off');
    } catch {
      // Preferencia nao persiste; tudo bem.
    }
    if (next) beep('ok');
  }

  const tone =
    kind === 'found'
      ? 'border-[var(--color-success)]'
      : kind === 'not-found' || kind === 'error'
        ? 'border-[var(--color-warning)]'
        : focused
          ? 'border-[var(--color-brand)]'
          : 'border-[var(--color-border-strong)]';

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="barcode-scanner-input" className="text-[0.8125rem] font-medium">
          {label}
        </label>
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={sound}
          className="flex items-center gap-1 rounded-full px-2 py-1 text-[0.75rem] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)]"
        >
          {sound ? <Volume2 aria-hidden className="size-3.5" /> : <VolumeX aria-hidden className="size-3.5" />}
          {sound ? 'Som ligado' : 'Som desligado'}
        </button>
      </div>
      <div
        className={cn(
          'flex items-center gap-3 rounded-[var(--radius-lg)] border-2 bg-[var(--color-surface)] px-4 transition-colors',
          tone,
          focused && 'shadow-[0_0_0_4px_var(--color-brand-subtle)]',
        )}
      >
        <ScanBarcode aria-hidden className={cn('size-6 shrink-0', focused ? 'text-[var(--color-brand)]' : 'text-[var(--color-text-subtle)]')} />
        <input
          ref={inputRef}
          id="barcode-scanner-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          disabled={disabled}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="Aguardando leitura…"
          aria-describedby="barcode-scanner-hint"
          className="tabular min-w-0 flex-1 bg-transparent py-4 text-lg font-semibold tracking-wide outline-none placeholder:font-normal placeholder:text-[var(--color-text-subtle)]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !value.trim()}
          className="shrink-0 rounded-[var(--radius-md)] bg-[var(--color-brand)] px-3.5 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Buscando…' : 'OK'}
        </button>
      </div>
      <p id="barcode-scanner-hint" className="flex items-center gap-1.5 text-[0.75rem] text-[var(--color-text-muted)]" aria-live="polite">
        <span aria-hidden className={cn('size-2 rounded-full', focused || captureWhenUnfocused ? 'bg-[var(--color-success)]' : 'bg-[var(--color-text-subtle)]')} />
        {busy
          ? 'Buscando o código…'
          : focused
            ? 'Pronto para o leitor. Cada bip soma 1.'
            : captureWhenUnfocused
              ? 'Leitor ativo: pode bipar a qualquer momento.'
              : 'Clique no campo para usar o leitor.'}
      </p>
    </div>
  );
});
