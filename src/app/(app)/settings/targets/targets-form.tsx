"use client";

import { useState, useTransition } from "react";
import { saveTargets } from "@/app/(app)/money/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { parse } from "@/lib/date";
import { parseYen } from "@/lib/money";

const t = (n: number | null) => (n == null ? "" : n.toLocaleString("ja-JP"));

export function TargetsForm({ rows }: { rows: { month: string; revenue: number | null; grossProfit: number | null }[] }) {
  const [list, setList] = useState(rows.map((r) => ({ month: r.month, revenue: t(r.revenue), gross: t(r.grossProfit) })));
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty);
  const set = (month: string, k: "revenue" | "gross", v: string) => {
    setList(list.map((r) => (r.month === month ? { ...r, [k]: v } : r)));
    setDirty(true);
  };
  return (
    <div className="flex flex-col gap-3 px-4 pb-8">
      <div className="grid grid-cols-[4.5rem_1fr_1fr] gap-2 text-sm text-muted-foreground">
        <span>月</span>
        <span>売上目標（税抜）</span>
        <span>粗利目標</span>
      </div>
      {list.map((r) => {
        const { y, m } = parse(`${r.month}-01`);
        return (
          <div key={r.month} className="grid grid-cols-[4.5rem_1fr_1fr] items-center gap-2">
            <span className="text-sm">
              {y}年<br />
              <b className="text-base">{m}月</b>
            </span>
            <Input inputMode="numeric" aria-label={`${m}月の売上目標`} placeholder="未設定" className="text-right tabular-nums" value={r.revenue} onChange={(e) => set(r.month, "revenue", e.target.value)} />
            <Input inputMode="numeric" aria-label={`${m}月の粗利目標`} placeholder="未設定" className="text-right tabular-nums" value={r.gross} onChange={(e) => set(r.month, "gross", e.target.value)} />
          </div>
        );
      })}
      <Button
        className="self-start"
        disabled={pending}
        onClick={() => {
          const out = list.map((r) => ({ month: r.month, revenue: parseYen(r.revenue), grossProfit: parseYen(r.gross) }));
          const bad = out.find((r) => Number.isNaN(r.revenue) || Number.isNaN(r.grossProfit));
          if (bad) return toast.error(`${parse(`${bad.month}-01`).m}月の金額を数字で入れてください`);
          start(async () => {
            const res = await saveTargets(out);
            if (res.ok) {
              toast.success(res.message);
              setDirty(false);
            } else toast.error(res.message);
          });
        }}
      >
        {pending ? "保存中…" : "月次目標を保存"}
      </Button>
    </div>
  );
}
