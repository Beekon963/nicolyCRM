"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AvailabilityCalendar, type AvailabilityStatus } from "@/components/app/availability-calendar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { eachDay, formatShortJa, monthRange } from "@/lib/date";
import { saveAvailability } from "../actions";

type Values = Record<string, AvailabilityStatus>;

export function AvailabilityEditor({
  token,
  month,
  today,
  initial,
  memo: initialMemo,
  submittedAt,
  deadline,
  holidays,
  events,
}: {
  token: string;
  month: string;
  today: string;
  initial: Values;
  memo: string;
  submittedAt: string | null;
  deadline: string;
  holidays: Record<string, string>;
  events: Record<string, string>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(initial);
  const [memo, setMemo] = useState(initialMemo);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty);
  const { start: first, end } = monthRange(month);
  const editableDays = eachDay(first < today ? today : first, end);
  const blank = editableDays.filter((d) => !values[d]);

  function fill(status: AvailabilityStatus) {
    setValues((v) => ({ ...v, ...Object.fromEntries(blank.map((d) => [d, status])) }));
    setDirty(true);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex flex-wrap items-center gap-2">
        {submittedAt ? <Badge tone="done">提出済み</Badge> : <Badge tone={today > deadline ? "alert" : "waiting"}>未提出</Badge>}
        <span className="text-sm text-muted-foreground">締切 {formatShortJa(deadline)}</span>
      </p>
      <p className="text-sm text-muted-foreground">日付をタップすると ○ → △ → × → 未入力 と切り替わります。</p>
      <AvailabilityCalendar
        month={month}
        values={values}
        holidays={holidays}
        marks={Object.fromEntries(Object.entries(events).map(([d, v]) => [d, v.slice(0, 4)]))}
        editable
        minDate={today}
        onToggle={(d, next) => {
          setValues((v) => {
            const n = { ...v };
            if (next) n[d] = next;
            else delete n[d];
            return n;
          });
          setDirty(true);
        }}
      />
      {blank.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fill("ok")}>
            未入力の日を全部 ○
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => fill("ng")}>
            未入力の日を全部 ×
          </Button>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <Label htmlFor="memo">メモ（任意）</Label>
        <Textarea id="memo" rows={2} placeholder="例: 土日は午後からなら可" value={memo} onChange={(e) => (setMemo(e.target.value), setDirty(true))} />
      </div>
      <div className="sticky bottom-20 z-20">
        <Button
          size="lg"
          className="h-14 w-full text-lg shadow"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const days = Object.fromEntries(editableDays.map((d) => [d, values[d] ?? null]));
              const r = await saveAvailability(token, `${month}-01`, days, memo, true);
              if (!r.ok) return void toast.error(r.message);
              toast.success(r.message);
              setDirty(false);
              router.refresh();
            })
          }
        >
          {pending ? "送信中…" : submittedAt ? "もう一度提出する" : "提出する"}
        </Button>
      </div>
    </div>
  );
}
