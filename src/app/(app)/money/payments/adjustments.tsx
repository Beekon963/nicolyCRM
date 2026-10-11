"use client";

import { TrashIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addAdjustment, removeAdjustment } from "@/app/(app)/money/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { parseYen } from "@/lib/money";

/** 調整額を足す（＋ / −、理由は必須） */
export function AdjustmentForm({ staffId, month }: { staffId: string; month: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="grid grid-cols-[7.5rem_1fr_auto] gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const v = parseYen(amount.replace(/^[＋+]/, ""));
        if (v == null || Number.isNaN(v) || v === 0) return toast.error("金額を数字で入れてください（減らすときは −3000 のように）");
        if (!reason.trim()) return toast.error("理由を入れてください");
        start(async () => {
          const r = await addAdjustment(staffId, month, v, reason);
          if (r.ok) {
            toast.success(r.message);
            setAmount("");
            setReason("");
            router.refresh();
          } else toast.error(r.message);
        });
      }}
    >
      <Input inputMode="numeric" aria-label="調整額（減らすときは −）" placeholder="例: −3000" value={amount} onChange={(e) => setAmount(e.target.value)} className="text-right tabular-nums" />
      <Input aria-label="調整の理由" placeholder="理由（必須）" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button type="submit" variant="outline" disabled={pending}>
        追加
      </Button>
    </form>
  );
}

export function RemoveAdjustment({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="この調整額を消す"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await removeAdjustment(id);
          if (r.ok) toast.success(r.message);
          else toast.error(r.message);
          router.refresh();
        })
      }
    >
      <TrashIcon />
    </Button>
  );
}
