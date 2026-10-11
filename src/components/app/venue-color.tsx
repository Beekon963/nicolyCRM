"use client";

import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { VENUE_COLOR_KEYS, VENUE_COLORS, type VenueColor, venueColor } from "@/lib/venue-colors";

/** 会場の色の小さな丸（一覧・詳細で使う） */
export function VenueColorDot({ color, className }: { color: string | null | undefined; className?: string }) {
  const c = venueColor(color);
  return <span aria-hidden className={cn("inline-block size-3.5 shrink-0 rounded-full ring-1 ring-black/10", className)} style={{ background: c.bg }} />;
}

/**
 * 会場の色を選ぶ（丸いボタンを並べる）。auto を渡すと先頭に「おまかせ」を出す（新しい会場用。空いている色が自動で付く）
 */
export function VenueColorPicker({ value, onChange, auto }: { value: VenueColor | ""; onChange: (v: VenueColor | "") => void; auto?: boolean }) {
  const options: (VenueColor | "")[] = auto ? ["", ...VENUE_COLOR_KEYS] : VENUE_COLOR_KEYS;
  return (
    <div role="radiogroup" aria-label="会場の色" className="flex flex-wrap gap-x-1 gap-y-2">
      {options.map((k) => {
        const on = value === k;
        const c = k ? VENUE_COLORS[k] : null;
        return (
          <button
            key={k || "auto"}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={c ? c.label : "おまかせ"}
            onClick={() => onChange(k)}
            className="flex w-11 flex-col items-center gap-0.5 text-xs text-muted-foreground"
          >
            <span
              className={cn(
                "grid size-11 place-items-center rounded-full border-b-4 transition-transform active:translate-y-0.5",
                on ? "ring-2 ring-foreground ring-offset-2" : "ring-1 ring-black/10",
                !c && "border-slate-300 bg-[conic-gradient(#2563eb,#38bdf8,#9333ea,#f472b6,#78350f,#2563eb)]",
              )}
              style={c ? { background: c.bg, borderColor: c.edge, color: c.fg } : undefined}
            >
              {on && <CheckIcon className={cn("size-5", !c && "rounded-full bg-white text-foreground")} strokeWidth={3} />}
            </span>
            {c ? c.label : "おまかせ"}
          </button>
        );
      })}
    </div>
  );
}
