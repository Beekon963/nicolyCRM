"use client";

import { CheckCircle2Icon, ChevronDownIcon, FileUpIcon, MessageSquareTextIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { formatShortJa } from "@/lib/date";
import { type LineHistory, readLineHistory } from "@/lib/import/line-history";
import { buildEntries, distinct, suggestStaff, suggestVenue } from "@/lib/import/line-plan";
import { resolveItemName } from "@/lib/report-convert";
import { cn } from "@/lib/utils";
import { addVenueDetails, importLineReports, type LineImportResult } from "../line-actions";

type Named = { id: string; name: string };
type Map_ = Record<string, string | null>;

/** 1回に送る報告の数（多いと時間がかかりすぎるので分けて送る） */
const CHUNK = 25;
const SKIP = "";

/**
 * LINE のトーク履歴の取り込み（Phase 11）。
 * 1. ファイルを選ぶ（読み取りはこの画面の中だけ。お客様のお名前などはここで捨てる）
 * 2. 人・会場・項目を CRM のものに当てる（最初の案は自動。よく出てくる順に並ぶので、上から確かめる）
 * 3. 取り込む → 結果（入れた人数・作った記録のみの現場・入らなかった理由）
 * 4. 現場詳細を会場のメモに入れる（任意）
 */
export function LineImport({
  staff,
  venues,
  clients,
  items,
  aliases,
  venueClient,
}: {
  staff: (Named & { kana: string; line_name: string })[];
  venues: Named[];
  clients: Named[];
  items: (Named & { active: boolean })[];
  aliases: { alias: string; name: string }[];
  venueClient: Record<string, string>;
}) {
  const [history, setHistory] = useState<LineHistory | null>(null);
  const [fileName, setFileName] = useState("");
  const [person, setPerson] = useState<Map_>({});
  const [venue, setVenue] = useState<Map_>({});
  const [item, setItem] = useState<Map_>({});
  const [client, setClient] = useState<Record<string, string>>(venueClient);
  const [result, setResult] = useState<LineImportResult | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, boolean>>({});
  const [pending, start] = useTransition();
  useUnsavedChanges(history != null && result == null);

  const itemIdByName = useMemo(() => new Map(items.map((i) => [i.name, i.id])), [items]);

  async function onFile(file: File) {
    // 名前はスタッフの一覧で見分ける（「会場 名前 名前」の行を会場と人に分ける）
    const h = readLineHistory(await file.text(), { person: (n) => suggestStaff(n, staff) });
    if (!h.messages.length) return void toast.error("LINE のトーク履歴（.txt）を選んでください。トークの右上のメニュー →「設定」→「トーク履歴を送信」で保存できます");
    setFileName(file.name);
    setHistory(h);
    setResult(null);
    // 最初の案（自動）。分からないものは「取り込まない」「数えない」
    const people = distinct(h.reports.flatMap((r) => [...r.people, ...r.lines.flatMap((l) => l.shares.map((s) => s.person))]));
    setPerson(Object.fromEntries(people.map(({ value }) => [value, suggestStaff(value, staff)])));
    const vs = distinct([...h.reports.map((r) => r.venue), ...h.details.map((d) => d.venue)]);
    setVenue(Object.fromEntries(vs.map(({ value }) => [value, suggestVenue(value, venues)])));
    const dict = { items: items.filter((i) => i.active).map((i) => i.name), aliases };
    const words = distinct(h.reports.flatMap((r) => r.lines.map((l) => l.raw)));
    setItem(
      Object.fromEntries(
        words.map(({ value }) => {
          const sub = h.reports.every((r) => r.lines.every((l) => l.raw !== value || l.sub));
          const r = resolveItemName(value, dict);
          // 件数のない行（PI の下の行）は、同じ名前・言いかえ表にあるときだけ数える
          const ok = r.name && (r.how === "exact" || r.how === "alias" || (!sub && r.how === "guess"));
          return [value, ok ? (itemIdByName.get(r.name!) ?? null) : null];
        }),
      ),
    );
  }

  const plan = useMemo(() => (history ? buildEntries(history.reports, { venue, person, item, client }) : null), [history, venue, person, item, client]);

  function runImport() {
    if (!plan) return;
    const all = plan.entries;
    start(async () => {
      const total: LineImportResult = { entered: 0, events: 0, skipped: [] };
      for (let i = 0; i < all.length; i += CHUNK) {
        setProgress(`${Math.min(i + CHUNK, all.length)} / ${all.length}件`);
        const r = await importLineReports(all.slice(i, i + CHUNK));
        if (!r.ok || !r.data) {
          toast.error(r.message);
          break;
        }
        total.entered += r.data.entered;
        total.events += r.data.events;
        total.skipped.push(...r.data.skipped);
      }
      setProgress(null);
      setResult(total);
      toast.success(`${total.entered}人分の実績を入れました`);
    });
  }

  // 現場詳細: 会場ごとに一番新しい投稿
  const latestDetails = useMemo(() => {
    const m = new Map<string, { venueId: string; date: string; body: string; venueText: string }>();
    for (const d of history?.details ?? []) {
      const id = venue[d.venue];
      if (!id) continue;
      const cur = m.get(id);
      if (!cur || cur.date <= d.date) m.set(id, { venueId: id, date: d.date, body: d.body, venueText: d.venue });
    }
    return [...m.values()];
  }, [history, venue]);

  if (!history)
    return (
      <div className="flex flex-col gap-3 px-4 pb-8">
        <p>
          件数の報告をしている LINE グループの<b>トーク履歴（.txt）</b>を選んでください。
          トークの右上のメニュー →「設定」→「トーク履歴を送信」で保存できます（パソコンの LINE は「トーク履歴を保存」）。
        </p>
        <p className="text-sm text-muted-foreground">
          読み取りはこの画面の中だけで行います。トーク履歴のファイルはサーバーに保存しません。お客様のお名前・予約の日時の行は使いません。
        </p>
        <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 hover:bg-accent">
          <FileUpIcon className="size-8 text-muted-foreground" />
          <span className="font-medium">トーク履歴のファイルを選ぶ</span>
          <input type="file" accept=".txt,text/plain" className="sr-only" aria-label="トーク履歴のファイル" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </label>
      </div>
    );

  const reports = history.reports;
  const dates = reports.map((r) => r.date).sort();
  const people = distinct(reports.flatMap((r) => [...r.people, ...r.lines.flatMap((l) => l.shares.map((s) => s.person))]));
  const venueWords = distinct(reports.map((r) => r.venue));
  const mainWords = distinct(reports.flatMap((r) => r.lines.filter((l) => !l.sub).map((l) => l.raw)));
  const mainSet = new Set(mainWords.map((w) => w.value));
  const subWords = distinct(reports.flatMap((r) => r.lines.filter((l) => l.sub && !mainSet.has(l.raw)).map((l) => l.raw)));
  const usedVenues = [...new Set(venueWords.map((v) => venue[v.value]).filter((v): v is string => !!v))];
  const staffOptions = [...staff].sort((a, b) => (a.kana || a.name).localeCompare(b.kana || b.name, "ja"));
  const peopleCount = plan?.entries.reduce((n, e) => n + e.people.length, 0) ?? 0;

  return (
    <div className="flex flex-col gap-4 px-4 pb-8">
      <section className="rounded-2xl border bg-card p-4 shadow-card">
        <p className="font-semibold">{history.title || fileName}</p>
        <p className="text-sm text-muted-foreground">
          {dates.length ? `${formatShortJa(dates[0])}〜${formatShortJa(dates.at(-1)!)}` : ""}　件数の報告 {reports.length}件（獲得なし {reports.filter((r) => r.zero).length}件）・現場詳細 {history.details.length}件
        </p>
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => setHistory(null)}>
          別のファイルを選ぶ
        </Button>
      </section>

      <MapSection
        title="人"
        hint="書いてあった名前と、LINE で送った人の表示名です。だれか選んでください。分からない人は「取り込まない」のままで大丈夫です（その人の分は入りません）"
        rows={people}
        value={person}
        onChange={(k, v) => setPerson((m) => ({ ...m, [k]: v }))}
        options={staffOptions.map((s) => ({ id: s.id, name: s.name }))}
        none="取り込まない"
      />
      <MapSection
        title="会場"
        hint="報告に書いてあった会場の書き方です。CRM の会場を選んでください。その日に現場がないときは「記録のみ」の現場を作ります（お金の計算には入りません）"
        rows={venueWords}
        value={venue}
        onChange={(k, v) => setVenue((m) => ({ ...m, [k]: v }))}
        options={venues}
        none="取り込まない"
      />
      {usedVenues.length > 0 && (
        <details className="group rounded-2xl border bg-card shadow-card">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-bold">
            「記録のみ」の現場を作るときの取引先（{usedVenues.length}か所）
            <ChevronDownIcon className="size-5 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <ul className="divide-y border-t">
            {usedVenues.map((id) => (
              <li key={id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:gap-3">
                <span className="min-w-0 flex-1 font-medium break-words">{venues.find((v) => v.id === id)?.name}</span>
                <NativeSelect aria-label={`${venues.find((v) => v.id === id)?.name}の取引先`} className="sm:w-72" value={client[id] ?? ""} onChange={(e) => setClient((m) => ({ ...m, [id]: e.target.value }))}>
                  <option value="">選んでください</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </li>
            ))}
          </ul>
        </details>
      )}
      <MapSection
        title="項目"
        hint="件数の書き方です。どの獲得項目にするか選んでください。応対数などの数えないものは「数えない」に。よく出てくる順に並んでいます"
        rows={mainWords}
        value={item}
        onChange={(k, v) => setItem((m) => ({ ...m, [k]: v }))}
        options={items.map((i) => ({ id: i.id, name: i.active ? i.name : `${i.name}（使っていない項目）` }))}
        none="数えない"
      />
      {subWords.length > 0 && (
        <MapSection
          title="件数のない行（PI などの下の行）"
          hint="「PI1」の下に書いてあった「D払い初回利用」「かけ放題」などです。獲得項目を選ぶと、その PI と同じ人の分として1件ずつ数えます"
          rows={subWords}
          value={item}
          onChange={(k, v) => setItem((m) => ({ ...m, [k]: v }))}
          options={items.filter((i) => i.active)}
          none="数えない"
          closed
        />
      )}

      {plan && !result && (
        <section aria-label="取り込む内容" className="sticky bottom-20 z-20 flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-raised md:bottom-4">
          <p>
            取り込める報告 <b className="text-lg">{plan.entries.length}件</b>（{peopleCount}人分）
            {plan.skipped.length > 0 && <span className="ml-2 text-sm text-muted-foreground">入らない報告 {plan.skipped.length}件</span>}
          </p>
          {plan.skipped.length > 0 && <SkipList skipped={plan.skipped} />}
          <Button size="lg" disabled={pending || plan.entries.length === 0} onClick={runImport}>
            {progress ? `取り込んでいます… ${progress}` : `${plan.entries.length}件を取り込む`}
          </Button>
          <p className="text-sm text-muted-foreground">もう実績がある人・打診中などのアサインがある人には入れません。締めた月にも入りません。</p>
        </section>
      )}

      {result && (
        <section aria-label="取り込みの結果" className="flex flex-col gap-2 rounded-2xl border bg-status-done-bg p-4">
          <p className="flex items-center gap-2 font-bold text-status-done">
            <CheckCircle2Icon className="size-5" />
            {result.entered}人分の実績を入れました（記録のみの現場を {result.events}件作りました）
          </p>
          {result.skipped.length > 0 && <SkipList skipped={result.skipped} title={`入らなかったもの ${result.skipped.length}件`} />}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/analysis">実績の分析を見る</Link>
            </Button>
            <Button variant="ghost" onClick={() => setHistory(null)}>
              別のファイルを取り込む
            </Button>
          </div>
        </section>
      )}

      {latestDetails.length > 0 && (
        <section aria-label="現場詳細" className="flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-card">
          <h2 className="flex items-center gap-2 font-bold">
            <MessageSquareTextIcon className="size-5 text-primary" />
            現場詳細を会場のメモに入れる（{latestDetails.length}か所）
          </h2>
          <p className="text-sm text-muted-foreground">【案件詳細】の投稿（集合・入店のしかた・服装・持ち物など）のうち、会場ごとに一番新しいものを会場のメモに足します。稼働日程・稼働メンバーは入れません。</p>
          <ul className="flex flex-col gap-2">
            {latestDetails.map((d) => (
              <li key={d.venueId} className="rounded-xl border p-3">
                <label className="flex min-h-11 items-center gap-3">
                  <Checkbox checked={details[d.venueId] ?? true} onCheckedChange={(v) => setDetails((m) => ({ ...m, [d.venueId]: v === true }))} />
                  <span className="min-w-0 font-medium break-words">
                    {venues.find((v) => v.id === d.venueId)?.name}
                    <span className="ml-2 text-sm font-normal text-muted-foreground">{formatShortJa(d.date)}の投稿</span>
                  </span>
                </label>
                <details>
                  <summary className="cursor-pointer text-sm text-primary">中身を見る</summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-2 font-sans text-sm whitespace-pre-wrap">{d.body}</pre>
                </details>
              </li>
            ))}
          </ul>
          <Button
            variant="outline"
            className="self-start"
            disabled={pending || !latestDetails.some((d) => details[d.venueId] ?? true)}
            onClick={() =>
              start(async () => {
                const r = await addVenueDetails(latestDetails.filter((d) => details[d.venueId] ?? true).map(({ venueId, date, body }) => ({ venueId, date, body })));
                if (!r.ok) return void toast.error(r.message);
                toast.success(r.message);
              })
            }
          >
            会場のメモに入れる
          </Button>
        </section>
      )}
    </div>
  );
}

/** 書き方 → CRM のもの の当て方の一覧（よく出てくる順。まだ決めていないものは赤い札） */
function MapSection({
  title,
  hint,
  rows,
  value,
  onChange,
  options,
  none,
  closed,
}: {
  title: string;
  hint: string;
  rows: { value: string; count: number }[];
  value: Map_;
  onChange: (key: string, id: string | null) => void;
  options: Named[];
  none: string;
  closed?: boolean;
}) {
  const open = rows.filter((r) => !value[r.value]).length;
  return (
    <details className="group rounded-2xl border bg-card shadow-card" open={!closed}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
        <span className="flex flex-wrap items-center gap-2 font-bold">
          {title}（{rows.length}）
          {open > 0 ? <Badge tone="waiting">{none} {open}</Badge> : <Badge tone="done">✓ ぜんぶ選びました</Badge>}
        </span>
        <ChevronDownIcon className="size-5 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <p className="border-t px-4 pt-3 text-sm text-muted-foreground">{hint}</p>
      <ul className="max-h-[60vh] divide-y overflow-y-auto">
        {rows.map((r) => (
          <li key={r.value} className={cn("flex flex-col gap-1 px-4 py-2 sm:flex-row sm:items-center sm:gap-3", !value[r.value] && "bg-muted/40")}>
            <span className="min-w-0 flex-1 break-words">
              <b className="font-semibold">{r.value}</b>
              <span className="ml-2 text-sm text-muted-foreground tabular-nums">{r.count}回</span>
            </span>
            <NativeSelect aria-label={`「${r.value}」をどれにするか`} className="sm:w-72" value={value[r.value] ?? SKIP} onChange={(e) => onChange(r.value, e.target.value || null)}>
              <option value={SKIP}>{none}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </li>
        ))}
      </ul>
    </details>
  );
}

function SkipList({ skipped, title }: { skipped: { label: string; reason: string }[]; title?: string }) {
  const byReason = distinct(skipped.map((s) => s.reason));
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-[#344054]">
        {title ?? "入らない報告"}: {byReason.map((r) => `${r.value} ${r.count}件`).join("・")}
      </summary>
      <ul className="mt-1 max-h-48 overflow-y-auto">
        {skipped.map((s, i) => (
          <li key={i} className="text-muted-foreground">
            {s.label} — {s.reason}
          </li>
        ))}
      </ul>
    </details>
  );
}
