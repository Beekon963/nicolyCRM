"use client";

import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** 複数選択のチップ（役割・エリアなど）。タップで付け外し */
export function ChipSelect({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: string; name: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.id) : [...value, o.id])}
            className={cn(
              "inline-flex h-11 items-center gap-1 rounded-full border px-4 text-base",
              on ? "border-primary bg-primary/10 font-medium text-primary" : "border-input text-muted-foreground",
            )}
          >
            {on && <CheckIcon className="size-4" />}
            {o.name}
          </button>
        );
      })}
    </div>
  );
}
