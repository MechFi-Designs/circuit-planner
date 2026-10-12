import { useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number | null;
  onCommit: (value: number) => void;
  /** Called instead of committing 0 when the field is emptied (for optional values). */
  onClear?: () => void;
  /** Commit on every keystroke instead of on blur / Enter. */
  live?: boolean;
};

/**
 * Number input that keeps a local draft only while it's being edited, so
 * clamping doesn't fight typing. Otherwise it always shows the current value.
 */
export function NumInput({ value, onCommit, onClear, live, ...rest }: Props) {
  // Required fields show 0 as blank; optional ones (onClear) distinguish blank from 0.
  const display = (v: number | null) => (v == null || (v === 0 && !onClear) ? '' : String(v));
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string) => {
    if (text.trim() === '' && onClear) return onClear();
    const n = text.trim() === '' ? 0 : Number(text);
    if (Number.isFinite(n)) onCommit(n);
  };

  return (
    <input
      type="number"
      inputMode="decimal"
      {...rest}
      value={draft ?? display(value)}
      onFocus={() => setDraft(display(value))}
      onChange={(e) => {
        setDraft(e.target.value);
        if (live) commit(e.target.value);
      }}
      onBlur={() => {
        if (draft != null) commit(draft);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
