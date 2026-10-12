"use client";

import { ArrowRightIcon, BookmarkPlusIcon, CircleAlertIcon } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import { ShareButtons } from "@/components/app/share-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import type { ActionResult } from "@/lib/action-result";
import { type ConvertedLine, matchPerson, mergeCounts, type NameDict, normalizeName, type ParsedReport, parseReportText, resolveLines } from "@/lib/report-convert";
import { REPORT_PRESETS, type ReportPerson, renderReport, type ReportFormatBlocks } from "@/lib/report-format";
import { cn } from "@/lib/utils";

export type ConverterFormat = { id: string; name: string; blocks: ReportFormatBlocks };

/** 変換した結果（「実績に入れる」「報告に入れる」で使う） */
export type ConverterResult = {
  parsed: ParsedReport;
  /** 1行ずつ。name は当てた項目の名前（選んでいなければ null）。person は稼働者の名前にそろえたもの（なければ空） */
  rows: { raw: string; name: string | null; count: number; person: string; notes: string[] }[];
  /** 名前の分からない行の数（0 になるまで入れられない） */
  unresolved: number;
  /** 貼った文の稼働者（なければ defaults の稼働者） */
  workers: string[];
};

const HOW: Record<ConvertedLine["how"], { label: string; tone: "done" | "waiting" | "alert" }> = {
  exact: { label: "✓ 同じ名前", tone: "done" },
  alias: { label: "✓ 言いかえ表", tone: "done" },
  guess: { label: "たぶん", tone: "waiting" },
  unknown: { label: "選んでください", tone: "alert" },
};

/** 報告のメモ（「RMMNP: ソフトバンクから楽天 / iPhone17×2」）。CRM の報告のコメントに残すとき用 */
export function notesText(rows: ConverterResult["rows"]): string {
  return rows
    .filter((r) => r.notes.length)
    .map((r) => `${(r.name ?? r.raw).replace(/[（(]後日[)）]$/, "")}: ${r.notes.join(" / ")}`)
    .join("\n");
}

/**
 * LINE に書いた報告（いつもの書き方）を貼ると、取引先の公認名称・書式に直す（Phase 8・9）。
 * - 項目名は「同じ名前 → 言いかえ表 → 推測」の順に当てる。推測（黄）とわからない（赤）は選び直せる
 * - onSaveAlias があるとき（オーナー）は、選んだ言いかえを「覚える」で言いかえ表に足せる
 * - 日付・現場・稼働者は、貼った文になければ defaults を使う
 * - 「新規1(山田)」のように人の名前が付いていれば、1人ずつの件数にする（NICOLY フォーマット）。項目の下の行はメモ
 * - footer に「実績に入れる」などのボタンを出せる（変換した結果を渡す）
 */
