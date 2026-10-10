"use client";

import { AlertTriangleIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { BoardGrid, BoardLegend } from "@/components/app/board-grid";
import { MessageDialog, type Recipient } from "@/components/app/message-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import type { BoardStaffAssignment, BoardStaffRow } from "@/lib/board";
import { type AvailabilityChange, applyAvailability, reverseChanges } from "@/lib/board/grid";
import { formatShortJa } from "@/lib/date";
import type { BoardEventInfo, BoardPageData } from "@/lib/data/board";
import { AVAILABILITY } from "@/lib/labels";
import { buildMessage } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { removeOffer } from "../actions";
import { assignFromBoard, setAvailabilityCells, setAvailabilityDay, undoAssignFromBoard } from "./actions";

type Sel = { staffId: string; date: string } | { clientId: string; date: string } | null;

export function BoardScreen({ data }: { data: BoardPageData }) {
  const router = useRouter();
  const [sel, setSel] = useState<Sel>(null);
  const [sent, setSent] = useState<Recipient[] | null>(null);
  const { board } = data;
  // キーで入れた稼働可能日は、保存が終わる前から表に出す
  const [shown, showChanges] = useOptimistic(board, applyAvailability);
  const [, startSave] = useTransition();

  /** 稼働表でキー（1 2 3 / Delete）を押して、選んだマスの稼働可能日を入れる。「元に戻す」付き */
  function saveAvailability(changes: AvailabilityChange[], undo = false) {
    startSave(async () => {
      showChanges(changes);
      const r = await setAvailabilityCells(changes.map(({ staffId, date, status }) => ({ staffId, date, status })));
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      if (undo) toast.success("元に戻しました");
      else toast.success(r.message, { action: { label: "元に戻す", onClick: () => saveAvailability(reverseChanges(changes), true) } });
    });
  }

  function openClientCell(clientId: string, date: string) {
    const list = Object.values(data.events).filter((e) => e.clientId === clientId && e.date === date);
    if (list.length === 0) return router.push(`/events/new?date=${date}&client=${clientId}`);
    if (list.length === 1) return router.push(`/events/${list[0].id}`);
    setSel({ clientId, date });
  }

  const staffRow = sel && "staffId" in sel ? board.staff.find((s) => s.id === sel.staffId) : undefined;
  const clientEvents = sel && "clientId" in sel ? Object.values(data.events).filter((e) => e.clientId === sel.clientId && e.date === sel.date) : [];

  return (
    <>
      {board.clients.length === 0 && board.staff.length === 0 ? (
        <p className="px-4 py-8 text-center text-muted-foreground">この月の現場とスタッフはまだありません。「現場」から現場を作るか、「データ取り込み」で名簿を入れてください。</p>
      ) : (
        <BoardGrid
          board={shown}
          onSetAvailability={saveAvailability}
          onStaffCell={(staffId, date) => setSel({ staffId, date })}
          onClientCell={openClientCell}
          staffHref={(id) => `/staff/${id}`}
        />
      )}
      <BoardLegend admin />

      <Dialog open={!!staffRow} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent side="bottom" className="max-h-[85dvh] overflow-y-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-w-xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg">
          {staffRow && sel && "staffId" in sel && (
            <StaffDay
              key={`${sel.staffId}|${sel.date}`}
              row={staffRow}
              date={sel.date}
              data={data}
              onOffered={(r) => {
                setSel(null);
                setSent([r]);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={clientEvents.length > 1} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{sel && formatShortJa(sel.date)}の現場</DialogTitle>
          </DialogHeader>
          <ul className="divide-y rounded-md border">
            {clientEvents.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}`} className="flex min-h-12 items-center justify-between gap-2 px-3 py-2 hover:bg-accent">
                  <span>{e.venueName}</span>
                  {e.cancelled ? <Badge tone="muted">中止</Badge> : e.shortage > 0 ? <Badge tone="alert">欠員{e.shortage}</Badge> : <Badge tone="done">確定</Badge>}
                </Link>
              </li>
            ))}
          </ul>
          {sel && "clientId" in sel && (
            <Button asChild variant="outline">
              <Link href={`/events/new?date=${sel.date}&client=${sel.clientId}`}>この日に現場を作る</Link>
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <MessageDialog
        open={!!sent}
        onOpenChange={(o) => !o && setSent(null)}
        title="打診の文面を送る"
        description="LINE で送るか、コピーして送ってください。"
        recipients={sent ?? []}
      />
    </>
  );
}

/** スタッフ × 日付のマスを押したとき: 稼働可能日の入力と、その日の現場への打診・確定 */
function StaffDay({ row, date, data, onOffered }: { row: BoardStaffRow; date: string; data: BoardPageData; onOffered: (r: Recipient) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // ダイアログを開いている間はトーストが押せないので、「元に戻す」はダイアログの中に出す
  const [notice, setNotice] = useState<{ text: string; undo?: () => Promise<unknown> } | null>(null);
  const notify = (text: string | undefined, undo?: () => Promise<unknown>) => setNotice({ text: text ?? "保存しました", undo });
  const cell = row.cells[date];
  const info = data.staff[row.id];
  const dayEvents = Object.values(data.events)
    .filter((e) => e.date === date && !e.cancelled)
    .sort((a, b) => b.shortage - a.shortage || a.venueName.localeCompare(b.venueName, "ja"));

  function setAvailability(v: "ok" | "maybe" | "ng" | null) {
    start(async () => {
      const r = await setAvailabilityDay(row.id, date, v);
      if (!r.ok) return void toast.error(r.message);
      router.refresh();
      notify(r.message, () => setAvailabilityDay(row.id, date, r.data!.previous));
    });
  }

  function undo() {
    const fn = notice?.undo;
    if (!fn) return;
    start(async () => {
      await fn();
      router.refresh();
      setNotice({ text: "元に戻しました" });
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {row.name}・{formatShortJa(date)}
        </DialogTitle>
        <DialogDescription>{[row.rankName, row.station].filter(Boolean).join(" / ")}</DialogDescription>
      </DialogHeader>

      {notice && (
        <div role="status" className="flex min-h-12 items-center justify-between gap-2 rounded-md bg-status-done-bg px-3 text-status-done">
          <span>{notice.text}</span>
          {notice.undo && (
            <Button size="sm" variant="outline" disabled={pending} onClick={undo}>
              元に戻す
            </Button>
          )}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-bold">稼働可能日</h3>
        <div className="grid grid-cols-4 gap-2">
          {(["ok", "maybe", "ng", null] as const).map((v) => {
            const on = (cell?.availability ?? null) === v;
            const a = AVAILABILITY[v ?? "none"];
            return (
              <Button
                key={v ?? "none"}
                type="button"
                variant={on ? "default" : "outline"}
                disabled={pending}
                aria-pressed={on}
                onClick={() => !on && setAvailability(v)}
                className="h-auto min-h-12 flex-col gap-0 py-1"
              >
                <span className="text-lg font-bold">{a.mark}</span>
                <span className="text-xs">{v ? a.label : "未入力"}</span>
              </Button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-bold">この日の現場</h3>
        {dayEvents.length === 0 ? (
          <p className="text-muted-foreground">この日の現場はありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {dayEvents.map((e) => (
              <EventRow
                key={e.id}
                e={e}
                row={row}
                date={date}
                assignment={cell?.assignments.find((a) => a.eventId === e.id)}
                data={data}
                pending={pending}
                start={start}
                notify={notify}
                onOffered={onOffered}
                info={info}
              />
            ))}
          </ul>
        )}
        <Button asChild variant="ghost" className="self-start">
          <Link href={`/events/new?date=${date}`}>この日に現場を作る</Link>
        </Button>
      </section>
    </>
  );
}

function EventRow({
  e,
  row,
  date,
  assignment,
  data,
  pending,
  start,
  notify,
  onOffered,
  info,
}: {
  e: BoardEventInfo;
  row: BoardStaffRow;
  date: string;
  assignment: BoardStaffAssignment | undefined;
  data: BoardPageData;
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
  notify: (text: string | undefined, undo?: () => Promise<unknown>) => void;
  onOffered: (r: Recipient) => void;
  info: BoardPageData["staff"][string] | undefined;
}) {
  const router = useRouter();
  const roleEntries = Object.entries(e.byRole).filter(([, r]) => r.required > 0);
  const defaultRole =
    roleEntries.find(([id, r]) => r.shortage > 0 && info?.roleIds.includes(id))?.[0] ??
    roleEntries.find(([, r]) => r.shortage > 0)?.[0] ??
    roleEntries.find(([id]) => info?.roleIds.includes(id))?.[0] ??
    roleEntries[0]?.[0] ??
    data.roles[0]?.id;
  const [roleId, setRoleId] = useState(defaultRole);
  const roleName = data.roles.find((r) => r.id === roleId)?.name;
  const cell = row.cells[date];
  const others = (cell?.assignments ?? []).filter((a) => a.eventId !== e.id);

  const warnings = [
    cell?.availability === "ng" && "この日は × です",
    others.length > 0 && `同じ日に別の現場（${others.map((a) => a.venueName).join("・")}）`,
    info?.ngVenueIds.includes(e.venueId) && "この会場は NG です",
    info?.ngClientIds.includes(e.clientId) && "この取引先は NG です",
    !assignment && roleId && (e.byRole[roleId]?.shortage ?? 0) === 0 && `${roleName ?? "この役割"}はもう埋まっています`,
  ].filter(Boolean) as string[];

  function assign(status: "offered" | "confirmed") {
    if (!roleId) return void toast.error("役割を選んでください");
    start(async () => {
      const r = await assignFromBoard(e.id, row.id, roleId, status);
      if (!r.ok) return void toast.error(r.message);
      router.refresh();
      notify(r.message, () => undoAssignFromBoard(r.data!.id, r.data!.previous));
      if (status === "offered" && info) {
        // 打診は続けて文面を送る画面へ（打診の取り消しは、このマスの「打診を取り消す」から）
        toast.success(r.message);
        onOffered({
          id: row.id,
          name: row.name,
          text: buildMessage(data.offerTemplate, e.message, { name: row.name, mypage_token: info.mypageToken }, { siteUrl: data.siteUrl, roleName }),
        });
      }
    });
  }

  function cancelOffer(a: BoardStaffAssignment) {
    start(async () => {
      const r = await removeOffer(a.id);
      if (!r.ok) return void toast.error(r.message);
      router.refresh();
      notify(r.message, () => assignFromBoard(e.id, row.id, a.roleId, "offered"));
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <Link href={`/events/${e.id}`} className="block truncate font-medium hover:underline">
            {e.venueName}
          </Link>
          <span className="block truncate text-sm text-muted-foreground">{e.clientName}</span>
        </span>
        {e.shortage > 0 ? <Badge tone="alert">欠員{e.shortage}</Badge> : <Badge tone="done">埋まっている</Badge>}
      </div>

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-status-alert">
          {warnings.map((w) => (
            <li key={w} className="flex items-center gap-1">
              <AlertTriangleIcon className="size-4 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}

      {assignment ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={assignment.status === "confirmed" ? "done" : "waiting"}>
            {assignment.status === "confirmed" ? "確定" : assignment.status === "offered" ? "打診中" : "補欠"}
          </Badge>
          {assignment.status !== "confirmed" && (
            <Button size="sm" disabled={pending} onClick={() => assign("confirmed")}>
              確定にする
            </Button>
          )}
          {assignment.status === "offered" && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => cancelOffer(assignment)}>
              打診を取り消す
            </Button>
          )}
          {assignment.status === "confirmed" && (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/events/${e.id}`}>キャンセルなどは現場の画面で</Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          {roleEntries.length > 1 && (
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="役割">
              {roleEntries.map(([id, r]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={id === roleId}
                  onClick={() => setRoleId(id)}
                  className={cn("h-11 rounded-full border px-3 text-sm", id === roleId ? "border-primary bg-primary text-primary-foreground" : "border-input")}
                >
                  {data.roles.find((x) => x.id === id)?.name}
                  <span className={cn("ml-1", id !== roleId && r.shortage > 0 && "text-status-alert")}>
                    {r.confirmed}/{r.required}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={pending} onClick={() => assign("offered")}>
              打診する（LINE）
            </Button>
            <Button disabled={pending} onClick={() => assign("confirmed")}>
              確定にする
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
