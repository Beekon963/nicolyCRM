"use client";

import { CheckCircle2Icon, FileUpIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toaster";
import { decodeCsv, parseCsv } from "@/lib/csv";
import { todayJst } from "@/lib/date";
import { guessMonth, parseMonthSheet, type ParsedMonthSheet } from "@/lib/import/month-sheet";
import { buildPlan, defaultChoices, NEW, SKIP, type PlanChoices, type PlanContext } from "@/lib/import/month-sheet-plan";
import { getMonthSheetContext, importMonthSheet, type MonthSheetReport } from "./month-sheet-actions";

type Opt = { id: string; name: string };

export function MonthSheetImport({ roles, onBack }: { roles: Opt[]; onBack: () => void }) {
  const [parsed, setParsed] = useState<ParsedMonthSheet | null>(null);
  const [fileName, setFileName] = useState("");
  const [month, setMonth] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [ctx, setCtx] = useState<PlanContext | null>(null);
  const [choices, setChoices] = useState<PlanChoices | null>(null);
  const [report, setReport] = useState<MonthSheetReport | null>(null);
  const [pending, start] = useTransition();

  const plan = useMemo(() => (parsed && ctx && choices ? buildPlan(parsed, ctx, choices) : null), [parsed, ctx, choices]);

  // 月を続けて変えたときに、古い月の結果で上書きしない
  const latest = useRef("");
  function load(p: ParsedMonthSheet, m: string) {
    latest.current = m;
    start(async () => {
      const r = await getMonthSheetContext(m);
      if (latest.current !== m) return;
      if (!r.ok) return void toast.error(r.message);
      setCtx(r.data!);
      setChoices(defaultChoices(p, r.data!, m));
    });
  }

  async function onFile(file: File) {
    const p = parseMonthSheet(parseCsv(decodeCsv(await file.arrayBuffer())));
    if (!p.days.length) return void toast.error(p.warnings[0] ?? "月のシートとして読めませんでした");
    const m = guessMonth(p.month, todayJst());
    setFileName(file.name);
    setParsed(p);
    setMonth(m);
    load(p, m);
  }

  if (report) {
    return (
      <div className="flex flex-col gap-3">
        <p className="flex items-center gap-2 text-lg font-bold text-status-done">
          <CheckCircle2Icon />
          取り込みました
        </p>
        <ul className="list-disc pl-5">
          <li>現場: 新しく {report.eventsCreated}件（すでにあった {report.eventsReused}件はそのまま使いました）</li>
          <li>アサイン（確定）: {report.assignments}件</li>
          <li>稼働可能日: {report.availability}件</li>
          {report.clients + report.venues > 0 && (
            <li>
              新しい取引先 {report.clients}件・会場 {report.venues}件（住所などはあとで入力してください）
            </li>
          )}
          {report.rates + report.dailyRates > 0 && (
            <li>
              単価: 請求 {report.rates}件・日当 {report.dailyRates}件（オーナーだけが見られます）
            </li>
          )}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={`/events/board?month=${month}`}>稼働表で見る</Link>
          </Button>
          <Button variant="outline" onClick={() => (setReport(null), setParsed(null), setCtx(null), setChoices(null))}>
            ほかの月も取り込む
          </Button>
        </div>
      </div>
    );
  }

  if (!parsed || !plan || !choices || !ctx) {
    return (
      <div className="flex flex-col gap-3">
        <p>
          今の管理用スプレッドシートの<b>月のシート（202611 など）</b>を取り込みます。Google スプレッドシートで取り込みたい月のタブを開き、
          「ファイル → ダウンロード → カンマ区切り形式（.csv）」で保存したファイルを選んでください。
        </p>
        <ul className="list-disc pl-5 text-sm text-muted-foreground">
          <li>上の段（単価・現場・人数）から現場を、下の段（単価・場所・シフト）からアサインと稼働可能日を作ります</li>
          <li>先に「スタッフ名簿」を取り込んでおいてください（名簿にいない人は取り込みません）</li>
          <li>今日より前の日は「記録のみ」（実績報告なし）で入ります。同じ月をもう一度取り込んでも重なりません</li>
        </ul>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ms-role">シートの人数を入れる役割（シートには役割がないため）</Label>
          <NativeSelect id="ms-role" value={roleId} onChange={(e) => setRoleId(e.target.value)} className="min-w-0 sm:max-w-xs">
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 hover:bg-accent">
          <FileUpIcon className="size-8 text-muted-foreground" />
          <span className="font-medium">{pending ? "読み込み中…" : "月のシートの CSV を選ぶ"}</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" aria-label="月のシートの CSV" disabled={pending} onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </label>
        <Button variant="ghost" className="self-start" onClick={onBack}>
          戻る
        </Button>
      </div>
    );
  }

  const set = (part: "clients" | "venues" | "staff" | "places", key: string, v: string) => setChoices({ ...choices, [part]: { ...choices[part], [key]: v } });
  const clientOpts = ctx.clients.slice().sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const venueOpts = ctx.venues.slice().sort((a, b) => a.name.localeCompare(b.name, "ja"));
  const staffOpts = ctx.staff.slice().sort((a, b) => a.name.localeCompare(b.name, "ja"));
  // 上の段の会場と、取引先を選んだ「上の段にない場所」
  const venueNames = [
    ...new Set([
      ...parsed.clients.flatMap((c) => c.lines.map((l) => l.venue)),
      ...plan.unknownPlaces.filter((u) => (choices.places[u.place] ?? SKIP) !== SKIP).map((u) => u.place),
    ]),
  ];
  const unmatchedVenues = venueNames.filter((v) => (choices.venues[v] ?? NEW) === NEW);
  const unmatchedStaff = parsed.staff.filter((s) => choices.staff[s.name] === SKIP);
  const matchedStaff = parsed.staff.length - unmatchedStaff.length;
  const created = plan.events.filter((e) => !e.existingId).length;
  const recordOnly = plan.events.filter((e) => e.recordOnly && !e.existingId).length;
  const notes = [...parsed.warnings, ...plan.notes];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="ms-month">対象の月</Label>
          <Input
            id="ms-month"
            type="month"
            className="w-auto"
            value={month}
            onChange={(e) => {
              if (!/^\d{4}-\d{2}$/.test(e.target.value)) return;
              setMonth(e.target.value);
              load(parsed, e.target.value);
            }}
          />
        </div>
        <p className="min-w-0 text-sm break-all text-muted-foreground">{fileName}</p>
      </div>

      <section className="rounded-lg border p-4" aria-label="取り込む内容">
        <h2 className="mb-2 font-bold">取り込む内容</h2>
        <ul className="flex flex-col gap-1">
          <li>
            現場 <b>{plan.events.length}件</b>（新しく作る {created}件・すでにある {plan.events.length - created}件）
            {recordOnly > 0 && <span className="text-sm text-muted-foreground">　うち今日より前の {recordOnly}件は「記録のみ」</span>}
          </li>
          <li>
            アサイン（確定） <b>{plan.assignments.length}件</b>・稼働可能日 <b>{plan.availability.length}件</b>（{matchedStaff}人分）
          </li>
          <li>
            単価（オーナーだけ） 請求 {plan.events.filter((e) => e.rate != null).length}件・日当 {plan.assignments.filter((a) => a.dailyRate != null).length}件
            {plan.transportClients.length > 0 && `・交通費を請求する取引先 ${plan.transportClients.length}社`}
          </li>
          {(plan.newClients.length > 0 || plan.newVenues.length > 0) && (
            <li>
              新しく作る: 取引先 {plan.newClients.length}件・会場 {plan.newVenues.length}件
            </li>
          )}
        </ul>
      </section>

      <MatchSection
        title="取引先"
        help="シートの取引先名を CRM の取引先に合わせます。ないものは新しく作ります（取引中として登録）。"
        rows={parsed.clients.map((c) => c.name)}
        value={(k) => choices.clients[k] ?? NEW}
        onChange={(k, v) => set("clients", k, v)}
        options={clientOpts}
        first={{ value: NEW, label: "新しく作る" }}
        isMatched={(k) => choices.clients[k] !== NEW}
        highlight={parsed.clients.filter((c) => (choices.clients[c.name] ?? NEW) === NEW).length}
      />

      <MatchSection
        title="会場"
        help="表記ゆれ（「楽天イオンモール与野」と「楽天イオンモール与野ca」など）は、すでにある会場を選んでください。ないものは新しく作ります（住所などはあとで入力）。"
        rows={venueNames}
        value={(k) => choices.venues[k] ?? NEW}
        onChange={(k, v) => set("venues", k, v)}
        options={venueOpts}
        first={{ value: NEW, label: "新しく作る" }}
        isMatched={(k) => (choices.venues[k] ?? NEW) !== NEW}
        highlight={unmatchedVenues.length}
      />

      <MatchSection
        title="スタッフ"
        help="名簿にいない人は取り込みません。名前の書き方が違うだけなら、名簿の人を選んでください。"
        rows={parsed.staff.map((s) => s.name)}
        value={(k) => choices.staff[k] ?? SKIP}
        onChange={(k, v) => set("staff", k, v)}
        options={staffOpts}
        first={{ value: SKIP, label: "取り込まない" }}
        isMatched={(k) => choices.staff[k] !== SKIP}
        highlight={unmatchedStaff.length}
      />

      {plan.unknownPlaces.length > 0 && (
        <section className="rounded-lg border p-4">
          <h2 className="font-bold">上の段にない場所</h2>
          <p className="mb-2 text-sm text-muted-foreground">下の段の「場所」にだけある予定です（研修など）。取引先を選ぶと、その取引先の現場として作ります。</p>
          <ul className="flex flex-col gap-2">
            {plan.unknownPlaces.map((u) => (
              <li key={u.place} className="flex flex-col gap-1 sm:flex-row sm:items-center">
                <span className="break-all sm:w-64">
                  <b>{u.place}</b>
                  <span className="block text-sm text-muted-foreground">{u.days.join("・")}日</span>
                </span>
                <NativeSelect aria-label={`${u.place}の取引先`} className="min-w-0 flex-1" value={choices.places[u.place] ?? SKIP} onChange={(e) => set("places", u.place, e.target.value)}>
                  <option value={SKIP}>取り込まない</option>
                  {clientOpts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}の現場にする
                    </option>
                  ))}
                </NativeSelect>
              </li>
            ))}
          </ul>
        </section>
      )}

      {notes.length > 0 && (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-bold">取り込まないもの・注意（{notes.length}件）</summary>
          <ul className="mt-2 list-disc pl-5 text-sm">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" onClick={() => (setParsed(null), setCtx(null), setChoices(null))}>
          ファイルを選び直す
        </Button>
        <Button
          size="lg"
          disabled={pending || plan.events.length + plan.availability.length === 0}
          onClick={() =>
            start(async () => {
              const r = await importMonthSheet(parsed, choices, roleId);
              if (!r.ok) return void toast.error(r.message);
              setReport(r.data!);
              toast.success(r.message);
            })
          }
        >
          {pending ? "取り込み中…" : `取り込む（現場 ${plan.events.length}件）`}
        </Button>
      </div>
    </div>
  );
}

