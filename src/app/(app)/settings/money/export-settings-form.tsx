"use client";

import { useState, useTransition } from "react";
import { saveFreeeSettings, saveZenginSettings } from "@/app/(app)/money/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import type { FreeeSettings } from "@/lib/export/freee";
import type { ZenginSender } from "@/lib/export/zengin";

const FREEE_FIELDS: { key: keyof FreeeSettings; label: string; placeholder?: string; hint?: string }[] = [
  { key: "salesAccount", label: "売上の勘定科目" },
  { key: "salesTax", label: "売上の税区分" },
  { key: "rewardAccount", label: "報酬の勘定科目" },
  { key: "expenseAccount", label: "交通費・経費の勘定科目" },
  { key: "purchaseTaxRegistered", label: "報酬の税区分（インボイス登録あり）" },
  {
    key: "purchaseTaxUnregistered",
    label: "報酬の税区分（インボイス登録なし）",
    placeholder: "空なら自動",
    hint: "空のときは、2026年9月までは「課対仕入（控80）10%」、10月からは「課対仕入（控50）10%」",
  },
  { key: "withholdingAccount", label: "源泉所得税の勘定科目" },
  { key: "withholdingTax", label: "源泉所得税の税区分" },
];

const ZENGIN_FIELDS: { key: Exclude<keyof ZenginSender, "accountType">; label: string; numeric?: boolean; placeholder?: string }[] = [
  { key: "requesterCode", label: "委託者コード（10桁）", numeric: true, placeholder: "銀行から知らされた番号" },
  { key: "requesterName", label: "委託者名（カナ）", placeholder: "例: カ）ニコリー" },
  { key: "bankCode", label: "振込元の銀行番号（4桁）", numeric: true },
  { key: "bankName", label: "振込元の銀行名（カナ）" },
  { key: "branchCode", label: "振込元の支店番号（3桁）", numeric: true },
  { key: "branchName", label: "振込元の支店名（カナ）" },
  { key: "accountNumber", label: "振込元の口座番号（7桁まで）", numeric: true },
];

/** ★ freee の書き出しの勘定科目・税区分と、振込データ（全銀）の振込元（オーナーだけ） */
export function ExportSettingsForm({ freee: initialFreee, zengin: initialZengin }: { freee: FreeeSettings; zengin: Partial<ZenginSender> }) {
  const [freee, setFreee] = useState(initialFreee);
  const [zengin, setZengin] = useState(initialZengin);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty);

  const run = (p: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await p();
      if (r.ok) {
        toast.success(r.message);
        setDirty(false);
      } else toast.error(r.message);
    });

  return (
    <div className="flex flex-col gap-6 px-4 pb-8">
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="font-bold">freee の書き出し（取引のインポート）</h2>
        <p className="text-sm text-muted-foreground">freee に登録してある名前と同じにしてください。税区分は、税理士に確かめたものを入れてください。</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {FREEE_FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-1">
              <Label htmlFor={`freee-${f.key}`}>{f.label}</Label>
              <Input
                id={`freee-${f.key}`}
                value={freee[f.key]}
                placeholder={f.placeholder}
                className="placeholder:text-sm"
                onChange={(e) => {
                  setFreee({ ...freee, [f.key]: e.target.value });
                  setDirty(true);
                }}
              />
              {f.hint && <p className="text-sm text-muted-foreground">{f.hint}</p>}
            </div>
          ))}
        </div>
        <Button className="self-start" disabled={pending} onClick={() => run(() => saveFreeeSettings(freee))}>
          freee の設定を保存
        </Button>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="font-bold">振込データ（全銀フォーマット）の振込元</h2>
        <p className="text-sm text-muted-foreground">ネットバンキングの「総合振込」で使う番号です。委託者コードは銀行の契約書類やネットバンキングの画面で確認できます。</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {ZENGIN_FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-1">
              <Label htmlFor={`zengin-${f.key}`}>{f.label}</Label>
              <Input
                id={`zengin-${f.key}`}
                inputMode={f.numeric ? "numeric" : undefined}
                value={zengin[f.key] ?? ""}
                placeholder={f.placeholder}
                className="placeholder:text-sm"
                onChange={(e) => {
                  setZengin({ ...zengin, [f.key]: e.target.value });
                  setDirty(true);
                }}
              />
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <Label htmlFor="zengin-accountType">振込元の預金種目</Label>
            <NativeSelect
              id="zengin-accountType"
              value={zengin.accountType ?? ""}
              onChange={(e) => {
                setZengin({ ...zengin, accountType: (e.target.value || undefined) as ZenginSender["accountType"] | undefined });
                setDirty(true);
              }}
            >
              <option value="">選んでください</option>
              <option value="ordinary">普通</option>
              <option value="checking">当座</option>
            </NativeSelect>
          </div>
        </div>
        <Button className="self-start" disabled={pending} onClick={() => run(() => saveZenginSettings(zengin))}>
          振込データの設定を保存
        </Button>
      </section>
    </div>
  );
}
