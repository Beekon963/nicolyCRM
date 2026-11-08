"use client";

import { AlertTriangleIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { BoardTabs, StaffFilterBar } from "@/components/app/board/board-tabs";
import { DayView } from "@/components/app/board/day-view";
import { ChipLegend } from "@/components/app/board/staff-chip";
import { MonthGrid, MonthLegend, WeekGrid } from "@/components/app/board/staff-grid";
import { BoardGrid, BoardLegend, type BoardMoney } from "@/components/app/board-grid";
import { MessageDialog, type Recipient } from "@/components/app/message-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { type BoardStaffAssignment, type BoardStaffRow, isDropped } from "@/lib/board";
import { type AvailabilityChange, applyAvailability, reverseChanges } from "@/lib/board/grid";
import { type BoardFilters, filterBoard, filterCounts, NO_FILTERS, venuesOf } from "@/lib/board/view";
import { type BoardTab, filterStaff, initialDate, initialWeek, NO_STAFF_FILTER, type StaffFilter, tabFromPrefs, unassignedCount, weekBounds, weekDates } from "@/lib/board/views";
import { useIsPhone, useLocalPref } from "@/hooks/use-local-pref";
import { addDays, type DateString, formatShortJa, monthOf } from "@/lib/date";
import type { BoardEventInfo, BoardPageData } from "@/lib/data/board";
import { AVAILABILITY } from "@/lib/labels";
import { chipLabel } from "@/lib/board/short-name";
import { buildMessage } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { removeOffer } from "../actions";
import { assignFromBoard, setAvailabilityCells, setAvailabilityDay, undoAssignFromBoard } from "./actions";
import { BoardFilterBar } from "./board-views";

/** 絞り込みとリスト・表は、この端末に覚えておく */
const parseFilters = (raw: string | null): BoardFilters => {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<BoardFilters>) : {};
    return { shortageOnly: v.shortageOnly === true, freeOnly: v.freeOnly === true, fromToday: v.fromToday === true };
  } catch {
    return NO_FILTERS;
  }
};
const rawPref = (raw: string | null) => raw;

type Sel = { staffId: string; date: string; eventId?: string } | { clientId: string; date: string } | null;

