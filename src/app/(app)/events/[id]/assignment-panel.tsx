"use client";

import { MessageCircleIcon, MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { MessageDialog, type Recipient } from "@/components/app/message-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { ASSIGNMENT_STATUS, CANCEL_REASONS, INPUT_SOURCE } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { markSent, removeOffer, setAssignmentStatus } from "../actions";

type Status = keyof typeof ASSIGNMENT_STATUS;

export type PanelAssignment = {
  id: string;
  staffId: string;
  name: string;
  roleName: string;
  status: Status;
  responseSource: "self" | "admin" | null;
  respondedAt: string | null;
  offeredAt: string;
  confirmNoticeSent: boolean;
  reminderSent: boolean;
  reported: boolean;
  messages: { offer: string; confirm: string; reminder: string; report: string };
};

const ORDER: Status[] = ["confirmed", "offered", "waitlisted", "declined", "cancelled", "no_show"];

export function AssignmentPanel({
  assignments,
  isPast,
  isTomorrowOrToday,
  overCapacityRoles,
  recordOnly = false,
}: {
  assignments: PanelAssignment[];
  isPast: boolean;
  /** シートから取り込んだ過去の記録（実績報告なし） */
  recordOnly?: boolean;
  isTomorrowOrToday: boolean;
  overCapacityRoles: string[];
}) {
  const [pending, start] = useTransition();
  const [menu, setMenu] = useState<PanelAssignment | null>(null);
  const [cancelFor, setCancelFor] = useState<{ a: PanelAssignment; status: "cancelled" | "no_show" } | null>(null);
  const [dialog, setDialog] = useState<null | { kind: "offer" | "confirm" | "reminder" | "report"; ids: string[] }>(null);

  function changeStatus(a: PanelAssignment, status: Status, reason?: { code: string; text: string }) {
    start(async () => {
      const r = await setAssignmentStatus(a.id, status, reason);
      if (!r.ok) return void toast.error(r.message);
      setMenu(null);
      setCancelFor(null);
      const label = ASSIGNMENT_STATUS[status].label;
      // 元に戻せる操作は確認なしで実行し「元に戻す」を出す（要件 §9-7）。キャンセル・当日不稼働は理由を聞いている
      if (status === "cancelled" || status === "no_show") toast.success(`${a.name}さんを「${label}」にしました（稼働履歴メモに記録）`);
      else
        toast.success(`${a.name}さんを「${label}」にしました`, {
          action: { label: "元に戻す", onClick: () => start(async () => void (await setAssignmentStatus(a.id, r.data!.previous))) },
        });
    });
  }

  const groups = ORDER.map((s) => ({ status: s, list: assignments.filter((a) => a.status === s) })).filter((g) => g.list.length);
  const confirmed = assignments.filter((a) => a.status === "confirmed");
  const offered = assignments.filter((a) => a.status === "offered");
  const unsentConfirm = confirmed.filter((a) => !a.confirmNoticeSent);
  const unsentReminder = confirmed.filter((a) => !a.reminderSent);
  const unreported = confirmed.filter((a) => !a.reported);

  const recipients: Recipient[] = dialog
    ? assignments
        .filter((a) => dialog.ids.includes(a.id))
        .map((a) => ({
          id: a.id,
          name: a.name,
          text: a.messages[dialog.kind],
          sent: dialog.kind === "confirm" ? a.confirmNoticeSent : dialog.kind === "reminder" ? a.reminderSent : false,
        }))
    : [];

  return (
    <div className="flex flex-col gap-3">
      {overCapacityRoles.length > 0 && (
        <p className="rounded-md border border-status-waiting/40 bg-status-waiting-bg p-2 text-sm text-status-waiting">
          {overCapacityRoles.join("・")} が必要人数を超えて確定しています
        </p>
      )}

      {/* まとめて送る */}
      <div className="flex flex-wrap gap-2">
        {offered.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "offer", ids: offered.map((a) => a.id) })}>
            <MessageCircleIcon />
            打診の文面（{offered.length}人）
          </Button>
        )}
        {!isPast && unsentConfirm.length > 0 && (
          <Button size="sm" onClick={() => setDialog({ kind: "confirm", ids: unsentConfirm.map((a) => a.id) })}>
            <MessageCircleIcon />
            確定連絡を送る（{unsentConfirm.length}人）
          </Button>
        )}
        {!isPast && isTomorrowOrToday && unsentReminder.length > 0 && (
          <Button size="sm" variant={unsentConfirm.length ? "outline" : "default"} onClick={() => setDialog({ kind: "reminder", ids: unsentReminder.map((a) => a.id) })}>
            <MessageCircleIcon />
            前日リマインドを送る（{unsentReminder.length}人）
          </Button>
        )}
        {isPast && !recordOnly && unreported.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "report", ids: unreported.map((a) => a.id) })}>
            <MessageCircleIcon />
            実績報告のお願い（{unreported.length}人）
          </Button>
        )}
      </div>

      {recordOnly && <p className="text-sm text-muted-foreground">スプレッドシートから取り込んだ過去の記録です（実績報告はありません）。</p>}
      {groups.length === 0 && <p className="text-sm text-muted-foreground">まだ誰にも打診していません。「候補を探す」から打診しましょう。</p>}
      {groups.map((g) => (
        <div key={g.status}>
          <p className="mb-1 text-sm font-medium text-muted-foreground">
            {ASSIGNMENT_STATUS[g.status].label}（{g.list.length}）
          </p>
          <ul className="divide-y rounded-md border">
            {g.list.map((a) => (
              <li key={a.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <Link href={`/staff/${a.staffId}`} className="font-medium hover:underline">
                    {a.name}
                  </Link>
                  <span className="ml-2 text-sm text-muted-foreground">{a.roleName}</span>
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    <Badge tone={ASSIGNMENT_STATUS[a.status].tone}>{ASSIGNMENT_STATUS[a.status].label}</Badge>
                    {a.status === "offered" && Date.now() - new Date(a.offeredAt).getTime() > 24 * 3600_000 && <Badge tone="alert">24時間以上未回答</Badge>}
                    {a.responseSource && a.status !== "offered" && <span className="text-xs text-muted-foreground">回答: {INPUT_SOURCE[a.responseSource]}</span>}
                    {a.status === "confirmed" && !isPast && (
                      <>
                        <Badge tone={a.confirmNoticeSent ? "done" : "waiting"}>{a.confirmNoticeSent ? "確定連絡済み" : "確定連絡まだ"}</Badge>
                        {isTomorrowOrToday && <Badge tone={a.reminderSent ? "done" : "alert"}>{a.reminderSent ? "リマインド済み" : "リマインドまだ"}</Badge>}
                      </>
                    )}
                    {a.status === "confirmed" && isPast && !recordOnly && <Badge tone={a.reported ? "done" : "alert"}>{a.reported ? "報告済み" : "未報告"}</Badge>}
                  </div>
                </div>
                <Button variant="ghost" size="icon" aria-label={`${a.name}の状態を変える`} onClick={() => setMenu(a)}>
                  <MoreHorizontalIcon />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* 状態を変える */}
      <Dialog open={menu != null} onOpenChange={(o) => !o && setMenu(null)}>
        <DialogContent side="bottom" className="md:top-1/2 md:bottom-auto md:left-1/2 md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg">
          <DialogHeader>
            <DialogTitle>{menu?.name}さんの状態</DialogTitle>
          </DialogHeader>
          {menu && (
            <div className="grid grid-cols-2 gap-2">
              {(["confirmed", "waitlisted", "declined", "offered"] as Status[])
                .filter((s) => s !== menu.status)
                .map((s) => (
                  <Button key={s} variant="outline" disabled={pending} onClick={() => changeStatus(menu, s)}>
                    {s === "offered" ? "打診中に戻す" : `${ASSIGNMENT_STATUS[s].label}にする`}
                  </Button>
                ))}
              {menu.status === "confirmed" && (
                <>
                  <Button variant="outline" className="text-status-alert" onClick={() => setCancelFor({ a: menu, status: "cancelled" })}>
                    キャンセル
                  </Button>
                  <Button variant="outline" className="text-status-alert" onClick={() => setCancelFor({ a: menu, status: "no_show" })}>
                    当日不稼働
                  </Button>
                </>
              )}
              {menu.status === "offered" && !menu.respondedAt && (
                <Button
                  variant="ghost"
                  className="col-span-2 text-muted-foreground"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await removeOffer(menu.id);
                      if (r.ok) {
                        toast.success(r.message);
                        setMenu(null);
                      } else toast.error(r.message);
                    })
                  }
                >
                  打診を取り消す（間違えたとき）
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <CancelDialog
        target={cancelFor}
        pending={pending}
        onClose={() => setCancelFor(null)}
        onSubmit={(reason) => cancelFor && changeStatus(cancelFor.a, cancelFor.status, reason)}
      />

      <MessageDialog
        open={dialog != null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog ? { offer: "打診の文面", confirm: "確定連絡", reminder: "前日リマインド", report: "実績報告のお願い" }[dialog.kind] : ""}
        description="1人ずつ「LINEで送る」を押し、LINE で送り先を選んで送信してください。"
        recipients={recipients}
        onSent={(id) => {
          if (dialog?.kind === "confirm" || dialog?.kind === "reminder") void markSent([id], dialog.kind);
        }}
      />
    </div>
  );
}

function CancelDialog({
  target,
  pending,
  onClose,
  onSubmit,
}: {
  target: { a: PanelAssignment; status: "cancelled" | "no_show" } | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: { code: string; text: string }) => void;
}) {
  const [code, setCode] = useState("");
  const [text, setText] = useState("");
  return (
    <Dialog
      open={target != null}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setCode("");
          setText("");
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target?.a.name}さんを「{target ? ASSIGNMENT_STATUS[target.status].label : ""}」にする
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">理由を選んでください。スタッフの稼働履歴メモに自動で記録されます。</p>
        <div className="grid gap-2">
          {CANCEL_REASONS.map((r) => (
            <button
              key={r.code}
              type="button"
              onClick={() => setCode(r.code)}
              className={cn("h-11 rounded-md border px-3 text-left", code === r.code ? "border-primary bg-primary/10 font-medium" : "border-input")}
            >
              {r.label}
            </button>
          ))}
        </div>
        <Label htmlFor="cancel-text">メモ（任意）</Label>
        <Input id="cancel-text" value={text} onChange={(e) => setText(e.target.value)} />
        <DialogFooter>
          <Button variant="destructive" disabled={!code || pending} onClick={() => onSubmit({ code, text })}>
            {target ? ASSIGNMENT_STATUS[target.status].label : ""}にする
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
