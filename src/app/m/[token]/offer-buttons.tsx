"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { respondOffer } from "./actions";

export function OfferButtons({ token, assignmentId }: { token: string; assignmentId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  // 回答するとこのカードは一覧から消える（「予定」に移る）ので、結果は画面下の通知でも出す
  const answer = (accept: boolean) =>
    start(async () => {
      const r = await respondOffer(token, assignmentId, accept);
      setResult(r);
      if (r.ok) toast.success(r.message, { duration: 8000 });
    });

  if (result?.ok) return <p className="rounded-lg bg-status-done-bg p-3 font-bold text-status-done" role="status">{result.message}</p>;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" className="h-14 text-lg" disabled={pending} onClick={() => answer(true)}>
          参加できる
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-14 text-lg"
          disabled={pending}
          onClick={() => {
            if (!window.confirm("「参加できない」で回答します。よろしいですか？")) return;
            answer(false);
          }}
        >
          できない
        </Button>
      </div>
      {result && !result.ok && <p className="text-status-alert" role="alert">{result.message}</p>}
    </div>
  );
}
