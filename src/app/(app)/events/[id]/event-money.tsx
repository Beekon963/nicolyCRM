"use client";

import { useState, useTransition } from "react";
import { saveEventMoney } from "@/app/(app)/money/actions";
import { type RateField, RateFields, readRateFields } from "@/components/app/rate-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { formatYen, parseYen } from "@/lib/money/format";
import { cn } from "@/lib/utils";

export type EventMoneyView = {
  status: "confirmed" | "estimate";
  subtotal: number;
  reward: number;
  expenses: number;
  gross: number;
  missingRoles: string[];
  missingDaily: string[];
};

type SimpleField = { key: string; id: string; label: string; sub?: string; text: string; fallback: string };

function SimpleFields({ title, fields, onChange, idPrefix }: { title: string; fields: SimpleField[]; onChange: (key: string, text: string) => void; idPrefix: string }) {
  if (!fields.length) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-bold text-muted-foreground">{title}</legend>
      {fields.map((f) => {
        const v = parseYen(f.text);
        const bad = Number.isNaN(v) || (v != null && v < 0);
        return (
          <div key={f.key} className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-2">
            <label htmlFor={`${idPrefix}-${f.key}`} className="min-w-0">
              <span className="block truncate">
                {f.label}
                {f.sub && <span className="ml-1 text-sm text-muted-foreground">{f.sub}</span>}
              </span>
              <span className="block truncate text-sm text-muted-foreground">{f.fallback}</span>
            </label>
            <div className="relative">
              <Input
                id={`${idPrefix}-${f.key}`}
                inputMode="numeric"
                placeholder="上書きしない"
                aria-invalid={bad || undefined}
                value={f.text}
                onChange={(e) => onChange(f.key, e.target.value)}
                className={cn("pr-7 text-right tabular-nums placeholder:text-sm", bad && "border-status-alert")}
              />
              <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">円</span>
            </div>
          </div>
        );
      })}
    </fieldset>
  );
}

/**
 * ★ この現場だけの単価・インセンティブ・日当の上書きと、この現場の請求・支払いの見込み（オーナーだけ）。
 * 空の欄は標準（取引先×会場 → 取引先、インセンティブは全体、日当はスタッフの基本日当）を使う。
 */
export function EventMoneySection({
  eventId,
  money,
  rates: initialRates,
  incentives: initialIncentives,
  daily: initialDaily,
}: {
  eventId: string;
  money: EventMoneyView;
  rates: RateField[];
  incentives: SimpleField[];
  daily: SimpleField[];
}) {
  const [rates, setRates] = useState(initialRates);
  const [incentives, setIncentives] = useState(initialIncentives);
  const [daily, setDaily] = useState(initialDaily);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty);

  const read = (list: SimpleField[]) => {
    const out: { id: string; amount: number | null }[] = [];
    for (const f of list) {
      const v = parseYen(f.text);
      if (Number.isNaN(v) || (v != null && v < 0)) return { ok: false as const, label: f.label };
      out.push({ id: f.id, amount: v });
    }
    return { ok: true as const, rows: out };
  };

  const save = () => {
    const r = readRateFields(rates);
    const i = read(incentives);
    const d = read(daily);
    for (const x of [r, i, d]) if (!x.ok) return toast.error(`「${x.label}」の金額を数字で入れてください`);
    if (!r.ok || !i.ok || !d.ok) return;
    start(async () => {
      const res = await saveEventMoney(eventId, {
        rates: r.rows,
        incentives: i.rows.map((x) => ({ itemId: x.id, amount: x.amount })),
        daily: d.rows.map((x) => ({ assignmentId: x.id, amount: x.amount })),
      });
      if (res.ok) {
        toast.success(res.message);
        setDirty(false);
      } else toast.error(res.message);
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2 rounded-md bg-muted/60 p-3">
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={money.status === "confirmed" ? "done" : "waiting"}>{money.status === "confirmed" ? "確定" : "見込み"}</Badge>
          <span className="text-sm text-muted-foreground">{money.status === "confirmed" ? "実績が確定した金額です" : "実績が確定するまでは、確定人数と速報件数での見込みです"}</span>
        </p>
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div>
            <dt className="text-sm text-muted-foreground">請求（税抜）</dt>
            <dd className="font-bold tabular-nums">{formatYen(money.subtotal)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">報酬＋経費</dt>
            <dd className="font-bold tabular-nums">{formatYen(money.reward + money.expenses)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">粗利</dt>
            <dd className={cn("font-bold tabular-nums", money.gross < 0 && "text-status-alert")}>{formatYen(money.gross)}</dd>
          </div>
        </dl>
        {money.missingRoles.length > 0 && <p className="text-sm text-status-alert">人日単価が未設定: {money.missingRoles.join("・")}（取引先の標準単価か、下の欄で入れてください）</p>}
        {money.missingDaily.length > 0 && <p className="text-sm text-status-alert">日当が未設定: {money.missingDaily.join("・")}（スタッフの「お金・契約」か、下の欄で入れてください）</p>}
      </div>

      <RateFields
        idPrefix="event-rate"
        fields={rates}
        onChange={(key, text) => {
          setRates(rates.map((f) => (f.key === key ? { ...f, text } : f)));
          setDirty(true);
        }}
      />
      <SimpleFields
        title="インセンティブ単価（1件あたり・この現場だけ）"
        idPrefix="event-incentive"
        fields={incentives}
        onChange={(key, text) => {
          setIncentives(incentives.map((f) => (f.key === key ? { ...f, text } : f)));
          setDirty(true);
        }}
      />
      <SimpleFields
        title="日当（この現場だけ）"
        idPrefix="event-daily"
        fields={daily}
        onChange={(key, text) => {
          setDaily(daily.map((f) => (f.key === key ? { ...f, text } : f)));
          setDirty(true);
        }}
      />
      <Button className="self-start" disabled={pending} onClick={save}>
        {pending ? "保存中…" : "この現場の単価を保存"}
      </Button>
    </div>
  );
}
