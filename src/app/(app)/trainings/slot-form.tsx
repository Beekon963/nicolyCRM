"use client";

import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CountStepper } from "@/components/app/count-stepper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { formatShortJa, isDateString } from "@/lib/date";
import { cn } from "@/lib/utils";
import { createTrainingSlots } from "./actions";

const LENGTHS = [30, 45, 60, 90, 120];
const STARTS = ["10:00", "13:00", "15:00", "19:00"];

/** 研修の枠を作る。日付（複数）→ 始まる時刻 → 長さ → 続けていくつ、だけ選べば作れる */
export function SlotForm({
  defaults,
  today,
  days,
  extra,
}: {
  defaults: { title: string; meetingUrl: string };
  today: string;
  days: string[];
  /** 「研修の枠を作る」の横に並べるボタン（予約用リンク・設定） */
  extra?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [minutes, setMinutes] = useState(60);
  const [count, setCount] = useState(1);
  const [capacity, setCapacity] = useState(1);
  const [title, setTitle] = useState(defaults.title);
  const [meetingUrl, setMeetingUrl] = useState(defaults.meetingUrl);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  useUnsavedChanges(open && dates.length > 0 && !pending);

  const toggle = (d: string) => setDates((v) => (v.includes(d) ? v.filter((x) => x !== d) : [...v, d].sort()));
  const end = (i: number) => {
    const [h, m] = startTime.split(":").map(Number);
    const t = h * 60 + m + minutes * (i + 1);
    return `${String(Math.floor(t / 60) % 24).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  };
  const total = dates.length * count;

  // いちばん使う「研修の枠を作る」を先頭（スマホは全幅）。予約用リンク・設定はその横に白いボタンで
  if (!open)
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button className="w-full sm:w-auto" onClick={() => setOpen(true)}>
          <PlusIcon />
          研修の枠を作る
        </Button>
        {extra && <div className="flex flex-wrap gap-2">{extra}</div>}
      </div>
    );

  return (
    <>
      {extra && <div className="flex flex-wrap gap-2">{extra}</div>}
      <form
      className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await createTrainingSlots({ dates, start: startTime, minutes, count, capacity, title, meetingUrl, note });
          if (!r.ok) return void toast.error(r.message);
          toast.success(r.message);
          setDates([]);
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <h2 className="text-lg font-bold">研修の枠を作る</h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">日付（いくつでも）</legend>
        <div role="group" aria-label="日付" className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {days.map((d) => {
            const on = dates.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(d)}
                className={cn("h-11 rounded-md border text-base", on ? "border-primary bg-brand-50 font-semibold text-primary" : "border-input text-muted-foreground")}
              >
                {d === today ? "今日" : formatShortJa(d)}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <Input type="date" aria-label="ほかの日" className="w-44" value={other} min={today} onChange={(e) => setOther(e.target.value)} />
          <Button
            type="button"
            variant="outline"
            disabled={!isDateString(other) || dates.includes(other)}
            onClick={() => {
              toggle(other);
              setOther("");
            }}
          >
            足す
          </Button>
        </div>
        {dates.some((d) => !days.includes(d)) && <p className="text-sm text-muted-foreground">ほかの日: {dates.filter((d) => !days.includes(d)).map(formatShortJa).join("、")}</p>}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">始まる時刻</legend>
        <div className="flex flex-wrap items-center gap-2">
          {STARTS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={startTime === t}
              onClick={() => setStartTime(t)}
              className={cn("h-11 rounded-full border px-4 text-base", startTime === t ? "border-primary bg-brand-50 font-semibold text-primary" : "border-input text-muted-foreground")}
            >
              {t}
            </button>
          ))}
          <Input type="time" aria-label="始まる時刻" step={900} className="w-32" value={startTime} onChange={(e) => e.target.value && setStartTime(e.target.value)} />
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">1枠の長さ</legend>
        <div className="flex flex-wrap gap-2">
          {LENGTHS.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={minutes === m}
              onClick={() => setMinutes(m)}
              className={cn("h-11 rounded-full border px-4 text-base", minutes === m ? "border-primary bg-brand-50 font-semibold text-primary" : "border-input text-muted-foreground")}
            >
              {m}分
            </button>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <div className="flex flex-col gap-1">
          <span className="font-medium">続けて作る数</span>
          <CountStepper label="続けて作る数" value={count} min={1} max={12} onChange={setCount} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-medium">1枠の定員</span>
          <CountStepper label="1枠の定員" value={capacity} min={1} max={100} onChange={setCapacity} />
        </div>
      </div>

      <details className="group rounded-md border">
        <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-3 font-medium">
          詳細（研修の名前・参加の URL・ご案内）
          <ChevronDownIcon className="size-5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-3 border-t p-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ts-title">研修の名前</Label>
            <Input id="ts-title" value={title} maxLength={50} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ts-url">参加の URL（Zoom・Google Meet など）</Label>
            <Input id="ts-url" type="url" inputMode="url" value={meetingUrl} placeholder="https://" onChange={(e) => setMeetingUrl(e.target.value)} />
            <p className="text-sm text-muted-foreground">予約した人の控えの画面に「オンラインの研修に入る」ボタンで出ます。</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ts-note">ご案内（持ち物・注意など）</Label>
            <Textarea id="ts-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      </details>

      <p className="text-muted-foreground" aria-live="polite">
        {total === 0
          ? "日付を選んでください"
          : `${formatShortJa(dates[0])}${dates.length > 1 ? ` ほか${dates.length - 1}日` : ""} ${startTime}〜${end(count - 1)}（${minutes}分 × ${count}）… 合計 ${total}枠`}
      </p>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || total === 0}>
          {pending ? "作っています…" : `${total || ""}枠を作る`}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          やめる
        </Button>
      </div>
      </form>
    </>
  );
}
