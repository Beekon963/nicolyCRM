"use client";

import { ChevronDownIcon, MessageSquarePlusIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  type ActivityBefore,
  listRecordTargets,
  type RecordTarget,
  recordActivity,
  undoActivity,
} from "@/app/(app)/sales/activity-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { addDays, formatShortJa, todayJst } from "@/lib/date";
import { ACTIVITY_KIND, ACTIVITY_RESULT, COMPANY_KIND, COMPANY_STATUS } from "@/lib/labels";
import {
  type ActivityKind,
  type ActivityResult,
  type CompanyStatus,
  initialNextAction,
  NEXT_ACTION_SUGGESTION,
  needsNextAction,
  suggestStatus,
} from "@/lib/sales";
import { matchesQuery } from "@/lib/search";
import { cn } from "@/lib/utils";

export type ActivityCompany = Omit<RecordTarget, "kana" | "kind">;

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-11 rounded-full border px-4 text-base",
        on ? "border-primary bg-primary/10 font-bold text-primary" : "border-input text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * 活動の記録（要件 §4.8「スマホで10秒」）: 種類 → 結果 →（一言メモ）→ 次回アクション日。
 * 次回アクション日の候補を押すと、そのまま記録する（画面 E3）。
 */
function ActivityForm({ company, onDone, onDirty }: { company: ActivityCompany; onDone: () => void; onDirty: (d: boolean) => void }) {
  const router = useRouter();
  const today = todayJst();
  const initial = initialNextAction(company, today);
  const [kind, setKind] = useState<ActivityKind>("call");
  const [result, setResult] = useState<ActivityResult | null>(null);
  const [memo, setMemo] = useState("");
  const [nextText, setNextText] = useState(initial.text);
  const [textTouched, setTextTouched] = useState(initial.text !== "");
  const [status, setStatus] = useState<CompanyStatus>(company.status);
  const [statusTouched, setStatusTouched] = useState(false);
  const [contactId, setContactId] = useState<string | null>(company.contacts.length === 1 ? company.contacts[0].id : null);
  const [customDate, setCustomDate] = useState<string | null>(null);
  const [warnNoNext, setWarnNoNext] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => onDirty(memo.trim() !== ""), [memo, onDirty]);

  const choose = (k: ActivityKind, r: ActivityResult | null) => {
    setKind(k);
    setResult(r);
    if (!statusTouched) setStatus(suggestStatus(company.status, k, r));
    if (!textTouched && r) setNextText(NEXT_ACTION_SUGGESTION[r]);
  };

  const save = (date: string | null) => {
    if (!date && needsNextAction(status) && !warnNoNext) {
      setWarnNoNext(true);
      return;
    }
    start(async () => {
      const r = await recordActivity({
        company_id: company.id,
        kind,
        result,
        memo,
        contact_id: contactId,
        next_action_date: date,
        next_action: date ? nextText : "",
        status,
      });
      if (!r.ok || !r.data) {
        toast.error(r.message);
        return;
      }
      const { id, before } = r.data;
      onDirty(false);
      onDone();
      router.refresh();
      toast.success(r.message, {
        action: { label: "元に戻す", onClick: () => void undo(id, before) },
      });
    });
  };

  const undo = async (id: string, before: ActivityBefore) => {
    const r = await undoActivity(id, before);
    if (r.ok) toast.success(r.message);
    else toast.error(r.message);
    router.refresh();
  };

  const quick = [
    { label: "明日", date: addDays(today, 1) },
    { label: "3日後", date: addDays(today, 3) },
    { label: "1週間後", date: addDays(today, 7) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold text-muted-foreground">種類</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ACTIVITY_KIND) as ActivityKind[]).map((k) => (
            <Chip key={k} on={kind === k} onClick={() => choose(k, result)}>
              {ACTIVITY_KIND[k]}
            </Chip>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold text-muted-foreground">結果</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(ACTIVITY_RESULT) as ActivityResult[]).map((r) => (
            <Chip key={r} on={result === r} onClick={() => choose(kind, result === r ? null : r)}>
              {ACTIVITY_RESULT[r].label}
            </Chip>
          ))}
        </div>
      </fieldset>

      <Input aria-label="一言メモ" placeholder="一言メモ（なくても記録できます）" value={memo} onChange={(e) => setMemo(e.target.value)} />

      {status !== company.status && (
        <p className="text-sm">
          ステータスを「<b>{COMPANY_STATUS[status].label}</b>」に変えます（「詳細」で選び直せます）
        </p>
      )}

      <fieldset className={cn("flex flex-col gap-2 rounded-md border p-3", warnNoNext && "border-status-alert/50 bg-status-alert-bg/40")}>
        <legend className="px-1 text-sm font-bold text-muted-foreground">次回アクション日を押すと記録します</legend>
        <Input
          aria-label="次にやること"
          placeholder="次にやること（例: もう一度電話する）"
          value={nextText}
          onChange={(e) => {
            setNextText(e.target.value);
            setTextTouched(true);
          }}
        />
        {initial.date && (
          <Button variant="outline" disabled={pending} onClick={() => save(initial.date)}>
            いまの予定のまま（{formatShortJa(initial.date)}）で記録
          </Button>
        )}
        <div className="grid grid-cols-3 gap-2">
          {quick.map((q) => (
            <Button key={q.label} disabled={pending} onClick={() => save(q.date)} aria-label={`${q.label}（${formatShortJa(q.date)}）で記録`}>
              {q.label}
            </Button>
          ))}
        </div>
        {customDate == null ? (
          <Button variant="outline" disabled={pending} onClick={() => setCustomDate(addDays(today, 14))}>
            日付を指定する
          </Button>
        ) : (
          <div className="flex gap-2">
            <Input type="date" aria-label="次回アクション日" min={today} value={customDate} onChange={(e) => setCustomDate(e.target.value)} className="min-w-0 flex-1" />
            <Button disabled={pending || !customDate} onClick={() => save(customDate)}>
              この日で記録
            </Button>
          </div>
        )}
        {warnNoNext && (
          <p role="alert" className="text-sm text-status-alert">
            「{COMPANY_STATUS[status].label}」の会社は次回アクション日が必要です。上の候補から選んでください（もう一度押すと、次回なしで記録します）。
          </p>
        )}
        <Button variant="ghost" disabled={pending} onClick={() => save(null)}>
          次回なしで記録
        </Button>
      </fieldset>

      <details className="group rounded-md border">
        <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-3 font-medium">
          詳細（先方の担当者・ステータス）
          <ChevronDownIcon className="size-5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-4 border-t p-3">
          {company.contacts.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-bold text-muted-foreground">先方の担当者</legend>
              <div className="flex flex-wrap gap-2">
                {company.contacts.map((c) => (
                  <Chip key={c.id} on={contactId === c.id} onClick={() => setContactId(contactId === c.id ? null : c.id)}>
                    {c.name}
                  </Chip>
                ))}
              </div>
            </fieldset>
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-bold text-muted-foreground">ステータス</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(COMPANY_STATUS) as CompanyStatus[]).map((s) => (
                <Chip
                  key={s}
                  on={status === s}
                  onClick={() => {
                    setStatus(s);
                    setStatusTouched(true);
                    setWarnNoNext(false);
                  }}
                >
                  {COMPANY_STATUS[s].label}
                </Chip>
              ))}
            </div>
          </fieldset>
        </div>
      </details>
    </div>
  );
}

