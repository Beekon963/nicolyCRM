"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** 件数・人数の ＋ / − 入力（数字キーボードでも入れられる。要件 §9-3） */
export function CountStepper({
  value,
  onChange,
  label,
  min = 0,
  max = 999,
  size = "default",
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  min?: number;
  max?: number;
  size?: "default" | "lg";
}) {
  const btn = cn(
    "grid shrink-0 place-items-center rounded-full border border-input bg-background active:scale-95 disabled:opacity-40",
    size === "lg" ? "size-14" : "size-11",
  );
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={btn} aria-label={`${label}を1減らす`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <MinusIcon className="size-5" />
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        className={cn("w-14 rounded-md border border-input bg-background text-center font-bold outline-none focus-visible:border-ring", size === "lg" ? "h-14 text-2xl" : "h-11 text-lg")}
        value={value}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/[^0-9]/g, "") || 0);
          onChange(Math.min(max, Math.max(min, n)));
        }}
      />
      <button type="button" className={btn} aria-label={`${label}を1増やす`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <PlusIcon className="size-5" />
      </button>
    </div>
  );
}
