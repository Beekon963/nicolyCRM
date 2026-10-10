import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth";
import { addDays, monthOf, nextMonth, parse, todayJst } from "@/lib/date";
import { loadBoard } from "@/lib/data/board";
import { siteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { EventsViewTabs } from "../view-tabs";
import { BoardScreen } from "./board-screen";
import { ShareLink } from "./share-link";

export const metadata = { title: "稼働表 | NICOLY CRM" };

export default async function BoardPage({ searchParams }: PageProps<"/events/board">) {
  const me = await requireMember();
  const sp = await searchParams;
  const raw = typeof sp.month === "string" ? sp.month : "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : monthOf(todayJst());
  const supabase = await createClient();
  const [data, { data: share }] = await Promise.all([loadBoard(month), supabase.from("share_links").select("token, is_active").eq("kind", "board").maybeSingle()]);
  const { y, m } = parse(`${month}-01`);

  return (
    <>
      <PageHeader
        title="稼働表"
        actions={<ShareLink link={share ? { url: `${siteUrl()}/s/${share.token}`, active: share.is_active } : null} isOwner={me.role === "owner"} />}
      />
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
