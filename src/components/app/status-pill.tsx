import { cn } from "@/lib/utils";

/**
 * 状態の小さな札（欠2・✓・打1 など）。稼働表・カレンダー・現場一覧・ホームで同じ形にする。
 * 赤 = 欠員、緑 = そろった、黄 = 打診中（色だけにせず、必ず文字か印を入れる）。
 * onColor: 塗ったマス（会場の色・赤）の上に置くとき。白い地に赤・緑の文字にして、どの色の上でも読めるようにする（黄はそのまま）
 */
export function StatusPill({ tone, children, title, className, onColor }: { tone: "alert" | "done" | "waiting"; children: React.ReactNode; title?: string; className?: string; onColor?: boolean }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-xs font-bold leading-none tabular-nums",
        tone === "alert" && (onColor ? "bg-white text-status-alert-solid" : "bg-status-alert-solid text-white"),
        tone === "done" && (onColor ? "bg-white text-status-done-solid" : "bg-status-done-solid text-white"),
        tone === "waiting" && "bg-status-waiting-solid text-status-waiting-on-solid",
        className,
      )}
    >
      {children}
    </span>
  );
}
