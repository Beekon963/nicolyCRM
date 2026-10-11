"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import type { LineSettings } from "@/lib/line/notify";
import { saveLineSettings } from "./actions";

/** 何を送るか（オーナー） */
export function LineSettingsForm({ initial }: { initial: LineSettings }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  useUnsavedChanges(dirty && !pending);
  const row = (key: "staffConfirm" | "reminder" | "adminNotify", label: string, hint: string) => (
    <label className="flex min-h-11 items-start justify-between gap-3">
      <span className="flex flex-col">
        <span className="font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </span>
      <Switch aria-label={label} checked={v[key]} onCheckedChange={(c) => setV({ ...v, [key]: c })} />
    </label>
  );
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveLineSettings(v);
          if (!r.ok) return void toast.error(r.message);
          toast.success(r.message);
          router.refresh();
        });
      }}
    >
      {row("staffConfirm", "スタッフに確定のお知らせ", "打診中・補欠から確定になったとき、本人に「確定連絡」の文面を送る（送ったら「確定連絡 送信済み」になる）")}
      {row("reminder", "スタッフに前日のお知らせ", "前日の決めた時刻に、翌日の現場の確定した人へ「前日リマインド」の文面を送る")}
      {v.reminder && (
        <label className="flex items-center gap-2 pl-1">
          <span className="text-sm">送る時刻</span>
          <NativeSelect aria-label="前日のお知らせを送る時刻" value={String(v.reminderHour)} onChange={(e) => setV({ ...v, reminderHour: Number(e.target.value) })} className="w-28">
            {Array.from({ length: 15 }, (_, i) => i + 8).map((h) => (
              <option key={h} value={h}>
                {h}時ごろ
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {row("adminNotify", "社内に知らせる", "スタッフが確定したとき・新しい現場を登録したとき・確定していた人がキャンセル・当日不稼働になったとき、オーナー・管理者（LINE とつないだ人）に知らせる。自分の操作は自分には届かない")}
      <Button type="submit" className="self-start" disabled={pending || !dirty}>
        {pending ? "保存しています…" : "保存"}
      </Button>
    </form>
  );
}
