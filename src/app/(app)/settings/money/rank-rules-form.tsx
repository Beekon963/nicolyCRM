"use client";

import { useState, useTransition } from "react";
import { saveRankRules } from "@/app/(app)/money/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { parseYen } from "@/lib/money";

const yenText = (n: number | null) => (n == null ? "" : n.toLocaleString("ja-JP"));

/** ★ ランク制度の決まり（Phase 12）: 遠方の上乗せの1回分、友達紹介のボーナスの額と回数（オーナーだけ） */
export function RankRulesForm({ travelStepAmount, referral }: { travelStepAmount: number | null; referral: { amount: number | null; after: number } }) {
  const [travel, setTravel] = useState(yenText(travelStepAmount));
  const [bonus, setBonus] = useState(yenText(referral.amount));
  const [after, setAfter] = useState(String(referral.after));
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty);

  const yenInput = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative w-40">
        <Input
          id={id}
          inputMode="numeric"
          placeholder="未設定"
          className="pr-7 text-right tabular-nums"
          value={value}
          onChange={(e) => {
            set(e.target.value);
            setDirty(true);
          }}
        />
        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">円</span>
      </div>
    </div>
  );

  return (
    <section className="mx-4 mb-6 flex flex-col gap-4 rounded-lg border p-4">
      <h2 className="font-bold">遠方の上乗せ・友達紹介のボーナス</h2>
      <p className="text-sm text-muted-foreground">
        ランクごとの日当は「設定 → ランク」の基準日当で決まります。ここでは、ランク制度のそのほかの決まりの額を入れます。
      </p>
      {yenInput("travel-step", "遠方の上乗せ（最寄り駅から1時間30分を超える30分ごとに、日当に足す額）", travel, setTravel)}
      <p className="-mt-2 text-sm text-muted-foreground">現場の人の「…」→「最寄り駅からの時間」で選んだ回数だけ足します。</p>
      {yenInput("referral-amount", "友達紹介のボーナス（紹介した人の報酬に足す額）", bonus, setBonus)}
      <div className="flex flex-col gap-1">
        <Label htmlFor="referral-after">紹介された人が何回稼働したら出すか</Label>
        <div className="flex items-center gap-2">
          <Input
            id="referral-after"
            inputMode="numeric"
            className="w-20 text-right tabular-nums"
            value={after}
            onChange={(e) => {
              setAfter(e.target.value.replace(/[^0-9]/g, ""));
              setDirty(true);
            }}
          />
          回
        </div>
      </div>
      <Button
        className="self-start"
        disabled={pending}
        onClick={() => {
          const t = parseYen(travel);
          const b = parseYen(bonus);
          if (Number.isNaN(t) || Number.isNaN(b)) return toast.error("金額を数字で入れてください");
          start(async () => {
            const r = await saveRankRules({ travelStepAmount: t, referralAmount: b, referralAfter: Number(after) || 0 });
            if (r.ok) {
              toast.success(r.message);
              setDirty(false);
            } else toast.error(r.message);
          });
        }}
      >
        遠方・紹介の設定を保存
      </Button>
    </section>
  );
}
