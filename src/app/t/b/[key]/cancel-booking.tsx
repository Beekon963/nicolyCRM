"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { cancelTraining } from "../../actions";

/** 予約した人のキャンセル（取り消すと元に戻せないので確かめる） */
export function CancelBooking({ bookingKey }: { bookingKey: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  if (!confirm)
    return (
      <Button variant="ghost" className="text-muted-foreground" onClick={() => setConfirm(true)}>
        予約をキャンセルする
      </Button>
    );
  return (
    <div className="flex flex-col gap-2 rounded-md border border-status-alert/40 bg-status-alert-bg p-3">
      <p className="text-status-alert">キャンセルすると、この枠は他の人が予約できるようになります。もう一度受けるときは、日時を選び直してください。</p>
      <div className="flex gap-2">
        <Button
          variant="destructive"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await cancelTraining(bookingKey);
              if (!r.ok) return void toast.error(r.message);
              toast.success(r.message);
              router.refresh();
            })
          }
        >
          キャンセルする
        </Button>
        <Button variant="ghost" onClick={() => setConfirm(false)}>
          やめる
        </Button>
      </div>
    </div>
  );
}
