import { cn } from "@/lib/utils";

/**
 * 「見つかりません」「うまく表示できませんでした」などの画面（Phase 7）。
 * 何が起きたか・次に何をすればいいかを日本語で出す（英語の決まり文句やエラー番号は出さない）
 */
export function StatusScreen({
  icon,
  tone = "brand",
  title,
  children,
  actions,
  className,
}: {
  /** 上の丸い印（ロゴを上に出す画面では省く） */
  icon?: React.ReactNode;
  tone?: "brand" | "alert";
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex w-full max-w-md flex-col items-center gap-3 px-6 py-16 text-center", className)}>
      {icon && (
        <span
          aria-hidden
          className={cn(
            "mb-1 grid size-16 place-items-center rounded-full ring-8 motion-safe:animate-pop [&_svg]:size-7",
            tone === "alert" ? "bg-status-alert-tint text-status-alert ring-status-alert-bg" : "bg-brand-100 text-primary ring-brand-50",
          )}
        >
          {icon}
        </span>
      )}
      <h1 className="text-xl font-bold">{title}</h1>
      {children && <div className="text-muted-foreground">{children}</div>}
      {actions && <div className="mt-3 flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-center">{actions}</div>}
    </div>
  );
}
