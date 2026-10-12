"use client";

import { ClipboardCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { type ConverterFormat, type ConverterResult, notesText, ReportConverter } from "@/components/app/report-converter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toaster";
import { resolveMonthDay } from "@/lib/date";
import { matchPerson, type NameDict, normalizeName } from "@/lib/report-convert";
import { saveItemAlias } from "../../alias-actions";
import { type ConvertTarget, enterConvertedReports, loadConvertTargets } from "./actions";

export function ConvertClient({
  clients,
  clientId,
  dict,
  formats,
  defaults,
  canLearn,
  today,
}: {
  clients: { id: string; name: string }[];
  clientId: string;
  dict: NameDict;
  formats: ConverterFormat[];
  defaults: { date: string; weekday: string; venue: string; workers: string[]; clientName: string };
  canLearn: boolean;
  today: string;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-card">
      <div className="flex flex-col gap-1 sm:max-w-sm">
        <Label htmlFor="convert-client">取引先</Label>
        <NativeSelect id="convert-client" value={clientId} onChange={(e) => router.replace(`/results/convert?client=${e.target.value}`)}>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      {/* 取引先を変えたら作り直す（貼った文・選び直しは消える） */}
      <ReportConverter
        key={clientId}
        dict={dict}
        formats={formats}
        defaults={defaults}
        onSaveAlias={canLearn ? (alias, name) => saveItemAlias(clientId || null, alias, name) : undefined}
        footer={(r) => <EnterReports clientId={clientId} result={r} today={today} />}
      />
    </div>
  );
}

/** 「10/11」→ 日付（年は近いほう）。読めなければ今日 */
function dateOf(label: string, today: string): string {
  const m = label.match(/^(\d{1,2})\/(\d{1,2})$/);
  return (m && resolveMonthDay(Number(m[1]), Number(m[2]), today)) || today;
}

/**
 * 変換した報告を、その日の現場の人の速報として入れる（Phase 9）。
 * 現場は日付と現場名で、人は「新規1(山田)」の名前（なければ稼働者の名前）で選んでおく。選び直せる
 */
function EnterReports({ clientId, result, today }: { clientId: string; result: ConverterResult; today: string }) {
  const parsedDate = dateOf(result.parsed.date, today);
  // 日付は貼った文から。選び直したら、貼った文の日付が変わるまでその日
  const [override, setOverride] = useState<{ from: string; date: string } | null>(null);
  const date = override?.from === parsedDate ? override.date : parsedDate;
  const setDate = (d: string) => setOverride({ from: parsedDate, date: d });
  const [targets, setTargets] = useState<ConvertTarget[] | null>(null);
  const [eventId, setEventId] = useState("");
  const [map, setMap] = useState<Record<string, string>>({});
  const [loading, startLoading] = useTransition();
  const [pending, start] = useTransition();

  useEffect(() => {
    let alive = true;
    startLoading(async () => {
      const ts = await loadConvertTargets(clientId, date);
      if (!alive) return;
      setTargets(ts);
      // 現場名が合う現場（1つしかなければそれ）
      const v = normalizeName(result.parsed.venue);
      const hit = (v && ts.find((t) => normalizeName(t.venue) && (v.includes(normalizeName(t.venue)) || normalizeName(t.venue).includes(v)))) || (ts.length === 1 ? ts[0] : null);
      setEventId(hit?.eventId ?? "");
      setMap({});
    });
    return () => {
      alive = false;
    };
    // 現場名は最初に読んだときだけ使う（貼り直したら日付が変わるので読み直す）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, date]);

  const event = targets?.find((t) => t.eventId === eventId);
  const groups = useMemo(() => [...new Set(result.rows.map((r) => r.person))], [result.rows]);
  // 選んでいなければ、名前の合う人（名前のない行は、現場の人が1人ならその人）
  const pickOf = (g: string) => {
    if (g in map) return map[g];
    if (!event) return "";
    if (!g) return event.people.length === 1 ? event.people[0].assignmentId : "";
    const name = matchPerson(g, event.people.map((p) => p.name));
    return event.people.find((p) => p.name === name)?.assignmentId ?? "";
  };

  const entries = (() => {
    const byAsg = new Map<string, { counts: { name: string; count: number }[]; comment: string[] }>();
    let first = true;
    groups.forEach((g) => {
      const id = pickOf(g);
      if (!id) return;
      const rows = result.rows.filter((r) => r.person === g);
      const cur = byAsg.get(id) ?? { counts: [], comment: [] };
      cur.counts.push(...rows.map((r) => ({ name: r.name ?? r.raw, count: r.count })));
      // 所感は最初の人に、メモはその人に
      if (first && result.parsed.comment) cur.comment.push(result.parsed.comment);
      first = false;
      const notes = notesText(rows);
      if (notes) cur.comment.push(notes);
      byAsg.set(id, cur);
    });
    return [...byAsg].map(([assignment_id, v]) => ({ assignment_id, counts: v.counts, comment: v.comment.join("\n") }));
  })();

  function submit() {
    start(async () => {
      const r = await enterConvertedReports({ entries });
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      setTargets(await loadConvertTargets(clientId, date));
    });
  }

  return (
    <section aria-label="実績に入れる" className="flex flex-col gap-3 rounded-xl border p-3">
      <h3 className="flex items-center gap-2 font-semibold">
        <ClipboardCheckIcon aria-hidden className="size-5 text-primary" />
        実績に入れる（速報）
      </h3>
      <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
        <div className="flex flex-col gap-1">
          <Label htmlFor="enter-date">日付</Label>
          <Input id="enter-date" type="date" className="w-auto" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="enter-event">現場</Label>
          <NativeSelect id="enter-event" value={eventId} disabled={loading} onChange={(e) => (setEventId(e.target.value), setMap({}))}>
            <option value="">{targets && targets.length === 0 ? "この日の現場はありません" : "選んでください"}</option>
            {(targets ?? []).map((t) => (
              <option key={t.eventId} value={t.eventId}>
                {t.venue} {t.time}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {event && (
        <ul className="flex flex-col gap-2">
          {groups.map((g) => {
            const rows = result.rows.filter((r) => r.person === g);
            return (
              <li key={g || "-"} className="flex flex-col gap-1 rounded-lg bg-muted/50 p-2 sm:flex-row sm:items-center sm:gap-3">
                <span className="min-w-0 flex-1 break-words">
                  <b className="font-semibold">{g || "名前のない行"}</b>
                  <span className="ml-2 text-sm text-muted-foreground">{rows.map((r) => `${r.name ?? r.raw} ${r.count}`).join("・")}</span>
                </span>
                <NativeSelect aria-label={`「${g || "名前のない行"}」をだれの報告にするか`} className="sm:w-64" value={pickOf(g)} onChange={(e) => setMap((m) => ({ ...m, [g]: e.target.value }))}>
                  <option value="">入れない</option>
                  {event.people.map((p) => (
                    <option key={p.assignmentId} value={p.assignmentId}>
                      {p.name}（{p.role}）{p.state && ` ${p.state}`}
                    </option>
                  ))}
                </NativeSelect>
              </li>
            );
          })}
        </ul>
      )}
      {event && event.people.length === 0 && <p className="text-sm text-muted-foreground">この現場には確定した人がいません。</p>}

      {result.unresolved > 0 && (
        <p className="text-sm">
          <Badge tone="alert">選んでください {result.unresolved}件</Badge> の項目を選んでから入れてください。
        </p>
      )}
      <Button type="button" className="self-start" disabled={pending || loading || result.unresolved > 0 || entries.length === 0} onClick={submit}>
        {pending ? "入れています…" : entries.length ? `${entries.length}人分を速報で入れる` : "速報で入れる（人を選んでください）"}
      </Button>
      <p className="text-sm text-muted-foreground">本人がもう報告している人・確定ずみの人には入れません。確定は「実績確認」で行ってください。</p>
    </section>
  );
}
