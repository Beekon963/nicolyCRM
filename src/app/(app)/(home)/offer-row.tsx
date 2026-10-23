"use client";

import { CheckIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setAssignmentStatus } from "@/app/(app)/events/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { formatShortJa } from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * ホームの「未回答の打診」の1行（Phase 18-3）。LINE で返事が来たら、ここで1タップで確定・辞退にする（元に戻せる）。
 */
export function OfferRow({ id, staffName, date, venue, eventId, overdue }: { id: string; staffName: string; date: string; venue: string; eventId: string; overdue: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<"confirmed" | "declined" | null>(null);
  const act = (status: "confirmed" | "declined") =>
    start(async () => {
      const r = await setAssignmentStatus(id, status);
      if (!r.ok) return void toast.error(r.message);
      setDone(status);
      toast.success(`${staffName}さんを${status === "confirmed" ? "確定" : "辞退"}にしました${r.data?.filled ? "。全員そろいました！" : ""}`, {
        action: {
          label: "元に戻す",
          onClick: () =>
            start(async () => {
              const u = await setAssignmentStatus(id, "offered");
              if (!u.ok) return void toast.error(u.message);
              setDone(null);
              router.refresh();
            }),
        },
      });
      router.refresh();
    });
  return (
    <li className={cn("flex min-h-14 items-center gap-2 py-1", overdue && "text-status-alert")}>
      <Link href={`/events/${eventId}`} className="min-w-0 flex-1 hover:underline">
        <span className="font-semibold">{staffName}</span>
        <span className="ml-2 text-sm text-muted-foreground">
          {formatShortJa(date)} {venue}
        </span>
        {overdue && (
          <Badge tone="alert" className="ml-2">
            24時間以上
          </Badge>
        )}
      </Link>
      {done ? (
        <Badge tone={done === "confirmed" ? "done" : "alert"}>{done === "confirmed" ? "確定" : "辞退"}</Badge>
      ) : (
        <>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => act("confirmed")} aria-label={`${staffName}さんを確定にする`} className="gap-1 text-status-done">
            <CheckIcon className="size-4" />
            確定
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => act("declined")} aria-label={`${staffName}さんを辞退にする`} className="gap-1 text-muted-foreground">
            <XIcon className="size-4" />
            辞退
          </Button>
        </>
      )}
    </li>
  );
}
