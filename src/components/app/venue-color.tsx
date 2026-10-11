"use client";

import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { VENUE_COLOR_KEYS, VENUE_COLORS, type VenueColor, venueColor } from "@/lib/venue-colors";

/** 会場の色の小さな丸（一覧・詳細で使う） */
export function VenueColorDot({ color, className }: { color: string | null | undefined; className?: string }) {
  const c = venueColor(color);
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/10", className)} style={{ background: c.bar }} />;
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
            className={cn("flex w-11 flex-col items-center gap-1 text-xs", on ? "font-semibold text-foreground" : "text-muted-foreground")}
          >
            <span
              className={cn(
                "grid size-10 place-items-center rounded-full transition-transform motion-safe:active:scale-95",
                on ? "ring-2 ring-foreground ring-offset-2" : "ring-1 ring-black/10",
                !c && "bg-[conic-gradient(#246cc2,#3ea6ce,#7a34a9,#dc719d,#774b22,#246cc2)]",
              )}
              style={c ? { background: c.bar } : undefined}
            >
              {on && (
                <span className="grid size-5 place-items-center rounded-full bg-white shadow-sm">
                  <CheckIcon className="size-3.5 text-foreground" strokeWidth={3} />
                </span>
              )}
            </span>
            {c ? c.label : "おまかせ"}
          </button>
        );
      })}
    </div>
  );
}
