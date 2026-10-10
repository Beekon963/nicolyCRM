"use client";

import { Maximize2Icon, MinusIcon, PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AVAILABILITY_MARK, type Board, type BoardDay, type BoardEventChip, type BoardStaffCell } from "@/lib/board";
import { clampZoom, keepFocus, stepZoom, zoomLabel } from "@/lib/board/zoom";
import { cn } from "@/lib/utils";

const ZOOM_KEY = "nicoly.board.zoom";

/**
 * 表の中だけの拡大・縮小（スプレッドシートと同じ操作感）。
 * - スマホ: 2本指でつまむ / 広げる（画面全体は拡大しない）
 * - PC: Ctrl（Mac は ⌘ でも可）を押しながらホイール、またはトラックパッドでつまむ
 * - ＋ / − ボタン、倍率を押すと 100% に戻る。倍率はこの端末に覚えておく
 */
function useBoardZoom() {
  /** 縦横に動かす枠 */
  const box = useRef<HTMLDivElement>(null);
  /** 拡大・縮小する中身 */
  const inner = useRef<HTMLDivElement>(null);
  const [zoom, setZoomState] = useState(1);
  const live = useRef(1);

  // 端末に覚えた倍率を読む（読めない環境では 100% のまま）
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(ZOOM_KEY));
      if (saved) {
        live.current = clampZoom(saved);
        setZoomState(live.current);
      }
    } catch {}
  }, []);

  /** 倍率を変える。focal（枠の左上からの位置）の下にあるマスが動かないようにスクロールも直す */
  const apply = useCallback(
    (next: number, focal?: { x: number; y: number }, commit = true) => {
      const el = box.current;
      const z = clampZoom(next);
      const from = live.current;
      live.current = z;
      if (inner.current) inner.current.style.zoom = String(z);
      if (el && from !== z) {
        const f = focal ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
        el.scrollLeft = keepFocus(el.scrollLeft, f.x, from, z);
        el.scrollTop = keepFocus(el.scrollTop, f.y, from, z);
      }
      if (commit) {
        setZoomState(z);
        try {
          window.localStorage.setItem(ZOOM_KEY, String(z));
        } catch {}
      }
    },
    [],
  );

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const rel = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return { x: x - r.left, y: y - r.top };
    };

    // 2本指のピンチ（スマホ・タブレット）
    let pinch: { dist: number; zoom: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList) => rel((t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { dist: dist(e.touches) || 1, zoom: live.current };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault(); // 画面全体が拡大されないように
      apply((pinch.zoom * dist(e.touches)) / pinch.dist, mid(e.touches), false);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (pinch && e.touches.length < 2) {
        pinch = null;
        apply(live.current);
      }
    };

    // Ctrl ＋ ホイール、トラックパッドのピンチ（Chrome・Edge・Firefox は ctrlKey 付きのホイールになる）
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      apply(live.current * Math.exp(-e.deltaY * 0.01), rel(e.clientX, e.clientY));
    };

    // Safari（Mac のトラックパッド・iPhone）のピンチ。iPhone は上のタッチで扱うので、ここでは画面の拡大を止めるだけ
    type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };
    let gesture: number | null = null;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      if (!pinch) gesture = live.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as GestureEvent;
      if (gesture != null && !pinch) apply(gesture * g.scale, rel(g.clientX, g.clientY), false);
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      if (gesture != null) apply(live.current);
      gesture = null;
    };

    const active = { passive: false } as const;
    el.addEventListener("touchstart", onTouchStart, active);
    el.addEventListener("touchmove", onTouchMove, active);
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("wheel", onWheel, active);
    el.addEventListener("gesturestart", onGestureStart, active);
    el.addEventListener("gesturechange", onGestureChange, active);
    el.addEventListener("gestureend", onGestureEnd, active);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
  }, [apply]);

  return { box, inner, zoom, setZoom: apply };
}

/** 日付の列の幅（会場名が長くても広がらないように固定） */
const DAY_W = "w-[5.5rem] min-w-[5.5rem] max-w-[5.5rem] md:w-[7rem] md:min-w-[7rem] md:max-w-[7rem]";

/**
 * 稼働表の表（今の月のスプレッドシートと同じ並び）。管理画面と「見るだけリンク」で共通。
 * - 名前の列と日付の行は固定し、表の中だけ縦横に動かす（画面全体は横にずれない）
 * - 押せるのは管理画面だけ（onStaffCell / onClientCell を渡したとき）
 */
