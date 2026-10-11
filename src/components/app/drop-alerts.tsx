"use client";

import { SirenIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDropAlerts, seeDropAlerts } from "@/app/(app)/alert-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { DropAlert } from "@/lib/data/alerts";
import { formatShortJa } from "@/lib/date";
import { venueColor } from "@/lib/venue-colors";

/** お知らせを聞きに行く間隔（ミリ秒） */
const POLL_MS = 60_000;
const LABEL = { cancelled: "キャンセル", no_show: "当日不稼働" } as const;

/**
 * キャンセル・当日不稼働のポップアップ（Phase 6）。
 * 確定していた人が来られなくなったら、ほかのオーナー・管理者の画面に赤いお知らせを出す。
 * 開いている間は1分ごと・画面に戻ってきたときに聞く。閉じると「ここまで見た」になり、次からは出ない。
 */
export function DropAlerts() {
  const [alerts, setAlerts] = useState<DropAlert[]>([]);
  const busy = useRef(false);

  const check = useCallback(async () => {
    if (busy.current || document.visibilityState !== "visible") return;
    busy.current = true;
    try {
      const next = await getDropAlerts();
      // 開いている間に増えたものは足す（閉じるまで消さない）
      setAlerts((cur) => [...cur, ...next.filter((n) => !cur.some((c) => c.id === n.id))]);
    } catch {
      // 聞けなかったときは次の回に聞く
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(check, 0);
    const timer = setInterval(check, POLL_MS);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  function close() {
    const latest = alerts.reduce((m, a) => (a.createdAt > m ? a.createdAt : m), "");
    setAlerts([]);
    if (latest) void seeDropAlerts(latest);
  }

  const open = alerts.length > 0;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="gap-0 overflow-hidden border-4 border-status-alert-solid p-0 [&>button:last-child]:text-white [&>button:last-child]:hover:bg-white/20">
        <div className="flex items-center gap-3 bg-status-alert-solid px-4 pt-4 pb-3 pr-14 text-white">
          <SirenIcon className="size-8 shrink-0 motion-safe:animate-shake" strokeWidth={2.5} />
          <div className="min-w-0">
            <DialogTitle className="text-lg font-bold">欠員が出ました（{alerts.length}件）</DialogTitle>
            <DialogDescription className="text-sm text-white/90">確定していた人が来られなくなりました。代わりの人を探してください。</DialogDescription>
          </div>
        </div>
        <ul className="flex flex-col gap-2 p-3" data-testid="drop-alerts">
          {alerts.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 rounded-lg border-2 border-b-4 p-3">
              <div className="flex items-start gap-2">
                <span aria-hidden className="mt-1 inline-block size-3.5 shrink-0 rounded-full" style={{ background: venueColor(a.venueColor).bg }} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {formatShortJa(a.date)} {a.venueName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[a.clientName, a.roleName].filter(Boolean).join("・")}
                  </p>
                  <p className="mt-1">
                    {a.staffName}さんが <b className="text-status-alert">{LABEL[a.status]}</b>
                  </p>
                </div>
                {a.shortage > 0 ? (
                  <span className="shrink-0 rounded-md bg-status-alert-solid px-2 py-1 text-sm font-bold text-white">欠{a.shortage}</span>
                ) : (
                  <span className="shrink-0 rounded-md bg-status-done-solid px-2 py-1 text-sm font-bold text-white">埋まりました</span>
                )}
              </div>
              {a.shortage > 0 && (
                <Button asChild className="border-b-4 border-status-alert-edge bg-status-alert-solid font-bold text-white hover:bg-status-alert-solid/90">
                  <Link href={`/events/${a.eventId}/candidates`} onClick={close}>
                    代わりの人を探す
                  </Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="border-t p-3">
          <Button variant="outline" className="w-full" onClick={close}>
            確認した
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
