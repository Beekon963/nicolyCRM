"use client";

import { FileTextIcon, UploadIcon } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { ACCOUNT_TYPE, WITHHOLDING_METHOD } from "@/lib/labels";
import { saveStaffPrivate, uploadContract, type StaffPrivateInput } from "../actions";

export type StaffPrivate = {
  base_daily_rate: number | null;
  withholding_method: "none" | "fee" | "sales_agent";
  invoice_number: string | null;
  contract_date: string | null;
  contract_file_path: string | null;
  bank_name: string;
  bank_branch: string;
  account_type: "ordinary" | "checking" | null;
  account_number: string;
  account_holder_kana: string;
};

/** ★ オーナーだけに表示（管理者にはこのデータ自体を渡さない） */
export function PrivateSection({ staffId, initial }: { staffId: string; initial: StaffPrivate | null }) {
  const [form, setForm] = useState<StaffPrivateInput>({
    staffId,
    base_daily_rate: initial?.base_daily_rate ?? null,
    withholding_method: initial?.withholding_method ?? "none",
    invoice_number: initial?.invoice_number ?? "",
    contract_date: initial?.contract_date ?? "",
    bank_name: initial?.bank_name ?? "",
    bank_branch: initial?.bank_branch ?? "",
    account_type: initial?.account_type ?? "",
    account_number: initial?.account_number ?? "",
    account_holder_kana: initial?.account_holder_kana ?? "",
  });
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  useUnsavedChanges(dirty);
  const set = <K extends keyof StaffPrivateInput>(k: K, v: StaffPrivateInput[K]) => {
    setForm({ ...form, [k]: v });
    setDirty(true);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveStaffPrivate(form);
          if (r.ok) {
            toast.success(r.message);
            setDirty(false);
          } else toast.error(r.message);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="rate">基本日当</Label>
          <div className="flex items-center gap-2">
            <Input
              id="rate"
              inputMode="numeric"
              value={form.base_daily_rate ?? ""}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, "");
                set("base_daily_rate", v === "" ? null : Number(v));
              }}
            />
            円
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="wh">源泉徴収の方式</Label>
          <NativeSelect id="wh" value={form.withholding_method} onChange={(e) => set("withholding_method", e.target.value as StaffPrivate["withholding_method"])}>
            {(Object.keys(WITHHOLDING_METHOD) as (keyof typeof WITHHOLDING_METHOD)[]).map((k) => (
              <option key={k} value={k}>
                {WITHHOLDING_METHOD[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="inv">インボイス登録番号</Label>
          <Input id="inv" placeholder="T1234567890123" value={form.invoice_number} onChange={(e) => set("invoice_number", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cdate">業務委託契約の締結日</Label>
          <Input id="cdate" type="date" value={form.contract_date} onChange={(e) => set("contract_date", e.target.value)} />
        </div>
      </div>

      <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium">振込口座</legend>
        <Input aria-label="銀行名" placeholder="銀行名" value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} />
        <Input aria-label="支店名" placeholder="支店名" value={form.bank_branch} onChange={(e) => set("bank_branch", e.target.value)} />
        <NativeSelect aria-label="口座種別" value={form.account_type} onChange={(e) => set("account_type", e.target.value as "ordinary" | "checking" | "")}>
          <option value="">種別</option>
          {(Object.keys(ACCOUNT_TYPE) as (keyof typeof ACCOUNT_TYPE)[]).map((k) => (
            <option key={k} value={k}>
              {ACCOUNT_TYPE[k]}
            </option>
          ))}
        </NativeSelect>
        <Input aria-label="口座番号" inputMode="numeric" placeholder="口座番号" value={form.account_number} onChange={(e) => set("account_number", e.target.value)} />
        <Input
          aria-label="口座名義（カナ）"
          className="sm:col-span-2"
          placeholder="口座名義（カナ）"
          value={form.account_holder_kana}
          onChange={(e) => set("account_holder_kana", e.target.value)}
        />
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        {initial?.contract_file_path ? (
          <Button asChild variant="outline" size="sm">
            <a href={`/staff/${staffId}/contract`} target="_blank" rel="noreferrer">
              <FileTextIcon />
              契約書を開く
            </a>
          </Button>
        ) : (
          <span className="text-sm text-muted-foreground">契約書PDFは未登録</span>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const fd = new FormData();
            fd.set("file", file);
            start(async () => {
              const r = await uploadContract(staffId, fd);
              if (r.ok) toast.success(r.message);
              else toast.error(r.message);
            });
          }}
        />
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => fileRef.current?.click()}>
          <UploadIcon />
          契約書PDFをアップロード
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">支払履歴は Phase 3（お金）で表示します。</p>
      <Button type="submit" className="self-end" disabled={pending || !dirty}>
        {pending ? "保存中…" : "保存する"}
      </Button>
    </form>
  );
}
