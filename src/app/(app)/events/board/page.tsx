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
import { cn } from "@/lib/utils";
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
          // 見出しと同じ行に小さく並べる（表を少しでも上に出すため）
          <div className="flex gap-2 max-md:[&_button]:gap-1.5 max-md:[&_button]:px-2.5">
            {/* 現場は稼働表から開くので、ここからも作れるように（スマホは右下の ＋）。Phase 13 */}
            <Button asChild size="sm" className="hidden md:inline-flex">
              <Link href="/events/new">＋ 現場を作る</Link>
            </Button>
            <ShareLink link={share ? { url: `${siteUrl()}/s/${share.token}`, active: share.is_active } : null} isOwner={isOwner} />
            <SheetExport
              isOwner={isOwner}
              state={{
                spreadsheetId: (sheet?.value as { spreadsheet_id?: string } | null)?.spreadsheet_id ?? null,
                last: last ? { ranAt: at(last.ran_at), ok: last.ok, message: last.message } : null,
                serviceEmail: isOwner ? (readServiceAccount()?.client_email ?? null) : null,
              }}
            />
          </div>
        }
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
        // オーナーだけ: この月の数字を3つ横に並べる（見込みを含む）
        <Link
          href={`/money?month=${month}`}
          className="mx-4 mb-2 grid grid-cols-3 divide-x rounded-xl border bg-[#fcfcfd] py-1.5 text-center tabular-nums transition-colors hover:bg-accent"
          aria-label="この月の数字（お金の画面へ）"
        >
          {(
            [
              ["売上", money.summary.revenue.confirmed + money.summary.revenue.estimate],
              ["支払", money.summary.pay.confirmed + money.summary.pay.estimate],
              ["粗利", money.summary.gross.confirmed + money.summary.gross.estimate],
            ] as const
          ).map(([label, v]) => (
            <span key={label} className="flex min-w-0 flex-col px-1">
              <span className="text-xs text-muted-foreground">
                {label}
                {label === "売上" && money.summary.revenue.estimate !== 0 && <span className="max-md:hidden">（見込み含む）</span>}
              </span>
              <span className={cn("truncate text-sm font-bold", v < 0 && "text-status-alert")}>{formatYen(v)}</span>
            </span>
          ))}
        </Link>
      )}
      <BoardScreen data={data} money={boardMoney} />
    </>
  );
}
