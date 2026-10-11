"use client";

import { useEffect } from "react";
import "./globals.css";

/** いちばん外側（画面の枠）で失敗したとき。ここだけはほかの部品を使わず、最小限で出す */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <html lang="ja">
      <body className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground antialiased">
        <title>うまく表示できませんでした | NICOLY</title>
        <h1 className="text-xl font-bold">うまく表示できませんでした</h1>
        <p className="max-w-sm text-muted-foreground">電波が弱いときなどに起きます。少し待ってからもう一度試してください。</p>
        <button type="button" onClick={() => retry()} className="mt-2 h-11 rounded-xl bg-primary px-5 font-semibold text-primary-foreground">
          もう一度試す
        </button>
      </body>
    </html>
  );
}
