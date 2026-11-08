import { XIcon } from "lucide-react";
import { chipLabel } from "@/lib/board/short-name";
import type { ChipState } from "@/lib/board/views";
import { cn } from "@/lib/utils";
import { venueStyle } from "@/lib/venue-colors";

/**
 * 稼働表（日・週・月）のマスに出すチップ（Phase 22）。状態は形、現場は色で区別する:
 * - 確定 = 会場の色で塗る（文字は白か濃い紺）
 * - 仮（打診中・補欠）= 会場の色の点線の枠（「打」「補」の字つき）
 * - 現場未定 = 橙の枠（○の人。△の人は「△」を添える）
 * - キャンセル・当日不稼働 = 赤い枠に ✕（要対応）
 * - × = 空白（何も出さない。読み上げには「×」）
 * 文字は「キャリア 場所」の短い名前（src/lib/board/short-name.ts）。単価は出さない（タップした先の詳細だけ）
 */
const BASE = "inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-md px-1.5 text-xs font-bold leading-none whitespace-nowrap";

export function StaffChip({ state, className }: { state: ChipState; className?: string }) {
  if (state.kind === "confirmed") {
    const { a } = state;
    return (
      <span data-chip="confirmed" data-venue={a.venueId} style={venueStyle(a.venueColor)} title={`確定: ${a.venueName}（${a.clientName}）`} className={cn(BASE, "bg-(--v-solid) text-(--v-on)", className)}>
        <span className="truncate">{chipLabel(a)}</span>
      </span>
    );
  }
  if (state.kind === "tentative") {
    const { a } = state;
    const mark = a.status === "offered" ? "打" : "補";
    return (
      <span
        data-chip="tentative"
        data-venue={a.venueId}
        style={venueStyle(a.venueColor)}
        title={`${a.status === "offered" ? "打診中" : "補欠"}: ${a.venueName}（${a.clientName}）`}
        className={cn(BASE, "border-2 border-dashed border-(--v-solid) bg-background text-(--v-fg)", className)}
      >
        <span className="shrink-0 rounded-sm bg-(--v-tint) px-1 text-[10px] leading-4">{mark}</span>
        <span className="truncate">{chipLabel(a)}</span>
      </span>
    );
  }
  if (state.kind === "dropped") {
    const { a } = state;
    return (
      <span data-chip="dropped" data-venue={a.venueId} title={`${a.status === "cancelled" ? "キャンセル" : "当日不稼働"}: ${a.venueName}（${a.clientName}）`} className={cn(BASE, "border-2 border-status-alert-solid bg-status-alert-bg text-status-alert", className)}>
        <XIcon aria-hidden className="size-3 shrink-0" strokeWidth={3} />
        <span className="truncate line-through">{chipLabel(a)}</span>
      </span>
    );
  }
  if (state.kind === "unassigned") {
    return (
      <span data-chip="unassigned" data-avail={state.availability} title={state.availability === "ok" ? "○（出られる）で現場が決まっていない" : "△（調整すれば可）で現場が決まっていない"} className={cn(BASE, "border-2 border-status-waiting-solid bg-status-waiting-bg text-status-waiting", className)}>
        現場未定{state.availability === "maybe" && <span className="font-semibold">△</span>}
      </span>
    );
  }
  if (state.kind === "off") return <span data-chip="off" className="sr-only">×（稼働できない）</span>;
  return null;
}

/** 凡例（日・週・月のタブの下） */
export function ChipLegend() {
  const sample = (venueColor: string) => ({ id: "x", eventId: "x", roleId: "x", venueId: "x", venueName: "会場名", venueColor, venueShort: "村山", carrier: "docomo", clientName: "取引先", status: "confirmed" as const });
  const item = "inline-flex items-center gap-1.5 whitespace-nowrap";
  return (
    <div className="mx-4 my-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border bg-[#fcfcfd] p-3 text-sm text-muted-foreground" aria-label="マスの見方">
      <span className={item}>
        <StaffChip state={{ kind: "confirmed", a: sample("blue") }} />
        確定（会場の色）
      </span>
      <span className={item}>
        <StaffChip state={{ kind: "tentative", a: { ...sample("purple"), status: "offered" } }} />
        仮（打診中・補欠は点線）
      </span>
      <span className={item}>
        <StaffChip state={{ kind: "unassigned", availability: "ok" }} />
        ○で現場が決まっていない
      </span>
      <span className={item}>
        <StaffChip state={{ kind: "dropped", a: { ...sample("sky"), status: "cancelled" } }} />
        キャンセル・当日不稼働
      </span>
      <span className={item}>
        <span className="inline-block h-6 w-10 rounded-md border border-dashed" aria-hidden />
        空白 = ×か未入力
      </span>
    </div>
  );
}
