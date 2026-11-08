"use client";

import { AlertTriangleIcon } from "lucide-react";
import { type BoardFilters } from "@/lib/board/view";
import { cn } from "@/lib/utils";

/** 絞り込みの切りかえボタン（押すと色が付く。件数つき） */
function Toggle({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors motion-safe:active:translate-y-px",
        on ? "border-primary bg-brand-50 text-primary" : "border-input bg-background text-[#344054] hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

const Count = ({ n, tone }: { n: number; tone: "alert" | "done" | "muted" }) => (
  <span
    className={cn(
      "min-w-6 rounded-full px-1.5 text-center text-xs leading-5 font-bold tabular-nums",
      tone === "alert" && (n > 0 ? "bg-status-alert-solid text-white" : "bg-muted text-muted-foreground"),
      tone === "done" && (n > 0 ? "bg-status-done-solid text-white" : "bg-muted text-muted-foreground"),
      tone === "muted" && "bg-muted text-[#344054]",
    )}
  >
    {n}
  </span>
);

/**
 * 今までの月の表（「表」タブ）の絞り込み（Phase 10）: 欠員の現場だけ・○で空いている人だけ・今日から。
 * 日ごとのリストは日ビュー（`src/components/app/board/day-view.tsx`。Phase 22-3）に置きかえた
 */
export function BoardFilterBar({ filters, setFilters, counts }: { filters: BoardFilters; setFilters: (f: BoardFilters) => void; counts: { shortage: number; free: number; past: number } }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-2" role="group" aria-label="絞り込み">
      <Toggle on={filters.shortageOnly} label={`欠員の現場だけ ${counts.shortage}件`} onClick={() => setFilters({ ...filters, shortageOnly: !filters.shortageOnly })}>
        <AlertTriangleIcon aria-hidden className="size-4 text-status-alert" />
        {/* スマホは短く（ボタンが1〜2行に収まるように） */}
        <span className="max-md:hidden">欠員の現場だけ</span>
        <span className="md:hidden">欠員だけ</span>
        <Count n={counts.shortage} tone="alert" />
      </Toggle>
      <Toggle on={filters.freeOnly} label={`○で空いている人だけ ${counts.free}人`} onClick={() => setFilters({ ...filters, freeOnly: !filters.freeOnly })}>
        <b aria-hidden className="text-base leading-none text-status-done">○</b>
        <span className="max-md:hidden">で空いている人だけ</span>
        <span className="md:hidden">の人だけ</span>
        <Count n={counts.free} tone="done" />
      </Toggle>
      {counts.past > 0 && (
        <Toggle on={filters.fromToday} label={`今日から（過ぎた${counts.past}日を隠す）`} onClick={() => setFilters({ ...filters, fromToday: !filters.fromToday })}>
          今日から
          <span className="text-xs font-normal text-muted-foreground max-md:hidden">（過ぎた{counts.past}日を隠す）</span>
        </Toggle>
      )}
    </div>
  );
}
