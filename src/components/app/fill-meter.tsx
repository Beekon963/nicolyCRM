import type { Fill } from "@/lib/fill";
import { cn } from "@/lib/utils";

/**
 * 埋まり具合のゲージ（ゲームの体力ゲージのような太いバー。Phase 6）。
 * 緑 = 埋まった人数、赤い地 = まだ足りない人数。数字と「あと〇人」の文字も必ず出す（色だけにしない）。
 */
export function FillMeter({ label, fill, className }: { label: string; fill: Fill; className?: string }) {
  const none = fill.required === 0;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-bold">{label}</span>
        {!none && (
          <span className="tabular-nums">
            <b className="text-xl">{fill.filled}</b>/{fill.required}人（{fill.pct}%）
          </span>
        )}
      </div>
      <div
        role="meter"
        aria-label={`${label}の埋まり具合`}
        aria-valuemin={0}
        aria-valuemax={Math.max(fill.required, 1)}
        aria-valuenow={fill.filled}
        className={cn("h-4 overflow-hidden rounded-full border-2", none ? "bg-muted" : "border-status-alert-solid/30 bg-status-alert-bg")}
      >
        {!none && (
          <div
            className="h-full rounded-full border-b-4 border-status-done-edge bg-status-done-solid motion-safe:transition-[width] motion-safe:duration-700"
            style={{ width: `${fill.pct}%` }}
          />
        )}
      </div>
      <span className={cn("text-sm font-bold", none ? "text-muted-foreground" : fill.shortage > 0 ? "text-status-alert" : "text-status-done")}>
        {none ? "現場はありません" : fill.shortage > 0 ? `あと ${fill.shortage}人で全部うまる` : "全部うまりました！"}
      </span>
    </div>
  );
}
