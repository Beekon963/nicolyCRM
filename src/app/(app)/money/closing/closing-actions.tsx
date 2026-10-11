"use client";

import { LockIcon, LockOpenIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { closeMonth, unlockMonth } from "@/app/(app)/money/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";

/**
 * 締める（初めて・もう一度）。未処理があるときは一覧を出して確かめてから締める（要件: 警告のうえ締められる）。
 * 未処理がないときは確認なしで締める（ロック解除で戻せるため）。
 */
export function CloseMonthButton({ month, label, warnings, disabled }: { month: string; label: string; warnings: string[]; disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await closeMonth(month);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setOpen(false);
      toast.success(r.message);
      const n = r.data?.changedPaid ?? 0;
      if (n > 0) toast.warning(`支払済みの${n}人の金額が変わりました。差額は翌月の調整額で精算してください`, { duration: 15000 });
      router.refresh();
    });
  return (
    <>
      <Button size="lg" className="self-start" disabled={disabled || pending} onClick={() => (warnings.length ? setOpen(true) : run())}>
        <LockIcon />
        {pending ? "締めています…" : label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>未処理があります。このまま締めますか？</DialogTitle>
            <DialogDescription>締めると、この月の実績・単価・経費・現場は変更できなくなります（ロックを解除すると直せます）。</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-1">
            {warnings.map((w) => (
              <li key={w} className="text-status-alert">
                ・{w}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              やめる
            </Button>
            <Button disabled={pending} onClick={run}>
              {pending ? "締めています…" : "このまま締める"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** ロック解除（理由は必須。オーナーだけ） */
export function UnlockMonthButton({ month }: { month: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const run = () => {
    if (!reason.trim()) return toast.error("ロックを解除する理由を入れてください");
    start(async () => {
      const r = await unlockMonth(month, reason);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      setOpen(false);
      setReason("");
      toast.success(r.message);
      router.refresh();
    });
  };
  return (
    <>
      <Button variant="outline" className="self-start" onClick={() => setOpen(true)}>
        <LockOpenIcon />
        ロックを解除する
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ロックを解除する</DialogTitle>
            <DialogDescription>解除すると、この月の実績・単価・経費・現場を直せるようになります。直したら、もう一度締めてください。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <Label htmlFor="unlock-reason">理由（必須）</Label>
            <Textarea id="unlock-reason" placeholder="例: 交通費の承認漏れを直すため" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              やめる
            </Button>
            <Button disabled={pending} onClick={run}>
              {pending ? "解除しています…" : "ロックを解除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
