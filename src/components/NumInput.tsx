import { useEffect, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: number;
  onCommit: (value: number) => void;
  /** Commit on every keystroke instead of on blur / Enter. */
  live?: boolean;
};

/** Number input that keeps a local draft so clamping doesn't fight typing. */
export function NumInput({ value, onCommit, live, ...rest }: Props) {
  const [draft, setDraft] = useState(value ? String(value) : '');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value ? String(value) : '');
  }, [value, focused]);

  const commit = (text: string) => {
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