export function BoardScreen({ data, money, initialDay }: { data: BoardPageData; money?: BoardMoney; /** 日ビューで最初に出す日（?date=。この月の中） */ initialDay?: string | null }) {
  const router = useRouter();
  const [sel, setSel] = useState<Sel>(null);
  const [sent, setSent] = useState<Recipient[] | null>(null);
  const { board } = data;
  // キーで入れた稼働可能日は、保存が終わる前から表に出す
  const [shown, showChanges] = useOptimistic(board, applyAvailability);
  const [, startSave] = useTransition();
  const [filters, setFilters] = useLocalPref("nicoly.board.filters", parseFilters);
  // 見せ方のタブ（日・週・月・表。Phase 22）。古い「リスト／表」の設定も読む。選んでいなければ、スマホは日、PC は週
  const [tabPref, setTabPref] = useLocalPref("nicoly.board.tab", rawPref);
  const [legacyView] = useLocalPref("nicoly.board.view", rawPref);
  const phone = useIsPhone();
  const tab: BoardTab | null = tabFromPrefs(tabPref, legacyView) ?? (phone == null ? null : phone ? "day" : "week");
  const setTab = (t: BoardTab) => setTabPref(t);
  // 日・週・月の絞り込み（現場未定だけ・現場別・名前）と、見ている週
  const [staffFilter, setStaffFilter] = useState<StaffFilter>(NO_STAFF_FILTER);
  const [weekStart, setWeekStart] = useState<DateString | null>(null);
  const inMonth = (d: string | null | undefined) => !!d && shown.days.some((x) => x.date === d);
  const week = weekStart ? weekDates(weekStart) : inMonth(initialDay) ? weekDates(initialDay!) : initialWeek(shown);
  const bounds = weekBounds(shown);
  const thisWeek = initialWeek(shown);
  const weekRows = filterStaff(shown.staff, staffFilter, week);
  const monthDates = shown.days.map((d) => d.date);
  // 日ビューで見ている日（この月の外になったら、今日か月の最初の日）
  const [dayPick, setDayPick] = useState<DateString | null>(null);
  const day = inMonth(dayPick) ? dayPick! : initialDate(shown, initialDay);
  // 週・日を切り替えたときの動き（新しい方が横から入る）。月の外に出るときは前後の月を開く（日付も渡す）
  const [slide, setSlide] = useState<"next" | "prev" | null>(null);
  function goWeek(delta: 1 | -1) {
    const start = addDays(week[0], 7 * delta);
    setSlide(delta > 0 ? "next" : "prev");
    if (start >= bounds.first && start <= bounds.last) return setWeekStart(start);
    router.push(`/events/board?month=${monthOf(start)}&date=${start}`);
  }
  function goDay(d: DateString) {
    setSlide(d > day ? "next" : "prev");
    if (inMonth(d)) return setDayPick(d);
    router.push(`/events/board?month=${monthOf(d)}&date=${d}`);
  }
  const slideCls = slide === "next" ? "motion-safe:animate-board-slide-next" : slide === "prev" ? "motion-safe:animate-board-slide-prev" : "";
  // 「表」タブの絞り込み（欠員の現場だけ・○で空いている人だけ・今日から）
  const counts = filterCounts(shown, filters);
  const visible = filterBoard(shown, filters);
  const filterBar = <BoardFilterBar filters={filters} setFilters={setFilters} counts={counts} />;
  // 絞り込んだ結果、何もないとき（次に何をすればいいかを出す）
  const emptyNote =
    filters.shortageOnly && counts.shortage === 0 ? (
      <p className="mx-4 mb-2 rounded-xl bg-status-done-bg p-3 font-semibold text-status-done">✓ 欠員の現場はありません</p>
    ) : filters.freeOnly && counts.free === 0 ? (
      <p className="mx-4 mb-2 rounded-xl bg-muted p-3 text-[#344054]">○で空いている人はいません。「稼働可能日の提出状況」から提出をお願いしてください。</p>
    ) : null;

  /** 稼働表でキー（1 2 3 / Delete）を押して、選んだマスの稼働可能日を入れる。「元に戻す」付き */
  function saveAvailability(changes: AvailabilityChange[], undo = false) {
    startSave(async () => {
      showChanges(changes);
      const r = await setAvailabilityCells(changes.map(({ staffId, date, status }) => ({ staffId, date, status })));
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      if (undo) toast.success("元に戻しました");
      else toast.success(r.message, { action: { label: "元に戻す", onClick: () => saveAvailability(reverseChanges(changes), true) } });
    });
  }

  function openClientCell(clientId: string, date: string) {
    const list = Object.values(data.events).filter((e) => e.clientId === clientId && e.date === date);
    if (list.length === 0) return router.push(`/events/new?date=${date}&client=${clientId}`);
    if (list.length === 1) return router.push(`/events/${list[0].id}`);
    setSel({ clientId, date });
  }

  const staffRow = sel && "staffId" in sel ? board.staff.find((s) => s.id === sel.staffId) : undefined;
  const clientEvents = sel && "clientId" in sel ? Object.values(data.events).filter((e) => e.clientId === sel.clientId && e.date === sel.date) : [];

  return (
    <>
      {board.clients.length === 0 && board.staff.length === 0 ? (
        <p className="px-4 py-8 text-center text-muted-foreground">この月の現場とスタッフはまだありません。「現場」から現場を作るか、「データ取り込み」で名簿を入れてください。</p>
      ) : (
        <>
          {board.staff.length === 0 && (
            // 「名前が出ない」と見えるときの多くは、スタッフが1人も出ていないとき。次に何をすればいいかを出す
            <p className="mx-4 mb-2 rounded-md bg-status-waiting-bg p-3 text-status-waiting" data-testid="board-no-staff">
              この月に出せるスタッフがいません（稼働表に出るのは「稼働中」の人と、この月に予定がある人です）。「データ取り込み」でスタッフ名簿を取り込むか、「スタッフ」の画面で状態を「すべて」にして、休止・終了になっていないか確かめてください。
            </p>
          )}
          {tab && <BoardTabs tab={tab} setTab={setTab} />}
          {tab == null ? (
            // 画面の幅が分かるまでの骨組み（一瞬だけ）
            <div aria-hidden className="mx-4 h-64 rounded-xl bg-muted motion-safe:animate-pulse" />
          ) : tab === "day" ? (
            <>
              <StaffFilterBar filter={staffFilter} setFilter={setStaffFilter} venues={venuesOf(shown)} unassigned={unassignedCount(shown.staff, [day])} />
              <DayView board={shown} date={day} setDate={goDay} slideCls={slideCls} filter={staffFilter} events={data.events} roles={data.roles} onStaff={(staffId, date, eventId) => setSel({ staffId, date, eventId })} />
            </>
          ) : tab === "week" ? (
            <>
              <StaffFilterBar filter={staffFilter} setFilter={setStaffFilter} venues={venuesOf(shown)} unassigned={unassignedCount(shown.staff, week)} />
              <div className="flex items-center justify-between px-4 pb-2">
                <Button variant="ghost" size="sm" onClick={() => goWeek(-1)}>
                  <ChevronLeftIcon />
                  前の週
                </Button>
                <span className="flex items-center gap-2 text-sm font-semibold tabular-nums">
                  {formatShortJa(week[0])}〜{formatShortJa(week[6])}
                  {week[0] !== thisWeek[0] && [...shown.days, ...shown.pad].some((d) => d.isToday) && (
                    <button type="button" className="min-h-11 text-sm font-semibold text-primary" onClick={() => goWeek(thisWeek[0] > week[0] ? 1 : -1)}>
                      今週へ
                    </button>
                  )}
                </span>
                <Button variant="ghost" size="sm" onClick={() => goWeek(1)}>
                  次の週
                  <ChevronRightIcon />
                </Button>
              </div>
              <div key={week[0]} className={slideCls}>
                <WeekGrid board={shown} dates={week} rows={weekRows} onCell={(staffId, date) => setSel({ staffId, date })} />
              </div>
              <ChipLegend />
            </>
          ) : tab === "month" ? (
            <>
              <StaffFilterBar filter={staffFilter} setFilter={setStaffFilter} venues={venuesOf(shown)} unassigned={unassignedCount(shown.staff, monthDates)} />
              <MonthGrid board={shown} dates={monthDates} rows={filterStaff(shown.staff, staffFilter, monthDates)} onCell={(staffId, date) => setSel({ staffId, date })} />
              <MonthLegend />
            </>
          ) : (
            <BoardGrid
              board={visible}
              money={money}
              filters={
                <>
                  {filterBar}
                  {emptyNote}
                </>
              }
              showFree
              fillBoard={shown}
              onSetAvailability={saveAvailability}
              onStaffCell={(staffId, date) => setSel({ staffId, date })}
              onClientCell={openClientCell}
              staffHref={(id) => `/staff/${id}`}
            />
          )}
        </>
      )}
      {tab === "table" && <BoardLegend admin />}

      <Dialog open={!!staffRow} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent side="bottom" className="max-h-[85dvh] overflow-y-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-w-xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg">
          {staffRow && sel && "staffId" in sel && (
            <StaffDay
              key={`${sel.staffId}|${sel.date}`}
              row={staffRow}
              date={sel.date}
              focusEventId={sel.eventId}
              data={data}
              money={money}
              onOffered={(r) => {
                setSel(null);
                setSent([r]);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={clientEvents.length > 1} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{sel && formatShortJa(sel.date)}の現場</DialogTitle>
          </DialogHeader>
          <ul className="divide-y rounded-md border">
            {clientEvents.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}`} className="flex min-h-12 items-center justify-between gap-2 px-3 py-2 hover:bg-accent">
                  <span>{e.venueName}</span>
                  {e.cancelled ? <Badge tone="muted">中止</Badge> : e.shortage > 0 ? <Badge tone="alert">欠員{e.shortage}</Badge> : <Badge tone="done">確定</Badge>}
                </Link>
              </li>
            ))}
          </ul>
          {sel && "clientId" in sel && (
            <Button asChild variant="outline">
              <Link href={`/events/new?date=${sel.date}&client=${sel.clientId}`}>この日に現場を作る</Link>
            </Button>
          )}
        </DialogContent>
      </Dialog>

      <MessageDialog
        open={!!sent}
        onOpenChange={(o) => !o && setSent(null)}
        title="打診の文面を送る"
        description="LINE で送るか、コピーして送ってください。"
        recipients={sent ?? []}
      />
    </>
  );
}

/** スタッフ × 日付のマスを押したとき: 稼働可能日の入力と、その日の現場への打診・確定 */
function StaffDay({
  row,
  date,
  focusEventId,
  data,
  money,
  onOffered,
}: {
  row: BoardStaffRow;
  date: string;
  /** 日ビューの「空き」から来たとき: その現場を先頭に出して枠で示す */
  focusEventId?: string;
  data: BoardPageData;
  money?: BoardMoney;
  onOffered: (r: Recipient) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // ダイアログを開いている間はトーストが押せないので、「元に戻す」はダイアログの中に出す
  const [notice, setNotice] = useState<{ text: string; undo?: () => Promise<unknown> } | null>(null);
  const notify = (text: string | undefined, undo?: () => Promise<unknown>) => setNotice({ text: text ?? "保存しました", undo });
  const cell = row.cells[date];
  const info = data.staff[row.id];
  const dayEvents = Object.values(data.events)
    .filter((e) => e.date === date && !e.cancelled)
    .sort((a, b) => Number(b.id === focusEventId) - Number(a.id === focusEventId) || b.shortage - a.shortage || a.venueName.localeCompare(b.venueName, "ja"));

  function setAvailability(v: "ok" | "maybe" | "ng" | null) {
    start(async () => {
      const r = await setAvailabilityDay(row.id, date, v);
      if (!r.ok) return void toast.error(r.message);
      router.refresh();
      notify(r.message, () => setAvailabilityDay(row.id, date, r.data!.previous));
    });
  }

  function undo() {
    const fn = notice?.undo;
    if (!fn) return;
    start(async () => {
      await fn();
      router.refresh();
      setNotice({ text: "元に戻しました" });
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {row.name}・{formatShortJa(date)}
        </DialogTitle>
        <DialogDescription>{[row.rankName, row.station].filter(Boolean).join(" / ")}</DialogDescription>
      </DialogHeader>

      {notice && (
        <div
          role="status"
          key={notice.text}
          className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-status-done-border bg-status-done-bg px-3 font-semibold text-status-done motion-safe:animate-pop"
        >
          <span>{notice.text}</span>
          {notice.undo && (
            <Button size="sm" variant="outline" disabled={pending} onClick={undo}>
              元に戻す
            </Button>
          )}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="font-bold">稼働可能日</h3>
        <div className="grid grid-cols-4 gap-2">
          {(["ok", "maybe", "ng", null] as const).map((v) => {
            const on = (cell?.availability ?? null) === v;
            const a = AVAILABILITY[v ?? "none"];
            return (
              <Button
                key={v ?? "none"}
                type="button"
                variant={on ? "default" : "outline"}
                disabled={pending}
                aria-pressed={on}
                onClick={() => !on && setAvailability(v)}
                className="h-auto min-h-12 flex-col gap-0 py-1"
              >
                <span className="text-lg font-bold">{a.mark}</span>
                <span className="text-xs">{v ? a.label : "未入力"}</span>
              </Button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-bold">この日の現場</h3>
        {dayEvents.length === 0 ? (
          <p className="text-muted-foreground">この日の現場はありません。</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {dayEvents.map((e) => (
              <EventRow
                key={e.id}
                e={e}
                focused={e.id === focusEventId}
                row={row}
                date={date}
                assignment={cell?.assignments.find((a) => a.eventId === e.id)}
                data={data}
                money={money}
                pending={pending}
                start={start}
                notify={notify}
                onOffered={onOffered}
                info={info}
              />
            ))}
          </ul>
        )}
        <Button asChild variant="ghost" className="self-start">
          <Link href={`/events/new?date=${date}`}>この日に現場を作る</Link>
        </Button>
      </section>
    </>
  );
}

function EventRow({
  e,
  focused,
  row,
  date,
  assignment,
  data,
  money,
  pending,
  start,
  notify,
  onOffered,
  info,
}: {
  e: BoardEventInfo;
  /** 日ビューの「空き」から来た現場（先頭に出して枠で示す） */
  focused?: boolean;
  row: BoardStaffRow;
  date: string;
  assignment: BoardStaffAssignment | undefined;
  data: BoardPageData;
  /** ★ オーナーだけ: この現場の人日単価と、確定した人の日当（マスには出さず、ここにだけ出す） */
  money?: BoardMoney;
  pending: boolean;
  start: (fn: () => Promise<void>) => void;
  notify: (text: string | undefined, undo?: () => Promise<unknown>) => void;
  onOffered: (r: Recipient) => void;
  info: BoardPageData["staff"][string] | undefined;
}) {
  const router = useRouter();
  const roleEntries = Object.entries(e.byRole).filter(([, r]) => r.required > 0);
  const defaultRole =
    roleEntries.find(([id, r]) => r.shortage > 0 && info?.roleIds.includes(id))?.[0] ??
    roleEntries.find(([, r]) => r.shortage > 0)?.[0] ??
    roleEntries.find(([id]) => info?.roleIds.includes(id))?.[0] ??
    roleEntries[0]?.[0] ??
    data.roles[0]?.id;
  const [roleId, setRoleId] = useState(defaultRole);
  const roleName = data.roles.find((r) => r.id === roleId)?.name;
  const cell = row.cells[date];
  // キャンセル・当日不稼働になった別の現場は「同じ日に別の現場」に数えない
  const others = (cell?.assignments ?? []).filter((a) => a.eventId !== e.id && !isDropped(a.status));

  const warnings = [
    cell?.availability === "ng" && "この日は × です",
    others.length > 0 && `同じ日に別の現場（${others.map((a) => a.venueName).join("・")}）`,
    info?.ngVenueIds.includes(e.venueId) && "この会場は NG です",
    info?.ngClientIds.includes(e.clientId) && "この取引先は NG です",
    !assignment && roleId && (e.byRole[roleId]?.shortage ?? 0) === 0 && `${roleName ?? "この役割"}はもう埋まっています`,
  ].filter(Boolean) as string[];

  function assign(status: "offered" | "confirmed") {
    if (!roleId) return void toast.error("役割を選んでください");
    start(async () => {
      const r = await assignFromBoard(e.id, row.id, roleId, status);
      if (!r.ok) return void toast.error(r.message);
      router.refresh();
      notify(r.message, () => undoAssignFromBoard(r.data!.id, r.data!.previous));
      if (status === "offered" && info) {
        // 打診は続けて文面を送る画面へ（打診の取り消しは、このマスの「打診を取り消す」から）
        toast.success(r.message);
        onOffered({
          id: row.id,
          name: row.name,
          text: buildMessage(data.offerTemplate, e.message, { name: row.name, mypage_token: info.mypageToken }, { siteUrl: data.siteUrl, roleName }),
        });
      }
    });
  }

  function cancelOffer(a: BoardStaffAssignment) {
    start(async () => {
      const r = await removeOffer(a.id);
      if (!r.ok) return void toast.error(r.message);
      router.refresh();
      notify(r.message, () => assignFromBoard(e.id, row.id, a.roleId, "offered"));
    });
  }

  return (
    <li className={cn("flex flex-col gap-2 rounded-md border p-3", focused && "border-primary ring-2 ring-primary/30")} data-focused={focused ? "1" : undefined}>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <Link href={`/events/${e.id}`} className="block truncate font-medium hover:underline">
            {e.venueName}
          </Link>
          <span className="block truncate text-sm text-muted-foreground">
            {e.clientName}
            <span className="ml-2 rounded bg-muted px-1 text-xs">{chipLabel(e)}</span>
          </span>
          {money && (money.eventRate[e.id] || (assignment?.status === "confirmed" && money.daily[assignment.id])) && (
            <span className="block text-sm text-muted-foreground" data-testid="sheet-rate">
              {money.eventRate[e.id] && `単価 ${money.eventRate[e.id]}円`}
              {money.eventRate[e.id] && assignment?.status === "confirmed" && money.daily[assignment.id] ? "・" : ""}
              {assignment?.status === "confirmed" && money.daily[assignment.id] ? `日当 ${money.daily[assignment.id].toLocaleString("ja-JP")}円` : ""}
            </span>
          )}
        </span>
        {e.shortage > 0 ? <Badge tone="alert">欠員{e.shortage}</Badge> : <Badge tone="done">埋まっている</Badge>}
      </div>

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-status-alert">
          {warnings.map((w) => (
            <li key={w} className="flex items-center gap-1">
              <AlertTriangleIcon className="size-4 shrink-0" />
              {w}
            </li>
          ))}
        </ul>
      )}

      {assignment && isDropped(assignment.status) ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="alert">{assignment.status === "cancelled" ? "キャンセル" : "当日不稼働"}</Badge>
          <Button asChild size="sm" variant="ghost">
            <Link href={`/events/${e.id}`}>状態を変えるのは現場の画面で</Link>
          </Button>
        </div>
      ) : assignment ? (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={assignment.status === "confirmed" ? "done" : "waiting"}>
            {assignment.status === "confirmed" ? "確定" : assignment.status === "offered" ? "打診中" : "補欠"}
          </Badge>
          {assignment.status !== "confirmed" && (
            <Button size="sm" disabled={pending} onClick={() => assign("confirmed")}>
              確定にする
            </Button>
          )}
          {assignment.status === "offered" && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => cancelOffer(assignment)}>
              打診を取り消す
            </Button>
          )}
          {assignment.status === "confirmed" && (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/events/${e.id}`}>キャンセルなどは現場の画面で</Link>
            </Button>
          )}
        </div>
      ) : (
        <>
          {roleEntries.length > 1 && (
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="役割">
              {roleEntries.map(([id, r]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={id === roleId}
                  onClick={() => setRoleId(id)}
                  className={cn("h-11 rounded-full border px-3 text-sm", id === roleId ? "border-primary bg-primary text-primary-foreground" : "border-input")}
                >
                  {data.roles.find((x) => x.id === id)?.name}
                  <span className={cn("ml-1", id !== roleId && r.shortage > 0 && "text-status-alert")}>
                    {r.confirmed}/{r.required}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" disabled={pending} onClick={() => assign("offered")}>
              打診する（LINE）
            </Button>
            <Button disabled={pending} onClick={() => assign("confirmed")}>
              確定にする
            </Button>
          </div>
        </>
      )}
    </li>
  );
}
