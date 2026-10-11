"use client";

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { StatusScreen } from "@/components/app/status-screen";
import { Button } from "@/components/ui/button";

/** ログイン画面・見るだけリンク・研修の予約などで失敗したとき */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <main className="flex flex-1 flex-col items-center justify-center">
      <StatusScreen
        icon={<TriangleAlertIcon />}
        tone="alert"
        title="うまく表示できませんでした"
        actions={
          <Button onClick={() => retry()}>
            <RefreshCwIcon />
            もう一度試す
          </Button>
        }
      >
        電波が弱いときなどに起きます。少し待ってからもう一度試してください。
      </StatusScreen>
    </main>
  );
}
