"use client";

import { CheckCircle2Icon, FileUpIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toaster";
import { decodeCsv, parseCsv } from "@/lib/csv";
import { autoMap, IGNORED_HEADERS, mapRow, TARGETS, type ImportTarget } from "@/lib/import/fields";
import type { PreviewRow } from "@/lib/import/validate";
import { cn } from "@/lib/utils";
import { previewImport, runImport, type ImportReport } from "./actions";

type Step = "target" | "file" | "map" | "preview" | "done";

export function ImportWizard() {
  const [step, setStep] = useState<Step>("target");
  const [target, setTarget] = useState<ImportTarget>("staff");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [body, setBody] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number[]>>({});
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [overwrite, setOverwrite] = useState<number[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, start] = useTransition();
  const fields = TARGETS[target].fields;
  const rows = () => body.map((r) => mapRow(target, headers, r, mapping));

  async function onFile(file: File) {
    const table = parseCsv(decodeCsv(await file.arrayBuffer()));
    if (table.length < 2) return void toast.error("見出しの行とデータが入った CSV を選んでください");
    setFileName(file.name);
    setHeaders(table[0]);
    setBody(table.slice(1));
    setMapping(autoMap(target, table[0]));
    setStep("map");
  }

  const ok = preview.filter((p) => !p.errors.length && p.inFileDuplicateOf == null && (!p.duplicate || overwrite.includes(p.index)));
  const errorCount = preview.filter((p) => p.errors.length).length;
  const dupCount = preview.filter((p) => p.duplicate).length;

  return (
    <div className="flex flex-col gap-4 px-4 pb-8">
      <ol className="flex gap-1 text-sm">
        {(["target", "file", "map", "preview", "done"] as Step[]).map((s, i) => (
          <li key={s} className={cn("flex-1 rounded px-2 py-1 text-center", s === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
            {i + 1}. {{ target: "種類", file: "ファイル", map: "列の対応", preview: "確認", done: "結果" }[s]}
          </li>
        ))}
      </ol>

      {step === "target" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {(["staff", "client", "partner", "venue"] as ImportTarget[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTarget(t);
                setStep("file");
              }}
              className="flex min-h-16 flex-col items-start justify-center rounded-lg border p-4 text-left hover:bg-accent"
            >
              <span className="font-bold">{TARGETS[t].label}</span>
              <span className="text-sm text-muted-foreground">{TARGETS[t].dupHelp}</span>
            </button>
          ))}
        </div>
      )}

      {step === "file" && (
        <div className="flex flex-col gap-3">
          <p>
            <b>{TARGETS[target].label}</b>の CSV ファイルを選んでください。1行目は見出し（列名）にしてください。
            Google スプレッドシートは「ファイル → ダウンロード → カンマ区切り形式（.csv）」で保存できます。Excel の CSV（Shift_JIS）も読めます。
          </p>
          <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 hover:bg-accent">
            <FileUpIcon className="size-8 text-muted-foreground" />
            <span className="font-medium">CSV ファイルを選ぶ</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV ファイル" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          </label>
          <Button variant="ghost" className="self-start" onClick={() => setStep("target")}>
            戻る
          </Button>
        </div>
      )}

      {step === "map" && (
        <div className="flex flex-col gap-3">
          <p>
            {fileName}（{body.length}行）。それぞれの項目に入れる列を選んでください。列名から自動で選んであります。
          </p>
          {headers.some((h) => IGNORED_HEADERS.includes(h)) && (
            <p className="text-sm text-muted-foreground">「{headers.filter((h) => IGNORED_HEADERS.includes(h)).join("」「")}」の列は取り込みません。</p>
          )}
          <ul className="divide-y rounded-lg border">
            {fields.map((f) => (
              <li key={f.key} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-center">
                <div className="sm:w-56">
                  <p className="font-medium">
                    {f.label}
                    {f.required && <span className="text-status-alert">（必須）</span>}
                    {f.ownerOnly && <Badge tone="brand" className="ml-1">オーナーのみ</Badge>}
                  </p>
                  {f.help && <p className="text-sm text-muted-foreground">{f.help}</p>}
                </div>
                {f.multi ? (
                  <div className="flex flex-1 flex-wrap gap-1">
                    {headers.map((h, i) => {
                      const on = (mapping[f.key] ?? []).includes(i);
                      return (
                        <button
                          key={i}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setMapping({ ...mapping, [f.key]: on ? mapping[f.key].filter((x) => x !== i) : [...(mapping[f.key] ?? []), i] })}
                          className={cn("h-9 rounded-full border px-3 text-sm", on ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground")}
                        >
                          {h || `列${i + 1}`}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <NativeSelect
                    aria-label={`${f.label}に入れる列`}
                    className="flex-1"
                    value={mapping[f.key]?.[0] ?? ""}
                    onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value === "" ? [] : [Number(e.target.value)] })}
                  >
                    <option value="">（取り込まない）</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `列${i + 1}`}（例: {body[0]?.[i]?.slice(0, 20) || "空"}）
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </li>
            ))}
          </ul>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep("file")}>
              戻る
            </Button>
            <Button
              disabled={pending || fields.some((f) => f.required && !mapping[f.key]?.length)}
              onClick={() =>
                start(async () => {
                  const r = await previewImport(target, rows());
                  if (!r.ok) return void toast.error(r.message);
                  setPreview(r.data!);
                  setOverwrite([]);
                  setStep("preview");
                })
              }
            >
              確認へ
            </Button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge tone="done">取り込む {ok.length}行</Badge>
            {dupCount > 0 && <Badge tone="waiting">重複候補 {dupCount}行</Badge>}
            {errorCount > 0 && <Badge tone="alert">エラー {errorCount}行（取り込みません）</Badge>}
          </div>
          {dupCount > 0 && <p className="text-sm text-muted-foreground">重複候補は、チェックを入れた行だけ登録済みのデータを上書きします。チェックしない行は飛ばします。</p>}
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-2">行</th>
                  <th className="p-2">{fields[0].label}</th>
                  <th className="p-2">確認</th>
                  <th className="p-2">上書き</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p) => (
                  <tr key={p.index} className={cn("border-t align-top", p.errors.length && "bg-status-alert-bg")}>
                    <td className="p-2 text-muted-foreground">{p.index + 2}</td>
                    <td className="p-2 font-medium">{p.values.name}</td>
                    <td className="p-2">
                      {p.errors.map((e) => (
                        <p key={e} className="text-status-alert">
                          {e}
                        </p>
                      ))}
                      {p.duplicate && <p className="text-status-waiting">登録済み「{p.duplicate.name}」と同じ</p>}
                      {p.warnings.map((w) => (
                        <p key={w} className="text-muted-foreground">
                          {w}
                        </p>
                      ))}
                      {!p.errors.length && !p.duplicate && !p.warnings.length && <span className="text-status-done">OK</span>}
                    </td>
                    <td className="p-2">
                      {p.duplicate && !p.errors.length && p.inFileDuplicateOf == null && (
                        <Checkbox
                          aria-label={`${p.index + 2}行目で上書きする`}
                          checked={overwrite.includes(p.index)}
                          onCheckedChange={(v) => setOverwrite((o) => (v ? [...o, p.index] : o.filter((x) => x !== p.index)))}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between">
            <Button variant="ghost" onClick={() => setStep("map")}>
              戻る
            </Button>
            <Button
              disabled={pending || ok.length === 0}
              onClick={() =>
                start(async () => {
                  const r = await runImport(target, rows(), overwrite);
                  if (!r.ok) return void toast.error(r.message);
                  setReport(r.data!);
                  setStep("done");
                })
              }
            >
              {pending ? "取り込み中…" : `${ok.length}行を取り込む`}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && report && (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-lg font-bold text-status-done">
            <CheckCircle2Icon />
            取り込みが終わりました
          </p>
          <ul className="flex flex-wrap gap-2">
            <Badge tone="done">新規 {report.created}件</Badge>
            <Badge tone="brand">上書き {report.updated}件</Badge>
            <Badge tone="muted">飛ばした {report.skipped}件</Badge>
            {report.errors.length > 0 && <Badge tone="alert">エラー {report.errors.length}件</Badge>}
          </ul>
          {report.errors.length > 0 && (
            <ul className="rounded-lg border p-3 text-sm">
              {report.errors.map((e) => (
                <li key={e.row}>
                  {e.row}行目: {e.message}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={target === "staff" ? "/staff" : target === "venue" ? "/venues" : `/sales?kind=${target}`}>一覧を見る</Link>
            </Button>
            <Button onClick={() => setStep("target")}>続けて取り込む</Button>
          </div>
        </div>
      )}
    </div>
  );
}
