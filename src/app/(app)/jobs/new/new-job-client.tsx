"use client";

import { CheckIcon, CircleAlertIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { type DateString, formatShortJa } from "@/lib/date";
import { suggestVenueMatch } from "@/lib/import/name-match";
import { datesToText, parseDateList, parseJobOffer } from "@/lib/jobs/parse";
import { searchNorm } from "@/lib/search";
import { cn } from "@/lib/utils";
import { createJob } from "../actions";

type Opt = { id: string; name: string };
/** 店舗の行（文から読んだもの・手で足したもの）。dateText が空なら全体の日程、rate が空なら案件の単価（オーナーだけ） */
type VenueRow = { key: string; name: string; label: string; dateText: string; count: number; rate: string };
type RowEdit = Partial<Pick<VenueRow, "name" | "dateText" | "count" | "rate">>;
type Draft = { forText: string; edits: Record<string, RowEdit>; removed: string[]; extra: VenueRow[] };

const NEW = "new";
const EMPTY_DRAFT: Draft = { forText: "", edits: {}, removed: [], extra: [] };

/**
 * 案件の文を貼る → 要素ごとに分けて読む（全体の日程・エントリー期限・店舗ごとの日程と人数・単価・稼働時間・備考）→
 * 店舗の表で直す（会場は CRM の会場に合わせる。候補を先に選ぶ）→ 案件と現場（日 × 店舗）をまとめて作る。
 * 単価と単価のメモはオーナーだけ（管理者には欄を出さない）
 */
export function NewJobClient({ clients, venues, roles, today, initialText = "", isOwner }: { clients: Opt[]; venues: Opt[]; roles: Opt[]; today: DateString; initialText?: string; isOwner: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const parsed = useMemo(() => parseJobOffer(text, today), [text, today]);
  /** 店舗の表の手直し（文を貼り直したら消える） */
  const [draftState, setDraftState] = useState<Draft>(EMPTY_DRAFT);
  const draft = draftState.forText === text ? draftState : EMPTY_DRAFT;
  const patchDraft = (p: Partial<Draft>) => setDraftState({ ...draft, forText: text, ...p });
  /** 会場の選び直し（文の書き方 → 会場の id か「新しく作る」）。選び直していないものは候補から決める */
  const [venueOverrides, setVenueOverrides] = useState<Record<string, string>>({});
  const [clientId, setClientId] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [contactName, setContactName] = useState("");
  /** 手で直した欄（直していない欄は読み取った内容を出す） */
  const [edits, setEdits] = useState<{ name?: string; hoursNote?: string; notes?: string; rate?: string; transport?: boolean; rateNote?: string; deadline?: string; globalText?: string }>({});
  const [pending, start] = useTransition();

  // 読み取った内容（手で直していない欄に出す）
  const month = parsed.month ? `${Number(parsed.month.slice(5, 7))}月` : "";
  const name = edits.name ?? (parsed.venues.length ? `${month}の案件` : "");
  const hoursNote = edits.hoursNote ?? parsed.hoursNote;
  const notes = edits.notes ?? parsed.notes;
  const rate = edits.rate ?? (parsed.rate != null ? String(parsed.rate) : "");
  const transport = edits.transport ?? parsed.transportIncluded;
  const rateNote = edits.rateNote ?? parsed.rateLines.join("\n");
  const deadline = edits.deadline ?? parsed.entryDeadline ?? "";
  const globalText = edits.globalText ?? datesToText(parsed.globalDates);
  /** 「2・3」のように日だけ書いたときに使う月（文から分かった月） */
  const ctxMonth = parsed.month ? Number(parsed.month.slice(5, 7)) : null;
  const globalDates = useMemo(() => parseDateList(globalText, today, { month: ctxMonth }), [globalText, today, ctxMonth]);

  // 店舗の表: 文から読んだ行（手直しを重ねる）＋ 足した行
  const rows: VenueRow[] = [
    ...parsed.venues.map((v, i) => ({ key: `p:${i}`, name: v.name, label: v.label, dateText: v.dateText, count: v.count, rate: v.rate != null ? String(v.rate) : "", ...draft.edits[`p:${i}`] })).filter((r) => !draft.removed.includes(r.key)),
    ...draft.extra,
  ];
  const editRow = (key: string, patch: RowEdit) => {
    if (key.startsWith("x:")) patchDraft({ extra: draft.extra.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
    else patchDraft({ edits: { ...draft.edits, [key]: { ...draft.edits[key], ...patch } } });
  };
  const removeRow = (key: string) => {
    if (key.startsWith("x:")) patchDraft({ extra: draft.extra.filter((r) => r.key !== key) });
    else patchDraft({ removed: [...draft.removed, key] });
  };
  const addRow = () => patchDraft({ extra: [...draft.extra, { key: `x:${Date.now()}`, name: "", label: "", dateText: "", count: 1, rate: "" }] });

  // 店舗 × 日程 → 現場の行（同じ日・同じ店舗は人数の大きいほう）
  const rowDates = (r: VenueRow) => (r.dateText.trim() ? parseDateList(r.dateText, today, { month: ctxMonth }) : globalDates);
  /** 店舗の行の単価（オーナーだけ。空や数字でないときは案件の単価） */
  const rowRate = (r: VenueRow) => (isOwner && /^\d{1,8}$/.test(r.rate.trim()) ? Number(r.rate.trim()) : null);
  const byKey = new Map<string, { date: DateString; venueText: string; count: number; label: string; rate: number | null }>();
  for (const r of rows) {
    const venueText = r.name.trim();
    if (!venueText) continue;
    for (const date of rowDates(r)) {
      const k = `${date}|${venueText}`;
      const cur = byKey.get(k);
      if (!cur) byKey.set(k, { date, venueText, count: r.count, label: r.label, rate: rowRate(r) });
      else if (cur.count < r.count) cur.count = r.count;
    }
  }
  const lines = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.venueText.localeCompare(b.venueText, "ja"));
  const venueTexts = [...new Set(rows.map((r) => r.name.trim()).filter(Boolean))];

  // 会場: 選び直したもの → 同じ名前 → 近いもの（候補）→ 新しく作る
  const suggested = (v: string) => {
    const exact = venues.find((x) => searchNorm(x.name) === searchNorm(v));
    return exact ? null : suggestVenueMatch(v, venues);
  };
  const venueMap: Record<string, string> = Object.fromEntries(
    venueTexts.map((v) => [v, venueOverrides[v] ?? venues.find((x) => searchNorm(x.name) === searchNorm(v))?.id ?? suggestVenueMatch(v, venues)?.id ?? NEW]),
  );
  const submit = () =>
    start(async () => {
      const r = await createJob({
        clientId,
        name,
        receivedOn: receivedOn || null,
        startTime: parsed.start ?? "",
        endTime: parsed.end ?? "",
        hoursNote,
        notes,
        contactName,
        sourceText: text,
        entryDeadline: deadline || null,
        roleId,
        lines: lines.map((l) => ({ date: l.date, venueId: venueMap[l.venueText] && venueMap[l.venueText] !== NEW ? venueMap[l.venueText] : null, newVenueName: venueMap[l.venueText] === NEW ? l.venueText : "", count: l.count, label: l.label, rate: l.rate })),
        rate: isOwner && rate.trim() ? Number(rate) : null,
        transportIncluded: isOwner ? transport : false,
        rateNote: isOwner ? rateNote : "",
      });
      if (!r.ok || !r.data) return void toast.error(r.message);
      toast.success(r.message);
      router.push(`/jobs/${r.data.id}`);
    });

  const dateFrom = lines[0]?.date ?? null;
  const dateTo = lines.at(-1)?.date ?? null;
  const withDates = rows.filter((r) => r.name.trim() && rowDates(r).length).length;

  return (
    <div className="flex flex-col gap-4 px-4" data-testid="job-new">
      <div className="flex flex-col gap-1">
        <Label htmlFor="job-text">取引先の案件の文を貼ってください</Label>
        <Textarea
          id="job-text"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"例:\n■ 日程\n1/1〜1/4\n■ エントリー期限\n11/20まで\n■ 店舗\n① 〇〇カメラ 北店\n【日程】1/2・1/3・1/4\n② △△モール →2名\n\n単価\n20000円/日　交通費込\n\n稼働時間\n10:00〜18:00\n\n「20 〇〇モール外販　1名」の形の行が並ぶ文も読めます"}
          className="text-base"
        />
        <p className="text-sm text-muted-foreground">LINE の文を長押し →「コピー」で、ここに貼れます。書き方が取引先ごとに違っても、日程・期限・店舗・人数・単価・稼働時間・備考に分けて読みます。「①役割 / 店舗：… / 日程：3.26日 / 単価：…」のように役割ごとに分かれた文も読めます（3.26日 = 3日と26日）。読めなかった所は下の表で直せます。</p>
      </div>

      {text.trim() && (
        <section aria-label="読み取った内容" className="flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-card">
          <h2 className="font-semibold">読み取った内容</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
            <Row label="店舗" ok={rows.length > 0}>
              {rows.length ? `${rows.length}件（日程あり ${withDates}件）` : "読めませんでした。「① 〇〇店」「・〇〇店 →2名」「20 〇〇モール 1名」のような店舗の行があるか確かめてください（下の表で足せます）"}
            </Row>
            <Row label="日程" ok={lines.length > 0}>
              {lines.length ? `現場 ${lines.length}件（${formatShortJa(dateFrom!)}〜${formatShortJa(dateTo!)}・${venueTexts.length}会場）` : "読めませんでした。全体の日程か、店舗ごとの日程を下の表に入れてください"}
            </Row>
            <Row label="期限" ok={Boolean(parsed.entryDeadline)}>{parsed.entryDeadline ? `エントリー期限 ${formatShortJa(parsed.entryDeadline)}` : "書いてありませんでした（なくても作れます）"}</Row>
            {isOwner && (
              <Row label="単価" ok={parsed.rate != null}>
                {parsed.rate != null ? `${parsed.rate.toLocaleString()}円/日${parsed.transportIncluded ? "（交通費込）" : ""}` : "読めませんでした（なくても作れます）"}
                {parsed.rateLines.length > 0 && <span className="block text-sm text-muted-foreground">金額の行 {parsed.rateLines.length}件は「単価のメモ」に入ります</span>}
              </Row>
            )}
            <Row label="稼働時間" ok={Boolean(parsed.hoursNote)}>{parsed.hoursNote || "読めませんでした（なくても作れます）"}</Row>
            <Row label="備考" ok={Boolean(parsed.notes)}>{parsed.notes ? <span className="whitespace-pre-wrap">{parsed.notes}</span> : "なし"}</Row>
          </dl>
        </section>
      )}

      {/* 店舗と日程の表 */}
      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-card" aria-label="店舗と日程">
        <h2 className="font-semibold">
          店舗と日程 <span className="text-sm font-normal text-muted-foreground">店舗 {rows.length}件 → 現場 {lines.length}件</span>
        </h2>
        <div className="flex flex-col gap-1">
          <Label htmlFor="job-global-dates">全体の日程（店舗に日程が書いてないときに使う）</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input id="job-global-dates" value={globalText} onChange={(e) => setEdits((x) => ({ ...x, globalText: e.target.value }))} placeholder="1/1〜1/4・1/6" className="w-full sm:w-72" />
            <span className={cn("text-sm", globalText.trim() && !globalDates.length ? "text-status-alert" : "text-muted-foreground")}>{globalText.trim() ? (globalDates.length ? `${globalDates.length}日` : "読めません（例: 1/1〜1/4・1/6）") : "なし"}</span>
          </div>
        </div>
        {rows.length > 0 && (
          <ul className="flex flex-col gap-2" data-testid="job-venue-rows">
            {rows.map((r) => {
              const own = r.dateText.trim();
              const ds = rowDates(r);
              return (
                <li key={r.key} className={cn("grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 rounded-xl border p-2 sm:items-end", isOwner ? "sm:grid-cols-[1fr_12rem_5rem_7rem_auto]" : "sm:grid-cols-[1fr_12rem_5rem_auto]")} data-testid="job-venue-row">
                  <div className="flex min-w-0 flex-col gap-1">
                    <Label htmlFor={`${r.key}-name`} className="min-w-0 flex-wrap text-xs text-muted-foreground">
                      店舗{r.label && <span className="font-normal text-[#344054]">{r.label}</span>}
                    </Label>
                    <Input id={`${r.key}-name`} value={r.name} list="job-venue-names" aria-label="店舗の名前" onChange={(e) => editRow(r.key, { name: e.target.value })} />
                  </div>
                  <Button type="button" size="icon" variant="ghost" className="self-end sm:order-last" aria-label={`${r.name || "この店舗"} を外す`} onClick={() => removeRow(r.key)}>
                    <Trash2Icon className="size-4" />
                  </Button>
                  <div className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
                    <Label htmlFor={`${r.key}-dates`} className="text-xs text-muted-foreground">
                      日程{own ? `（${ds.length}日）` : globalDates.length ? `（全体の日程 ${globalDates.length}日）` : ""}
                    </Label>
                    <Input id={`${r.key}-dates`} value={r.dateText} aria-label={`${r.name || "この店舗"}の日程`} placeholder="全体の日程" onChange={(e) => editRow(r.key, { dateText: e.target.value })} className={cn(own && !ds.length && "border-status-alert")} />
                  </div>
                  {/* スマホでは 人数・単価 を2列に並べる（PC では行の列にそのまま入る） */}
                  <div className="col-span-2 grid grid-cols-2 gap-2 sm:contents">
                    <div className="flex min-w-0 flex-col gap-1">
                      <Label htmlFor={`${r.key}-count`} className="text-xs text-muted-foreground">
                        人数
                      </Label>
                      <Input id={`${r.key}-count`} type="number" inputMode="numeric" min={1} max={50} value={r.count} aria-label={`${r.name || "この店舗"}の人数`} onChange={(e) => editRow(r.key, { count: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />
                    </div>
                    {isOwner && (
                      <div className="flex min-w-0 flex-col gap-1">
                        <Label htmlFor={`${r.key}-rate`} className="text-xs text-muted-foreground">
                          単価（円）
                        </Label>
                        <Input id={`${r.key}-rate`} type="number" inputMode="numeric" min={0} value={r.rate} aria-label={`${r.name || "この店舗"}の単価`} placeholder="案件の単価" onChange={(e) => editRow(r.key, { rate: e.target.value })} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <datalist id="job-venue-names">
          {venues.map((v) => (
            <option key={v.id} value={v.name} />
          ))}
        </datalist>
        <Button type="button" variant="outline" onClick={addRow} className="w-fit gap-1">
          <PlusIcon className="size-4" />
          店舗を足す
        </Button>
        {lines.length > 0 && (
          <details>
            <summary className="w-fit cursor-pointer text-sm text-primary">できる現場 {lines.length}件を見る</summary>
            <ul className="mt-2 divide-y text-sm" data-testid="job-lines">
              {lines.map((l) => (
                <li key={`${l.date}|${l.venueText}`} className="flex items-center gap-2 py-1">
                  <span className="w-20 shrink-0 tabular-nums">{formatShortJa(l.date)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {l.venueText}
                    {l.label && <span className="ml-1 text-xs text-muted-foreground">{l.label}</span>}
                  </span>
                  <span className="shrink-0 tabular-nums">{l.count}名</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* 会場の対応づけ */}
      {venueTexts.length > 0 && (
        <section className="flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-card" aria-label="会場">
          <h2 className="flex items-center gap-2 font-semibold">
            会場
            {venueTexts.some((v) => venueMap[v] === NEW) ? <Badge tone="waiting">新しく作る {venueTexts.filter((v) => venueMap[v] === NEW).length}件</Badge> : <Badge tone="done">すべて合わせ済み</Badge>}
          </h2>
          <p className="text-sm text-muted-foreground">文の書き方を、このアプリの会場に合わせます。近い名前は候補として先に選んであります。ないものは「この名前で新しく作る」（住所などはあとで会場の画面で）。</p>
          <ul className="flex flex-col gap-2">
            {venueTexts.map((v) => {
              const s = suggested(v);
              const val = venueMap[v] ?? NEW;
              return (
                <li key={v} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <span className="min-w-0 break-words font-medium sm:w-64">
                    {v}
                    {s && val === s.id && (
                      <span className="flex items-center gap-1 text-sm font-normal text-muted-foreground">
                        <Badge tone="waiting">候補</Badge>
                        {s.why}
                      </span>
                    )}
                  </span>
                  <NativeSelect aria-label={`${v}の会場`} value={val} onChange={(e) => setVenueOverrides((m) => ({ ...m, [v]: e.target.value }))} className="min-w-0 flex-1">
                    <option value={NEW}>この名前で新しく作る</option>
                    {venues.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </NativeSelect>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 案件の内容 */}
      <section className="grid gap-3 rounded-2xl border bg-card p-4 shadow-card sm:grid-cols-2" aria-label="案件の内容">
        <div className="flex flex-col gap-1">
          <Label htmlFor="job-client">取引先</Label>
          <NativeSelect id="job-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">選んでください</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="job-name">案件の名前</Label>
          <Input id="job-name" value={name} onChange={(e) => setEdits((x) => ({ ...x, name: e.target.value }))} placeholder="11月の案件" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="job-received">受けた日</Label>
          <Input id="job-received" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="job-deadline">エントリー期限（取引先に返事をする期限）</Label>
          <Input id="job-deadline" type="date" value={deadline} onChange={(e) => setEdits((x) => ({ ...x, deadline: e.target.value }))} className="w-40" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="job-role">人数を入れる役割</Label>
          <NativeSelect id="job-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="job-hours">稼働時間</Label>
          <Input id="job-hours" value={hoursNote} onChange={(e) => setEdits((x) => ({ ...x, hoursNote: e.target.value }))} placeholder="10:00〜18:00 or 11:00〜19:00" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="job-contact">取引先の担当者</Label>
          <Input id="job-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </div>
        {isOwner && (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor="job-rate">単価（請求の人日単価・円。オーナーだけ）</Label>
              <div className="flex items-center gap-3">
                <Input id="job-rate" type="number" inputMode="numeric" min={0} value={rate} onChange={(e) => setEdits((x) => ({ ...x, rate: e.target.value }))} className="w-36" />
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={transport} onCheckedChange={(v) => setEdits((x) => ({ ...x, transport: v === true }))} aria-label="交通費込" />
                  交通費込
                </label>
              </div>
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor="job-rate-note">単価のメモ（文の中の金額の行。オーナーだけ）</Label>
              <Textarea id="job-rate-note" rows={2} value={rateNote} onChange={(e) => setEdits((x) => ({ ...x, rateNote: e.target.value }))} placeholder="弱 30,000円 / 一律 24,000円 など" />
            </div>
          </>
        )}
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor="job-notes">備考（募集の条件など）</Label>
          <Textarea id="job-notes" rows={3} value={notes} onChange={(e) => setEdits((x) => ({ ...x, notes: e.target.value }))} />
        </div>
      </section>

      <div className="flex flex-col-reverse gap-2 pb-4 sm:flex-row sm:justify-end">
        <Button size="lg" disabled={pending || !clientId || !lines.length || !name.trim()} onClick={submit} className="gap-1.5">
          {pending ? "作っています…" : `案件と現場を作る（現場 ${lines.length}件）`}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, ok, children }: { label: string; ok: boolean; children: React.ReactNode }) {
  return (
    <>
      <dt className="flex items-start gap-1 font-medium whitespace-nowrap">
        {ok ? <CheckIcon aria-label="読めました" className="mt-1 size-4 text-status-done" /> : <CircleAlertIcon aria-label="読めませんでした" className="mt-1 size-4 text-status-waiting" />}
        {label}
      </dt>
      <dd className={cn("min-w-0 break-words", !ok && "text-[#344054]")}>{children}</dd>
    </>
  );
}
