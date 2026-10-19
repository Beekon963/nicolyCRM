"use client";

import { CheckCircle2Icon, FileUpIcon, LinkIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { decodeCsv, parseCsv } from "@/lib/csv";
import { type ExpenseSheet, matchPayer, NOT_EXPENSE_SHEET, readExpenseSheet } from "@/lib/import/expense-sheet";
import { summarizeCompanyExpenses } from "@/lib/money/company-expenses";
import { formatYen } from "@/lib/money/format";
import { importCompanyExpenses, readExpenseSpreadsheet } from "../actions";

/** だれの分か: オーナーの id・「まだ決めていない」・「取り込まない」 */
const NONE = "none";
const SKIP = "skip";
type Loaded = { key: string; label: string; sheet: ExpenseSheet; payer: string };

const sumOf = (s: ExpenseSheet) => summarizeCompanyExpenses(s.rows.map((r) => ({ amount: r.amount, paidBy: null, category: r.category }))).total;

/**
 * 今の「経費記録」スプレッドシートから取り込む（Phase 16）。
 * 1. スプレッドシートの URL を貼る（全部のシートを読む）か、シートを1枚ずつ CSV で保存して選ぶ
 * 2. シートごとに、だれが払った分かを選ぶ（シートの名前から最初の案を出す。「未振分」は「まだ決めていない」）
 * 3. 取り込む（CRM にもう同じ経費があれば入れない）
 */
export function ExpenseImport({ payers }: { payers: { id: string; name: string }[] }) {
  const [url, setUrl] = useState("");
  const [sheets, setSheets] = useState<Loaded[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useUnsavedChanges(sheets.length > 0 && done == null);

  const firstPayer = (name: string) => {
    const p = matchPayer(name, payers);
    return p === undefined ? SKIP : p === null ? NONE : p;
  };

  function add(list: { key: string; label: string; sheet: ExpenseSheet }[]) {
    setDone(null);
    setSheets((cur) => [...cur.filter((c) => !list.some((l) => l.key === c.key)), ...list.map((l) => ({ ...l, payer: firstPayer(l.sheet.owner || l.label) }))]);
  }

  function loadUrl() {
    start(async () => {
      const r = await readExpenseSpreadsheet(url);
      if (!r.ok || !r.data) return void toast.error(r.ok ? "読めませんでした" : r.message);
      const found = r.data.tabs.flatMap((t) => {
        const sheet = readExpenseSheet(t.rows);
        return sheet ? [{ key: `tab:${t.title}`, label: t.title, sheet }] : [];
      });
      if (!found.length) return void toast.error(NOT_EXPENSE_SHEET);
      add(found);
    });
  }

  async function loadFiles(files: FileList | null) {
    const list = [];
    for (const f of [...(files ?? [])]) {
      const sheet = readExpenseSheet(parseCsv(decodeCsv(await f.arrayBuffer())));
      if (!sheet) toast.error(`${f.name}: ${NOT_EXPENSE_SHEET}`);
      else list.push({ key: `file:${f.name}`, label: sheet.owner || f.name.replace(/\.csv$/i, ""), sheet });
    }
    if (list.length) add(list);
  }

  const chosen = sheets.filter((s) => s.payer !== SKIP && s.sheet.rows.length > 0);
  const count = chosen.reduce((n, s) => n + s.sheet.rows.length, 0);

  function runImport() {
    start(async () => {
      const r = await importCompanyExpenses(chosen.map((s) => ({ paidBy: s.payer === NONE ? null : s.payer, rows: s.sheet.rows })));
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      setDone(r.message ?? "取り込みました");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="sheet-url">スプレッドシートの URL</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="sheet-url" placeholder="https://docs.google.com/spreadsheets/d/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button type="button" variant="outline" disabled={pending || !url.trim()} onClick={loadUrl}>
            <LinkIcon />
            全部のシートを読む
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">シートへの書き出しと同じ Google のアカウントで読みます（シートの共有にそのアカウントを入れておきます）。</p>
      </div>

      <label className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-4 text-center hover:bg-accent">
        <FileUpIcon className="size-7 text-muted-foreground" />
        <span className="font-medium">CSV ファイルを選ぶ（何枚でも）</span>
        <span className="text-sm text-muted-foreground">シートを1枚ずつ「ファイル → ダウンロード → CSV」で保存したもの</span>
        <input type="file" accept=".csv,text/csv" multiple className="sr-only" aria-label="経費記録の CSV" onChange={(e) => void loadFiles(e.target.files).finally(() => (e.target.value = ""))} />
      </label>

      {sheets.length > 0 && (
        <section aria-label="読み込んだシート" className="flex flex-col gap-3">
          <ul className="flex flex-col gap-3">
            {sheets.map((s) => {
              const sum = sumOf(s.sheet);
              const same = s.sheet.sheetTotal != null && s.sheet.sheetTotal === sum && (s.sheet.sheetCount == null || s.sheet.sheetCount === s.sheet.rows.length);
              return (
                <li key={s.key} className="flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-card">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <b className="text-lg break-words">{s.label}</b>
                    <span className="tabular-nums">
                      {s.sheet.rows.length}件・{formatYen(sum)}
                    </span>
                  </div>
                  {s.sheet.sheetTotal != null &&
                    (same ? (
                      <Badge tone="done" className="self-start">
                        ✓ シートの合計（{formatYen(s.sheet.sheetTotal)}）と同じ
                      </Badge>
                    ) : (
                      <Badge tone="waiting" className="self-start">
                        シートの合計（{formatYen(s.sheet.sheetTotal)}
                        {s.sheet.sheetCount != null && `・${s.sheet.sheetCount}件`}）とちがいます
                      </Badge>
                    ))}
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`payer-${s.key}`}>だれが払った分か</Label>
                    <NativeSelect id={`payer-${s.key}`} aria-label={`${s.label}のシートはだれが払った分か`} value={s.payer} onChange={(e) => setSheets((cur) => cur.map((c) => (c.key === s.key ? { ...c, payer: e.target.value } : c)))}>
                      {payers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                      <option value={NONE}>まだ決めていない</option>
                      <option value={SKIP}>取り込まない</option>
                    </NativeSelect>
                  </div>
                  {s.sheet.warnings.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-[#344054]">入れない行 {s.sheet.warnings.length}件</summary>
                      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                        {s.sheet.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>

          {done == null ? (
            <section aria-label="取り込む内容" className="sticky bottom-20 z-20 flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-raised md:bottom-4">
              <p>
                取り込む経費 <b className="text-lg">{count}件</b>
                <span className="ml-2 text-sm text-muted-foreground">（CRM にもう同じものがあれば入れません）</span>
              </p>
              <Button size="lg" disabled={pending || count === 0} onClick={runImport}>
                {pending ? "取り込んでいます…" : `${count}件を取り込む`}
              </Button>
            </section>
          ) : (
            <section aria-label="取り込みの結果" className="flex flex-col gap-2 rounded-2xl border bg-status-done-bg p-4">
              <p className="flex items-center gap-2 font-bold text-status-done">
                <CheckCircle2Icon className="size-5 shrink-0" />
                {done}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link href="/company-expenses">会社の経費を見る</Link>
                </Button>
              </div>
            </section>
          )}
        </section>
      )}
    </div>
  );
}
