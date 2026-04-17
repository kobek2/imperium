"use client";

import { useCallback, useState } from "react";
import { countWords } from "@/lib/word-count";

const MIN = 200;

export function SpeechTextareaWithCounter({
  name,
  rows,
  className,
  placeholder,
}: {
  name: string;
  rows: number;
  className: string;
  placeholder?: string;
}) {
  const [words, setWords] = useState(0);
  const onInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    setWords(countWords(e.currentTarget.value));
  }, []);

  const ok = words >= MIN;
  const need = Math.max(0, MIN - words);
  return (
    <div className="grid gap-2">
      <textarea
        name={name}
        rows={rows}
        required
        onPaste={(e) => e.preventDefault()}
        onInput={onInput}
        placeholder={placeholder}
        className={className}
      />
      <div
        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md border border-[var(--psc-border)] bg-[color-mix(in_srgb,var(--psc-border)_22%,white)] px-3 py-2 text-sm shadow-sm dark:bg-[color-mix(in_srgb,var(--psc-border)_35%,black)]"
        aria-live="polite"
      >
        <span className="font-semibold tabular-nums text-[var(--psc-ink)]">
          {words} / {MIN} words
        </span>
        {ok ? (
          <span className="font-medium text-green-800 dark:text-green-400">Ready to submit</span>
        ) : (
          <span className="font-semibold text-red-800 dark:text-red-300">
            Need {need} more {need === 1 ? "word" : "words"}
          </span>
        )}
      </div>
    </div>
  );
}
