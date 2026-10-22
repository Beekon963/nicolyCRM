"use client";

import { CheckIcon, ClipboardPasteIcon, SparklesIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runAiProposal, undoAiProposal } from "@/app/(app)/ai-actions";
import { setAssignmentStatus } from "@/app/(app)/events/actions";
import { type CardState, ProposalCard } from "@/components/app/proposal-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { formatShortJa } from "@/lib/date";
import { AVAILABILITY } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { markInboxDone, proposeAvailabilityFor, readPaste, type ReadResult, saveVenueDetails } from "./actions";

type Opt = { id: string; name: string };
type InboxItem = { id: string; text: string; createdAt: string };

/**
 * LINE の文を貼る → 読み取る → 確認カード → 登録する（Phase 18）。
 * compact はホームに置くとき（見出しを小さく、転送の一覧は出さない）。
 */
export function InboxClient({ staff, venues, inbox = [], compact = false }: { staff: Opt[]; venues: Opt[]; inbox?: InboxItem[]; compact?: boolean }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [result, setResult] = useState<ReadResult | null>(null);
  const [card, setCard] = useState<CardState | null>(null);
  const [pending, start] = useTransition();
  const [sourceId, setSourceId] = useState<string | null>(null);

  const read = (t = text, pick: { eventId?: string; staffId?: string } = {}) =>
    start(async () => {
      setCard(null);
      const r = await readPaste(t, pick);
      if (!r.ok) {
        setResult(null);
        return void toast.error(r.message);
      }
      setResult(r.data!);
      if (r.data!.kind === "report") setCard({ ...r.data!.proposal, state: "open" });
    });
  const clear = () => {
    setText("");
    setResult(null);
    setCard(null);
    setSourceId(null);
  };
  const patch = (p: Partial<CardState>) => setCard((c) => (c ? { ...c, ...p } : c));
  const onRun = async (c: CardState) => {
    patch({ state: "running" });
    const r = await runAiProposal(c.kind, c.payload);
    if (!r.ok) {
      patch({ state: "open" });
      return void toast.error(r.message);
    }
    patch({ state: "done", message: r.message, undo: r.data?.undo });
    if (sourceId) void markInboxDone(sourceId);
  };
  const onCancel = () => patch({ state: "cancelled" });
  const onUndo = async (c: CardState) => {
    if (!c.undo) return;
    const r = await undoAiProposal(c.undo);
    if (!r.ok) return void toast.error(r.message);
    patch({ state: "undone", message: r.message });
  };
  const takeInbox = (item: InboxItem) => {
    setText(item.text);
    setSourceId(item.id);
    read(item.text);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="inbox">
      {!compact && inbox.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3">
          <p className="font-semibold">LINE から転送された文（{inbox.length}件）</p>
          <ul className="flex flex-col gap-2">
            {inbox.map((i) => (
              <li key={i.id} className="flex flex-col gap-1 rounded-md bg-background p-2 sm:flex-row sm:items-center">
                <span className="min-w-0 flex-1 truncate text-sm">{i.text.replace(/\s+/g, " ")}</span>
                <span className="flex gap-2">
                  <Button size="sm" onClick={() => takeInbox(i)} disabled={pending}>
                    読み取る
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await markInboxDone(i.id);
                        if (r.ok) router.refresh();
                        else toast.error(r.message);
                      })
                    }
                  >
                    済み
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className={cn("font-semibold", compact && "sr-only")}>LINE の文をここに貼る</span>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="LINE の文を長押しでコピーして、ここに貼ってください（件数の報告・稼働可能日・募集の文・案件詳細・打診の返事）"
          rows={compact ? 3 : 6}
          className="text-base"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending || !text.trim()} onClick={() => read()} className="gap-1.5">
          <ClipboardPasteIcon className="size-4" />
          {pending ? "読み取っています…" : "読み取る"}
        </Button>
        {(text || result) && (
          <Button variant="ghost" disabled={pending} onClick={clear}>
            消す
          </Button>
        )}
      </div>

      {result && (
        <div className="flex flex-col gap-3" data-testid="inbox-result" data-kind={result.kind}>
          {result.kind === "report" && (
            <>
              <Badge tone="done" className="w-fit">
                件数の報告として読みました
              </Badge>
              {result.notes.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-status-waiting">
                  {result.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
              {card && <ProposalCard card={card} onRun={onRun} onCancel={onCancel} onUndo={onUndo} />}
            </>
          )}
          {result.kind === "report_unmatched" && <ReportUnmatched result={result} pending={pending} onPick={(pick) => read(text, pick)} />}
          {result.kind === "availability" && (
            <AvailabilityPicker result={result} staff={staff} pending={pending} card={card} onCard={(c) => setCard(c)} onRun={onRun} onCancel={onCancel} onUndo={onUndo} />
          )}
          {result.kind === "recruit" && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <p>
                <Badge tone="done" className="mr-2">
                  募集の文
                </Badge>
                {result.dates}日分{result.venue && `・${result.venue}`}
              </p>
              <Button asChild className="w-fit">
                <Link href={`/events/from-text?text=${encodeURIComponent(text)}`}>現場を作る画面で続ける</Link>
              </Button>
            </div>
          )}
          {result.kind === "details" && <DetailsSaver result={result} venues={venues} pending={pending} />}
          {result.kind === "reply" && <ReplyList result={result} onDone={() => sourceId && markInboxDone(sourceId)} />}
          {result.kind === "unknown" && (
            <div className="flex flex-col gap-2 rounded-lg border p-3">
              <p>この文は、報告・稼働可能日・募集の文・案件詳細・返事のどれとも読み取れませんでした。</p>
              <Button
                variant="outline"
                className="w-fit gap-1.5"
                onClick={() => window.dispatchEvent(new CustomEvent("nicoly:ai-paste", { detail: { text } }))}
              >
                <SparklesIcon className="size-4 text-primary" />
                AI に読んでもらう
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ReportUnmatched({ result, pending, onPick }: { result: Extract<ReadResult, { kind: "report_unmatched" }>; pending: boolean; onPick: (pick: { eventId?: string; staffId?: string }) => void }) {
  const [eventId, setEventId] = useState(result.events.length === 1 ? result.events[0].id : "");
  const [staffId, setStaffId] = useState("");
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-status-waiting-border bg-status-waiting-bg p-3">
      <p className="font-semibold">{result.reason}</p>
      <p className="text-sm text-muted-foreground">
        読めたもの: {[result.read.date.slice(5).replace("-", "/"), result.read.venue, result.read.people.join("、"), result.read.items.join("、")].filter(Boolean).join("・")}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {!result.needStaff && (
          <NativeSelect aria-label="どの現場の報告か" value={eventId} onChange={(e) => setEventId(e.target.value)} className="sm:w-72">
            <option value="">どの現場の報告か…</option>
            {result.events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </NativeSelect>
        )}
        {result.needStaff && (
          <NativeSelect aria-label="だれの報告か" value={staffId} onChange={(e) => setStaffId(e.target.value)} className="sm:w-72">
            <option value="">だれの報告か…</option>
            {result.staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        )}
        <Button disabled={pending || (result.needStaff ? !staffId : !eventId)} onClick={() => onPick(result.needStaff ? { eventId, staffId } : { eventId })}>
          この内容で読み直す
        </Button>
      </div>
    </div>
  );
}

function AvailabilityPicker({
  result,
  staff,
  pending,
  card,
  onCard,
  onRun,
  onCancel,
  onUndo,
}: {
  result: Extract<ReadResult, { kind: "availability" }>;
  staff: Opt[];
  pending: boolean;
  card: CardState | null;
  onCard: (c: CardState) => void;
  onRun: (c: CardState) => Promise<void>;
  onCancel: (c: CardState) => void;
  onUndo: (c: CardState) => Promise<void>;
}) {
  const [staffId, setStaffId] = useState("");
  const [busy, start] = useTransition();
  const by = (s: "ok" | "maybe" | "ng") => result.days.filter((d) => d.status === s).map((d) => Number(d.date.slice(8)));
  const m = Number(result.month.slice(5));
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <p>
        <Badge tone="done" className="mr-2">
          稼働可能日
        </Badge>
        {m}月: {(["ok", "maybe", "ng"] as const).map((s) => (by(s).length ? `${AVAILABILITY[s].mark} ${by(s).join("・")}日 ` : "")).join("")}
      </p>
      {result.unread.length > 0 && <p className="text-sm text-status-waiting">読めなかった行: {result.unread.join(" / ")}</p>}
      {!card && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <NativeSelect aria-label="だれの稼働可能日か" value={staffId} onChange={(e) => setStaffId(e.target.value)} className="sm:w-72">
            <option value="">だれの分か…</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            disabled={pending || busy || !staffId}
            onClick={() =>
              start(async () => {
                const r = await proposeAvailabilityFor({ staffId, days: result.days });
                if (!r.ok) return void toast.error(r.message);
                onCard({ ...r.data!, state: "open" });
              })
            }
          >
            確認カードを出す
          </Button>
        </div>
      )}
      {card && <ProposalCard card={card} onRun={onRun} onCancel={onCancel} onUndo={onUndo} />}
    </div>
  );
}

function DetailsSaver({ result, venues, pending }: { result: Extract<ReadResult, { kind: "details" }>; venues: Opt[]; pending: boolean }) {
  const [venueId, setVenueId] = useState(result.venueId ?? "");
  const [busy, start] = useTransition();
  const [done, setDone] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <p>
        <Badge tone="done" className="mr-2">
          案件詳細
        </Badge>
        {result.venueName || "（会場名が読めません）"} → 会場のメモに入れます
      </p>
      <pre className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 text-sm whitespace-pre-wrap">{result.body}</pre>
      {done ? (
        <p className="text-status-done">{done}</p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <NativeSelect aria-label="どの会場のメモに入れるか" value={venueId} onChange={(e) => setVenueId(e.target.value)} className="sm:w-72">
            <option value="">どの会場か…</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            disabled={pending || busy || !venueId}
            onClick={() =>
              start(async () => {
                const r = await saveVenueDetails({ venueId, body: result.body });
                if (!r.ok) return void toast.error(r.message);
                setDone(r.message ?? "入れました");
              })
            }
          >
            会場のメモに入れる
          </Button>
        </div>
      )}
    </div>
  );
}

function ReplyList({ result, onDone }: { result: Extract<ReadResult, { kind: "reply" }>; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [decided, setDecided] = useState<Record<string, "confirmed" | "declined">>({});
  const act = (o: (typeof result.offers)[number], status: "confirmed" | "declined") =>
    start(async () => {
      const r = await setAssignmentStatus(o.id, status);
      if (!r.ok) return void toast.error(r.message);
      setDecided((d) => ({ ...d, [o.id]: status }));
      onDone();
      toast.success(`${o.staffName}さんを${status === "confirmed" ? "確定" : "辞退"}にしました${r.data?.filled ? "。全員そろいました！" : ""}`, {
        action: {
          label: "元に戻す",
          onClick: () =>
            start(async () => {
              const u = await setAssignmentStatus(o.id, "offered");
              if (!u.ok) return void toast.error(u.message);
              setDecided((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== o.id)));
              router.refresh();
            }),
        },
      });
      router.refresh();
    });
  const sorted = [...result.offers].sort((a, b) => Number(b.staffId === result.matchedStaffId) - Number(a.staffId === result.matchedStaffId));
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <p>
        <Badge tone={result.positive ? "done" : "alert"} className="mr-2">
          {result.positive ? "参加できる の返事" : "できない の返事"}
        </Badge>
        だれの返事か、押して{result.positive ? "確定" : "辞退"}にしてください（元に戻せます）
      </p>
      {sorted.length === 0 ? (
        <p className="text-muted-foreground">返事待ちの打診はありません。</p>
      ) : (
        <ul className="divide-y">
          {sorted.map((o) => (
            <li key={o.id} className={cn("flex min-h-12 items-center gap-2 py-1", o.staffId === result.matchedStaffId && "rounded-md bg-brand-50 px-2")}>
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{o.staffName}</span>
                <span className="ml-2 text-sm text-muted-foreground">
                  {formatShortJa(o.date)} {o.venue} {o.role}
                </span>
              </span>
              {decided[o.id] ? (
                <Badge tone={decided[o.id] === "confirmed" ? "done" : "alert"}>{decided[o.id] === "confirmed" ? "確定" : "辞退"}</Badge>
              ) : (
                <>
                  <Button size="sm" variant={result.positive ? "default" : "outline"} disabled={pending} onClick={() => act(o, "confirmed")} aria-label={`${o.staffName}さんを確定にする`} className="gap-1">
                    <CheckIcon className="size-4" />
                    確定
                  </Button>
                  <Button size="sm" variant={result.positive ? "outline" : "default"} disabled={pending} onClick={() => act(o, "declined")} aria-label={`${o.staffName}さんを辞退にする`} className="gap-1">
                    <XIcon className="size-4" />
                    辞退
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
