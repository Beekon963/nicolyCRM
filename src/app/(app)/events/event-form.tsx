"use client";

import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CountStepper } from "@/components/app/count-stepper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { datesFor, presetRanges, WEEKDAYS, type Weekday } from "@/lib/bulk-dates";
import { addDays, formatShortJa, todayJst } from "@/lib/date";
import { cn } from "@/lib/utils";
import { createEvent, createEventsBulk, updateEvent, type EventInput } from "./actions";

type Opt = { id: string; name: string };

export type EventFormInitial = EventInput & { id?: string; date: string };

export function EventForm({
  mode,
  initial,
  clients,
  venues,
  roles,
  holidays,
}: {
  mode: "single" | "bulk" | "edit";
  initial?: EventFormInitial;
  clients: Opt[];
  venues: Opt[];
  roles: Opt[];
  holidays: Record<string, string>;
}) {
  const router = useRouter();
  const today = todayJst();
  const [form, setForm] = useState<EventInput>(
    initial ?? {
      client_id: "",
      venue_id: "",
      start_time: "10:00",
      end_time: "19:00",
      meeting_time: "09:30",
      meeting_place: "",
      belongings: "",
      notes: "",
      requirements: roles.map((r, i) => ({ role_id: r.id, required_count: i === 0 ? 1 : 0 })),
    },
  );
  const [date, setDate] = useState(initial?.date ?? addDays(today, 1));
  const presets = presetRanges(today);
  const [range, setRange] = useState({ from: presets[0].from, to: presets[0].to, weekdays: presets[0].weekdays as Weekday[] });
  const [excluded, setExcluded] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty);

  const bulkDates = useMemo(() => datesFor(range.from, range.to, range.weekdays), [range]);
  const selectedDates = bulkDates.filter((d) => !excluded.includes(d));
  const set = <K extends keyof EventInput>(k: K, v: EventInput[K]) => {
    setForm({ ...form, [k]: v });
    setDirty(true);
  };
  const setCount = (roleId: string, n: number) =>
    set(
      "requirements",
      form.requirements.some((r) => r.role_id === roleId)
        ? form.requirements.map((r) => (r.role_id === roleId ? { ...r, required_count: n } : r))
        : [...form.requirements, { role_id: roleId, required_count: n }],
    );
  const venueName = venues.find((v) => v.id === form.venue_id)?.name ?? "";

  function submit() {
    start(async () => {
      if (mode === "edit" && initial?.id) {
        const r = await updateEvent(initial.id, form, date);
        if (!r.ok) return void toast.error(r.message);
        toast.success(r.message);
        setDirty(false);
        router.push(`/events/${initial.id}`);
        return;
      }
      const r =
        mode === "bulk"
          ? await createEventsBulk(form, selectedDates, groupName || `${venueName} ${formatShortJa(selectedDates[0] ?? today)}〜`)
          : await createEvent(form, date);
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      setDirty(false);
      if (r.data?.groupId) router.push(`/events?group=${r.data.groupId}`);
      else if (r.data?.ids[0]) router.push(`/events/${r.data.ids[0]}`);
    });
  }

  return (
    <form
      className="flex flex-col gap-5 px-4 pb-8"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="ev-client">取引先</Label>
          <NativeSelect id="ev-client" required value={form.client_id} onChange={(e) => set("client_id", e.target.value)}>
            <option value="">選んでください</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ev-venue">会場</Label>
          <NativeSelect id="ev-venue" required value={form.venue_id} onChange={(e) => set("venue_id", e.target.value)}>
            <option value="">選んでください</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {mode === "bulk" ? (
        <fieldset className="flex flex-col gap-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">期間と曜日</legend>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                className={cn(
                  "h-11 rounded-full border px-4",
                  range.from === p.from && range.to === p.to ? "border-primary bg-primary/10 font-medium text-primary" : "border-input",
                )}
                onClick={() => {
                  setRange({ from: p.from, to: p.to, weekdays: p.weekdays });
                  setExcluded([]);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <Input type="date" aria-label="開始日" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            〜
            <Input type="date" aria-label="終了日" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </div>
          <div role="group" aria-label="曜日" className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w) => {
              const on = range.weekdays.includes(w);
              return (
                <button
                  key={w}
                  type="button"
                  aria-pressed={on}
                  className={cn("h-11 rounded-md border", on ? "border-primary bg-primary text-primary-foreground" : "border-input")}
                  onClick={() => setRange({ ...range, weekdays: on ? range.weekdays.filter((x) => x !== w) : [...range.weekdays, w] })}
                >
                  {w}
                </button>
              );
            })}
          </div>
          <div>
            <p className="mb-1 text-sm text-muted-foreground">作成する日（{selectedDates.length}件）。タップで除外できます</p>
            <div className="flex flex-wrap gap-1">
              {bulkDates.map((d) => {
                const off = excluded.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setExcluded(off ? excluded.filter((x) => x !== d) : [...excluded, d])}
                    className={cn("h-10 rounded-md border px-2 text-sm", off ? "border-dashed text-muted-foreground line-through" : "border-primary/40 bg-primary/5")}
                  >
                    {formatShortJa(d)}
                    {holidays[d] && <span className="ml-1 text-status-alert">祝</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </fieldset>
      ) : (
        <div className="flex flex-col gap-1">
          <Label htmlFor="ev-date">日付</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input id="ev-date" type="date" className="w-auto" required value={date} onChange={(e) => (setDate(e.target.value), setDirty(true))} />
            {holidays[date] && <Badge tone="alert">{holidays[date]}</Badge>}
            {mode === "single" && (
              <Button asChild variant="link" size="sm">
                <Link href="/events/bulk">期間でまとめて作る</Link>
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ["start_time", "開始"],
            ["end_time", "終了"],
            ["meeting_time", "集合"],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="flex flex-col gap-1">
            <Label htmlFor={`ev-${k}`}>{label}</Label>
            <Input id={`ev-${k}`} type="time" step={300} value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
          </div>
        ))}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">役割別の必要人数</legend>
        {roles.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2">
            <span>{r.name}</span>
            <CountStepper
              label={`${r.name}の必要人数`}
              max={50}
              value={form.requirements.find((x) => x.role_id === r.id)?.required_count ?? 0}
              onChange={(n) => setCount(r.id, n)}
            />
          </div>
        ))}
      </fieldset>

      <details className="group rounded-md border" open={mode === "edit"}>
        <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-3 font-medium">
          詳細（集合場所・服装・持ち物・注意事項{mode === "bulk" ? "・グループ名" : ""}）
          <ChevronDownIcon className="size-5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-3 border-t p-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ev-place">集合場所</Label>
            <Input id="ev-place" value={form.meeting_place} onChange={(e) => set("meeting_place", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ev-belongings">服装・持ち物</Label>
            <Textarea id="ev-belongings" rows={2} value={form.belongings} onChange={(e) => set("belongings", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ev-notes">注意事項</Label>
            <Textarea id="ev-notes" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
          </div>
          {mode === "bulk" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="ev-group">グループ名（空なら「会場名 開始日〜」）</Label>
              <Input id="ev-group" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
            </div>
          )}
        </div>
      </details>

      <Button type="submit" size="lg" disabled={pending || (mode === "bulk" && selectedDates.length === 0)}>
        {pending ? "保存中…" : mode === "edit" ? "保存する" : mode === "bulk" ? `${selectedDates.length}件の現場を作る` : "現場を作る"}
      </Button>
    </form>
  );
}