function MatchSection({
  title,
  help,
  rows,
  value,
  onChange,
  options,
  first,
  isMatched,
  highlight,
}: {
  title: string;
  help: string;
  rows: string[];
  value: (k: string) => string;
  onChange: (k: string, v: string) => void;
  options: Opt[];
  first: { value: string; label: string };
  isMatched: (k: string) => boolean;
  highlight?: number;
}) {
  const unmatched = rows.filter((k) => !isMatched(k));
  const matched = rows.filter(isMatched);
  const row = (k: string) => (
    <li key={k} className="flex flex-col gap-1 sm:flex-row sm:items-center">
      <span className="font-medium break-all sm:w-64">{k}</span>
      <NativeSelect aria-label={`${k}の${title}`} className="min-w-0 flex-1" value={value(k)} onChange={(e) => onChange(k, e.target.value)}>
        <option value={first.value}>{first.label}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </NativeSelect>
    </li>
  );
  return (
    <section className="rounded-lg border p-4">
      <h2 className="flex items-center gap-2 font-bold">
        {title}
        {highlight ? <Badge tone="waiting">確認 {highlight}件</Badge> : <Badge tone="done">すべて合わせ済み</Badge>}
      </h2>
      <p className="mb-2 text-sm text-muted-foreground">{help}</p>
      {unmatched.length > 0 && <ul className="flex flex-col gap-2">{unmatched.map(row)}</ul>}
      {matched.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm">合わせ済み（{matched.length}件）を見る・直す</summary>
          <ul className="mt-2 flex flex-col gap-2">{matched.map(row)}</ul>
        </details>
      )}
    </section>
  );
}
