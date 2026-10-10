import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BoardGrid, BoardLegend } from "@/components/app/board-grid";
import { Button } from "@/components/ui/button";
import { addDays, monthOf, nextMonth, parse, todayJst } from "@/lib/date";
import { loadSharedBoard } from "@/lib/data/shared-board";

export const metadata: Metadata = {
  title: "稼働表（見るだけ） | NICOLY",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/** 稼働表の「見るだけリンク」（ログイン不要。現場リーダー・スタッフ向け。金額・電話番号は出さない） */
export default async function SharedBoardPage({ params, searchParams }: PageProps<"/s/[token]">) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const current = monthOf(todayJst());
  const raw = typeof sp.month === "string" ? sp.month : "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : current;
  const r = await loadSharedBoard(token, month);

  if (!r.ok) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <Image src="/logo.png" alt="" width={80} height={62} />
        <h1 className="text-xl font-bold">稼働表を開けません</h1>
        <p className="text-muted-foreground">{r.error}</p>
        {r.code === "out_of_range" && (
          <Button asChild>
            <Link href={`/s/${token}`}>今月の稼働表を見る</Link>
          </Button>
        )}
      </main>
    );
  }

  const prev = monthOf(addDays(`${month}-01`, -1));
  const next = nextMonth(month);
  const min = monthOf(addDays(`${current}-01`, -1));
  let max = current;
  for (let i = 0; i < 3; i++) max = nextMonth(max);
  const { y, m } = parse(`${month}-01`);

  return (
    <div className="flex min-h-dvh w-full flex-col">
      <header className="sticky top-0 z-40 flex items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <Image src="/logo.png" alt="" width={36} height={28} />
        <h1 className="flex-1 truncate font-bold">NICOLY 稼働表（見るだけ）</h1>
      </header>
      <div className="flex items-center justify-between px-4 py-2">
        {month > min ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/s/${token}?month=${prev}`}>
              <ChevronLeftIcon />
              前の月
            </Link>
          </Button>
        ) : (
          <span />
        )}
        <span className="font-bold">
          {y}年{m}月
        </span>
        {month < max ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/s/${token}?month=${next}`}>
              次の月
              <ChevronRightIcon />
            </Link>
          </Button>
        ) : (
          <span />
        )}
      </div>
      <BoardGrid board={r.board} className="max-h-[calc(100dvh-10.5rem)] md:max-h-[calc(100dvh-10.5rem)]" />
      <BoardLegend />
    </div>
  );
}
