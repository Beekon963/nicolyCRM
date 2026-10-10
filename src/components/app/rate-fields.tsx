"use client";

import { Input } from "@/components/ui/input";
import { formatYen, parseYen } from "@/lib/money/format";
import type { RateKind } from "@/lib/money/rates";
import { cn } from "@/lib/utils";

/** 単価の入力欄1つ分（空なら「未設定」＝標準を使う） */
export type RateField = {
  key: string;
  kind: RateKind;
  roleId: string | null;
  itemId: string | null;
  label: string;
  /** 入力中の文字 */
  text: string;
  /** 空のときに使われる値の説明（例: 「標準 25,000円（取引先）」） */
  fallback?: string;
};

const GROUP_LABEL: Record<RateKind, string> = {
  per_person_day: "人日単価（1人1日あたり）",
  per_event: "現場固定（1現場1日あたり）",
  per_item: "成果単価（1件あたり）",
};

export function rateText(n: number | null | undefined) {
  return n == null ? "" : n.toLocaleString("ja-JP");
}

/** 入力を保存用の値にする。読めない入力があれば、その項目名を返す */
export function readRateFields(fields: RateField[]): { ok: true; rows: { kind: RateKind; roleId: string | null; itemId: string | null; amount: number | null }[] } | { ok: false; label: string } {
  const rows = [];
  for (const f of fields) {
    const v = parseYen(f.text);
    if (Number.isNaN(v) || (v != null && v < 0)) return { ok: false, label: f.label };
    rows.push({ kind: f.kind, roleId: f.roleId, itemId: f.itemId, amount: v });
  }
  return { ok: true, rows };
}

/** 単価の入力欄（人日・現場固定・成果のまとまりごと）。金額は「25,000」のように入れる */
export function RateFields({ fields, onChange, idPrefix }: { fields: RateField[]; onChange: (key: string, text: string) => void; idPrefix: string }) {
  const kinds: RateKind[] = ["per_person_day", "per_event", "per_item"];
  return (
    <div className="flex flex-col gap-4">
      {kinds.map((k) => {
        const list = fields.filter((f) => f.kind === k);
        if (!list.length) return null;
        return (
          <fieldset key={k} className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-bold text-muted-foreground">{GROUP_LABEL[k]}</legend>
            {list.map((f) => {
              const v = parseYen(f.text);
              const bad = Number.isNaN(v) || (v != null && v < 0);
              return (
                <div key={f.key} className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-2">
                  <label htmlFor={`${idPrefix}-${f.key}`} className="min-w-0">
                    <span className="block truncate">{f.label}</span>
                    {f.fallback && <span className="block truncate text-sm text-muted-foreground">{f.fallback}</span>}
                  </label>
                  <div className="relative">
                    <Input
                      id={`${idPrefix}-${f.key}`}
                      inputMode="numeric"
                      aria-invalid={bad || undefined}
                      placeholder="未設定"
                      value={f.text}
                      onChange={(e) => onChange(f.key, e.target.value)}
                      onBlur={() => {
                        const n = parseYen(f.text);
                        if (n != null && !Number.isNaN(n)) onChange(f.key, rateText(n));
                      }}
                      className={cn("pr-7 text-right tabular-nums", bad && "border-status-alert")}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">円</span>
                  </div>
                </div>
              );
            })}
          </fieldset>
        );
      })}
    </div>
  );
}

/** 単価の一覧を短い文にする（例: 「クローザー 25,000円・現場固定 10,000円」） */
export function rateSummary(fields: RateField[]): string {
  return fields
    .map((f) => ({ f, v: parseYen(f.text) }))
    .filter(({ v }) => v != null && !Number.isNaN(v))
    .map(({ f, v }) => `${f.label} ${formatYen(v)}`)
    .join("・");
}