export function ReportConverter({
  dict,
  formats,
  defaults,
  onSaveAlias,
  placeholder,
  footer,
  showOutput = true,
}: {
  dict: NameDict;
  formats: ConverterFormat[];
  defaults: { date: string; weekday: string; venue: string; workers: string[]; clientName: string };
  onSaveAlias?: (alias: string, name: string) => Promise<ActionResult>;
  placeholder?: string;
  footer?: (r: ConverterResult) => React.ReactNode;
  /** 変換した報告（書式の文）を出すか。書式のない取引先のマイページでは出さない */
  showOutput?: boolean;
}) {
  const [text, setText] = useState("");
  // 人が選び直した名前（元の書き方 → 項目の名前）
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [learned, setLearned] = useState<{ alias: string; name: string }[]>([]);
  const [pending, start] = useTransition();
  // 取引先の書式がなければ見本を使う
  const choices = formats.length ? formats : REPORT_PRESETS.map((p) => ({ id: `preset-${p.key}`, name: `見本: ${p.name}`, blocks: p.blocks }));
  const [formatId, setFormatId] = useState(choices[0]?.id ?? "");
  const format = choices.find((f) => f.id === formatId) ?? choices[0];

  const fullDict = useMemo(() => ({ ...dict, aliases: [...learned, ...dict.aliases] }), [dict, learned]);
  const parsed = useMemo(() => parseReportText(text, fullDict), [text, fullDict]);
  const lines = useMemo(() => resolveLines(parsed.lines, fullDict), [parsed, fullDict]);
  const keyOf = (raw: string) => normalizeName(raw);
  const nameOf = (l: ConvertedLine) => picks[keyOf(l.raw)] || l.name;
  const unresolved = lines.filter((l) => !nameOf(l));
  const workers = parsed.workers.length ? parsed.workers : defaults.workers;

  const result: ConverterResult = {
    parsed,
    rows: lines.map((l) => ({
      raw: l.raw,
      name: nameOf(l) || null,
      count: l.count,
      person: l.person ? (matchPerson(l.person, workers) ?? l.person) : workers.length === 1 ? workers[0] : "",
      notes: l.notes ?? [],
    })),
    unresolved: unresolved.length,
    workers,
  };

  const output = (() => {
    if (!format || (!parsed.lines.length && !parsed.comment)) return "";
    const tagged = parsed.lines.some((l) => l.person);
    // 人の名前のない報告は、全員分を1つに（今までどおり）。名前があれば1人ずつ
    const groups = tagged ? [...new Set(result.rows.map((r) => r.person))] : [workers.join("、")];
    const people: ReportPerson[] = groups.map((g, i) => ({
      name: g,
      role: "",
      items: mergeCounts(
        result.rows.filter((r) => !tagged || r.person === g).map((r) => ({ name: r.name || r.raw, count: r.count, notes: r.notes })),
        dict.items,
      ),
      comment: i === 0 ? parsed.comment : "",
    }));
    return renderReport(format.blocks, {
      date: parsed.date || defaults.date,
      weekday: parsed.date ? "" : defaults.weekday,
      clientName: defaults.clientName,
      events: [{ venueName: parsed.venue || defaults.venue, time: "", people, workers, remark: parsed.comment }],
    });
  })();

  function learn(raw: string, name: string) {
    if (!onSaveAlias) return;
    start(async () => {
      const r = await onSaveAlias(raw, name);
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message ?? "言いかえ表に足しました");
      setLearned((ls) => [{ alias: raw, name }, ...ls]);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="convert-text">LINE に書いた報告を貼ってください</Label>
        <Textarea
          id="convert-text"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder ?? "例:\n10/11\nDS〇〇\n山田\nキヘン 2\n光 1\nGOLD 1\n【所感】\n午後から来店が増えました"}
        />
        <p className="text-sm text-muted-foreground">
          1行に「項目 件数」（例: キヘン 2、MAX×3、新規1(山田)）。「後日」の下は後日の獲得、項目の下の行はメモ、【所感】のあとはコメントになります。
        </p>
      </div>

      {lines.length > 0 && (
        <section aria-label="項目名のそろえ方" className="flex flex-col gap-2">
          <h3 className="flex flex-wrap items-center gap-2 font-semibold">
            項目名のそろえ方
            {unresolved.length > 0 && <Badge tone="alert">選んでください {unresolved.length}件</Badge>}
          </h3>
          <ul className="divide-y rounded-xl border bg-card">
            {lines.map((l, i) => {
              const picked = picks[keyOf(l.raw)];
              const name = nameOf(l);
              const how = picked ? null : HOW[l.how];
              const canLearn = onSaveAlias && name && (picked || l.how === "guess") && !learned.some((x) => keyOf(x.alias) === keyOf(l.raw));
              return (
                <li key={`${l.raw}-${i}`} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                  <span className="flex min-w-0 flex-col sm:w-44">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 font-medium break-words">{l.raw}</span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">{l.count}</span>
                      <ArrowRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    </span>
                    {(Boolean(l.person) || (l.notes?.length ?? 0) > 0) && (
                      <span className="text-sm break-words text-muted-foreground">
                        {l.person && `${l.person}`}
                        {l.person && l.notes?.length ? " / " : ""}
                        {l.notes?.length ? `メモ: ${l.notes.join("・")}` : ""}
                      </span>
                    )}
                  </span>
                  <NativeSelect
                    aria-label={`「${l.raw}」をどの項目にするか`}
                    className={cn("min-w-0 flex-1", !name && "border-status-alert-solid")}
                    value={name ?? ""}
                    onChange={(e) => setPicks((p) => ({ ...p, [keyOf(l.raw)]: e.target.value }))}
                  >
                    <option value="">（選んでください）</option>
                    {dict.items.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </NativeSelect>
                  <span className="flex shrink-0 items-center gap-2">
                    {how ? <Badge tone={how.tone}>{how.label}</Badge> : <Badge tone="done">選びました</Badge>}
                    {canLearn && (
                      <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => learn(l.raw, name!)} title="次からは自動でこの項目にします">
                        <BookmarkPlusIcon />
                        覚える
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {parsed.unreadable.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-status-waiting-bg p-3 text-sm text-[#344054]">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-status-waiting" />
          <span>
            件数が読めなかった行があります（入っていません）: <b className="font-semibold">{parsed.unreadable.join("、")}</b>
            <br />「項目 件数」の形に直して貼ってください。
          </span>
        </p>
      )}

      {showOutput && output && (
        <section aria-label="変換した報告" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">変換した報告</h3>
            {choices.length > 1 && (
              <NativeSelect aria-label="書式" className="w-auto" value={formatId} onChange={(e) => setFormatId(e.target.value)}>
                {choices.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </div>
          {unresolved.length > 0 && <p className="text-sm text-status-alert">「選んでください」の項目は、元の書き方のまま出ています。</p>}
          <pre className="rounded-xl bg-[#8cabd8]/20 p-3 font-sans text-base break-words whitespace-pre-wrap">{output}</pre>
          <ShareButtons text={output} />
        </section>
      )}

      {lines.length > 0 && footer?.(result)}
    </div>
  );
}
