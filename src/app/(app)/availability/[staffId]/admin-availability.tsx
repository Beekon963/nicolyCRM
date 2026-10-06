"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AvailabilityCalendar, type AvailabilityStatus } from "@/components/app/availability-calendar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { eachDay, monthRange } from "@/lib/date";
import { saveAvailabilityAsAdmin } from "../actions";

export function AdminAvailability({
  staffId,
  month,
  initial,
  memo: initialMemo,
  holidays,
}: {
  staffId: string;
  month: string;
  initial: Record<string, AvailabilityStatus>;
  memo: string;
  holidays: Record<string, string>;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [memo, setMemo] = useState(initialMemo);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty);
  const { start: first, end } = monthRange(month);
  const days = eachDay(first, end);
  const blank = days.filter((d) => !values[d]);

  function save(submit: boolean) {
    start(async () => {
      const r = await saveAvailabilityAsAdmin(staffId, first, Object.fromEntries(days.map((d) => [d, values[d] ?? null])), memo, submit);
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      setDirty(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4 px-4">
      <p className="text-sm text-muted-foreground">日付をタップすると ○ → △ → × → 未入力 と切り替わります。入力元は「管理者」で記録されます。</p>
      <AvailabilityCalendar
        month={month}
        values={values}
        holidays={holidays}
        editable
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
          <Button variant="outline" size="sm" onClick={() => (setValues({ ...values, ...Object.fromEntries(blank.map((d) => [d, "ok" as const])) }), setDirty(true))}>
            未入力の日を全部 ○
          </Button>
          <Button variant="outline" size="sm" onClick={() => (setValues({ ...values, ...Object.fromEntries(blank.map((d) => [d, "ng" as const])) }), setDirty(true))}>
            未入力の日を全部 ×
          </Button>
        </div>
      )}
      <Label htmlFor="memo">メモ</Label>
      <Textarea id="memo" rows={2} value={memo} onChange={(e) => (setMemo(e.target.value), setDirty(true))} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={pending} onClick={() => save(false)}>
          保存だけ
        </Button>
        <Button disabled={pending} onClick={() => save(true)}>
          代理で提出する
        </Button>
      </div>
    </div>
  );
}
