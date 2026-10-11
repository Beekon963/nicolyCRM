"use client";

import { PencilIcon, PlusIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { saveClientBilling, saveClientRates } from "@/app/(app)/money/actions";
import { type RateField, RateFields, rateSummary, rateText, readRateFields } from "@/components/app/rate-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { formatYen } from "@/lib/money/format";
import type { Rate } from "@/lib/money/rates";

type Named = { id: string; name: string };

/** 単価の入力欄を作る（役割ごとの人日・現場固定・獲得項目ごとの成果） */
function makeFields(roles: Named[], items: Named[], current: Rate[], fallback?: Rate[]): RateField[] {
  const find = (list: Rate[] | undefined, kind: Rate["kind"], key: string | null) =>
    list?.find((r) => r.kind === kind && (kind === "per_person_day" ? r.roleId === key : kind === "per_item" ? r.itemId === key : true))?.amount;
  const fb = (kind: Rate["kind"], key: string | null) => {
    if (!fallback) return undefined;
    const v = find(fallback, kind, key);
    return v == null ? "取引先の標準: 未設定" : `取引先の標準: ${formatYen(v)}`;
  };
  return [
    ...roles.map((r) => ({ key: `d-${r.id}`, kind: "per_person_day" as const, roleId: r.id, itemId: null, label: r.name, text: rateText(find(current, "per_person_day", r.id)), fallback: fb("per_person_day", r.id) })),
    { key: "e", kind: "per_event" as const, roleId: null, itemId: null, label: "現場固定", text: rateText(find(current, "per_event", null)), fallback: fb("per_event", null) },
    ...items.map((i) => ({ key: `i-${i.id}`, kind: "per_item" as const, roleId: null, itemId: i.id, label: i.name, text: rateText(find(current, "per_item", i.id)), fallback: fb("per_item", i.id) })),
  ];
}

/**
 * ★ 取引先の請求設定と標準単価（オーナーだけ。要件 §4.8・§4.9、Phase 0 決定4）。
 * 単価は 現場ごとの上書き → 取引先×会場 → 取引先 の順に使う。
 */
export function ClientBillingSection({
  companyId,
  billing,
  rates,
  venueRates,
  roles,
  items,
  venues,
}: {
  companyId: string;
  billing: { billTransport: boolean; invoiceNote: string };
  rates: Rate[];
  venueRates: { id: string; name: string; rates: Rate[] }[];
  roles: Named[];
  items: Named[];
  venues: Named[];
}) {
  const [b, setB] = useState(billing);
  const [fields, setFields] = useState(() => makeFields(roles, items, rates));
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [venueEdit, setVenueEdit] = useState<{ id: string; name: string; fields: RateField[] } | null>(null);
  const [addVenue, setAddVenue] = useState("");
  useUnsavedChanges(dirty);

  const run = (p: () => Promise<{ ok: boolean; message?: string }>, done?: () => void) =>
    start(async () => {
      const r = await p();
      if (r.ok) {
        toast.success(r.message);
        done?.();
      } else toast.error(r.message);
    });

  const saveStandard = () => {
    const read = readRateFields(fields);
    if (!read.ok) return toast.error(`「${read.label}」の金額を数字で入れてください`);
    run(() => saveClientRates(companyId, null, read.rows), () => setDirty(false));
  };
  const saveVenue = (clear = false) => {
    if (!venueEdit) return;
    const read = clear ? { ok: true as const, rows: [] } : readRateFields(venueEdit.fields);
    if (!read.ok) return toast.error(`「${read.label}」の金額を数字で入れてください`);
    run(() => saveClientRates(companyId, venueEdit.id, read.rows), () => setVenueEdit(null));
  };
  const openVenue = (v: Named, current: Rate[]) => setVenueEdit({ id: v.id, name: v.name, fields: makeFields(roles, items, current, rates) });

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h3 className="font-bold">請求設定</h3>
        <label className="flex min-h-11 items-center gap-3">
          <Switch
            checked={b.billTransport}
            onCheckedChange={(v) => {
              setB({ ...b, billTransport: v });
              setDirty(true);
            }}
            aria-label="交通費を請求に含める"
          />
          交通費を請求に含める（承認済みの交通費を請求額に足す）
        </label>
        <div className="flex flex-col gap-1">
          <Label htmlFor="invoice-note">請求書の送付先メモ</Label>
          <Textarea
            id="invoice-note"
            rows={2}
            placeholder="例: 経理部 山田様 宛に PDF をメールで"
            value={b.invoiceNote}
            onChange={(e) => {
              setB({ ...b, invoiceNote: e.target.value });
              setDirty(true);
            }}
          />
        </div>
        <Button variant="outline" className="self-start" disabled={pending} onClick={() => run(() => saveClientBilling(companyId, b), () => setDirty(false))}>
          請求設定を保存
        </Button>
      </section>

      <section className="flex flex-col gap-3 border-t pt-4">
        <h3 className="font-bold">標準単価</h3>
        <p className="text-sm text-muted-foreground">この取引先の現場で使う単価です。空の欄は請求に入りません（人日単価が空のまま人が稼働すると、お金の画面で「単価が未設定」と出ます）。</p>
        <RateFields
          idPrefix="client-rate"
          fields={fields}
          onChange={(key, text) => {
            setFields(fields.map((f) => (f.key === key ? { ...f, text } : f)));
            setDirty(true);
          }}
        />
        <Button className="self-start" disabled={pending} onClick={saveStandard}>
          標準単価を保存
        </Button>
      </section>

      <section className="flex flex-col gap-3 border-t pt-4">
        <h3 className="font-bold">会場ごとの単価</h3>
        <p className="text-sm text-muted-foreground">同じ取引先でも会場によって単価が違うときに入れます。入れた単価だけが標準より優先されます。</p>
        {venueRates.length > 0 && (
          <ul className="divide-y rounded-md border">
            {venueRates.map((v) => (
              <li key={v.id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{v.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">{rateSummary(makeFields(roles, items, v.rates)) || "未設定"}</span>
                </span>
                <Button variant="ghost" size="icon" aria-label={`${v.name}の単価を編集`} onClick={() => openVenue(v, v.rates)}>
                  <PencilIcon />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <NativeSelect aria-label="単価を変える会場" className="min-w-0 flex-1" value={addVenue} onChange={(e) => setAddVenue(e.target.value)}>
            <option value="">会場を選ぶ</option>
            {venues
              .filter((v) => !venueRates.some((x) => x.id === v.id))
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
          </NativeSelect>
          <Button
            variant="outline"
            disabled={!addVenue}
            onClick={() => {
              const v = venues.find((x) => x.id === addVenue);
              if (v) openVenue(v, []);
              setAddVenue("");
            }}
          >
            <PlusIcon />
            追加
          </Button>
        </div>
      </section>

      <Dialog open={venueEdit != null} onOpenChange={(o) => !o && setVenueEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{venueEdit?.name} の単価</DialogTitle>
            <DialogDescription>空の欄は取引先の標準単価を使います。</DialogDescription>
          </DialogHeader>
          {venueEdit && (
            <RateFields
              idPrefix="venue-rate"
              fields={venueEdit.fields}
              onChange={(key, text) => setVenueEdit({ ...venueEdit, fields: venueEdit.fields.map((f) => (f.key === key ? { ...f, text } : f)) })}
            />
          )}
          <DialogFooter>
            {venueRates.some((x) => x.id === venueEdit?.id) && (
              <Button variant="ghost" disabled={pending} onClick={() => saveVenue(true)}>
                この会場の単価をやめる
              </Button>
            )}
            <Button disabled={pending} onClick={() => saveVenue()}>
              保存する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
