import { seatsOf } from "@/lib/board/view";
import type { Fill } from "@/lib/fill";
import { cn } from "@/lib/utils";

/**
 * 人数分のマス（Phase 10）。1人 = 1マスで、確定は塗り、打診中は縞、空きは白。
 * 途中は青、全員そろったら緑（緑 = 完了の色なので、足りないうちは使わない）。
 * 9人以上の現場はマスが細くなりすぎるので、1本のバーにする。
 * 色だけにしないよう、読み上げ用の名前（2人中1人確定・打診中1人）を付ける
 */
export function SeatBar({ required, confirmed, offered, className, onColor }: { required: number; confirmed: number; offered: number; className?: string; onColor?: boolean }) {
  if (required <= 0) return null;
  const done = confirmed >= required;
  const label = `${required}人中${Math.min(confirmed, required)}人確定${offered > 0 ? `・打診中${offered}人` : ""}`;
  // 塗ったマスの上では、文字の色（白か濃い紺）で描く（どの会場の色の上でも見える）
  const fill = onColor ? "bg-current" : done ? "bg-status-done-solid" : "bg-primary";
  const empty = onColor ? "ring-1 ring-current/60 ring-inset" : "bg-white ring-1 ring-[#98a2b3] ring-inset";
  const stripes = onColor ? cn(STRIPES_CURRENT, "ring-1 ring-current/60 ring-inset") : cn(STRIPES, "ring-1 ring-status-waiting-solid ring-inset");
  if (required > 8) {
    const filled = Math.min(confirmed, required);
    const pending = Math.min(offered, required - filled);
    return (
      <span role="img" aria-label={label} title={label} className={cn("relative block h-2.5 w-full min-w-10 overflow-hidden rounded-[3px]", empty, className)}>
        <span className={cn("absolute inset-y-0 left-0", fill)} style={{ width: `${(filled * 100) / required}%` }} />
        <span className={cn("absolute inset-y-0", onColor ? STRIPES_CURRENT : STRIPES)} style={{ left: `${(filled * 100) / required}%`, width: `${(pending * 100) / required}%` }} />
      </span>
    );
  }
  return (
    <span role="img" aria-label={label} title={label} className={cn("flex min-w-0 gap-0.5", className)}>
      {seatsOf({ required, confirmed, offered }).map((s, i) => (
        <span key={i} className={cn("h-2.5 w-3 min-w-1 shrink rounded-[3px]", s === "filled" && fill, s === "offered" && stripes, s === "empty" && empty)} />
      ))}
    </span>
  );
}

/** 打診中の縞（黄の差し色と白） */
const STRIPES = "bg-[repeating-linear-gradient(135deg,var(--status-waiting-solid)_0_2px,#fff_2px_4px)]";
/** 塗ったマスの上の打診中の縞（文字の色と透明） */
const STRIPES_CURRENT = "bg-[repeating-linear-gradient(135deg,currentColor_0_2px,transparent_2px_4px)]";

/** 細い埋まり具合のバー（日付の見出し・取引先名の下）。途中は青、全部うまったら緑 */
export function ThinBar({ fill, className }: { fill: Fill; className?: string }) {
  if (fill.required === 0) return null;
  const done = fill.shortage === 0;
  return (
    <span
      role="meter"
      aria-label={`${fill.required}人中${fill.filled}人`}
      aria-valuemin={0}
      aria-valuemax={fill.required}
      aria-valuenow={fill.filled}
      className={cn("block h-1 overflow-hidden rounded-full bg-[#e4e7ec]", className)}
    >
      <span className={cn("block h-full rounded-full", done ? "bg-status-done-solid" : "bg-primary")} style={{ width: `${fill.pct}%` }} />
    </span>
  );
}
