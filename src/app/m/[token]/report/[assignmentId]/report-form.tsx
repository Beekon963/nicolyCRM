"use client";

import { ChevronDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CountStepper } from "@/components/app/count-stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { saveReport } from "../../actions";

type Item = { item_id: string; name: string; reported: number | null; confirmed: number | null };
type Expense = { amount: number; memo: string; status: "pending" | "approved" | "rejected" };

export function ReportForm({
  token,
  assignmentId,
  items,
  comment,
  expenses,
  editable,
}: {
  token: string;
  assignmentId: string;
  items: Item[];
  comment: string;
  expenses: { transport?: Expense; other?: Expense };
  editable: boolean;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, number>>(Object.fromEntries(items.map((i) => [i.item_id, i.reported ?? 0])));
  const [text, setText] = useState(comment);
  const [transport, setTransport] = useState({ amount: expenses.transport?.amount ? String(expenses.transport.amount) : "", memo: expenses.transport?.memo ?? "" });
  const [other, setOther] = useState({ amount: expenses.other?.amount ? String(expenses.other.amount) : "", memo: expenses.other?.memo ?? "" });
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty);
  const touch = () => setDirty(true);
  const locked = (e?: Expense) => !editable || (e != null && e.status !== "pending");
  const yen = (v: string) => v.replace(/[^0-9]/g, "");

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveReport(token, assignmentId, {
            items: items.map((i) => ({ item_id: i.item_id, count: counts[i.item_id] ?? 0 })),
            comment: text,
            transportAmount: Number(transport.amount || 0),
            transportMemo: transport.memo,
            otherAmount: Number(other.amount || 0),
            otherMemo: other.memo,
          });
          if (!r.ok) return void toast.error(r.message);
          toast.success(r.message);
          setDirty(false);
          router.push(`/m/${token}/report`);
        });
      }}
    >
      <fieldset className="flex flex-col gap-3" disabled={!editable}>
        <legend className="mb-1 text-lg font-bold">獲得件数</legend>
        {items.map((i) => (
          <div key={i.item_id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
            <span className="text-base font-medium">{i.name}</span>
            <CountStepper
              size="lg"
              label={i.name}
              value={counts[i.item_id] ?? 0}
              onChange={(n) => {
                setCounts({ ...counts, [i.item_id]: n });
                touch();
              }}
            />
          </div>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1">
        <Label htmlFor="comment">一言コメント（任意）</Label>
        <Textarea id="comment" rows={2} disabled={!editable} placeholder="例: 午後から好調でした" value={text} onChange={(e) => (setText(e.target.value), touch())} />
      </div>

      <fieldset className="flex flex-col gap-2 rounded-lg border p-3" disabled={locked(expenses.transport)}>
        <legend className="px-1 font-bold">交通費</legend>
        {expenses.transport && expenses.transport.status !== "pending" && (
          <p className="text-sm text-muted-foreground">{expenses.transport.status === "approved" ? "承認済み" : "却下"}のため変更できません</p>
        )}
        <div className="flex items-center gap-2">
          <Input aria-label="交通費の金額" inputMode="numeric" className="text-lg" placeholder="0" value={transport.amount} onChange={(e) => (setTransport({ ...transport, amount: yen(e.target.value) }), touch())} />
          円
        </div>
        <Input aria-label="交通費の区間" placeholder="区間（例: 大宮〜浦和 往復）" value={transport.memo} onChange={(e) => (setTransport({ ...transport, memo: e.target.value }), touch())} />
      </fieldset>

      <details className="group rounded-lg border" open={Boolean(expenses.other)}>
        <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-3 font-medium">
          その他の経費（任意）
          <ChevronDownIcon className="size-5 transition-transform group-open:rotate-180" />
        </summary>
        <fieldset className="flex flex-col gap-2 border-t p-3" disabled={locked(expenses.other)}>
          <div className="flex items-center gap-2">
            <Input aria-label="その他の経費の金額" inputMode="numeric" placeholder="0" value={other.amount} onChange={(e) => (setOther({ ...other, amount: yen(e.target.value) }), touch())} />
            円
          </div>
          <Input aria-label="その他の経費の内容" placeholder="内容（例: 駐車場代）" value={other.memo} onChange={(e) => (setOther({ ...other, memo: e.target.value }), touch())} />
        </fieldset>
      </details>

      {editable && (
        <div className="sticky bottom-20 z-20">
          <Button type="submit" size="lg" className="h-14 w-full text-lg shadow" disabled={pending}>
            {pending ? "送信中…" : "送信する"}
          </Button>
        </div>
      )}
    </form>
  );
}
