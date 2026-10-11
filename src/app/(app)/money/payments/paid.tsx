"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setPaid } from "@/app/(app)/money/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { formatShortJa, todayJst } from "@/lib/date";
import { cn } from "@/lib/utils";

function usePaid(month: string) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (staffIds: string[], paidOn: string | null) =>
    start(async () => {
      const r = await setPaid(month, staffIds, paidOn);
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      // 元に戻せる操作なので確認は出さず「元に戻す」を出す
      toast.success(r.message, {
        action: paidOn ? { label: "元に戻す", onClick: () => void setPaid(month, staffIds, null).then(() => router.refresh()) } : undefined,
      });
      router.refresh();
    });
  return { pending, run };
}

/** 確定した人をまとめて支払済みにする（支払日は設定の支払日か今日をワンタップで） */
export function PaidBar({ month, staffIds, defaultDate }: { month: string; staffIds: string[]; defaultDate: string }) {
  const [date, setDate] = useState(defaultDate);
  const { pending, run } = usePaid(month);
  const today = todayJst();
  const options = [
    { label: `支払日（${formatShortJa(defaultDate)}）`, value: defaultDate },
    ...(today !== defaultDate ? [{ label: "今日", value: today }] : []),
  ];
  return (
    <div className="mx-4 flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-card">
      <p className="font-bold">支払済みにする</p>
      <div className="flex flex-wrap items-center gap-2">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            onClick={() => setDate(o.value)}
            className={cn("h-11 rounded-full border px-4 text-base", date === o.value ? "border-primary bg-brand-50 font-semibold text-primary" : "border-input text-muted-foreground")}
          >
            {o.label}
          </button>
        ))}
        <Input type="date" aria-label="支払った日" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
      </div>
      <Button className="self-start" disabled={pending || staffIds.length === 0 || !date} onClick={() => run(staffIds, date)}>
        {staffIds.length === 0 ? "全員が支払済みです" : `確定の${staffIds.length}人を支払済みにする`}
      </Button>
    </div>
  );
}

/** 1人ずつ支払済みにする／取り消す */
export function PaidToggle({ month, staffId, paid, defaultDate }: { month: string; staffId: string; paid: boolean; defaultDate: string }) {
  const { pending, run } = usePaid(month);
  return paid ? (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => run([staffId], null)}>
      支払済みを取り消す
    </Button>
  ) : (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => run([staffId], defaultDate)}>
      {formatShortJa(defaultDate)}に支払済みにする
    </Button>
  );
}
