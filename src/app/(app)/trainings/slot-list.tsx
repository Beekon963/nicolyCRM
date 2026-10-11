"use client";

import { MessageSquareTextIcon, PencilIcon, UserPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CountStepper } from "@/components/app/count-stepper";
import { ShareButtons } from "@/components/app/share-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import type { AdminSlot } from "@/lib/data/trainings";
import { addTrainingBooking, cancelTrainingBooking, restoreTrainingBooking, setTrainingSlotActive, updateTrainingSlot } from "./actions";

type Slot = AdminSlot & { date: string; day: string; time: string; conflict: boolean };
type Booking = Slot["bookings"][number];

/** 研修の枠と予約の一覧（日付ごと） */
export function SlotList({ slots, past, site, linkActive, calendarLinked }: { slots: Slot[]; past: boolean; site: string; linkActive: boolean; calendarLinked: boolean }) {
  if (!slots.length)
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
        {past
          ? "過去60日の研修はありません。"
          : linkActive
            ? "これからの研修の枠はありません。「研修の枠を作る」から日時を作ってください。"
            : "これからの研修の枠はありません。「研修の枠を作る」から日時を作り、「予約用リンク」を LINE で送ってください。"}
      </p>
    );
  const days = [...new Set(slots.map((s) => s.date))];
  return (
    <div className="flex flex-col gap-5">
      {calendarLinked && !past && <p className="text-sm text-muted-foreground">Google カレンダーとつないでいます。予定と重なる枠は予約の画面に出さず、予約が入るとカレンダーに予定を入れます。</p>}
      {days.map((d) => (
        <section key={d} className="flex flex-col gap-2">
          <h2 className="font-bold">{slots.find((s) => s.date === d)!.day}</h2>
          {slots
            .filter((s) => s.date === d)
            .map((s) => (
              <SlotCard key={s.id} slot={s} past={past} site={site} />
            ))}
        </section>
      ))}
    </div>
  );
}

function SlotCard({ slot, past, site }: { slot: Slot; past: boolean; site: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"view" | "add" | "edit">("view");
  const [pending, start] = useTransition();
  const active = slot.bookings.filter((b) => !b.cancelled);
  const cancelled = slot.bookings.filter((b) => b.cancelled);
  const full = active.length >= slot.capacity;

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, undo?: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.message);
      // 元に戻せる操作なので確認は出さず「元に戻す」を出す
      toast.success(r.message, {
        action: undo
          ? {
              label: "元に戻す",
              onClick: () =>
                void undo().then((u) => {
                  if (!u.ok) toast.error(u.message);
                  router.refresh();
                }),
            }
          : undefined,
      });
      setMode("view");
      router.refresh();
    });

  return (
    <div className={slot.isActive ? "flex flex-col gap-3 rounded-lg border p-3" : "flex flex-col gap-3 rounded-lg border border-dashed bg-muted/40 p-3"} data-testid="training-slot" data-slot={slot.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-lg font-bold">{slot.time}</span>
        <span className="min-w-0 break-words">{slot.title}</span>
        <span className="ml-auto flex flex-wrap gap-1">
          {!slot.isActive && <Badge tone="muted">止めています</Badge>}
          {full ? <Badge tone="done">満席 {active.length}/{slot.capacity}</Badge> : <Badge tone={active.length ? "brand" : "muted"}>予約 {active.length}/{slot.capacity}</Badge>}
        </span>
      </div>
      {slot.conflict && slot.isActive && !full && (
        <p className="rounded-md bg-status-waiting-bg p-2 text-sm text-status-waiting">カレンダーの予定と重なっているので、予約の画面に出していません。</p>
      )}
      {!slot.meetingUrl && !past && active.length > 0 && <p className="text-sm text-status-waiting">参加の URL がまだありません（「直す」で入れられます）。</p>}

      {active.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border">
          {active.map((b) => (
            <BookingRow
              key={b.id}
              booking={b}
              slot={slot}
              site={site}
              past={past}
              pending={pending}
              onCancel={() => run(() => cancelTrainingBooking(b.id), () => restoreTrainingBooking(b.id))}
            />
          ))}
        </ul>
      )}
      {cancelled.length > 0 && <p className="text-sm text-muted-foreground">キャンセル: {cancelled.map((b) => b.name).join("、")}</p>}

      {!past && mode === "view" && (
        <div className="flex flex-wrap gap-2">
          {!full && (
            <Button variant="outline" size="sm" onClick={() => setMode("add")}>
              <UserPlusIcon />
              予約を入れる
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setMode("edit")}>
            <PencilIcon />
            直す
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => run(() => setTrainingSlotActive(slot.id, !slot.isActive), () => setTrainingSlotActive(slot.id, slot.isActive))}
          >
            {slot.isActive ? "止める" : "再開する"}
          </Button>
        </div>
      )}
      {mode === "add" && <AddBooking pending={pending} onCancel={() => setMode("view")} onSubmit={(v) => run(() => addTrainingBooking(slot.id, v))} />}
      {mode === "edit" && <EditSlot slot={slot} pending={pending} onCancel={() => setMode("view")} onSubmit={(v) => run(() => updateTrainingSlot(slot.id, v))} />}
    </div>
  );
}

