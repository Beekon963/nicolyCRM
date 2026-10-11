"use client";

import { useTransition } from "react";
import { LineLink } from "@/components/app/line-link";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { sendMyLineTest, startMyLineLink, unlinkMyLine } from "./actions";

/** 自分（オーナー・管理者）の LINE をつなぐ */
export function MyLine({ linked, botName }: { linked: boolean; botName: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2" data-testid="my-line">
      <LineLink linked={linked} botName={botName} what="スタッフの確定や新しい現場のお知らせが届きます（オーナーが「社内に知らせる」をオンにしているとき）。" start={startMyLineLink} unlink={unlinkMyLine} />
      {linked && (
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await sendMyLineTest();
              if (r.ok) toast.success(r.message);
              else toast.error(r.message);
            })
          }
        >
          自分にテストを送る
        </Button>
      )}
    </div>
  );
}
