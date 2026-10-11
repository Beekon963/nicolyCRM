"use client";

import { ChevronLeftIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { cn } from "@/lib/utils";
import { bookTraining } from "../actions";

export type PickSlot = { id: string; title: string; note: string; left: number; date: string; day: string; time: string };

/** 日時を選ぶ → お名前を入れて予約（2ステップ） */
export function SlotPicker({ token, slots }: { token: string; slots: PickSlot[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<PickSlot | null>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [memo, setMemo] = useState("");
  const [pending, start] = useTransition();
  useUnsavedChanges(picked != null && name.trim() !== "" && !pending);
  const titles = new Set(slots.map((s) => s.title));
  const days = [...new Set(slots.map((s) => s.date))].map((date) => ({ date, day: slots.find((s) => s.date === date)!.day, slots: slots.filter((s) => s.date === date) }));

  if (!picked) {
    return (
      <div className="flex flex-col gap-5">
        {days.map((d) => (
          <section key={d.date} className="flex flex-col gap-2">
            <h2 className="font-bold">{d.day}</h2>
            <div className="grid grid-cols-2 gap-2">
              {d.slots.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-slot={s.id}
                  disabled={s.left <= 0}
                  onClick={() => setPicked(s)}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center rounded-lg border px-2 py-2 text-base",
                    s.left > 0 ? "border-primary/40 font-bold text-primary active:bg-primary/10" : "border-input text-muted-foreground",
                  )}
                >
                  <span>{s.time}</span>
                  {titles.size > 1 && <span className="text-sm font-normal">{s.title}</span>}
                  {s.left <= 0 && <span className="text-sm font-normal">満席</span>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await bookTraining(token, { slotId: picked.id, name, contact, memo });
          if (!r.ok) {
            toast.error(r.message);
            setPicked(null);
            router.refresh();
            return;
          }
          router.push(`/t/b/${encodeURIComponent(r.cancelToken)}`);
        });
      }}
    >
      <div className="flex flex-col gap-1 rounded-lg border border-primary/40 bg-primary/5 p-4">
        <p className="text-sm text-muted-foreground">{picked.title}</p>
        <p className="text-lg font-bold">
          {picked.day} {picked.time}
        </p>
        {picked.note && <p className="text-sm whitespace-pre-wrap">{picked.note}</p>}
      </div>
      <Button type="button" variant="ghost" className="self-start" onClick={() => setPicked(null)}>
        <ChevronLeftIcon />
        日時を選び直す
      </Button>
      <div className="flex flex-col gap-2">
        <Label htmlFor="t-name">お名前</Label>
        <Input id="t-name" value={name} maxLength={50} autoComplete="name" required onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="t-contact">連絡先（任意）</Label>
        <Input id="t-contact" value={contact} maxLength={100} placeholder="電話番号・メール・LINE の名前など" onChange={(e) => setContact(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="t-memo">ひとこと（任意）</Label>
        <Textarea id="t-memo" value={memo} maxLength={500} rows={2} onChange={(e) => setMemo(e.target.value)} />
      </div>
      <Button type="submit" size="lg" disabled={pending || !name.trim()}>
        {pending ? "予約しています…" : "この日時で予約する"}
      </Button>
    </form>
  );
}
