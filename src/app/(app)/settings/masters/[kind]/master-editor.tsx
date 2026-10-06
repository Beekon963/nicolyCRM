"use client";

import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { cn } from "@/lib/utils";
import type { MasterKind, MasterRow } from "../kinds";
import { saveMasters } from "./actions";

export function MasterEditor({ kind, initial }: { kind: MasterKind; initial: MasterRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<MasterRow[]>(initial);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty);
  const isRank = kind === "ranks";

  function update(i: number, patch: Partial<MasterRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function move(i: number, d: -1 | 1) {
    setRows((rs) => {
      const next = [...rs];
      const [r] = next.splice(i, 1);
      next.splice(i + d, 0, r);
      return next;
    });
    setDirty(true);
  }

  return (
    <form
      className="flex flex-col gap-3 px-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveMasters(kind, rows);
          if (r.ok) {
            toast.success(r.message);
            setDirty(false);
            router.refresh();
          } else toast.error(r.message);
        });
      }}
    >
      <ul className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <li key={r.id ?? `new-${i}`} className={cn("flex flex-wrap items-center gap-2 rounded-lg border p-2", !r.is_active && "bg-muted")}>
            <div className="flex">
              <Button type="button" variant="ghost" size="icon" aria-label="上へ" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUpIcon />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="下へ" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                <ArrowDownIcon />
              </Button>
            </div>
            <Input
              aria-label="名前"
              className="min-w-32 flex-1"
              value={r.name}
              required
              onChange={(e) => update(i, { name: e.target.value })}
            />
            {isRank && (
              <>
                <label className="flex items-center gap-1 text-sm">
                  基準日当
                  <Input
                    aria-label={`${r.name}の基準日当`}
                    className="w-28"
                    inputMode="numeric"
                    value={r.base_daily_rate ?? ""}
                    placeholder="未設定"
                    onChange={(e) => {
                      const v = e.target.value.replace(/[^0-9]/g, "");
                      update(i, { base_daily_rate: v === "" ? null : Number(v) });
                    }}
                  />
                  円
                </label>
                <Input
                  aria-label={`${r.name}の定義メモ`}
                  className="min-w-40 flex-[2]"
                  placeholder="定義メモ（例: 月平均10件以上）"
                  value={r.description ?? ""}
                  onChange={(e) => update(i, { description: e.target.value })}
                />
              </>
            )}
            <label className="flex items-center gap-2 text-sm">
              有効
              <Switch checked={r.is_active} onCheckedChange={(v) => update(i, { is_active: v })} aria-label={`${r.name}を有効にする`} />
            </label>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => {
          setRows((rs) => [...rs, { name: "", is_active: true, description: "", base_daily_rate: null }]);
          setDirty(true);
        }}
      >
        <PlusIcon />
        追加
      </Button>
      <div className="sticky bottom-20 flex justify-end md:bottom-4">
        <Button type="submit" disabled={pending || !dirty} className="shadow">
          {pending ? "保存中…" : "保存する"}
        </Button>
      </div>
    </form>
  );
}
