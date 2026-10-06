"use client";

import { ChevronDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChipSelect } from "@/components/app/chip-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { STAFF_STATUS } from "@/lib/labels";
import { saveStaff, type StaffInput } from "./actions";

type Opt = { id: string; name: string };

export function StaffForm({
  initial,
  roles,
  ranks,
  areas,
  rankRates,
}: {
  initial?: StaffInput;
  roles: Opt[];
  ranks: Opt[];
  areas: Opt[];
  /** オーナーの新規登録のときだけ渡す（ランク → 基準日当） */
  rankRates?: Record<string, number>;
}) {
  const router = useRouter();
  const isNew = !initial?.id;
  const [form, setForm] = useState<StaffInput>(
    initial ?? {
      name: "",
      kana: "",
      phone: "",
      line_name: "",
      nearest_station: "",
      rank_id: "",
      status: "active",
      memo: "",
      role_ids: [],
      area_ids: [],
      base_daily_rate: null,
    },
  );
  const [rateTouched, setRateTouched] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty);

  function set<K extends keyof StaffInput>(k: K, v: StaffInput[K]) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      // ランクを選んだら、基本日当の初期値にランクの基準日当を入れる（Phase 0 決定2）
      if (k === "rank_id" && rankRates && !rateTouched) next.base_daily_rate = rankRates[String(v)] ?? null;
      return next;
    });
    setDirty(true);
  }

  return (
    <form
      className="flex flex-col gap-4 px-4 pb-8"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveStaff(form);
          if (r.ok && r.data) {
            toast.success(r.message);
            setDirty(false);
            router.push(`/staff/${r.data.id}`);
          } else if (!r.ok) toast.error(r.message);
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="name">氏名（必須）</Label>
          <Input id="name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="kana">かな</Label>
          <Input id="kana" value={form.kana} onChange={(e) => set("kana", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="phone">電話</Label>
          <Input id="phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="rank">ランク</Label>
          <NativeSelect id="rank" value={form.rank_id ?? ""} onChange={(e) => set("rank_id", e.target.value)}>
            <option value="">未設定</option>
            {ranks.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Label>役割</Label>
        <ChipSelect label="役割" options={roles} value={form.role_ids} onChange={(v) => set("role_ids", v)} />
      </div>

      {isNew && rankRates && (
        <div className="flex flex-col gap-1 rounded-md border border-primary/30 p-3">
          <Label htmlFor="rate">基本日当（オーナーのみ・ランクの基準日当が初期値）</Label>
          <div className="flex items-center gap-2">
            <Input
              id="rate"
              className="w-40"
              inputMode="numeric"
              value={form.base_daily_rate ?? ""}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, "");
                setRateTouched(true);
                set("base_daily_rate", v === "" ? null : Number(v));
              }}
            />
            円
          </div>
        </div>
      )}

      <details className="group rounded-md border" open={!isNew}>
        <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-3 font-medium">
          詳細（LINE表示名・最寄り駅・エリア・状態・メモ）
          <ChevronDownIcon className="size-5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-4 border-t p-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="line">LINE表示名</Label>
              <Input id="line" value={form.line_name} onChange={(e) => set("line_name", e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="station">最寄り駅</Label>
              <Input id="station" value={form.nearest_station} onChange={(e) => set("nearest_station", e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label>対応エリア</Label>
            <ChipSelect label="対応エリア" options={areas} value={form.area_ids} onChange={(v) => set("area_ids", v)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="status">状態</Label>
            <NativeSelect id="status" value={form.status} onChange={(e) => set("status", e.target.value as StaffInput["status"])}>
              {(Object.keys(STAFF_STATUS) as (keyof typeof STAFF_STATUS)[]).map((k) => (
                <option key={k} value={k}>
                  {STAFF_STATUS[k].label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="memo">メモ</Label>
            <Textarea id="memo" rows={3} value={form.memo} onChange={(e) => set("memo", e.target.value)} />
          </div>
        </div>
      </details>

      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "保存中…" : isNew ? "登録する" : "保存する"}
      </Button>
    </form>
  );
}