export function BoardGrid({
  board,
  onStaffCell,
  onClientCell,
  staffHref,
  className,
}: {
  board: Board;
  onStaffCell?: (staffId: string, date: string) => void;
  onClientCell?: (clientId: string, date: string) => void;
  staffHref?: (id: string) => string;
  /** 枠の高さ（全画面でないとき） */
  className?: string;
}) {
  const { box: ref, inner, zoom, setZoom } = useBoardZoom();
  // 全画面: 画面の上に表だけを重ねて出す（ページの上にもう1枚ページを重ねる形）
  const [full, setFull] = useState(false);
  const title = `${board.month.replace("-", "年")}月の稼働表`;

  // 今日の列が見えるところまで横に動かす（拡大・縮小していても画面上の位置で合わせる）
  useEffect(() => {
    const box = ref.current;
    const today = box?.querySelector<HTMLElement>("[data-today]");
    const first = box?.querySelector<HTMLElement>("[data-name-col]");
    if (box && today && first) {
      const left = today.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft;
      box.scrollLeft = Math.max(0, left - first.getBoundingClientRect().width - 8);
    }
  }, [board.month, ref]);

  // 全画面のあいだは後ろのページが動かないようにし、Esc で閉じる
  useEffect(() => {
    if (!full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("[role=dialog]") && setFull(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [full]);

  return (
    <div className={cn("flex flex-col", full && "fixed inset-0 z-50 bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]")}>
      <div className="flex items-center gap-1 px-4 py-1" role="toolbar" aria-label="表の大きさ">
        {full && <span className="mr-auto min-w-0 truncate font-bold">{Number(board.month.slice(5))}月</span>}
        <Button variant="outline" size="icon" aria-label="縮小" disabled={zoom <= 0.25} onClick={() => setZoom(stepZoom(zoom, -1))}>
          <MinusIcon />
        </Button>
        <Button variant="ghost" className="w-16 px-0 tabular-nums" aria-label={`表の倍率 ${zoomLabel(zoom)}（押すと100%に戻す）`} onClick={() => setZoom(1)}>
          {zoomLabel(zoom)}
        </Button>
        <Button variant="outline" size="icon" aria-label="拡大" disabled={zoom >= 2} onClick={() => setZoom(stepZoom(zoom, 1))}>
          <PlusIcon />
        </Button>
        {full ? (
          <Button variant="outline" className="ml-1" onClick={() => setFull(false)}>
            <XIcon />
            閉じる
          </Button>
        ) : (
          <>
            <span className="ml-2 hidden text-sm text-muted-foreground sm:inline">2本指・Ctrl＋ホイールでも拡大・縮小できます</span>
            <Button variant="outline" className="ml-auto" onClick={() => setFull(true)}>
              <Maximize2Icon />
              全画面
            </Button>
          </>
        )}
      </div>
      <div
        ref={ref}
        className={cn(
          "relative overflow-auto overscroll-contain border-y",
          full ? "min-h-0 flex-1" : cn("max-h-[calc(100dvh-16rem)] md:max-h-[calc(100dvh-13rem)]", className),
        )}
        style={{ touchAction: "pan-x pan-y" }}
        role="region"
        aria-label={title}
        tabIndex={0}
      >
        <div ref={inner} data-board-zoom={zoom} style={{ zoom }} className="w-max">
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th data-name-col className="sticky top-0 left-0 z-30 w-28 min-w-28 border-r border-b bg-background px-2 py-1 text-left md:w-44 md:min-w-44">
                  日付
                </th>
                {board.days.map((d) => (
                  <th
                    key={d.date}
                    data-today={d.isToday || undefined}
                    title={d.holiday ?? undefined}
                    className={cn("sticky top-0 z-20 border-r border-b bg-background px-1 py-1 text-center font-medium", DAY_W, d.isToday && "bg-primary/10", dayColor(d))}
                  >
                    <span className="block">{d.day}</span>
                    <span className="block text-xs">{d.weekday}</span>
                  </th>
                ))}
                <th className="sticky top-0 z-20 w-16 min-w-16 border-b bg-background px-1 py-1 text-center font-medium">稼働日数</th>
              </tr>
            </thead>
            <tbody>
              {board.clients.length > 0 && (
                <>
                  <SectionRow label="現場（取引先ごと）" days={board.days} />
                  <tr>
                    <th className="sticky left-0 z-10 border-r border-b bg-background px-2 py-1 text-left font-normal text-muted-foreground">欠員</th>
                    {board.days.map((d) => (
                      <td key={d.date} className={cn("border-r border-b px-1 py-1 text-center", DAY_W, d.isToday && "bg-primary/5")}>
                        {d.shortage > 0 ? <span className="font-bold text-status-alert">{d.shortage}人</span> : d.required > 0 ? <span className="text-status-done">0</span> : ""}
                      </td>
                    ))}
                    <td className="border-b px-1 text-center font-bold">{board.totals.shortage > 0 && <span className="text-status-alert">{board.totals.shortage}</span>}</td>
                  </tr>
                  {board.clients.map((c) => (
                    <tr key={c.id}>
                      <th className="sticky left-0 z-10 border-r border-b bg-background px-2 py-1 text-left font-medium">
                        <span className="line-clamp-2 break-all">{c.name}</span>
                      </th>
                      {board.days.map((d) => {
                        const chips = c.cells[d.date] ?? [];
                        return (
                          <td key={d.date} className={cn("border-r border-b p-0 align-top", DAY_W, d.isToday && "bg-primary/5")}>
                            <Cell onClick={onClientCell && (() => onClientCell(c.id, d.date))} label={`${c.name} ${d.day}日`}>
                              {chips.map((e) => (
                                <EventChip key={e.id} e={e} />
                              ))}
                            </Cell>
                          </td>
                        );
                      })}
                      <td className="border-b" />
                    </tr>
                  ))}
                </>
              )}
              <SectionRow label={`スタッフ（${board.staff.length}人）`} days={board.days} />
              {board.staff.map((s) => (
                <tr key={s.id}>
                  <th className="sticky left-0 z-10 border-r border-b bg-background px-2 py-1 text-left font-medium">
                    <span className="flex items-center gap-1">
                      {s.rankName && <span className="shrink-0 rounded border border-primary/30 px-1 text-xs text-primary">{s.rankName}</span>}
                      {staffHref ? (
                        <Link href={staffHref(s.id)} className="truncate hover:underline">
                          {s.name}
                        </Link>
                      ) : (
                        <span className="truncate">{s.name}</span>
                      )}
                    </span>
                    {s.station && <span className="block truncate text-xs font-normal text-muted-foreground">{s.station}</span>}
                  </th>
                  {board.days.map((d) => (
                    <td key={d.date} className={cn("border-r border-b p-0 align-top", DAY_W, d.isToday && "bg-primary/5")}>
                      <Cell onClick={onStaffCell && (() => onStaffCell(s.id, d.date))} label={`${s.name} ${d.day}日`}>
                        <StaffCellView cell={s.cells[d.date]} />
                      </Cell>
                    </td>
                  ))}
                  <td className="border-b px-1 text-center font-bold">{s.workedDays || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function dayColor(d: BoardDay) {
  if (d.weekday === "日" || d.holiday) return "text-status-alert";
  if (d.weekday === "土") return "text-primary";
  return undefined;
}

function SectionRow({ label, days }: { label: string; days: BoardDay[] }) {
  return (
    <tr>
      <th className="sticky left-0 z-10 border-r border-b bg-muted px-2 py-1 text-left font-bold">{label}</th>
      <td colSpan={days.length + 1} className="border-b bg-muted" />
    </tr>
  );
}

function Cell({ onClick, label, children }: { onClick?: () => void; label: string; children: React.ReactNode }) {
  const cls = "flex min-h-11 w-full min-w-0 flex-col items-stretch gap-0.5 overflow-hidden p-0.5 text-left";
  if (!onClick) return <div className={cls}>{children}</div>;
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cn(cls, "hover:bg-accent focus-visible:bg-accent")}>
      {children}
    </button>
  );
}

function EventChip({ e }: { e: BoardEventChip }) {
  return (
    <span
      className={cn(
        "flex min-w-0 flex-col rounded px-1 leading-tight",
        e.cancelled ? "bg-muted text-muted-foreground line-through" : e.shortage > 0 ? "bg-status-alert-bg text-status-alert" : "bg-status-done-bg text-status-done",
      )}
      title={e.venueName}
    >
      <span className="line-clamp-2 break-all">{e.venueName}</span>
      <span className="font-bold">
        {e.cancelled ? "中止" : `${e.confirmed}/${e.required}`}
        {e.offered > 0 && !e.cancelled && <span className="ml-1 font-normal text-status-waiting">打{e.offered}</span>}
      </span>
    </span>
  );
}

function StaffCellView({ cell }: { cell: BoardStaffCell | undefined }) {
  if (!cell) return null;
  if (cell.assignments.length) {
    return cell.assignments.map((a) => (
      <span
        key={a.id}
        title={`${a.venueName}（${a.clientName}）`}
        className={cn(
          "line-clamp-2 rounded px-1 leading-snug break-all",
          a.status === "confirmed" && "bg-status-done-bg text-status-done",
          a.status === "offered" && "bg-status-waiting-bg text-status-waiting",
          a.status === "waitlisted" && "bg-muted text-muted-foreground",
        )}
      >
        {a.status === "offered" && "打 "}
        {a.status === "waitlisted" && "補 "}
        {a.venueName}
      </span>
    ));
  }
  if (!cell.availability) return null;
  return (
    <span
      className={cn(
        "text-center text-base font-bold",
        cell.availability === "ok" && "text-status-done",
        cell.availability === "maybe" && "text-status-waiting",
        cell.availability === "ng" && "text-muted-foreground",
      )}
    >
      {AVAILABILITY_MARK[cell.availability]}
    </span>
  );
}

/** 表の下の凡例 */
export function BoardLegend({ admin }: { admin?: boolean }) {
  return (
    <p className="px-4 py-2 text-sm text-muted-foreground">
      <span className="text-status-done">緑</span> = 確定、<span className="text-status-waiting">黄（打）</span> = 打診中、灰（補）= 補欠、○△× = 稼働可能日。上の段の
      <span className="text-status-alert">赤</span> は欠員あり（確定/必要人数）。
      {admin && " マスを押すと打診・確定や稼働可能日の入力ができます。"}
    </p>
  );
}