function BookingRow({ booking: b, slot, site, past, pending, onCancel }: { booking: Booking; slot: Slot; site: string; past: boolean; pending: boolean; onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  const text = [
    `${b.name}様`,
    `研修のご予約を受け付けました。`,
    `日時: ${slot.day} ${slot.time}`,
    `研修: ${slot.title}`,
    `参加の URL・キャンセルはこちら`,
    `${site}/t/b/${b.cancelToken}`,
  ].join("\n");
  return (
    <li className="flex flex-wrap items-center gap-2 p-2">
      <div className="min-w-48 flex-1">
        <p className="font-bold break-words">
          {b.name}
          {b.source === "admin" && <span className="ml-2 text-sm font-normal text-muted-foreground">（こちらで入力）</span>}
        </p>
        {b.contact && <p className="text-sm break-words text-muted-foreground">{b.contact}</p>}
        {b.memo && <p className="text-sm break-words whitespace-pre-wrap">{b.memo}</p>}
      </div>
      {!past && (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            <MessageSquareTextIcon />
            控えを送る
          </Button>
          <Button variant="ghost" size="sm" className="text-status-alert" disabled={pending} onClick={onCancel}>
            取り消す
          </Button>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{b.name}さんへの控え</DialogTitle>
            <DialogDescription>参加の URL とキャンセルの画面を LINE で送れます（電話などで受けた予約のとき）。</DialogDescription>
          </DialogHeader>
          <p className="rounded bg-muted p-2 text-sm whitespace-pre-wrap break-all">{text}</p>
          <ShareButtons text={text} />
        </DialogContent>
      </Dialog>
    </li>
  );
}

function AddBooking({ pending, onCancel, onSubmit }: { pending: boolean; onCancel: () => void; onSubmit: (v: { name: string; contact: string; memo: string }) => void }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  return (
    <form
      className="flex flex-col gap-2 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name, contact, memo: "" });
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="tb-name">お名前</Label>
        <Input id="tb-name" value={name} maxLength={50} required autoFocus onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="tb-contact">連絡先（任意）</Label>
        <Input id="tb-contact" value={contact} maxLength={100} onChange={(e) => setContact(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !name.trim()}>
          入れる
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          やめる
        </Button>
      </div>
    </form>
  );
}

function EditSlot({
  slot,
  pending,
  onCancel,
  onSubmit,
}: {
  slot: Slot;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (v: { title: string; capacity: number; meetingUrl: string; note: string }) => void;
}) {
  const [title, setTitle] = useState(slot.title);
  const [capacity, setCapacity] = useState(slot.capacity);
  const [meetingUrl, setMeetingUrl] = useState(slot.meetingUrl);
  const [note, setNote] = useState(slot.note);
  return (
    <form
      className="flex flex-col gap-3 rounded-md border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ title, capacity, meetingUrl, note });
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={`te-title-${slot.id}`}>研修の名前</Label>
        <Input id={`te-title-${slot.id}`} value={title} maxLength={50} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-medium">定員</span>
        <CountStepper label="定員" value={capacity} min={1} max={100} onChange={setCapacity} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`te-url-${slot.id}`}>参加の URL</Label>
        <Input id={`te-url-${slot.id}`} type="url" inputMode="url" placeholder="https://" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`te-note-${slot.id}`}>ご案内</Label>
        <Textarea id={`te-note-${slot.id}`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="text-sm text-muted-foreground">日時を変えるときは、この枠を止めて新しく作ってください。</p>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          保存
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          やめる
        </Button>
      </div>
    </form>
  );
}
