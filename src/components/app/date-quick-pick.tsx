"use client";

import { addDays, todayJst } from "@/lib/date";
import { cn } from "@/lib/utils";

/** 日付のワンタップ候補（要件 §9-3） */
export function DateQuickPick({
  value,
  onChange,
  options = [
    { label: "明日", days: 1 },
    { label: "3日後", days: 3 },
    { label: "1週間後", days: 7 },
  ],
}: {
  value: string;
  onChange: (v: string) => void;
  options?: { label: string; days: number }[];
}) {
  const today = todayJst();
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const d = addDays(today, o.days);
        return (
          <button
            key={o.label}
            type="button"
            onClick={() => onChange(d)}
            className={cn(
              "h-11 rounded-full border px-4 text-base",
              value === d ? "border-primary bg-primary/10 font-medium text-primary" : "border-input text-muted-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
