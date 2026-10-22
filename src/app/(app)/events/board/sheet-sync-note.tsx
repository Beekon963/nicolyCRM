import { CheckCircle2Icon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * 稼働表の上の1行: シートを自動で読んでいるとき、いつ読んだか・合わない名前があるか（Phase 18）。
 * 読んでいないときは何も出さない（表を上に出す）。
 */
export function SheetSyncNote({ enabled, last, unmatched, isOwner }: { enabled: boolean; last: { at: string; ok: boolean; message: string } | null; unmatched: number; isOwner: boolean }) {
  if (!enabled) return null;
  const alert = (last && !last.ok) || unmatched > 0;
  const body = (
    <>
      {alert ? <TriangleAlertIcon className="size-4 shrink-0 text-status-alert" /> : <CheckCircle2Icon className="size-4 shrink-0 text-status-done" />}
      <span className="min-w-0 truncate">
        {last ? `シートから読んだ: ${last.at}` : "シートから自動で読みます（まだ読んでいません）"}
        {last && !last.ok && `（${last.message}）`}
        {unmatched > 0 && `・合わない名前 ${unmatched}件`}
      </span>
      {isOwner && <span className="shrink-0 text-primary">{unmatched > 0 ? "対応づける" : "設定"}</span>}
    </>
  );
  const cls = cn("mx-4 mb-2 flex min-h-9 items-center gap-2 rounded-md px-3 text-sm", alert ? "bg-status-alert-bg text-status-alert" : "bg-muted/60 text-muted-foreground");
  return isOwner ? (
    <Link href="/import#sheet-sync" className={cls} data-testid="sheet-sync-note">
      {body}
    </Link>
  ) : (
    <p className={cls} data-testid="sheet-sync-note">
      {body}
    </p>
  );
}
