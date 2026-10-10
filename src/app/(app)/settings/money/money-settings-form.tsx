"use client";

import { AlertTriangleIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { saveIncentiveRates, saveMoneySettings } from "@/app/(app)/money/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import type { MoneySettings } from "@/lib/data/money";
import { parseYen, ROUNDING_LABEL, type Rounding } from "@/lib/money";

/** ★ インセンティブ単価（全体）と、税・源泉・支払日の設定（オーナーだけ） */
export function MoneySettingsForm({ settings, incentives }: { settings: MoneySettings; incentives: { id: string; name: string; amount: number | null }[] }) {
  const [s, setS] = useState(settings);
  const [inc, setInc] = useState(incentives.map((i) => ({ ...i, text: i.amount == null ? "" : i.amount.toLocaleString("ja-JP") })));
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
        <h2 className="font-bold">インセンティブ単価（全体の標準・1件あたり）</h2>
        <p className="text-sm text-muted-foreground">スタッフへの報酬に足す、獲得項目ごとの単価です。現場ごとの上書きは現場の画面で入れます。</p>
        {inc.map((i) => {
          const v = parseYen(i.text);
          const bad = Number.isNaN(v) || (v != null && v < 0);
          return (
            <div key={i.id} className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-2">
              <Label htmlFor={`inc-${i.id}`}>{i.name}</Label>
              <div className="relative">
                <Input
                  id={`inc-${i.id}`}
                  inputMode="numeric"
                  placeholder="未設定"
                  aria-invalid={bad || undefined}
                  className="pr-7 text-right tabular-nums"
                  value={i.text}
                  onChange={(e) => {
                    setInc(inc.map((x) => (x.id === i.id ? { ...x, text: e.target.value } : x)));
                    setDirty(true);
                  }}
                />
                <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">円</span>
              </div>
            </div>
          );
        })}
        <Button
          className="self-start"
          disabled={pending}
          onClick={() => {
            const rows = inc.map((i) => ({ itemId: i.id, amount: parseYen(i.text) }));
            const bad = rows.find((r) => r.amount != null && (Number.isNaN(r.amount) || r.amount < 0));
            if (bad) return toast.error(`「${inc.find((i) => i.id === bad.itemId)?.name}」の金額を数字で入れてください`);
            run(() => saveIncentiveRates(rows));
          }}
        >
          インセンティブ単価を保存
        </Button>
      </section>

      <section className="flex flex-col gap-4 rounded-lg border p-4">
        <h2 className="font-bold">消費税・源泉徴収・支払日</h2>
        <p className="flex items-start gap-2 rounded-md bg-status-waiting-bg p-3 text-sm text-status-waiting">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          税務上の扱い（源泉徴収の対象額に交通費を含めるか、税込・税抜のどちらで計算するか）は、税理士に確認してください。
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="tax-rate">消費税率（%）</Label>
            <Input
              id="tax-rate"
              inputMode="numeric"
              value={String(s.taxRatePercent)}
              onChange={(e) => {
                setS({ ...s, taxRatePercent: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 });
                setDirty(true);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="tax-rounding">消費税の端数</Label>
            <NativeSelect
              id="tax-rounding"
              value={s.taxRounding}
              onChange={(e) => {
                setS({ ...s, taxRounding: e.target.value as Rounding });
                setDirty(true);
              }}
            >
              {(Object.keys(ROUNDING_LABEL) as Rounding[]).map((r) => (
                <option key={r} value={r}>
                  {ROUNDING_LABEL[r]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <label className="flex min-h-11 items-center gap-3">
          <Switch
            checked={s.withholdingIncludeExpenses}
            aria-label="源泉徴収の対象額に交通費・経費を含める"
            onCheckedChange={(v) => {
              setS({ ...s, withholdingIncludeExpenses: v });
              setDirty(true);
            }}
          />
          源泉徴収の対象額に交通費・経費を含める
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <Switch
            checked={s.withholdingTaxInclusive}
            aria-label="源泉徴収を税込の額で計算する"
            onCheckedChange={(v) => {
              setS({ ...s, withholdingTaxInclusive: v });
              setDirty(true);
            }}
          />
          源泉徴収を税込の額で計算する（オフにすると税抜に換算して計算）
        </label>
        <div className="flex flex-col gap-1">
          <Label htmlFor="payment-day">報酬の支払日（翌月）</Label>
          <NativeSelect
            id="payment-day"
            value={String(s.paymentDay)}
            onChange={(e) => {
              setS({ ...s, paymentDay: Number(e.target.value) });
              setDirty(true);
            }}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                翌月{d}日
              </option>
            ))}
            <option value={0}>翌月末日</option>
          </NativeSelect>
          <p className="text-sm text-muted-foreground">月末締め・翌月のこの日に支払います（土日祝は振込データを作るときに確認してください）。</p>
        </div>
        <Button className="self-start" disabled={pending} onClick={() => run(() => saveMoneySettings(s))}>
          税・源泉・支払日を保存
        </Button>
      </section>
    </div>
  );
}
