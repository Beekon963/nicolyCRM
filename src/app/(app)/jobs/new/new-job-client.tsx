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
import { parseJobOffer } from "@/lib/jobs/parse";
import { searchNorm } from "@/lib/search";
import { cn } from "@/lib/utils";
import { createJob } from "../actions";

type Opt = { id: string; name: string };
type Line = { key: string; date: DateString; venueText: string; count: number };

const NEW = "new";

/**
 * 案件の文を貼る → 読み取った日程の表（会場は CRM の会場に合わせる。候補を先に選ぶ）→ 案件と現場をまとめて作る。
 * 単価はオーナーだけ（管理者には欄を出さない）
 */
export function NewJobClient({ clients, venues, roles, today, initialText = "", isOwner }: { clients: Opt[]; venues: Opt[]; roles: Opt[]; today: DateString; initialText?: string; isOwner: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const parsed = useMemo(() => parseJobOffer(text, today), [text, today]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<Line[]>([]);
  /** 会場の選び直し（文の書き方 → 会場の id か「新しく作る」）。選び直していないものは候補から決める */
  const [venueOverrides, setVenueOverrides] = useState<Record<string, string>>({});
  const [clientId, setClientId] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [contactName, setContactName] = useState("");
  /** 手で直した欄（直していない欄は読み取った内容を出す） */
  const [edits, setEdits] = useState<{ name?: string; hoursNote?: string; notes?: string; rate?: string; transport?: boolean }>({});
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<{ date: string; venueText: string; count: string }>({ date: "", venueText: "", count: "1" });

  const parsedLines: Line[] = useMemo(() => parsed.lines.map((l) => ({ key: `p:${l.date}|${l.venue}`, date: l.date, venueText: l.venue, count: l.count })), [parsed]);
  const lines = [...parsedLines.filter((l) => !removed.has(l.key)), ...extra];
  const venueTexts = [...new Set(lines.map((l) => l.venueText))];

  // 読み取った内容（手で直していない欄に出す）
  const month = parsed.month ? `${Number(parsed.month.slice(5, 7))}月` : "";
  const name = edits.name ?? (parsed.lines.length ? `${month}の案件` : "");
  const hoursNote = edits.hoursNote ?? parsed.hoursNote;
  const notes = edits.notes ?? parsed.notes;
  const rate = edits.rate ?? (parsed.rate != null ? String(parsed.rate) : "");
  const transport = edits.transport ?? parsed.transportIncluded;
  // 会場: 選び直したもの → 同じ名前 → 近いもの（候補）→ 新しく作る
  const suggested = (v: string) => {
    const exact = venues.find((x) => searchNorm(x.name) === searchNorm(v));
    return exact ? null : suggestVenueMatch(v, venues);
  };
  const venueMap: Record<string, string> = Object.fromEntries(
    venueTexts.map((v) => [v, venueOverrides[v] ?? venues.find((x) => searchNorm(x.name) === searchNorm(v))?.id ?? suggestVenueMatch(v, venues)?.id ?? NEW]),
  );
  const addExtra = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !draft.venueText.trim()) return void toast.error("日付と会場を入れてください");
    const n = Number(draft.count);
    setExtra((xs) => [...xs, { key: `x:${Date.now()}`, date: draft.date as DateString, venueText: draft.venueText.trim(), count: Number.isInteger(n) && n > 0 ? n : 1 }]);
    setDraft({ date: "", venueText: "", count: "1" });
  };
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
        roleId,
        lines: lines.map((l) => ({ date: l.date, venueId: venueMap[l.venueText] && venueMap[l.venueText] !== NEW ? venueMap[l.venueText] : null, newVenueName: venueMap[l.venueText] === NEW ? l.venueText : "", count: l.count })),
        rate: isOwner && rate.trim() ? Number(rate) : null,
        transportIncluded: isOwner ? transport : false,
      });
      if (!r.ok || !r.data) return void toast.error(r.message);
      toast.success(r.message);
      router.push(`/jobs/${r.data.id}`);
    });

  const dateFrom = lines.length ? lines.map((l) => l.date).sort()[0] : null;
  const dateTo = lines.length ? lines.map((l) => l.date).sort().at(-1)! : null;

  return (
    <div className="flex flex-col gap-4 px-4" data-testid="job-new">
      <div className="flex flex-col gap-1">
        <Label htmlFor="job-text">取引先の案件の文を貼ってください</Label>
        <Textarea id="job-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"例:\n20 〇〇モール外販　1名\n21 〇〇モール外販　2名\n22 △△軒先　1名\n\n単価\n20000円/日　交通費込\n\n稼働時間\n10:00〜18:00\n\n備考\n外販経験者"} className="text-base" />
        <p className="text-sm text-muted-foreground">LINE の文を長押し →「コピー」で、ここに貼れます。日付だけの行（人数がない行）は読みません。</p>
      </div>

      {text.trim() && (
        <section aria-label="読み取った内容" className="flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-card">
          <h2 className="font-semibold">読み取った内容</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
            <Row label="日程" ok={lines.length > 0}>
              {lines.length ? `${lines.length}件（${formatShortJa(dateFrom!)}〜${formatShortJa(dateTo!)}・${venueTexts.length}会場）` : "読めませんでした。「20 〇〇モール 1名」の形の行が入っているか確かめてください（下で1行ずつ足せます）"}
            </Row>
            {isOwner && <Row label="単価" ok={parsed.rate != null}>{parsed.rate != null ? `${parsed.rate.toLocaleString()}円/日${parsed.transportIncluded ? "（交通費込）" : ""}` : "読めませんでした（なくても作れます）"}</Row>}
            <Row label="稼働時間" ok={Boolean(parsed.hoursNote)}>{parsed.hoursNote || "読めませんでした（なくても作れます）"}</Row>
            <Row label="備考" ok={Boolean(parsed.notes)}>{parsed.notes ? <span className="whitespace-pre-wrap">{parsed.notes}</span> : "なし"}</Row>
          </dl>
        </section>
      )}

      {/* 日程の表 */}
      <section className="flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-card" aria-label="日程">
        <h2 className="font-semibold">日程（{lines.length}件）</h2>
        {lines.length > 0 && (
          <ul className="divide-y">
            {lines.map((l) => (
              <li key={l.key} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="w-20 shrink-0 tabular-nums">{formatShortJa(l.date)}</span>
                <span className="min-w-0 flex-1 truncate">{l.venueText}</span>
                <span className="shrink-0 tabular-nums">{l.count}名</span>
                <Button type="button" size="icon" variant="ghost" aria-label={`${formatShortJa(l.date)} ${l.venueText} を外す`} onClick={() => (l.key.startsWith("p:") ? setRemoved((s) => new Set(s).add(l.key)) : setExtra((xs) => xs.filter((x) => x.key !== l.key)))}>
                  <Trash2Icon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-[auto_1fr_auto_auto] items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="job-draft-date">日付</Label>
            <Input id="job-draft-date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className="w-36" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor="job-draft-venue">会場</Label>
            <Input id="job-draft-venue" value={draft.venueText} list="job-venue-names" onChange={(e) => setDraft({ ...draft, venueText: e.target.value })} />
            <datalist id="job-venue-names">
              {venues.map((v) => (
                <option key={v.id} value={v.name} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="job-draft-count">人数</Label>
            <Input id="job-draft-count" type="number" min={1} max={50} value={draft.count} onChange={(e) => setDraft({ ...draft, count: e.target.value })} className="w-20" />
          </div>
          <Button type="button" variant="outline" onClick={addExtra} className="gap-1">
            <PlusIcon className="size-4" />
            足す
          </Button>
        </div>
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
