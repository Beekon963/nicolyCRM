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
      <DialogContent className="gap-0 overflow-hidden p-0">
        {/* 赤い線と、薄い赤の地のアイコンで「急ぎ」を伝える（全面を赤く塗らない） */}
        <div className="h-1.5 bg-status-alert-solid" aria-hidden />
        <div className="flex items-start gap-3 px-5 pt-5 pb-3 pr-14">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-status-alert-tint text-status-alert-solid ring-8 ring-status-alert-bg">
            <SirenIcon className="size-6 motion-safe:animate-shake" strokeWidth={2.25} />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-lg font-bold">欠員が出ました（{alerts.length}件）</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">確定していた人が来られなくなりました。代わりの人を探してください。</DialogDescription>
          </div>
        </div>
        <ul className="flex flex-col gap-2 px-5 pb-4" data-testid="drop-alerts">
          {alerts.map((a) => (
            <li key={a.id} className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-card">
              <div className="flex items-start gap-2.5">
                <span aria-hidden className="mt-1.5 inline-block size-3 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: venueColor(a.venueColor).bar }} />
                <div className="min-w-0 flex-1">
                  <p className="font-bold">
                    {formatShortJa(a.date)} {a.venueName}
                  </p>
                  <p className="text-sm text-muted-foreground">{[a.clientName, a.roleName].filter(Boolean).join("・")}</p>
                  <p className="mt-1">
                    {a.staffName}さんが <b className="text-status-alert">{LABEL[a.status]}</b>
                  </p>
                </div>
                {a.shortage > 0 ? (
                  <span className="shrink-0 rounded-full bg-status-alert-solid px-2.5 py-0.5 text-sm font-bold text-white">欠{a.shortage}</span>
                ) : (
                  <span className="shrink-0 rounded-full border border-status-done-border bg-status-done-bg px-2.5 py-0.5 text-sm font-semibold text-status-done">埋まりました</span>
                )}
              </div>
              {a.shortage > 0 && (
                <Button asChild variant="destructive">
                  <Link href={`/events/${a.eventId}/candidates`} onClick={close}>
                    代わりの人を探す
                  </Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
        <div className="border-t bg-[#fcfcfd] px-5 py-3">
          <Button variant="outline" className="w-full" onClick={close}>
            確認した
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
