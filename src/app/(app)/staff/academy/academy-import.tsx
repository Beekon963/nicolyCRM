"use client";

import { CheckCircle2Icon, FileUpIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { AcademyPill } from "@/components/app/academy-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { decodeCsv, parseCsv } from "@/lib/csv";
import { type AcademyCsv, NOT_ACADEMY_CSV, readAcademyCsv } from "@/lib/import/academy";
import { suggestStaff } from "@/lib/import/line-plan";
import { STAFF_STATUS } from "@/lib/labels";
import type { Database } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { importAcademyProgress } from "./actions";

type Staff = { id: string; name: string; kana: string; line_name: string; status: Database["public"]["Enums"]["staff_status"] };
type How = "linked" | "name" | null;
const SKIP = "";
/** 名前が同じか（空白・全角半角の違いは見ない） */
const sameName = (a: string, b: string) => a.normalize("NFKC").replace(/\s+/g, "") === b.normalize("NFKC").replace(/\s+/g, "");

/**
 * NICOLY アカデミーの進み具合の取り込み（Phase 14）。
 * 1. アカデミーの管理画面の「CSV」で保存したファイルを選ぶ（読み取りはこの画面の中だけ）
 * 2. 受講者ごとに CRM のスタッフを選ぶ（前に取り込んだ人は同じ人、はじめての人は名前から。分からない人は取り込まない）
 * 3. 取り込む → スタッフの詳細・一覧・打診の候補に出る
 */
export function AcademyImport({ staff, links }: { staff: Staff[]; links: Record<string, string> }) {
  const [csv, setCsv] = useState<AcademyCsv | null>(null);
  const [fileName, setFileName] = useState("");
  const [pick, setPick] = useState<Record<string, string>>({});
  const [how, setHow] = useState<Record<string, How>>({});
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();
  useUnsavedChanges(csv != null && done == null);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  async function onFile(file: File) {
    const r = readAcademyCsv(parseCsv(decodeCsv(await file.arrayBuffer())));
    if (!r) return void toast.error(NOT_ACADEMY_CSV);
    if (!r.rows.length) return void toast.error("受講者の行がありません。アカデミーの管理画面の「CSV」で保存したファイルを選んでください");
    // 最初の案: 前に取り込んだ人は同じスタッフ、はじめての人は名前が合うスタッフ（同じ人を2回は選ばない）
    const p: Record<string, string> = {};
    const h: Record<string, How> = {};
    const used = new Set(r.rows.map((row) => links[row.academyId]).filter(Boolean));
    for (const row of r.rows) {
      const linked = links[row.academyId];
      const byName = linked ? null : suggestStaff(row.name, staff);
      const id = linked ?? (byName && !used.has(byName) ? byName : null);
      if (id && !linked) used.add(id);
      p[row.academyId] = id ?? SKIP;
      h[row.academyId] = linked ? "linked" : id ? "name" : null;
    }
    setCsv(r);
    setFileName(file.name);
    setPick(p);
    setHow(h);
    setDone(null);
  }

  const chosen = useMemo(() => Object.values(pick).filter(Boolean), [pick]);
  const twice = useMemo(() => new Set(chosen.filter((id, i) => chosen.indexOf(id) !== i)), [chosen]);

  function runImport() {
    if (!csv) return;
    const rows = csv.rows.filter((r) => pick[r.academyId]).map((r) => ({ ...r, staffId: pick[r.academyId] }));
    start(async () => {
      const res = await importAcademyProgress(rows);
      if (!res.ok || !res.data) return void toast.error(res.message);
      toast.success(res.message ?? "取り込みました");
      setDone(res.data.count);
    });
  }

  if (!csv)
    return (
      <div className="flex flex-col gap-3 px-4 pb-8">
        <p>
          アカデミーの管理画面で<b>「CSV」</b>を押して保存したファイル（nicoly-progress.csv）を選んでください。
        </p>
        <p className="text-sm text-muted-foreground">
          受講者ごとに、称号・分野の進み具合・知識テスト・総合ロープレ・現場チェック・稼働判断を、スタッフの詳細・一覧・打診の候補に出します。前に取り込んだ人は、いちばん新しい記録に置きかわります。
        </p>
        <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 hover:bg-accent">
          <FileUpIcon className="size-8 text-muted-foreground" />
          <span className="font-medium">アカデミーの CSV を選ぶ</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" aria-label="アカデミーの CSV" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        </label>
      </div>
    );

  const options = [...staff].sort((a, b) => (a.kana || a.name).localeCompare(b.kana || b.name, "ja"));
  const open = csv.rows.filter((r) => !pick[r.academyId]).length;

  return (
    <div className="flex flex-col gap-4 px-4 pb-8">
      <section className="rounded-2xl border bg-card p-4 shadow-card">
        <p className="font-semibold break-words">{fileName}</p>
        <p className="text-sm text-muted-foreground">受講者 {csv.rows.length}人</p>
        {csv.warnings.length > 0 && (
          <details className="mt-1 text-sm">
            <summary className="cursor-pointer text-[#344054]">読まなかった行 {csv.warnings.length}件</summary>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {csv.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        )}
        <Button variant="ghost" size="sm" className="mt-1" onClick={() => setCsv(null)}>
          別のファイルを選ぶ
        </Button>
      </section>

      <section aria-label="受講者とスタッフ" className="rounded-2xl border bg-card shadow-card">
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-1 font-bold">
          受講者（{csv.rows.length}人）
          {open > 0 ? <Badge tone="waiting">取り込まない {open}人</Badge> : <Badge tone="done">✓ ぜんぶ選びました</Badge>}
        </div>
        <p className="px-4 pb-2 text-sm text-muted-foreground">CRM のスタッフを選んでください。前に取り込んだ人は同じ人、はじめての人は名前が合う人を選んでいます。CRM にいない人は「取り込まない」のままで大丈夫です。</p>
        <ul className="divide-y border-t">
          {csv.rows.map((r) => {
            const id = pick[r.academyId] ?? SKIP;
            const s = id ? staffById.get(id) : undefined;
            return (
              <li key={r.academyId} className={cn("flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3", !id && "bg-muted/40")}>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="break-words">
                    <b className="font-semibold">{r.name || "（名前なし）"}</b>
                    <span className="ml-2 text-sm text-muted-foreground">ログイン: {r.academyId}</span>
                    {!r.active && <span className="ml-2 text-sm text-muted-foreground">（アカデミーは利用停止中）</span>}
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    <AcademyPill badge={{ title: r.title, decision: r.decision }} />
                  </span>
                </div>
                <div className="flex flex-col gap-1 sm:w-72">
                  <NativeSelect
                    aria-label={`${r.name || r.academyId}さんを CRM のだれにするか`}
                    value={id}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPick((m) => ({ ...m, [r.academyId]: v }));
                      setHow((m) => ({ ...m, [r.academyId]: null }));
                    }}
                  >
                    <option value={SKIP}>取り込まない</option>
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.status === "active" ? o.name : `${o.name}（${STAFF_STATUS[o.status].label}）`}
                      </option>
                    ))}
                  </NativeSelect>
                  {id && twice.has(id) ? (
                    <span className="text-sm font-semibold text-status-alert">同じスタッフが2回選ばれています</span>
                  ) : how[r.academyId] === "linked" && s && r.name && !sameName(s.name, r.name) ? (
                    <span className="text-sm font-semibold text-status-waiting">前に取り込んだときと同じ人ですが、アカデミーの名前とちがいます。合っているか確かめてください</span>
                  ) : how[r.academyId] === "linked" ? (
                    <span className="text-sm text-muted-foreground">前に取り込んだときと同じ人</span>
                  ) : how[r.academyId] === "name" && s ? (
                    <span className="text-sm text-muted-foreground">名前から選びました。合っているか確かめてください</span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {done == null ? (
        <section aria-label="取り込む内容" className="sticky bottom-20 z-20 flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-raised md:bottom-4">
          <p>
            取り込む人 <b className="text-lg">{chosen.length}人</b>
          </p>
          {twice.size > 0 && <p className="text-sm font-semibold text-status-alert">同じスタッフを2人の受講者に選んでいます。どちらかを選び直してください</p>}
          <Button size="lg" disabled={pending || chosen.length === 0 || twice.size > 0} onClick={runImport}>
            {pending ? "取り込んでいます…" : `${chosen.length}人を取り込む`}
          </Button>
        </section>
      ) : (
        <section aria-label="取り込みの結果" className="flex flex-col gap-2 rounded-2xl border bg-status-done-bg p-4">
          <p className="flex items-center gap-2 font-bold text-status-done">
            <CheckCircle2Icon className="size-5" />
            {done}人のアカデミーの記録を入れました
          </p>
          <p className="text-sm text-[#344054]">スタッフの詳細・スタッフ一覧・打診の候補に出ます。</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/staff">スタッフ一覧を見る</Link>
            </Button>
            <Button variant="ghost" onClick={() => setCsv(null)}>
              別のファイルを取り込む
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
