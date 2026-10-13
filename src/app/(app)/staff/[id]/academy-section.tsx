import { CheckIcon, GraduationCapIcon } from "lucide-react";
import Link from "next/link";
import { BAR } from "@/components/app/fill-meter";
import { Field } from "@/components/app/list-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type AcademyProgress, areaComplete } from "@/lib/academy";
import { formatLongJa, toJstDateString } from "@/lib/date";
import type { AcademyArea } from "@/lib/import/academy";
import { ACADEMY_DECISION } from "@/lib/labels";

/**
 * スタッフの詳細の「アカデミー」（Phase 14）。NICOLY アカデミーから取り込んだ、いまのスキル感。
 * 称号と稼働判断を大きく、分野ごとの進み具合はゲージ（途中は青、テストまで終わったら緑）
 */
export function AcademySection({ progress }: { progress: AcademyProgress | null }) {
  if (!progress)
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">まだアカデミーの記録はありません。アカデミーの管理画面の「CSV」を取り込むと、称号・分野の進み具合・稼働判断が出ます。</p>
        <Button asChild variant="outline" size="sm">
          <Link href="/staff/academy">アカデミーの記録を取り込む</Link>
        </Button>
      </div>
    );

  const d = ACADEMY_DECISION[progress.decision];
  const date = (iso: string) => formatLongJa(toJstDateString(new Date(iso)));
  const ok = <CheckIcon aria-label="できています" className="ml-1 inline size-4 text-status-done" />;
  return (
    <div role="group" aria-label="アカデミーの記録" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <GraduationCapIcon aria-hidden className="size-6 shrink-0 text-primary" />
        <span className="text-xl font-bold break-words">{progress.title || "称号なし"}</span>
        <Badge tone={d.tone}>
          {progress.decision === "ready" && <CheckIcon aria-hidden className="size-4" />}
          稼働判断: {d.label}
        </Badge>
        {!progress.active && <Badge tone="muted">アカデミーは利用停止中</Badge>}
      </div>

      {progress.areas.length > 0 && (
        <ul aria-label="分野ごとの進み具合" className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-3">
          {progress.areas.map((a) => (
            <AreaMeter key={a.name} area={a} />
          ))}
        </ul>
      )}

      <dl>
        <Field label="知識テスト">
          {progress.knowledge}
          {progress.knowledgeOk && ok}
        </Field>
        <Field label="総合ロープレ">
          {progress.roleplay}
          {progress.roleplayOk && ok}
        </Field>
        <Field label="現場チェック">
          {progress.field && (
            <>
              {progress.field.done} / {progress.field.total}項目
              {progress.field.total > 0 && progress.field.done === progress.field.total && ok}
            </>
          )}
        </Field>
        <Field label="ロードマップ">{progress.roadmap && `${progress.roadmap.done} / ${progress.roadmap.total}`}</Field>
        <Field label="ヒアリング">{`評価 ${progress.hearing}回`}</Field>
        <Field label="最後の学習">{progress.lastStudiedAt && date(progress.lastStudiedAt)}</Field>
      </dl>
      <p className="text-sm text-muted-foreground">
        {date(progress.importedAt)}に取り込み（アカデミーのログイン: {progress.academyId}）。新しい記録は、スタッフ →「
        <Link href="/staff/academy" className="text-primary underline-offset-2 hover:underline">
          アカデミーの取り込み
        </Link>
        」で入れ直せます。
      </p>
    </div>
  );
}

function AreaMeter({ area }: { area: AcademyArea }) {
  const complete = areaComplete(area);
  const pct = area.total ? Math.min(100, Math.round((area.done / area.total) * 100)) : 0;
  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 font-semibold break-words text-[#344054]">{area.name}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          <b className="text-base text-foreground">{area.done}</b>/{area.total}章
        </span>
      </div>
      <div role="meter" aria-label={`${area.name}の進み具合`} aria-valuemin={0} aria-valuemax={area.total} aria-valuenow={area.done} className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={BAR(complete)} style={{ width: `${pct}%` }} />
      </div>
      {area.test ? <span className="text-sm font-semibold text-status-done">✓ テスト合格</span> : <span className="text-sm text-muted-foreground">テストはまだ</span>}
    </li>
  );
}
