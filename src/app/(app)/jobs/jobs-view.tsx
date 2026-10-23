"use client";

import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { FillMeter } from "@/components/app/fill-meter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import type { Job, JobCandidate } from "@/lib/data/jobs";
import { formatShortJa, toJstDateString } from "@/lib/date";
import { fillOf } from "@/lib/fill";
import { isActive, KANBAN_COLUMNS, type Stage, STAGE_INFO, turnOf, urgencyOf } from "@/lib/jobs/stages";
import { cn } from "@/lib/utils";
import { setCandidateStage } from "./actions";
import { DeadlineBadge } from "./[id]/job-detail";
import { sinceLabel, StageBadge, StageDots } from "./stage-ui";

/** 一覧（案件カード）とカンバン（列＝段階、札＝人×案件）の切り替え */
export function JobsView({ jobs, view, includeClosed, now: nowIso }: { jobs: Job[]; view: "list" | "kanban"; includeClosed: boolean; now: string }) {
  const now = new Date(nowIso);
  const q = (v: "list" | "kanban", closed: boolean) => `/jobs?view=${v}${closed ? "&closed=1" : ""}`;
  return (
    <div className="flex flex-col gap-4 px-4" data-testid="jobs">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="見せ方" className="inline-flex rounded-lg border bg-muted/40 p-0.5">
          {(["list", "kanban"] as const).map((v) => (
            <Link key={v} role="tab" aria-selected={view === v} href={q(v, includeClosed)} className={cn("min-h-11 rounded-md px-4 py-2 text-sm font-semibold", view === v ? "bg-background shadow-sm" : "text-muted-foreground")}>
              {v === "list" ? "一覧" : "カンバン"}
            </Link>
          ))}
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={q(view, !includeClosed)}>{includeClosed ? "終わった案件を隠す" : "終わった案件も見る"}</Link>
        </Button>
      </div>
      {jobs.length === 0 ? (
        <div className="rounded-2xl border bg-card p-6 text-center shadow-card">
          <p className="font-semibold">案件はまだありません</p>
          <p className="mt-1 text-sm text-muted-foreground">取引先から来た案件の文（日付・会場・人数の一覧）を貼ると、案件と現場をまとめて作れます。</p>
          <Button asChild className="mt-3">
            <Link href="/jobs/new">案件を作る（文を貼る）</Link>
          </Button>
        </div>
      ) : view === "list" ? (
        <JobCards jobs={jobs} now={now} />
      ) : (
        <Kanban jobs={jobs} now={now} />
      )}
    </div>
  );
}

