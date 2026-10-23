"use client";

import { CheckIcon, ChevronDownIcon, MessageSquareTextIcon, PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ShareButtons } from "@/components/app/share-buttons";
import { StatusPill } from "@/components/app/status-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import type { Job, JobCandidate } from "@/lib/data/jobs";
import { type DateString, diffDays, formatShortJa, formatTimeJst, toJstDateString } from "@/lib/date";
import { interviewShareText, slotsRequestText, slotsSummaryText, type SummaryLine } from "@/lib/jobs/messages";
import { isActive, nextStage, type Stage, STAGE_INFO } from "@/lib/jobs/stages";
import { ASSIGNMENT_STATUS } from "@/lib/labels";
import { searchNorm } from "@/lib/search";
import type { Database } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { addCandidates, offerCandidate, removeCandidate, setCandidateStage, setJobClosed, setJobRate, type StageExtra } from "../actions";
import { StageBadge, StageDots } from "../stage-ui";

type Opt = { id: string; name: string };
type StaffOpt = { id: string; name: string; kana: string };
type AsgStatus = Database["public"]["Enums"]["assignment_status"];

const fmtAt = (iso: string) => {
  const d = new Date(iso);
  return `${formatShortJa(toJstDateString(d))} ${formatTimeJst(d)}`;
};
/** datetime-local の値（日本時間）→ ISO */
const localToIso = (v: string) => (v ? new Date(`${v}:00+09:00`).toISOString() : null);
const isoToLocal = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${toJstDateString(d)}T${formatTimeJst(d)}`;
};

export function JobDetail({ job, staff, roles, isOwner, now: nowIso }: { job: Job; staff: StaffOpt[]; roles: Opt[]; isOwner: boolean; now: string }) {
  const router = useRouter();
  const now = new Date(nowIso);
  const [pending, start] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const live = job.events.filter((e) => !e.cancelled);
  const withSlots = job.candidates.filter((c) => c.interviewSlots.trim() && isActive(c.stage));

  const refresh = () => router.refresh();
  const toggleClosed = () =>
    start(async () => {
      const r = await setJobClosed(job.id, !job.closedAt);
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      refresh();
    });

  const summaryLines: SummaryLine[] = withSlots.map((c) => {
    const dates = c.dates.length ? c.dates : live.map((e) => ({ eventId: e.id, date: e.date, venue: e.venue, status: "" }));
    const venue = dates[0]?.venue ?? "";
    const count = Math.max(1, ...live.filter((e) => dates.some((d) => d.eventId === e.id)).map((e) => e.required));
    return { dates: dates.map((d) => d.date), venue, count, staffName: c.staffName, slots: c.interviewSlots };
  });

  return (
    <div className="flex flex-col gap-4 px-4 pb-6" data-testid="job-detail">
      {/* 案件の内容 */}
      <section className="flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-card" aria-label="案件の内容">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="font-medium text-muted-foreground">日程</dt>
          <dd>{job.dateFrom && job.dateTo ? `${formatShortJa(job.dateFrom)}〜${formatShortJa(job.dateTo)}・${live.length}日・${job.venues.length}会場` : "現場はまだありません"}</dd>
          <dt className="font-medium text-muted-foreground">受けた日</dt>
          <dd>{job.receivedOn ? formatShortJa(job.receivedOn) : "—"}</dd>
          {job.entryDeadline && (
            <>
              <dt className="font-medium text-muted-foreground">期限</dt>
              <dd className="flex flex-wrap items-center gap-2" data-testid="job-deadline">
                エントリー期限 {formatShortJa(job.entryDeadline)}
                <DeadlineBadge deadline={job.entryDeadline} today={toJstDateString(now)} closed={Boolean(job.closedAt)} />
              </dd>
            </>
          )}
          <dt className="font-medium text-muted-foreground">稼働時間</dt>
          <dd>{job.hoursNote || (job.startTime ? `${job.startTime}〜${job.endTime ?? ""}` : "—")}</dd>
          {job.contactName && (
            <>
              <dt className="font-medium text-muted-foreground">担当者</dt>
              <dd>{job.contactName}</dd>
            </>
          )}
          {job.notes && (
            <>
              <dt className="font-medium text-muted-foreground">備考</dt>
              <dd className="whitespace-pre-wrap">{job.notes}</dd>
            </>
          )}
          {isOwner && (
            <>
              <dt className="font-medium text-muted-foreground">単価</dt>
              <dd>
                <RateEditor jobId={job.id} rate={job.rate ?? null} />
              </dd>
            </>
          )}
        </dl>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="outline" size="sm" disabled={pending} onClick={toggleClosed}>
            {job.closedAt ? "進行中に戻す" : "終わった案件にする"}
          </Button>
          {job.closedAt && <Badge>終わった案件</Badge>}
          {job.sourceText && (
            <details className="w-full">
              <summary className="flex w-fit cursor-pointer items-center gap-1 text-sm text-primary">
                <ChevronDownIcon className="size-4" />
                貼った文を見る
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted/40 p-3 text-sm whitespace-pre-wrap">{job.sourceText}</pre>
            </details>
          )}
        </div>
      </section>

      {/* 日程 */}
      <section className="flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-card" aria-label="日程">
        <h2 className="font-semibold">
          日程 <span className="text-sm font-normal text-muted-foreground">必要 {job.requiredTotal}人・確定 {job.confirmedTotal}人</span>
        </h2>
        {live.length === 0 ? (
          <p className="text-sm text-muted-foreground">現場はありません</p>
        ) : (
          <ul className="divide-y" data-testid="job-events">
            {live.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:gap-3">
                <Link href={`/events/${e.id}`} className="flex min-w-0 items-center gap-2 font-medium">
                  <span className="w-20 shrink-0 tabular-nums">{formatShortJa(e.date)}</span>
                  <span className="min-w-0 truncate">{e.venue}</span>
                  {e.shortage > 0 ? <StatusPill tone="alert">欠{e.shortage}</StatusPill> : e.required > 0 ? <StatusPill tone="done">✓</StatusPill> : null}
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {e.confirmed}/{e.required}
                  </span>
                </Link>
                <ul className="flex flex-wrap gap-1 sm:ml-auto">
                  {e.people.map((p) => (
                    <li key={p.assignmentId} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
                      {p.name}
                      <Badge tone={ASSIGNMENT_STATUS[p.status as AsgStatus]?.tone ?? "muted"}>{ASSIGNMENT_STATUS[p.status as AsgStatus]?.label ?? p.status}</Badge>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 候補 */}
      <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-card" aria-label="候補">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">
            候補 <span className="text-sm font-normal text-muted-foreground">{job.candidates.length}人</span>
          </h2>
          <span className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!withSlots.length} onClick={() => setSummaryOpen(true)} className="gap-1">
              <MessageSquareTextIcon className="size-4" />
              取引先へのまとめ文
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1">
              <PlusIcon className="size-4" />
              候補を足す
            </Button>
          </span>
        </div>
        {job.candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだ候補がいません。「候補を足す」で名簿から選ぶと、本人への確認 → スキルシート → 面談 → 合否 の段階を1人ずつ進められます。</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="job-candidates">
            {job.candidates.map((c) => (
              <CandidateRow key={c.id} job={job} c={c} roles={roles} now={now} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>

      <AddCandidatesDialog open={addOpen} onOpenChange={setAddOpen} jobId={job.id} staff={staff.filter((s) => !job.candidates.some((c) => c.staffId === s.id))} onAdded={refresh} />
      <TextDialog key={slotsSummaryText(summaryLines)} open={summaryOpen} onOpenChange={setSummaryOpen} title="取引先へのまとめ文" description="会場・日付ごとに、名前と候補の日時を並べた文です。LINE に貼って送ってください。送ったら、それぞれの人を「候補日送付済」にします。" text={slotsSummaryText(summaryLines)} />
    </div>
  );
}

/** エントリー期限の札: 過ぎた＝赤、3日以内＝黄 */
export function DeadlineBadge({ deadline, today, closed }: { deadline: DateString; today: DateString; closed?: boolean }) {
  if (closed) return null;
  const left = diffDays(today, deadline);
  if (left < 0) return <Badge tone="alert">期限切れ</Badge>;
  if (left === 0) return <Badge tone="alert">今日まで</Badge>;
  if (left <= 3) return <Badge tone="waiting">あと{left}日</Badge>;
  return null;
}

/** 単価と単価のメモ（オーナーだけ） */
function RateEditor({ jobId, rate }: { jobId: string; rate: { rate: number | null; transportIncluded: boolean; rateNote: string } | null }) {
  const router = useRouter();
  const [edit, setEdit] = useState(false);
  const [value, setValue] = useState(rate?.rate != null ? String(rate.rate) : "");
  const [transport, setTransport] = useState(rate?.transportIncluded ?? false);
  const [note, setNote] = useState(rate?.rateNote ?? "");
  const [pending, start] = useTransition();
  if (!edit)
    return (
      <span className="flex flex-col gap-1">
        <span className="flex flex-wrap items-center gap-2" data-testid="job-rate">
          {rate?.rate != null ? `${rate.rate.toLocaleString()}円/日${rate.transportIncluded ? "（交通費込）" : ""}` : "未設定"}
          <Button variant="ghost" size="sm" onClick={() => setEdit(true)}>
            直す
          </Button>
        </span>
        {rate?.rateNote && (
          <span className="whitespace-pre-wrap text-muted-foreground" data-testid="job-rate-note">
            {rate.rateNote}
          </span>
        )}
      </span>
    );
  return (
    <span className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-2">
        <Input type="number" inputMode="numeric" min={0} value={value} onChange={(e) => setValue(e.target.value)} className="w-32" aria-label="単価" />
        <label className="flex items-center gap-1 text-sm">
          <Checkbox checked={transport} onCheckedChange={(v) => setTransport(v === true)} aria-label="交通費込" />
          交通費込
        </label>
      </span>
      <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} aria-label="単価のメモ" placeholder="弱 30,000円 / 一律 24,000円 など" />
      <span className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await setJobRate(jobId, value.trim() ? Number(value) : null, transport, note);
              if (!r.ok) return void toast.error(r.message);
              toast.success(r.message);
              setEdit(false);
              router.refresh();
            })
          }
        >
          保存
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>
          やめる
        </Button>
      </span>
    </span>
  );
}

function CandidateRow({ job, c, roles, now, onChanged }: { job: Job; c: JobCandidate; roles: Opt[]; now: Date; onChanged: () => void }) {
  const [pending, start] = useTransition();
  const [stageTarget, setStageTarget] = useState<Stage | null>(null);
  const [offerOpen, setOfferOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const next = nextStage(c.stage);
  const live = job.events.filter((e) => !e.cancelled);
  const notIn = live.filter((e) => !e.people.some((p) => p.staffId === c.staffId));

  const applyStage = (stage: Stage, extra: StageExtra = {}) =>
    start(async () => {
      const r = await setCandidateStage(c.id, stage, extra);
      if (!r.ok || !r.data) return void toast.error(r.message);
      const prev = r.data.previous;
      const more = r.data.confirmed ? `。打診中の ${r.data.confirmed}日分を確定にしました（確定連絡は現場の画面から）` : r.data.declined ? `。打診中の ${r.data.declined}日分を辞退にしました` : "";
      toast.success(`${c.staffName}さんを「${STAGE_INFO[stage].label}」にしました${more}`, {
        action: {
          label: "元に戻す",
          onClick: () =>
            start(async () => {
              await setCandidateStage(c.id, prev);
              onChanged();
            }),
        },
      });
      setStageTarget(null);
      onChanged();
    });
  const remove = () =>
    start(async () => {
      const r = await removeCandidate(c.id);
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      onChanged();
    });

  const copyText =
    c.stage === "sheet_sent" || c.stage === "staff_ok"
      ? { title: "本人へ: 面談の候補日時のお願い", text: slotsRequestText({ staffName: c.staffName, clientName: job.clientName, venues: (c.dates.length ? c.dates : live).map((d) => d.venue), dates: (c.dates.length ? c.dates : live).map((d) => d.date) }) }
      : c.stage === "interview_set" && c.interviewAt
        ? { title: "本人へ: 面談の日時の共有", text: interviewShareText({ staffName: c.staffName, clientName: job.clientName, interviewAt: c.interviewAt, note: c.interviewNote }) }
        : null;

  return (
    <li className="flex flex-col gap-2 rounded-xl border p-3" data-testid="job-candidate" data-stage={c.stage}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/staff/${c.staffId}`} className="font-semibold">
          {c.staffName}
        </Link>
        <StageDots stage={c.stage} />
        <StageBadge stage={c.stage} stageChangedAt={c.stageChangedAt} interviewAt={c.interviewAt} now={now} />
        <Button variant="ghost" size="sm" className="ml-auto" disabled={pending} onClick={remove} aria-label={`${c.staffName}を候補から外す`}>
          <XIcon className="size-4" />
          外す
        </Button>
      </div>
      {c.dates.length > 0 && (
        <ul className="flex flex-wrap gap-1 text-xs">
          {c.dates.map((d) => (
            <li key={d.eventId} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5">
              {formatShortJa(d.date)} {d.venue}
              <Badge tone={ASSIGNMENT_STATUS[d.status as AsgStatus]?.tone ?? "muted"}>{ASSIGNMENT_STATUS[d.status as AsgStatus]?.label ?? d.status}</Badge>
            </li>
          ))}
        </ul>
      )}
      {(c.interviewSlots || c.interviewAt || c.resultNote) && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
          {c.interviewSlots && (
            <>
              <dt className="text-muted-foreground">候補日時</dt>
              <dd className="whitespace-pre-wrap">{c.interviewSlots}</dd>
            </>
          )}
          {c.interviewAt && (
            <>
              <dt className="text-muted-foreground">面談</dt>
              <dd>
                {fmtAt(c.interviewAt)}
                {c.interviewNote && <span className="ml-2 break-all text-muted-foreground">{c.interviewNote}</span>}
              </dd>
            </>
          )}
          {c.resultNote && (
            <>
              <dt className="text-muted-foreground">合否のメモ</dt>
              <dd>{c.resultNote}</dd>
            </>
          )}
        </dl>
      )}
      <p className="text-sm text-[#344054]">次にやること: {STAGE_INFO[c.stage].next || "なし"}</p>
      <div className="flex flex-wrap gap-2">
        {c.stage === "interviewed" ? (
          <>
            <Button size="sm" disabled={pending} onClick={() => setStageTarget("passed")} className="gap-1">
              <CheckIcon className="size-4" />
              合格
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setStageTarget("failed")}>
              不合格
            </Button>
          </>
        ) : next && isActive(c.stage) ? (
          <Button size="sm" disabled={pending} onClick={() => setStageTarget(next)}>
            次へ: {STAGE_INFO[next].label}
          </Button>
        ) : null}
        {copyText && (
          <Button size="sm" variant="outline" onClick={() => setTextOpen(true)} className="gap-1">
            <MessageSquareTextIcon className="size-4" />
            {copyText.title.replace("本人へ: ", "")}の文
          </Button>
        )}
        {notIn.length > 0 && isActive(c.stage) && (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => setOfferOpen(true)}>
            日程に入れる
          </Button>
        )}
        {c.stage === "failed" && (
          <Button asChild size="sm" variant="outline">
            <Link href="/events?shortage=1">別の案件を探す（欠員のある現場）</Link>
          </Button>
        )}
        {(c.stage === "passed" || c.stage === "briefed") && c.dates[0] && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/events/${c.dates[0].eventId}`}>現場の画面で確定連絡を送る</Link>
          </Button>
        )}
      </div>

      {stageTarget && <StageDialog c={c} target={stageTarget} onClose={() => setStageTarget(null)} onSubmit={(extra) => applyStage(stageTarget, extra)} pending={pending} />}
      <OfferDialog open={offerOpen} onOpenChange={setOfferOpen} candidateId={c.id} staffName={c.staffName} events={notIn} roles={roles} onDone={onChanged} />
      {copyText && <TextDialog key={copyText.text} open={textOpen} onOpenChange={setTextOpen} title={copyText.title} description="LINE に貼って本人に送ってください。" text={copyText.text} />}
    </li>
  );
}

/** 段階を進めるときの入力（候補日時・面談の日時とリンク・合否のメモ） */
function StageDialog({ c, target, onClose, onSubmit, pending }: { c: JobCandidate; target: Stage; onClose: () => void; onSubmit: (extra: StageExtra) => void; pending: boolean }) {
  const [slots, setSlots] = useState(c.interviewSlots);
  const [at, setAt] = useState(isoToLocal(c.interviewAt));
  const [note, setNote] = useState(c.interviewNote);
  const [result, setResult] = useState(c.resultNote);
  const info = STAGE_INFO[target];
  const effect = target === "passed" ? "この案件で打診中・補欠になっている予定は確定になります。確定連絡の文は現場の画面から送れます。" : target === "failed" || target === "withdrawn" ? "この案件で打診中・補欠になっている予定は辞退になります。" : "";
  const submit = () => {
    if (target === "slots_collected" && !slots.trim()) return void toast.error("候補の日時を入れてください");
    if (target === "interview_set" && !at) return void toast.error("面談の日時を入れてください");
    onSubmit({
      ...(target === "slots_collected" ? { interviewSlots: slots } : {}),
      ...(target === "interview_set" ? { interviewAt: localToIso(at), interviewNote: note } : {}),
      ...(target === "passed" || target === "failed" ? { resultNote: result } : {}),
    });
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {c.staffName}さんを「{info.label}」にする
          </DialogTitle>
          <DialogDescription>{effect || `次にやること: ${info.next}`}</DialogDescription>
        </DialogHeader>
        {target === "slots_collected" && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="stage-slots">本人からの候補の日時（1行に1つ）</Label>
            <Textarea id="stage-slots" rows={4} value={slots} onChange={(e) => setSlots(e.target.value)} placeholder={"10/26 20:00〜\n10/27 9:00〜12:00\n10/28 終日"} />
          </div>
        )}
        {target === "interview_set" && (
          <div className="grid gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="stage-at">面談の日時</Label>
              <Input id="stage-at" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="w-full sm:w-64" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="stage-note">リンク・場所など</Label>
              <Input id="stage-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="https://… またはオンライン・店舗など" />
            </div>
          </div>
        )}
        {(target === "passed" || target === "failed") && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="stage-result">メモ（任意）</Label>
            <Input id="stage-result" value={result} onChange={(e) => setResult(e.target.value)} placeholder="取引先からの連絡の要点など" />
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            やめる
          </Button>
          <Button onClick={submit} disabled={pending} className={cn(target === "failed" && "bg-status-alert-solid text-white hover:bg-status-alert-solid/90")}>
            {info.label}にする
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddCandidatesDialog({ open, onOpenChange, jobId, staff, onAdded }: { open: boolean; onOpenChange: (o: boolean) => void; jobId: string; staff: StaffOpt[]; onAdded: () => void }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const list = useMemo(() => {
    const nq = searchNorm(q);
    return staff.filter((s) => !nq || searchNorm(s.name).includes(nq) || searchNorm(s.kana).includes(nq)).slice(0, 60);
  }, [q, staff]);
  const submit = () =>
    start(async () => {
      const r = await addCandidates(jobId, [...picked]);
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      setPicked(new Set());
      onOpenChange(false);
      onAdded();
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>候補を足す</DialogTitle>
          <DialogDescription>名簿から選びます。段階は「候補」から始まり、本人に確認したら「本人OK」に進めます。</DialogDescription>
        </DialogHeader>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="名前・ふりがなで探す" aria-label="スタッフを探す" />
        <ul className="max-h-72 divide-y overflow-auto rounded-md border">
          {list.map((s) => (
            <li key={s.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2">
                <Checkbox checked={picked.has(s.id)} onCheckedChange={(v) => setPicked((p) => (v === true ? new Set(p).add(s.id) : new Set([...p].filter((x) => x !== s.id))))} aria-label={s.name} />
                <span className="font-medium">{s.name}</span>
                <span className="text-sm text-muted-foreground">{s.kana}</span>
              </label>
            </li>
          ))}
          {list.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">見つかりません</li>}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            やめる
          </Button>
          <Button onClick={submit} disabled={pending || !picked.size}>
            {picked.size}人を足す
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OfferDialog({ open, onOpenChange, candidateId, staffName, events, roles, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; candidateId: string; staffName: string; events: Job["events"]; roles: Opt[]; onDone: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(events.map((e) => e.id)));
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await offerCandidate(candidateId, [...picked], roleId);
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      onOpenChange(false);
      onDone();
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{staffName}さんを日程に入れる</DialogTitle>
          <DialogDescription>選んだ日を「打診中」にします。合格にすると確定になります。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1">
          <Label htmlFor="offer-role">役割</Label>
          <NativeSelect id="offer-role" value={roleId} onChange={(e) => setRoleId(e.target.value)} className="w-full sm:w-56">
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <ul className="max-h-72 divide-y overflow-auto rounded-md border">
          {events.map((e) => (
            <li key={e.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                <Checkbox checked={picked.has(e.id)} onCheckedChange={(v) => setPicked((p) => (v === true ? new Set(p).add(e.id) : new Set([...p].filter((x) => x !== e.id))))} aria-label={`${formatShortJa(e.date)} ${e.venue}`} />
                <span className="w-20 tabular-nums">{formatShortJa(e.date)}</span>
                <span className="min-w-0 flex-1 truncate">{e.venue}</span>
                <span className="text-muted-foreground tabular-nums">
                  {e.confirmed}/{e.required}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            やめる
          </Button>
          <Button onClick={submit} disabled={pending || !picked.size || !roleId}>
            {picked.size}日分を打診中にする
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TextDialog({ open, onOpenChange, title, description, text }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; text: string }) {
  const [value, setValue] = useState(text);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setValue(text);
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Textarea rows={10} value={value} onChange={(e) => setValue(e.target.value)} aria-label={title} className="text-base" />
        <DialogFooter>
          <ShareButtons text={value} onSent={() => onOpenChange(false)} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
