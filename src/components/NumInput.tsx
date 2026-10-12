import { useEffect, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number | null;
  onCommit: (value: number) => void;
  /** Called instead of committing 0 when the field is emptied (for optional values). */
  onClear?: () => void;
  /** Commit on every keystroke instead of on blur / Enter. */
  live?: boolean;
};

/** Number input that keeps a local draft so clamping doesn't fight typing. */
export function NumInput({ value, onCommit, onClear, live, ...rest }: Props) {
  // Required fields show 0 as blank; optional ones (onClear) distinguish blank from 0.
  const display = (v: number | null) => (v == null || (v === 0 && !onClear) ? '' : String(v));
  const [draft, setDraft] = useState(display(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(display(value));
  }, [value, focused]);

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
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setDraft(e.target.value);
        if (live) commit(e.target.value);
      }}
      onBlur={() => {
        setFocused(false);
        commit(draft);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
