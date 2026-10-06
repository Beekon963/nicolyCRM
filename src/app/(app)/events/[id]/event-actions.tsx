"use client";

import { BanIcon, CopyIcon, PencilIcon, PlusIcon, Undo2Icon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { addDays, formatShortJa } from "@/lib/date";
import { duplicateEvent, setEventCancelled } from "../actions";

export function EventActions({ id, date, cancelled }: { id: string; date: string; cancelled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dupOpen, setDupOpen] = useState(false);
  const [dates, setDates] = useState<string[]>([addDays(date, 7)]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <>
      <Button asChild variant="outline" size="sm">
        <Link href={`/events/${id}/edit`}>
          <PencilIcon />
          編集
        </Link>
      </Button>
      <Button variant="outline" size="sm" onClick={() => setDupOpen(true)}>
        <CopyIcon />
        複製
      </Button>
      {cancelled ? (
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setEventCancelled(id, false);
              if (r.ok) toast.success(r.message);
              else toast.error(r.message);
            })
          }
        >
          <Undo2Icon />
          中止を取り消す
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className="text-status-alert" onClick={() => setCancelOpen(true)}>
          <BanIcon />
          中止
        </Button>
      )}

      <Dialog open={dupOpen} onOpenChange={setDupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>別の日に複製</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">取引先・会場・時間・必要人数などをコピーします（アサインはコピーしません）。</p>
          <ul className="flex flex-col gap-2">
            {dates.map((d, i) => (
              <li key={i} className="flex items-center gap-2">
                <Input type="date" aria-label={`複製先の日付${i + 1}`} value={d} onChange={(e) => setDates(dates.map((x, j) => (j === i ? e.target.value : x)))} />
                {dates.length > 1 && (
                  <Button variant="ghost" size="icon" aria-label="この日付を外す" onClick={() => setDates(dates.filter((_, j) => j !== i))}>
                    <XIcon />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <Button variant="outline" size="sm" className="self-start" onClick={() => setDates([...dates, addDays(dates.at(-1) ?? date, 1)])}>
            <PlusIcon />
            日付を追加
          </Button>
          <DialogFooter>
            <Button
              disabled={pending || dates.some((d) => !d)}
              onClick={() =>
                start(async () => {
                  const r = await duplicateEvent(id, dates);
                  if (!r.ok) return void toast.error(r.message);
                  toast.success(`${dates.map(formatShortJa).join("、")} に${r.message}`);
                  setDupOpen(false);
                  if (r.data?.ids.length === 1) router.push(`/events/${r.data.ids[0]}`);
                })
              }
            >
              複製する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>この現場を中止にする</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">確定・打診中のスタッフへの連絡は、LINE で別途お願いします。中止はあとから取り消せます。</p>
          <Label htmlFor="cancel-reason">理由（任意）</Label>
          <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await setEventCancelled(id, true, reason);
                  if (r.ok) {
                    toast.success(r.message);
                    setCancelOpen(false);
                  } else toast.error(r.message);
                })
              }
            >
              中止にする
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
