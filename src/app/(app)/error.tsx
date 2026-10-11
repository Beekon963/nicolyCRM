"use client";

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { StatusScreen } from "@/components/app/status-screen";
import { Button } from "@/components/ui/button";

/** 画面を出す途中で失敗したとき（通信が切れたときなど）。メニューはそのまま出す */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <StatusScreen
      icon={<TriangleAlertIcon />}
      tone="alert"
      title="うまく表示できませんでした"
      actions={
        <>
          <Button onClick={() => retry()}>
            <RefreshCwIcon />
            もう一度試す
          </Button>
          <Button asChild variant="outline">
            <Link href="/">ホームへ</Link>
          </Button>
        </>
      }
    >
      電波が弱いときなどに起きます。入力した内容は保存されていないことがあるので、開き直したら確かめてください。何度も続くときはオーナーに知らせてください。
    </StatusScreen>
  );
}
