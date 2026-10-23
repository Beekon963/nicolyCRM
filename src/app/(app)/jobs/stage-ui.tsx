"use client";

import { Badge } from "@/components/ui/badge";
import { progressDots, type Stage, STAGE_INFO, TURN_LABEL, turnOf, urgencyOf } from "@/lib/jobs/stages";
import { cn } from "@/lib/utils";

/** 「3日」「5時間」のような経った時間 */
export function sinceLabel(iso: string, now: Date): string {
  const ms = Math.max(0, now.getTime() - new Date(iso).getTime());
  const h = Math.floor(ms / 3600_000);
  if (h < 1) return "いま";
  if (h < 24) return `${h}時間`;
  return `${Math.floor(h / 24)}日`;
}

/** 段階の点（●●●○○○○○○）。不合格・辞退は塗らない */
export function StageDots({ stage, className }: { stage: Stage; className?: string }) {
  const { filled, total } = progressDots(stage);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${STAGE_INFO[stage].label}（${filled}/${total}）`} title={STAGE_INFO[stage].label}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} aria-hidden className={cn("size-1.5 rounded-full", i < filled ? (stage === "passed" || stage === "briefed" ? "bg-status-done-solid" : "bg-primary") : "bg-border")} />
      ))}
    </span>
  );
}

/** 段階の札（色はだれの番か・経った時間で決まる）と「自分の番」などの文字 */
export function StageBadge({ stage, stageChangedAt, interviewAt, now, short = false }: { stage: Stage; stageChangedAt: string; interviewAt: string | null; now: Date; short?: boolean }) {
  const tone = urgencyOf(stage, stageChangedAt, interviewAt, now);
  const turn = turnOf(stage, interviewAt, now);
  const info = STAGE_INFO[stage];
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={tone}>{short ? info.short : info.label}</Badge>
      {TURN_LABEL[turn] && (
        <span className={cn("text-xs", tone === "alert" ? "font-semibold text-status-alert" : "text-muted-foreground")}>
          {TURN_LABEL[turn]}・{sinceLabel(stageChangedAt, now)}
        </span>
      )}
    </span>
  );
}