function JobCards({ jobs, now }: { jobs: Job[]; now: Date }) {
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {jobs.map((j) => {
        const active = j.candidates.filter((c) => isActive(c.stage));
        const todo = active.filter((c) => turnOf(c.stage, c.interviewAt, now) === "us").sort((a, b) => a.stageChangedAt.localeCompare(b.stageChangedAt));
        const overdue = todo.filter((c) => urgencyOf(c.stage, c.stageChangedAt, c.interviewAt, now) === "alert").length;
        return (
          <li key={j.id} className={cn("rounded-2xl border bg-card shadow-card", j.closedAt && "opacity-70")} data-testid="job-card">
            <Link href={`/jobs/${j.id}`} className="flex flex-col gap-3 p-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted-foreground">{j.clientName}</p>
                  <h2 className="truncate text-lg font-bold">{j.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {j.dateFrom && j.dateTo ? `${formatShortJa(j.dateFrom)}〜${formatShortJa(j.dateTo)}・${j.events.filter((e) => !e.cancelled).length}日・${j.venues.length}会場` : "現場はまだありません"}
                    {j.receivedOn && `　受けた日 ${formatShortJa(j.receivedOn)}`}
                  </p>
                  {j.entryDeadline && (
                    <p className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                      エントリー期限 {formatShortJa(j.entryDeadline)}
                      <DeadlineBadge deadline={j.entryDeadline} today={toJstDateString(now)} closed={Boolean(j.closedAt)} />
                    </p>
                  )}
                </div>
                {j.closedAt ? <Badge>終わった</Badge> : overdue > 0 ? <Badge tone="alert">自分の番 {overdue}件</Badge> : todo.length > 0 ? <Badge tone="waiting">自分の番 {todo.length}件</Badge> : null}
                <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
              </div>
              <FillMeter label="確定" fill={fillOf([{ required: j.requiredTotal, shortage: Math.max(0, j.requiredTotal - j.confirmedTotal) }])} compact />
              {j.candidates.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {j.candidates.slice(0, 8).map((c) => (
                    <li key={c.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm">
                      <span className="font-medium">{c.staffName}</span>
                      <Badge tone={urgencyOf(c.stage, c.stageChangedAt, c.interviewAt, now)}>{STAGE_INFO[c.stage].short}</Badge>
                    </li>
                  ))}
                  {j.candidates.length > 8 && <li className="text-sm text-muted-foreground">＋{j.candidates.length - 8}人</li>}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">候補はまだいません。開いて「候補を足す」から</p>
              )}
              {todo.length > 0 && (
                <ul className="flex flex-col gap-0.5 text-sm">
                  {todo.slice(0, 2).map((c) => (
                    <li key={c.id} className={cn("flex items-center gap-1", urgencyOf(c.stage, c.stageChangedAt, c.interviewAt, now) === "alert" ? "text-status-alert" : "text-[#344054]")}>
                      <span className="font-semibold">{c.staffName}</span>: {STAGE_INFO[c.stage].next}（{sinceLabel(c.stageChangedAt, now)}）
                    </li>
                  ))}
                  {todo.length > 2 && <li className="text-muted-foreground">ほか {todo.length - 2}件</li>}
                </ul>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

type Card = JobCandidate & { jobId: string; jobName: string; clientName: string };

/** カンバン。PC では札を列にドラッグして段階を変えられる（合格・不合格もここで動く。元に戻せる） */
function Kanban({ jobs, now }: { jobs: Job[]; now: Date }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [over, setOver] = useState<string | null>(null);
  const cards: Card[] = jobs.flatMap((j) => (j.closedAt ? [] : j.candidates.map((c) => ({ ...c, jobId: j.id, jobName: j.name, clientName: j.clientName }))));
  const move = (candidateId: string, stage: Stage) =>
    start(async () => {
      const r = await setCandidateStage(candidateId, stage);
      if (!r.ok || !r.data) return void toast.error(r.message);
      const prev = r.data.previous;
      const extra = r.data.confirmed ? `。打診中の ${r.data.confirmed}日分を確定にしました` : r.data.declined ? `。打診中の ${r.data.declined}日分を辞退にしました` : "";
      toast.success(`「${STAGE_INFO[stage].label}」にしました${extra}`, {
        action: {
          label: "元に戻す",
          onClick: () =>
            start(async () => {
              await setCandidateStage(candidateId, prev);
              router.refresh();
            }),
        },
      });
      router.refresh();
    });
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2" data-testid="jobs-kanban">
      <div className="grid min-w-[1120px] grid-cols-8 gap-2">
        {KANBAN_COLUMNS.map((col) => {
          const inCol = cards.filter((c) => col.stages.includes(c.stage)).sort((a, b) => a.stageChangedAt.localeCompare(b.stageChangedAt));
          return (
            <section
              key={col.key}
              aria-label={col.label}
              className={cn("flex min-h-40 flex-col gap-2 rounded-xl border bg-muted/30 p-2", over === col.key && "border-primary bg-primary/5")}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.key);
              }}
              onDragLeave={() => setOver((o) => (o === col.key ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id && !pending) move(id, col.stages[0]);
              }}
            >
              <h3 className="flex items-center justify-between px-1 text-sm font-semibold">
                {col.label}
                <span className="text-muted-foreground tabular-nums">{inCol.length}</span>
              </h3>
              {inCol.map((c) => (
                <article
                  key={c.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
                  className="cursor-grab rounded-lg border bg-card p-2 text-sm shadow-card active:cursor-grabbing"
                  data-testid="kanban-card"
                >
                  <Link href={`/jobs/${c.jobId}`} className="flex flex-col gap-1">
                    <span className="font-semibold">{c.staffName}</span>
                    <span className="truncate text-xs text-muted-foreground">{c.jobName}</span>
                    <StageBadge stage={c.stage} stageChangedAt={c.stageChangedAt} interviewAt={c.interviewAt} now={now} short />
                    <StageDots stage={c.stage} />
                  </Link>
                </article>
              ))}
            </section>
          );
        })}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">札をほかの列に動かすと段階が変わります（元に戻せます）。スマホでは案件を開いて進めてください。</p>
    </div>
  );
}