/** 入力途中で閉じようとしたら確認する（CLAUDE.md「入力途中で画面を離れようとしたら確認」） */
function useGuardedOpen() {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const onOpenChange = (o: boolean) => {
    if (!o && dirty && !window.confirm("入力中のメモは記録されません。閉じますか？")) return;
    if (!o) setDirty(false);
    setOpen(o);
  };
  return { open, setOpen, onOpenChange, setDirty };
}

/** 会社の画面・一覧・ホームに置く「記録する」ボタン */
export function RecordActivityButton({
  company,
  variant = "default",
  size = "default",
  label = "記録する",
  className,
}: {
  company: ActivityCompany;
  variant?: "default" | "outline";
  size?: "default" | "sm";
  label?: string;
  className?: string;
}) {
  const { open, setOpen, onOpenChange, setDirty } = useGuardedOpen();
  return (
    <>
      <Button variant={variant} size={size} className={className} aria-label={`${company.name}の活動を記録`} onClick={() => setOpen(true)}>
        <MessageSquarePlusIcon />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent side="bottom" className="mx-auto max-w-xl">
          <DialogHeader>
            <DialogTitle>活動を記録</DialogTitle>
            <DialogDescription>{company.name}</DialogDescription>
          </DialogHeader>
          {open && <ActivityForm company={company} onDirty={setDirty} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** ＋ボタンの「活動を記録」: 会社を選んでから記録する */
export function RecordActivityPicker({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [targets, setTargets] = useState<RecordTarget[] | null>(null);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<RecordTarget | null>(null);
  const [dirty, setDirty] = useState(false);
  const today = todayJst();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void listRecordTargets().then((t) => alive && setTargets(t));
    return () => {
      alive = false;
    };
  }, [open]);

  const shown = useMemo(() => (targets ?? []).filter((t) => matchesQuery(q, { text: [t.name, t.kana] })).slice(0, 30), [targets, q]);

  const close = () => {
    setPicked(null);
    setQ("");
    setDirty(false);
    onOpenChange(false);
  };
  const change = (o: boolean) => {
    if (o) return onOpenChange(true);
    if (dirty && !window.confirm("入力中のメモは記録されません。閉じますか？")) return;
    close();
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent side="bottom" className="mx-auto max-w-xl">
        <DialogHeader>
          <DialogTitle>活動を記録</DialogTitle>
          <DialogDescription>{picked ? picked.name : "どの会社の記録ですか？"}</DialogDescription>
        </DialogHeader>
        {picked ? (
          <ActivityForm company={picked} onDirty={setDirty} onDone={close} />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="会社を探す" placeholder="会社名で探す" className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {targets == null ? (
              <p className="py-4 text-center text-muted-foreground">読み込み中…</p>
            ) : shown.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground">
                {targets.length === 0 ? "会社がまだありません。「営業」から登録してください。" : "見つかりません"}
              </p>
            ) : (
              <ul className="divide-y">
                {shown.map((t) => {
                  const due = t.next_action_date != null && t.next_action_date <= today;
                  return (
                    <li key={t.id}>
                      <button type="button" onClick={() => setPicked(t)} className="flex min-h-12 w-full items-center gap-2 py-2 text-left hover:bg-accent">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{t.name}</span>
                          {t.next_action_date && (
                            <span className={cn("block truncate text-sm", due ? (t.next_action_date < today ? "text-status-alert" : "font-medium") : "text-muted-foreground")}>
                              {formatShortJa(t.next_action_date)} {t.next_action}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-sm text-muted-foreground">{COMPANY_KIND[t.kind]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
