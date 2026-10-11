import type { Metadata } from "next";
import Image from "next/image";

/** 研修の予約の画面（ログイン不要）。検索に載せない・リンク元を送らない */
export const trainingMetadata: Metadata = {
  title: "研修の予約 | NICOLY",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 py-6">
      <div className="flex items-center gap-3">
        <Image src="/logo.png" alt="" width={48} height={37} />
        <h1 className="text-xl font-bold">研修の予約</h1>
      </div>
      {children}
    </main>
  );
}

export function Message({ title, text }: { title: string; text: string }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <Image src="/logo.png" alt="" width={80} height={62} />
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="text-muted-foreground">{text}</p>
    </main>
  );
}
