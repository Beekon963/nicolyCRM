"use client";

import { ChevronDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DateQuickPick } from "@/components/app/date-quick-pick";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { COMPANY_KIND, COMPANY_STATUS, PRIORITY } from "@/lib/labels";
import { saveCompany, type CompanyInput } from "./actions";

export function CompanyForm({ initial, users }: { initial: CompanyInput; users: { id: string; name: string }[] }) {
  const router = useRouter();
  const [form, setForm] = useState<CompanyInput>(initial);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty);
  const isNew = !initial.id;
  const needsNext = form.status !== "active" && form.status !== "dormant";
  const missingNext = needsNext && (!form.next_action_date || !form.next_action.trim());
  const set = <K extends keyof CompanyInput>(k: K, v: CompanyInput[K]) => {
    setForm({ ...form, [k]: v });
    setDirty(true);
  };

  return (
    <form
      className="flex flex-col gap-4 px-4 pb-8"
      onSubmit={(e) => {
        e.preventDefault();
        // 取引中・見送り以外は次回アクションが必須（要件 §4.8）。空なら入力を促す
        if (missingNext && !window.confirm("「次回アクション日」と「次にやること」が空です。このまま保存しますか？\n（キャンセルを押すと入力に戻ります）")) return;
        start(async () => {
          const r = await saveCompany(form);
          if (r.ok && r.data) {
            toast.success(r.message);
            setDirty(false);
            router.push(`/sales/${r.data.id}`);
          } else if (!r.ok) toast.error(r.message);
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="c-name">会社名（必須）</Label>
          <Input id="c-name" required value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="c-kind">種別</Label>
          <NativeSelect id="c-kind" value={form.kind} onChange={(e) => set("kind", e.target.value as CompanyInput["kind"])}>
            <option value="client">{COMPANY_KIND.client}（案件を発注してくれる会社）</option>
            <option value="partner">{COMPANY_KIND.partner}（提携・開拓先）</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="c-status">ステータス</Label>
          <NativeSelect id="c-status" value={form.status} onChange={(e) => set("status", e.target.value as CompanyInput["status"])}>
            {(Object.keys(COMPANY_STATUS) as (keyof typeof COMPANY_STATUS)[]).map((k) => (
              <option key={k} value={k}>
                {COMPANY_STATUS[k].label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="c-phone">電話</Label>
          <Input id="c-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
      </div>

      <fieldset className={`flex flex-col gap-2 rounded-md border p-3 ${missingNext ? "border-status-alert/40 bg-status-alert-bg/40" : ""}`}>
        <legend className="px-1 text-sm font-medium">次回アクション{needsNext && "（取引中・見送り以外は必須）"}</legend>
        <DateQuickPick value={form.next_action_date ?? ""} onChange={(v) => set("next_action_date", v)} />
        <Input type="date" aria-label="次回アクション日" value={form.next_action_date ?? ""} onChange={(e) => set("next_action_date", e.target.value)} />
        <Input aria-label="次にやること" placeholder="次にやること（例: 来月の案件を確認）" value={form.next_action} onChange={(e) => set("next_action", e.target.value)} />
      </fieldset>

      <details className="group rounded-md border" open={!isNew}>
        <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-3 font-medium">
          詳細（住所・Web・優先度・担当者・メモ）
          <ChevronDownIcon className="size-5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-4 border-t p-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="c-kana">かな</Label>
            <Input id="c-kana" value={form.kana} onChange={(e) => set("kana", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="c-address">住所</Label>
            <Input id="c-address" value={form.address} onChange={(e) => set("address", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="c-web">Web</Label>
            <Input id="c-web" type="url" placeholder="https://" value={form.website} onChange={(e) => set("website", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="c-priority">優先度</Label>
            <NativeSelect id="c-priority" value={form.priority} onChange={(e) => set("priority", e.target.value as CompanyInput["priority"])}>
              {(Object.keys(PRIORITY) as (keyof typeof PRIORITY)[]).map((k) => (
                <option key={k} value={k}>
                  {PRIORITY[k]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="c-owner">担当者</Label>
            <NativeSelect id="c-owner" value={form.owner_user_id ?? ""} onChange={(e) => set("owner_user_id", e.target.value)}>
              <option value="">未設定</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="c-memo">メモ</Label>
            <Textarea id="c-memo" rows={3} value={form.memo} onChange={(e) => set("memo", e.target.value)} />
          </div>
          {!isNew && (
            <label className="flex items-center gap-3">
              <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} />
              表示する（オフにすると一覧に出なくなります。データは残ります）
            </label>
          )}
        </div>
      </details>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "保存中…" : isNew ? "登録する" : "保存する"}
      </Button>
    </form>
  );
}
