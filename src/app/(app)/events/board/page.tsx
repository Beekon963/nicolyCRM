import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requireMember } from "@/lib/auth";
import { addDays, formatTimeJst, monthOf, nextMonth, parse, todayJst, toJstDateString } from "@/lib/date";
import { readServiceAccount } from "@/lib/google/sheets";
import { loadBoard } from "@/lib/data/board";
import { getMonthMoney } from "@/lib/data/money";
import { formatYen, rateRangeText } from "@/lib/money";
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
  // ★ 金額の列はオーナーのときだけ計算する（管理者・見るだけリンクには出さない。Phase 1.5 で決めたこと）
  const money = isOwner ? await getMonthMoney(month) : null;
  const boardMoney = money
    ? {
        client: Object.fromEntries(money.clients.map((c) => [c.id, c.subtotal])),
        staff: Object.fromEntries(money.staff.map((st) => [st.id, st.totals.reward])),
        // 今のシートの「単価」の行と同じ情報（現場の人日単価・スタッフの日当）をマスに出す
        eventRate: Object.fromEntries(
          money.events.map((e) => [e.id, rateRangeText(e.bill.lines.filter((l) => l.kind === "person_day").map((l) => l.unit))]),
        ),
        daily: Object.fromEntries(money.staff.flatMap((st) => st.assignments.filter((a) => a.worked && a.pay.daily > 0).map((a) => [a.assignmentId, a.pay.daily]))),
      }
    : undefined;

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
      {money && (
        <p className="px-4 pb-2 text-sm tabular-nums">
          <span className="text-muted-foreground">この月（オーナーのみ）: </span>
          売上 <b>{formatYen(money.summary.revenue.confirmed + money.summary.revenue.estimate)}</b> ・ 支払 <b>{formatYen(money.summary.pay.confirmed + money.summary.pay.estimate)}</b> ・ 粗利{" "}
          <b className={money.summary.gross.confirmed + money.summary.gross.estimate < 0 ? "text-status-alert" : undefined}>
            {formatYen(money.summary.gross.confirmed + money.summary.gross.estimate)}
          </b>
          {money.summary.revenue.estimate !== 0 && <span className="text-muted-foreground">（見込みを含む）</span>}
          <Link href={`/money?month=${month}`} className="ml-2 text-primary underline-offset-2 hover:underline">
            お金へ
          </Link>
        </p>
      )}
      <BoardScreen data={data} money={boardMoney} />
    </>
  );
}
