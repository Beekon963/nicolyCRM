import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth";
import { addDays, monthOf, nextMonth, parse, todayJst } from "@/lib/date";
import { loadBoard } from "@/lib/data/board";
import { EventsViewTabs } from "../view-tabs";
import { BoardScreen } from "./board-screen";

export const metadata = { title: "稼働表 | NICOLY CRM" };

export default async function BoardPage({ searchParams }: PageProps<"/events/board">) {
  await requireMember();
  const sp = await searchParams;
  const raw = typeof sp.month === "string" ? sp.month : "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : monthOf(todayJst());
  const data = await loadBoard(month);
  const { y, m } = parse(`${month}-01`);

  return (
    <>
      <PageHeader title="稼働表" />
      <EventsViewTabs current="board" month={month} />
      <div className="flex items-center justify-between px-4 pb-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/events/board?month=${monthOf(addDays(`${month}-01`, -1))}`}>
            <ChevronLeftIcon />
            前の月
          </Link>
        </Button>
        <span className="font-bold">
          {y}年{m}月
        </span>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/events/board?month=${nextMonth(month)}`}>
            次の月
            <ChevronRightIcon />
          </Link>
        </Button>
      </div>
      <BoardScreen data={data} />
    </>
  );
}
