import { cn } from "@/lib/utils";

/**
 * 状態の小さな札（欠2・✓・打1 など）。稼働表・カレンダー・現場一覧・ホームで同じ形にする。
 * 赤 = 欠員、緑 = そろった、黄 = 打診中（色だけにせず、必ず文字か印を入れる）
 */
export function StatusPill({ tone, children, title, className }: { tone: "alert" | "done" | "waiting"; children: React.ReactNode; title?: string; className?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-xs font-bold leading-none tabular-nums",
        tone === "alert" && "bg-status-alert-solid text-white",
        tone === "done" && "bg-status-done-solid text-white",
        tone === "waiting" && "bg-status-waiting-solid text-status-waiting-on-solid",
        className,
      )}
    >
      {children}
    </span>
  );
}
