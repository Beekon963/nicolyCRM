"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { formatShortJa } from "@/lib/date";
import { EXPENSE_KIND, EXPENSE_STATUS, INPUT_SOURCE } from "@/lib/labels";
import { reviewExpenses } from "./actions";

export type ExpenseRow = {
  id: string;
  kind: "transport" | "other";
  amount: number;
  memo: string;
  status: "pending" | "approved" | "rejected";
  source: "self" | "admin";
  reject_reason: string;
  staff: { id: string; name: string } | null;
  event: { id: string; date: string; venue: string } | null;
};

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

export function ExpenseList({ rows }: { rows: ExpenseRow[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState<ExpenseRow | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const pendingRows = rows.filter((r) => r.status === "pending");

  function review(ids: string[], status: "approved" | "rejected", why = "") {
    start(async () => {
      const r = await reviewExpenses(ids, status, why);
      if (!r.ok) return void toast.error(r.message);
      setSelected([]);
      setRejecting(null);
      toast.success(r.message, {
        action: { label: "元に戻す", onClick: () => start(async () => void (await reviewExpenses(ids, "pending"))) },
      });
    });
  }

  return (
    <div className="flex flex-col gap-3 px-4">
      {pendingRows.length > 1 && (
        <div className="flex items-center gap-2">
          <label className="flex h-11 items-center gap-2">
            <Checkbox
              checked={selected.length === pendingRows.length}
              onCheckedChange={(v) => setSelected(v ? pendingRows.map((r) => r.id) : [])}
              aria-label="未承認をすべて選ぶ"
            />
            すべて選ぶ
          </label>
          <Button size="sm" disabled={!selected.length || pending} onClick={() => review(selected, "approved")}>
            選んだ{selected.length}件を承認
          </Button>
        </div>
      )}
      <ul className="divide-y rounded-lg border">
        {rows.map((r) => (
          <li key={r.id} className="flex items-start gap-3 p-3">
            {r.status === "pending" ? (
              <Checkbox
                className="mt-1"
                aria-label={`${r.staff?.name}の${EXPENSE_KIND[r.kind]}を選ぶ`}
                checked={selected.includes(r.id)}
                onCheckedChange={(v) => setSelected((s) => (v ? [...s, r.id] : s.filter((x) => x !== r.id)))}
              />
            ) : (
              <span className="w-6" />
            )}
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <Link href={`/staff/${r.staff?.id}`} className="font-medium hover:underline">
                  {r.staff?.name}
                </Link>
                <span className="text-lg font-bold">{yen(r.amount)}</span>
                <Badge tone={EXPENSE_STATUS[r.status].tone}>{EXPENSE_STATUS[r.status].label}</Badge>
              </p>
              <p className="text-sm">
                {EXPENSE_KIND[r.kind]}
                {r.memo && `: ${r.memo}`}
              </p>
              <p className="text-sm text-muted-foreground">
                {r.event && (
                  <Link href={`/events/${r.event.id}`} className="hover:underline">
                    {formatShortJa(r.event.date)} {r.event.venue}
                  </Link>
                )}
                （入力: {INPUT_SOURCE[r.source]}）
              </p>
              {r.status === "rejected" && r.reject_reason && <p className="text-sm text-muted-foreground">却下理由: {r.reject_reason}</p>}
            </div>
            {r.status === "pending" ? (
              <div className="flex flex-col gap-1">
                <Button size="sm" disabled={pending} onClick={() => review([r.id], "approved")}>
                  承認
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRejecting(r)}>
                  却下
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={pending} onClick={() => start(async () => void toast.success((await reviewExpenses([r.id], "pending")).message))}>
                未承認に戻す
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Dialog open={rejecting != null} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>却下する</DialogTitle>
          </DialogHeader>
          <p>
            {rejecting?.staff?.name}さんの{rejecting && EXPENSE_KIND[rejecting.kind]} {rejecting && yen(rejecting.amount)}
          </p>
          <Input aria-label="却下の理由" placeholder="理由（任意。本人には表示されません）" value={reason} onChange={(e) => setReason(e.target.value)} />
          <DialogFooter>
            <Button variant="destructive" disabled={pending} onClick={() => rejecting && review([rejecting.id], "rejected", reason)}>
              却下する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
