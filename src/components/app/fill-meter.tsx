import type { Fill } from "@/lib/fill";
import { cn } from "@/lib/utils";

/**
 * 埋まり具合のゲージ（Phase 6・7）。ゲームの体力ゲージのように、どれだけ埋まったかを1本のバーで見せる。
 * 緑 = 埋まった人数。足りない分は数字と「あと〇人」の赤い文字で出す（色だけにしない）。
 */
export function FillMeter({ label, fill, className, compact }: { label: string; fill: Fill; className?: string; compact?: boolean }) {
  const none = fill.required === 0;
  const done = !none && fill.shortage === 0;
  if (compact) return <CompactMeter label={label} fill={fill} done={done} className={className} />;
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-[#344054]">{label}</span>
        {!none && (
          <span className="text-sm text-muted-foreground tabular-nums">
            <b className="text-2xl leading-none font-bold text-foreground">{fill.filled}</b>
            <span className="mx-0.5">/</span>
            {fill.required}人
          </span>
        )}
      </div>
      {/* 現場がないときはバーを出さない（空のバーは「0%」に見えてしまうため） */}
      {!none && (
        <div
          role="meter"
          aria-label={`${label}の埋まり具合`}
          aria-valuemin={0}
          aria-valuemax={fill.required}
          aria-valuenow={fill.filled}
          className="h-2.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#10b981] to-status-done-solid motion-safe:transition-[width] motion-safe:duration-700"
            style={{ width: `${fill.pct}%` }}
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className={cn("font-semibold", none ? "text-muted-foreground" : done ? "text-status-done" : "text-status-alert")}>
          {none ? "現場はありません" : done ? "全部うまりました！" : `あと ${fill.shortage}人で全部うまる`}
        </span>
        {!none && <span className="font-semibold text-muted-foreground tabular-nums">{fill.pct}%</span>}
      </div>
    </div>
  );
}

/** 2行の小さなゲージ（稼働表の上など、表を少しでも上に出したいところ用） */
function CompactMeter({ label, fill, done, className }: { label: string; fill: Fill; done: boolean; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 font-semibold text-[#344054]">
          {label}
          <span className="ml-2 font-normal text-muted-foreground tabular-nums">
            <b className="font-bold text-foreground">{fill.filled}</b>/{fill.required}人
          </span>
        </span>
        <span className={cn("shrink-0 font-semibold", done ? "text-status-done" : "text-status-alert")}>{done ? "全部うまりました！" : `あと ${fill.shortage}人`}</span>
      </div>
      <div
        role="meter"
        aria-label={`${label}の埋まり具合`}
        aria-valuemin={0}
        aria-valuemax={Math.max(fill.required, 1)}
        aria-valuenow={fill.filled}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#10b981] to-status-done-solid motion-safe:transition-[width] motion-safe:duration-700"
          style={{ width: `${fill.pct}%` }}
        />
      </div>
    </div>
  );
}
