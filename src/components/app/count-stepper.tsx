"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { roundCount } from "@/lib/count";
import { cn } from "@/lib/utils";

/**
 * 件数・人数の ＋ / − 入力（数字キーボードでも入れられる。要件 §9-3）。
 * decimal を付けると 0.5 のような小数第2位までの件数も入れられる（2人で取った件数を分けた分。Phase 11）
 */
export function CountStepper({
  value,
  onChange,
  label,
  min = 0,
  max = 999,
  size = "default",
  decimal = false,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  min?: number;
  max?: number;
  size?: "default" | "lg";
  decimal?: boolean;
}) {
  // 小数を打っている途中（「0.」）の文字
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max, Math.max(min, roundCount(n)));
  const btn = cn(
    "grid shrink-0 place-items-center rounded-full border border-input bg-background active:scale-95 disabled:opacity-40",
    size === "lg" ? "size-14" : "size-11",
  );
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={btn} aria-label={`${label}を1減らす`} disabled={value <= min} onClick={() => (setDraft(null), onChange(clamp(value - 1)))}>
        <MinusIcon className="size-5" />
      </button>
      <input
        aria-label={label}
        inputMode={decimal ? "decimal" : "numeric"}
        className={cn("w-14 rounded-md border border-input bg-background text-center font-bold outline-none focus-visible:border-ring", size === "lg" ? "h-14 text-2xl" : "h-11 text-lg")}
        value={draft ?? value}
        onFocus={(e) => e.target.select()}
        onBlur={() => setDraft(null)}
        onChange={(e) => {
          const t = e.target.value.normalize("NFKC");
          if (!decimal) return onChange(clamp(Number(t.replace(/[^0-9]/g, "") || 0)));
          const m = t.replace(/[^0-9.]/g, "").match(/^\d*(\.\d{0,2})?/);
          const text = m?.[0] ?? "";
          setDraft(text);
          onChange(clamp(Number(text || 0)));
        }}
      />
      <button type="button" className={btn} aria-label={`${label}を1増やす`} disabled={value >= max} onClick={() => (setDraft(null), onChange(clamp(value + 1)))}>
        <PlusIcon className="size-5" />
      </button>
    </div>
  );
}
