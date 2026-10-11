"use client";

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { StatusScreen } from "@/components/app/status-screen";
import { Button } from "@/components/ui/button";

/** マイページを出す途中で失敗したとき（下のタブはそのまま出す） */
export default function MypageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <StatusScreen
      icon={<TriangleAlertIcon />}
      tone="alert"
      title="うまく表示できませんでした"
      className="px-2"
      actions={
        <Button size="lg" onClick={() => retry()}>
          <RefreshCwIcon />
          もう一度試す
        </Button>
      }
    >
      電波が弱いときなどに起きます。少し待ってからもう一度試してください。何度も続くときは、担当者に LINE で知らせてください。
    </StatusScreen>
  );
}
