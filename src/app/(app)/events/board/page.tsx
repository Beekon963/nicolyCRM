import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth";
import { addDays, formatTimeJst, monthOf, nextMonth, parse, todayJst, toJstDateString } from "@/lib/date";
import { readServiceAccount } from "@/lib/google/sheets";
import { loadBoard } from "@/lib/data/board";
import { siteUrl } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { EventsViewTabs } from "../view-tabs";
import { BoardScreen } from "./board-screen";
import { SheetExport } from "./sheet-export";
import { ShareLink } from "./share-link";

export const metadata = { title: "稼働表 | NICOLY CRM" };

export default async function BoardPage({ searchParams }: PageProps<"/events/board">) {
  const me = await requireMember();
  const sp = await searchParams;
  const raw = typeof sp.month === "string" ? sp.month : "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : monthOf(todayJst());
  const supabase = await createClient();
  const [data, { data: share }, { data: sheet }, { data: last }] = await Promise.all([
    loadBoard(month),
    supabase.from("share_links").select("token, is_active").eq("kind", "board").maybeSingle(),
    supabase.from("settings").select("value").eq("key", "sheet_export").maybeSingle(),
    supabase.from("sheet_exports").select("ran_at, ok, message").order("ran_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const at = (iso: string) => {
    const d = new Date(iso);
    const { m: mm, d: dd } = parse(toJstDateString(d));
    return `${mm}/${dd} ${formatTimeJst(d)}`;
  };
  const isOwner = me.role === "owner";
  const { y, m } = parse(`${month}-01`);

  return (
    <>
      <PageHeader
        title="稼働表"
        actions={
          <>
            <ShareLink link={share ? { url: `${siteUrl()}/s/${share.token}`, active: share.is_active } : null} isOwner={isOwner} />
            <SheetExport
              isOwner={isOwner}
              state={{
                spreadsheetId: (sheet?.value as { spreadsheet_id?: string } | null)?.spreadsheet_id ?? null,
                last: last ? { ranAt: at(last.ran_at), ok: last.ok, message: last.message } : null,
                serviceEmail: isOwner ? (readServiceAccount()?.client_email ?? null) : null,
              }}
            />
          </>
        }
        actionsBelow
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
