"use client";

import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { BoardVenue } from "@/lib/board/view";
import { BOARD_TABS, type BoardTab, type StaffFilter } from "@/lib/board/views";
import { cn } from "@/lib/utils";

/** 上のタブ（日・週・月・表）。スマホは日、PC は週が既定。端末に覚える */
export function BoardTabs({ tab, setTab }: { tab: BoardTab; setTab: (t: BoardTab) => void }) {
  return (
    <div role="tablist" aria-label="稼働表の見せ方" className="mx-4 mb-2 grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
      {BOARD_TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={tab === t.key}
          title={t.help}
          onClick={() => setTab(t.key)}
          className={cn(
            "flex h-11 items-center justify-center rounded-lg text-sm font-semibold transition-colors motion-safe:active:translate-y-px",
            tab === t.key ? "bg-background text-foreground shadow-[0_1px_3px_rgb(16_24_40/0.1),0_1px_2px_rgb(16_24_40/0.06)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const Count = ({ n }: { n: number }) => <span className={cn("min-w-6 rounded-full px-1.5 text-center text-xs leading-5 font-bold tabular-nums", n > 0 ? "bg-status-waiting-solid text-status-waiting-on-solid" : "bg-muted text-muted-foreground")}>{n}</span>;

/** 日・週・月の絞り込み: 現場未定だけ・現場別・名前 */
export function StaffFilterBar({ filter, setFilter, venues, unassigned }: { filter: StaffFilter; setFilter: (f: StaffFilter) => void; venues: BoardVenue[]; unassigned: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-2" role="group" aria-label="絞り込み">
      <button
        type="button"
        aria-pressed={filter.unassignedOnly}
        onClick={() => setFilter({ ...filter, unassignedOnly: !filter.unassignedOnly })}
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition-colors motion-safe:active:translate-y-px",
          filter.unassignedOnly ? "border-status-waiting-solid bg-status-waiting-bg text-status-waiting" : "border-input bg-background text-[#344054] hover:bg-accent",
        )}
      >
        現場未定だけ
        <Count n={unassigned} />
      </button>
      <NativeSelect aria-label="現場で絞る" value={filter.venueId ?? ""} onChange={(e) => setFilter({ ...filter, venueId: e.target.value || null })} className="h-11 w-auto max-w-[12rem]">
        <option value="">すべての現場</option>
        {venues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </NativeSelect>
      <label className="relative ml-auto flex min-w-0 flex-1 items-center sm:max-w-56">
        <SearchIcon aria-hidden className="pointer-events-none absolute left-3 size-4 text-muted-foreground" />
        <Input type="search" aria-label="名前で探す" placeholder="名前で探す" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} className="h-11 pl-9" />
      </label>
    </div>
  );
}
