"use client";

import { CopyIcon, Maximize2Icon, MinusIcon, PlusIcon, Rows3Icon, XIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { FillMeter } from "@/components/app/fill-meter";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { AVAILABILITY_MARK, type Board, type BoardDay, type BoardEventChip, type BoardStaffCell, isDropped } from "@/lib/board";
import {
  type AvailabilityChange,
  availabilityChanges,
  availabilityFromKey,
  clampPos,
  clampWidth,
  DAY_WIDTH,
  gridColCount,
  gridRows,
  MOVE_KEYS,
  type MoveKey,
  moveSelection,
  NAME_WIDTH,
  nextDensity,
  normRange,
  type Pos,
  ROW_DENSITY,
  type RowDensity,
  type Selection,
  selectionTsv,
  single,
} from "@/lib/board/grid";
import { clampZoom, keepFocus, stepZoom, zoomLabel } from "@/lib/board/zoom";
import { fillOf } from "@/lib/fill";
import { cn } from "@/lib/utils";
import { VENUE_COLOR_KEYS, VENUE_COLORS, venueStyle } from "@/lib/venue-colors";

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

const LAYOUT_KEY = "nicoly.board.layout";
type Layout = { dayW: number | null; nameW: number | null; density: RowDensity };

const layoutListeners = new Set<() => void>();
function readLayoutRaw(): string | null {
  try {
    return window.localStorage.getItem(LAYOUT_KEY);
  } catch {
    return null;
  }
}
function subscribeLayout(fn: () => void) {
  layoutListeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    layoutListeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}
function parseLayout(raw: string | null): Layout {
  const fallback: Layout = { dayW: null, nameW: null, density: "normal" };
  if (!raw) return fallback;
  try {
    const saved = JSON.parse(raw) as Partial<Layout>;
    return {
      dayW: typeof saved.dayW === "number" ? clampWidth(saved.dayW, DAY_WIDTH) : null,
      nameW: typeof saved.nameW === "number" ? clampWidth(saved.nameW, NAME_WIDTH) : null,
      density: saved.density && saved.density in ROW_DENSITY ? saved.density : "normal",
    };
  } catch {
    return fallback;
  }
}

/** 列の幅・行の高さ（スプレッドシートと同じように変えられる。この端末に覚えておく） */
function useBoardLayout() {
  // サーバーで描くときは初期値、ブラウザでは端末に覚えた値
  const raw = useSyncExternalStore(subscribeLayout, readLayoutRaw, () => null);
  const layout = parseLayout(raw);
  const setLayout = (next: Layout) => {
    try {
      window.localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {}
    for (const fn of layoutListeners) fn();
  };
  return { layout, setLayout };
}

/**
 * 選んだマス・範囲と、その行と列の強調（スプレッドシートと同じ見え方）。
 * マスが2,000以上あるので、マスごとに描き直さず、CSS だけを差し替えて色を付ける。
 */
function selectionCss(scope: string, sel: Selection | null): string {
  if (!sel) return "";
  const { r1, r2, c1, c2 } = normRange(sel);
  const { r, c } = sel.focus;
  const S = `[data-board="${scope}"]`;
  const list = (attr: string, a: number, b: number) => `:is(${Array.from({ length: b - a + 1 }, (_, i) => `[${attr}="${a + i}"]`).join(",")})`;
  const tint = (p: number) => `background-color: color-mix(in oklab, var(--primary) ${p}%, var(--background));`;
  return [
    // 選んだマスの行と列（うすく）
    `${S} tr[data-r="${r}"] > [data-c], ${S} tr[data-r] > [data-c="${c}"] { ${tint(6)} }`,
    // 選んだ範囲
    `${S} tr${list("data-r", r1, r2)} > ${list("data-c", c1, c2)} { ${tint(14)} }`,
    // 範囲の日付と名前（見出し）は濃く
    `${S} tr[data-r="0"] > ${list("data-c", c1, c2)}, ${S} tr${list("data-r", r1, r2)} > [data-c="0"] { ${tint(22)} font-weight: 700; }`,
    // いま動かしているマス
    `${S} tr[data-r="${r}"] > [data-c="${c}"] { outline: 2px solid var(--primary); outline-offset: -2px; }`,
  ].join("\n");
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // クリップボードが使えない環境（古いブラウザなど）
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const done = document.execCommand("copy");
    ta.remove();
    return done;
  }
}

/** 列の幅を変えるつまみ（見出しの右端。ドラッグで幅を変え、ダブルクリックで元に戻す） */
function ResizeHandle({ label, onStart, onReset }: { label: string; onStart: (e: React.PointerEvent<HTMLSpanElement>) => void; onReset: () => void }) {
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label}（ダブルクリックで元の幅）`}
      onPointerDown={onStart}
      onDoubleClick={onReset}
      className="absolute inset-y-0 right-0 z-10 w-2 cursor-col-resize touch-none hover:bg-primary/30 active:bg-primary/40"
    />
  );
}

export type BoardMoney = {
  client: Record<string, number>;
  staff: Record<string, number>;
  /** 現場ごとの請求単価（人日。表示用の文字） */
  eventRate: Record<string, string>;
  /** アサインごとの日当（確定して稼働したもの） */
  daily: Record<string, number>;
};

const yen = (n: number | undefined) => (n == null ? "" : `${n.toLocaleString("ja-JP")}円`);

/**
 * 稼働表の表（今の月のスプレッドシートと同じ並び）。管理画面と「見るだけリンク」で共通。
 * - 名前の列と日付の行は固定し、表の中だけ縦横に動かす（画面全体は横にずれない）
 * - 押せるのは管理画面だけ（onStaffCell / onClientCell を渡したとき）
 * - スプレッドシートと同じ操作: マスを選ぶと行と列に色が付く。矢印キーで移動、Shift／ドラッグで範囲、
 *   Ctrl＋C でコピー、Enter で開く、1 2 3 で ○△×・Delete で消す（onSetAvailability を渡したとき）。
 *   列の幅は見出しの右端をドラッグ、行の高さはボタンで変える
 */
export function BoardGrid({
  board,
  onStaffCell,
  onClientCell,
  onSetAvailability,
  staffHref,
  money,
  className,
}: {
  board: Board;
  /** ★ オーナーだけ: 右端に出す金額（取引先の売上・スタッフの報酬）。見るだけリンクには渡さない */
  money?: BoardMoney;
  onStaffCell?: (staffId: string, date: string) => void;
  onClientCell?: (clientId: string, date: string) => void;
  /** キーで稼働可能日を入れたとき（管理画面だけ） */
  onSetAvailability?: (changes: AvailabilityChange[]) => void;
  staffHref?: (id: string) => string;
  /** 枠の高さ（全画面でないとき） */
  className?: string;
}) {
  const { box: ref, inner, zoom, setZoom } = useBoardZoom();
  const { layout, setLayout } = useBoardLayout();
  const table = useRef<HTMLTableElement>(null);
  // 全画面: 画面の上に表だけを重ねて出す（ページの上にもう1枚ページを重ねる形）
  const [full, setFull] = useState(false);
  // 選んでいるマス（月を変えたら消す。行が減ったときは表の中に収める）
  const [selRaw, setSelRaw] = useState<{ month: string; sel: Selection } | null>(null);
  const drag = useRef<{ start: Pos; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const scope = useId().replace(/[^a-zA-Z0-9]/g, "");
  const title = `${board.month.replace("-", "年")}月の稼働表`;
  const rows = gridRows(board);
  const cols = gridColCount(board);
  const lastDay = board.days.length;
  const density = ROW_DENSITY[layout.density];
  const sel: Selection | null =
    selRaw && selRaw.month === board.month
      ? { anchor: clampPos(selRaw.sel.anchor, rows.length, cols), focus: clampPos(selRaw.sel.focus, rows.length, cols) }
      : null;
  const setSel = (next: Selection | null) => setSelRaw(next ? { month: board.month, sel: next } : null);

  // 今日の列が見えるところまで横に動かす（拡大・縮小していても画面上の位置で合わせる）
  useEffect(() => {
    const box = ref.current;
    const today = box?.querySelector<HTMLElement>("[data-today]");
    const first = box?.querySelector<HTMLElement>("[data-name-col]");
    if (box && today && first) {
      const left = today.getBoundingClientRect().left - box.getBoundingClientRect().left + box.scrollLeft;
      // 今日の列を名前の列のすぐ右にぴったり合わせる（前の日が細く見えないように）
      box.scrollLeft = Math.max(0, left - first.getBoundingClientRect().width);
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

  const cellEl = (p: Pos) => ref.current?.querySelector<HTMLElement>(`tr[data-r="${p.r}"] > [data-c="${p.c}"]`) ?? null;

  /** 動かしたマスが、固定の名前の列・日付の行に隠れないところまでスクロールする */
  const reveal = (p: Pos) => {
    const box = ref.current;
    const el = cellEl(p);
    if (!box || !el) return;
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const nameW = p.c === 0 ? 0 : (box.querySelector("[data-name-col]")?.getBoundingClientRect().width ?? 0);
    const headH = p.r === 0 ? 0 : (box.querySelector("thead")?.getBoundingClientRect().height ?? 0);
    if (r.left < b.left + nameW) box.scrollLeft -= b.left + nameW - r.left;
    else if (r.right > b.right) box.scrollLeft += r.right - b.right;
    if (r.top < b.top + headH) box.scrollTop -= b.top + headH - r.top;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
  };

  const posOf = (target: EventTarget | null): Pos | null => {
    const el = (target as Element | null)?.closest?.("[data-c]");
    const tr = el?.closest("tr[data-r]");
    if (!el || !tr) return null;
    return { r: Number(tr.getAttribute("data-r")), c: Number(el.getAttribute("data-c")) };
  };

  const copySelection = async () => {
    if (!sel) return;
    const { r1, r2, c1, c2 } = normRange(sel);
    const done = await copyText(selectionTsv(board, rows, sel));
    if (done) toast.success(`コピーしました（${r2 - r1 + 1}行 × ${c2 - c1 + 1}列）。スプレッドシートや LINE に貼り付けられます`);
    else toast.error("コピーできませんでした");
  };

  /** 選んでいるマスを開く（Enter）。押したときと同じ画面が開く */
  const openCell = (p: Pos) => {
    const row = rows[p.r];
    const day = p.c >= 1 && p.c <= lastDay ? board.days[p.c - 1] : null;
    if (!day) return;
    if (row.kind === "staff") onStaffCell?.(row.id, day.date);
    if (row.kind === "client") onClientCell?.(row.id, day.date);
  };

  const onKeyDown = (e: KeyboardEvent, inGrid: boolean) => {
    const t = e.target as HTMLElement;
    if (e.isComposing || t.closest?.("input, textarea, select, [contenteditable], [role=dialog]")) return;
    const mod = e.ctrlKey || e.metaKey;
    const focusBox = () => {
      // 押したマスのボタンに残ったフォーカスで、別のマスが開かないように枠へ移す
      if (document.activeElement !== ref.current) ref.current?.focus({ preventScroll: true });
    };
    if (!sel) {
      // 何も選んでいないときは、表にフォーカスがあるときだけ（ページのスクロールを邪魔しない）
      if (inGrid && (MOVE_KEYS.includes(e.key) || e.key === "Enter")) {
        e.preventDefault();
        const today = board.days.findIndex((d) => d.isToday);
        const start = single({ r: Math.min(1, rows.length - 1), c: today >= 0 ? today + 1 : 1 });
        setSel(start);
        focusBox();
        reveal(start.focus);
      }
      return;
    }
    if (MOVE_KEYS.includes(e.key)) {
      e.preventDefault();
      const next = moveSelection(sel, e.key as MoveKey, { shift: e.shiftKey, jump: mod, rows: rows.length, cols });
      setSel(next);
      focusBox();
      reveal(next.focus);
      return;
    }
    if (mod && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      void copySelection();
      return;
    }
    if (mod && (e.key === "a" || e.key === "A")) {
      e.preventDefault();
      setSel({ anchor: { r: 0, c: 0 }, focus: { r: rows.length - 1, c: cols - 1 } });
      return;
    }
    if (e.key === "Escape") {
      // 全画面のときも、まず選択を消す（もう一度 Esc で全画面を閉じる）
      e.stopPropagation();
      const { r1, r2, c1, c2 } = normRange(sel);
      setSel(r1 === r2 && c1 === c2 ? null : single(sel.focus));
      return;
    }
    if (e.key === "Enter" || e.key === "F2" || e.key === " ") {
      e.preventDefault();
      focusBox();
      openCell(sel.focus);
      return;
    }
    if (mod || e.altKey) return;
    const status = availabilityFromKey(e.key);
    if (status === undefined || !onSetAvailability) return;
    e.preventDefault();
    const changes = availabilityChanges(board, rows, sel, status);
    if (changes.length) onSetAvailability(changes);
    // 1マスずつ入れるときは、スプレッドシートのように次の日へ進む
    const { r1, r2, c1, c2 } = normRange(sel);
    if (r1 === r2 && c1 === c2 && status !== null && sel.focus.c >= 1 && sel.focus.c < lastDay) {
      const next = single({ r: sel.focus.r, c: sel.focus.c + 1 });
      setSel(next);
      reveal(next.focus);
    }
  };

  // キー操作は、表の中にフォーカスがあるときと、マスを選んだあと（開いた画面を閉じたあとなど）に受け付ける。
  // 何かの画面（ダイアログ）が開いているあいだは受け付けない
  const keyHandler = useRef(onKeyDown);
  useEffect(() => {
    keyHandler.current = onKeyDown;
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const a = document.activeElement;
      const inGrid = !!a && !!ref.current?.contains(a);
      // 「元に戻す」を押したあと（お知らせにフォーカスが残る）も続けて打てるようにする
      const inToast = !!a?.closest("[data-sonner-toaster]");
      if (!inGrid && !inToast && a !== document.body && a !== null) return;
      if (document.querySelector("[role=dialog]")) return;
      keyHandler.current(e, inGrid);
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [ref]);

  const onPointerDown = (e: React.PointerEvent<HTMLTableElement>) => {
    if (e.button !== 0 || (e.target as Element).closest("a, [role=separator]")) return;
    const p = posOf(e.target);
    if (!p) return;
    if (e.shiftKey && sel) {
      setSel({ anchor: sel.anchor, focus: p });
      suppressClick.current = true;
    } else {
      setSel(single(p));
    }
    // 指でのドラッグは表のスクロールにする。範囲の選択はマウスだけ
    if (e.pointerType === "mouse") drag.current = { start: e.shiftKey && sel ? sel.anchor : p, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLTableElement>) => {
    const d = drag.current;
    if (!d || !(e.buttons & 1)) return;
    const p = posOf(e.target);
    if (!p || (sel && p.r === sel.focus.r && p.c === sel.focus.c)) return;
    d.moved = true;
    setSel({ anchor: d.start, focus: p });
  };

  const onPointerUp = () => {
    if (drag.current?.moved) suppressClick.current = true;
    drag.current = null;
  };

  // Shift＋クリック・ドラッグのあとは、マスを開かない（範囲を選んだだけ）
  const onClickCapture = (e: React.MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  /** 列の幅を変える（日付の列はまとめて同じ幅、名前の列はひとつ） */
  const startResize = (which: "dayW" | "nameW", e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).parentElement!;
    const range = which === "dayW" ? DAY_WIDTH : NAME_WIDTH;
    const startX = e.clientX;
    const z = clampZoom(Number(inner.current?.style.zoom) || zoom);
    const startW = th.getBoundingClientRect().width / z;
    const prop = which === "dayW" ? "--day-w" : "--name-w";
    let w = clampWidth(startW, range);
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      w = clampWidth(startW + (ev.clientX - startX) / z, range);
      table.current?.style.setProperty(prop, `${w}px`);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      setLayout({ ...layout, [which]: w });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };
  const resetWidth = (which: "dayW" | "nameW") => {
    table.current?.style.removeProperty(which === "dayW" ? "--day-w" : "--name-w");
    setLayout({ ...layout, [which]: null });
  };

  const tableStyle = {
    ...(layout.dayW ? { "--day-w": `${layout.dayW}px` } : {}),
    ...(layout.nameW ? { "--name-w": `${layout.nameW}px` } : {}),
    "--row-h": `${density.height}px`,
    "--lines": density.lines,
  } as React.CSSProperties;

  let r = 0; // 選べる行の番号（gridRows と同じ順）
  return (
    <div className={cn("flex flex-col", full && "fixed inset-0 z-50 bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]")}>
      {/* 全画面のときは表だけにする */}
      {!full && <BoardGauge board={board} />}
      <div className="flex flex-wrap items-center gap-1 px-4 py-1" role="toolbar" aria-label="表の大きさ">
        {full && <span className="mr-auto min-w-0 truncate font-bold">{Number(board.month.slice(5))}月</span>}
        <Button variant="outline" size="icon" aria-label="縮小" disabled={zoom <= 0.25} onClick={() => setZoom(stepZoom(zoom, -1))}>
          <MinusIcon />
        </Button>
        <Button variant="ghost" className="w-14 px-0 tabular-nums" aria-label={`表の倍率 ${zoomLabel(zoom)}（押すと100%に戻す）`} onClick={() => setZoom(1)}>
          {zoomLabel(zoom)}
        </Button>
        <Button variant="outline" size="icon" aria-label="拡大" disabled={zoom >= 2} onClick={() => setZoom(stepZoom(zoom, 1))}>
          <PlusIcon />
        </Button>
        <Button
          variant="outline"
          className="gap-1 px-2"
          aria-label={`行の高さ ${density.label}（押すと切り替え）`}
          onClick={() => setLayout({ ...layout, density: nextDensity(layout.density) })}
        >
          <Rows3Icon />
          {density.label}
        </Button>
        {sel && (
          <Button variant="outline" className="hidden px-2.5 md:inline-flex" onClick={() => void copySelection()}>
            <CopyIcon />
            コピー
          </Button>
        )}
        {full ? (
          <Button variant="outline" className="ml-1" onClick={() => setFull(false)}>
            <XIcon />
            閉じる
          </Button>
        ) : (
          <Button variant="outline" className="ml-auto px-3" onClick={() => setFull(true)}>
            <Maximize2Icon />
            全画面
          </Button>
        )}
      </div>
      {/* キーボードの操作は、押したときだけ出す（いつも出ていると表が下がるため） */}
      <details className="hidden px-4 pb-1 text-sm text-muted-foreground md:block">
        <summary className="w-fit cursor-pointer select-none hover:text-foreground">キーボード・マウスでの操作</summary>
        <p className="pt-1">
          矢印で移動・Shift＋矢印 / ドラッグで範囲・Ctrl＋C でコピー・Enter で開く
          {onSetAvailability && "・1 2 3 で ○△×・Delete で消す"}・見出しの右端をドラッグで列の幅
        </p>
      </details>
      <style>{selectionCss(scope, sel)}</style>
      <div
        ref={ref}
        className={cn(
          "relative overflow-auto overscroll-contain border-y outline-none",
          full ? "min-h-0 flex-1" : cn("max-h-[calc(100dvh-16rem)] md:max-h-[calc(100dvh-15rem)]", className),
        )}
        style={{ touchAction: "pan-x pan-y" }}
        role="region"
        aria-label={title}
        tabIndex={0}
      >
        <div ref={inner} data-board-zoom={zoom} style={{ zoom }} className="w-max">
          <table
            ref={table}
            data-board={scope}
            data-density={layout.density}
            style={tableStyle}
            className="group/board border-separate border-spacing-0 text-sm select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onClickCapture={onClickCapture}
          >
            <thead>
              <tr data-r={r++}>
                <th data-c={0} data-name-col className={cn("sticky top-0 left-0 z-30 border-r border-b bg-background shadow-[4px_0_6px_-4px_rgb(16_24_40/0.14)] px-2 py-1 text-left", NAME_W)}>
                  日付
                  <ResizeHandle label="名前の列の幅を変える" onStart={(e) => startResize("nameW", e)} onReset={() => resetWidth("nameW")} />
                </th>
                {board.days.map((d, i) => (
                  <th
                    key={d.date}
                    data-c={i + 1}
                    data-today={d.isToday || undefined}
                    title={d.holiday ?? undefined}
                    className={cn("sticky top-0 z-20 border-r border-b px-1 py-1 text-center font-medium", DAY_W, headTint(d), dayColor(d))}
                  >
                    {/* 今日は丸で囲む（カレンダーのアプリと同じ見せ方） */}
                    <span className={cn("mx-auto grid size-7 place-items-center rounded-full text-base leading-none", d.isToday && "bg-primary font-bold text-primary-foreground")}>{d.day}</span>
                    <span className="block text-xs">{d.isToday ? "今日" : d.weekday}</span>
                    <ResizeHandle label="日付の列の幅を変える" onStart={(e) => startResize("dayW", e)} onReset={() => resetWidth("dayW")} />
                  </th>
                ))}
                <th data-c={lastDay + 1} className="sticky top-0 z-20 w-16 min-w-16 border-b bg-background px-1 py-1 text-center font-medium">
                  稼働日数
                </th>
                {money && (
                  <th className="sticky top-0 z-20 w-28 min-w-28 border-b border-l bg-background px-1 py-1 text-center text-sm font-medium">
                    売上・報酬
                    <span className="block text-xs font-normal text-muted-foreground">オーナーのみ</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {board.clients.length > 0 && (
                <>
                  <SectionRow
                    label={
                      // スマホでは名前の列が細いので短く
                      <>
                        <span className="md:hidden">現場</span>
                        <span className="max-md:hidden">現場（取引先ごと）</span>
                      </>
                    }
                    days={board.days}
                    extra={money ? 1 : 0}
                  />
                  <tr data-r={r++}>
                    <th data-c={0} className="sticky left-0 z-10 border-r border-b bg-background shadow-[4px_0_6px_-4px_rgb(16_24_40/0.14)] px-2 py-1 text-left font-normal text-muted-foreground">
                      欠員（その日）
                    </th>
                    {board.days.map((d, i) => (
                      <td
                        key={d.date}
                        data-c={i + 1}
                        // 欠員のある日はマスごと赤
                        className={cn("border-r border-b px-1 py-1 text-center", DAY_W, d.shortage > 0 ? "bg-status-alert-tint" : colTint(d))}
                      >
                        {d.shortage > 0 ? <Pill tone="alert">欠{d.shortage}</Pill> : d.required > 0 ? <Pill tone="done" title="欠員なし">✓</Pill> : ""}
                      </td>
                    ))}
                    <td data-c={lastDay + 1} className="border-b px-1 text-center font-bold">
                      {board.totals.shortage > 0 && <Pill tone="alert">欠{board.totals.shortage}</Pill>}
                    </td>
                    {money && <td className="border-b border-l" />}
                  </tr>
                  {board.clients.map((c) => (
                    <tr key={c.id} data-r={r++}>
                      <th data-c={0} className="sticky left-0 z-10 border-r border-b bg-background shadow-[4px_0_6px_-4px_rgb(16_24_40/0.14)] px-2 py-1 text-left font-medium">
                        <span className="line-clamp-[var(--lines,2)] break-all">{c.name}</span>
                      </th>
                      {board.days.map((d, i) => {
                        const chips = c.cells[d.date] ?? [];
                        return (
                          <td key={d.date} data-c={i + 1} className={cn("border-r border-b p-0 align-top", DAY_W, colTint(d))}>
                            <Cell onClick={onClientCell && (() => onClientCell(c.id, d.date))} label={`${c.name} ${d.day}日`}>
                              {chips.map((e) => (
                                <EventChip key={e.id} e={e} rate={money?.eventRate[e.id]} />
                              ))}
                            </Cell>
                          </td>
                        );
                      })}
                      <td data-c={lastDay + 1} className="border-b" />
                      {money && <td className="border-b border-l px-1 text-right text-sm tabular-nums">{yen(money.client[c.id])}</td>}
                    </tr>
                  ))}
                </>
              )}
              <SectionRow label={`スタッフ（${board.staff.length}人）`} days={board.days} extra={money ? 1 : 0} />
              {board.staff.map((s) => (
                <tr key={s.id} data-r={r++}>
                  <th data-c={0} className="sticky left-0 z-10 border-r border-b bg-background shadow-[4px_0_6px_-4px_rgb(16_24_40/0.14)] px-2 py-1 text-left font-medium">
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
                    {s.station && <span className="block truncate text-xs font-normal text-muted-foreground group-data-[density=small]/board:hidden">{s.station}</span>}
                  </th>
                  {board.days.map((d, i) => (
                    <td key={d.date} data-c={i + 1} className={cn("border-r border-b p-0 align-top", DAY_W, colTint(d))}>
                      <Cell onClick={onStaffCell && (() => onStaffCell(s.id, d.date))} label={`${s.name} ${d.day}日`}>
                        <StaffCellView cell={s.cells[d.date]} daily={money?.daily} />
                      </Cell>
                    </td>
                  ))}
                  <td data-c={lastDay + 1} className="border-b px-1 text-center font-bold">
                    {s.workedDays || ""}
                  </td>
                  {money && <td className="border-b border-l px-1 text-right text-sm tabular-nums">{yen(money.staff[s.id])}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/**
 * 日付の列の幅（会場名が長くても広がらないように固定。見出しの右端のドラッグで変えられる）
 * マスは横長に使う: 「欠1 1/2 打1」が1行に、会場名（9文字くらいまで）が PC で1行に収まり、PC の画面で1週間分が見える幅
 */
const DAY_W =
  "w-[var(--day-w,7rem)] min-w-[var(--day-w,7rem)] max-w-[var(--day-w,7rem)] md:w-[var(--day-w,9rem)] md:min-w-[var(--day-w,9rem)] md:max-w-[var(--day-w,9rem)]";
/** 名前の列の幅 */
const NAME_W =
  "w-[var(--name-w,7rem)] min-w-[var(--name-w,7rem)] max-w-[var(--name-w,7rem)] md:w-[var(--name-w,11rem)] md:min-w-[var(--name-w,11rem)] md:max-w-[var(--name-w,11rem)]";

function dayColor(d: BoardDay) {
  if (d.isToday) return undefined;
  if (d.weekday === "日" || d.holiday) return "text-status-alert";
  if (d.weekday === "土") return "text-primary";
  return undefined;
}

/** 列の色: 今日は青、土曜は薄い青、日曜・祝日は薄い赤（シフト表のアプリと同じ見分け方） */
function colTint(d: BoardDay) {
  if (d.isToday) return "bg-today";
  if (d.weekday === "日" || d.holiday) return "bg-day-sun";
  if (d.weekday === "土") return "bg-day-sat";
  return undefined;
}
function headTint(d: BoardDay) {
  return colTint(d) ?? "bg-background";
}

function SectionRow({ label, days, extra = 0 }: { label: React.ReactNode; days: BoardDay[]; extra?: number }) {
  return (
    <tr>
      <th className="sticky left-0 z-10 border-r border-b bg-[#f9fafb] shadow-[4px_0_6px_-4px_rgb(16_24_40/0.14)] px-2 py-1.5 text-left text-sm font-semibold text-[#344054]">{label}</th>
      <td colSpan={days.length + 1 + extra} className="border-b bg-[#f9fafb]" />
    </tr>
  );
}

/**
 * 小さな札（欠員・そろった・打診中の人数）。マスの地は薄く、札だけ色をはっきりさせて目に入るようにする。
 * 色だけでなく文字でも分かるように必ず文字を入れる
 */
function Pill({ tone, children, title }: { tone: "alert" | "done" | "waiting"; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-xs font-bold leading-none tabular-nums",
        tone === "alert" && "bg-status-alert-solid text-white",
        tone === "done" && "bg-status-done-solid text-white",
        tone === "waiting" && "bg-status-waiting-solid text-status-waiting-on-solid",
      )}
    >
      {children}
    </span>
  );
}

function Cell({ onClick, label, children }: { onClick?: () => void; label: string; children: React.ReactNode }) {
  const cls = "flex min-h-[var(--row-h,2.75rem)] w-full min-w-0 flex-col items-stretch gap-0.5 overflow-hidden p-0.5 text-left";
  if (!onClick) return <div className={cls}>{children}</div>;
  return (
    <button type="button" onClick={onClick} aria-label={label} className={cn(cls, "hover:bg-accent focus-visible:bg-accent")}>
      {children}
    </button>
  );
}

/** ★ オーナーだけ: マスの中の単価（今のシートの「単価」の行と同じ情報）。行の高さ「小」では出さない */
function RateLine({ text }: { text: string | undefined }) {
  if (!text) return null;
  return <span className="text-xs font-normal tabular-nums opacity-80 group-data-[density=small]/board:hidden">¥{text}</span>;
}

/** タイル（薄い地に左の線。角を丸く） */
const TILE = "rounded-md px-1.5 py-1 leading-tight";
/** 会場の色のタイル（色は style={venueStyle()} で渡す）。左の線が会場の色 */
const VENUE_TILE = "bg-(--v-tint) text-(--v-fg) shadow-[inset_3px_0_0_var(--v-bar)]";
/** マスごと赤（欠員・キャンセル・当日不稼働）。薄い赤の地に赤い線と濃い赤の文字 */
const RED_TILE = "bg-status-alert-tint text-[#912018] shadow-[inset_3px_0_0_var(--status-alert-solid)]";

/** 赤いタイルの上でも会場が分かるように、会場の色の丸を出す */
function VenueDot() {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full bg-(--v-bar) ring-2 ring-white" />;
}

/**
 * 上の段（取引先ごと）の現場。そろった現場は会場の色のタイルに緑の ✓、欠員がある現場はタイルごと赤（白い「欠N」）。
 * 打診中の人数は黄色の札。中止は点線。
 */
function EventChip({ e, rate }: { e: BoardEventChip; rate?: string }) {
  if (e.cancelled)
    return (
      <span className="flex min-w-0 items-center gap-1 rounded-md border border-dashed px-1 py-0.5 leading-tight text-muted-foreground" title={`${e.venueName}（中止）`}>
        <span className="shrink-0 text-xs font-bold">中止</span>
        <span className="truncate line-through">{e.venueName}</span>
      </span>
    );
  const short = e.shortage > 0;
  return (
    <span
      data-tile={short ? "shortage" : "filled"}
      style={venueStyle(e.venueColor)}
      className={cn(
        TILE,
        "flex min-w-0 flex-col gap-0.5 group-data-[density=small]/board:flex-row group-data-[density=small]/board:items-center group-data-[density=small]/board:gap-1",
        short ? RED_TILE : VENUE_TILE,
      )}
      title={`${e.venueName} 確定${e.confirmed}/必要${e.required}${e.offered ? ` 打診中${e.offered}` : ""}`}
    >
      <span className="flex flex-wrap items-center gap-1">
        {short ? <Pill tone="alert">欠{e.shortage}</Pill> : <Pill tone="done">✓</Pill>}
        <span className="text-xs font-bold tabular-nums">
          {e.confirmed}/{e.required}
        </span>
        {e.offered > 0 && <Pill tone="waiting">打{e.offered}</Pill>}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        {short && <VenueDot />}
        <span className="line-clamp-[var(--lines,2)] font-bold break-all group-data-[density=small]/board:truncate">{e.venueName}</span>
      </span>
      <RateLine text={rate} />
    </span>
  );
}

const DROPPED_LABEL = { cancelled: "キャンセル", no_show: "当日不稼働" } as const;
const STATUS_LABEL = { confirmed: "確定", offered: "打診中", waitlisted: "補欠", ...DROPPED_LABEL } as const;

/**
 * スタッフのマス。
 * - 確定 = 会場の色のタイル（上の段の現場と同じ色）
 * - 打診中 = 黄色の地に会場の色の点線の枠と「打」、補欠 = 灰色の点線と「補」
 * - キャンセル・当日不稼働 = タイルごと赤（「キャンセル」「当日不稼働」の文字つき）
 * - 稼働可能日は ○（緑）△（黄）×（灰）
 */
function StaffCellView({ cell, daily }: { cell: BoardStaffCell | undefined; daily?: Record<string, number> }) {
  if (!cell) return null;
  if (cell.assignments.length) {
    return cell.assignments.map((a) => {
      const dropped = isDropped(a.status);
      return (
        <span
          key={a.id}
          data-tile={a.status}
          style={venueStyle(a.venueColor)}
          title={`${STATUS_LABEL[a.status]}: ${a.venueName}（${a.clientName}）`}
          className={cn(
            "flex min-w-0 items-start gap-1",
            a.status === "confirmed" && cn(TILE, VENUE_TILE, "font-bold"),
            dropped && cn(TILE, RED_TILE, "flex-col items-stretch gap-0"),
            a.status === "offered" && "rounded-md border border-dashed border-(--v-bar) bg-status-waiting-bg px-1 py-0.5 leading-snug text-status-waiting",
            a.status === "waitlisted" && "rounded-md border border-dashed border-muted-foreground/60 bg-muted px-1 py-0.5 leading-snug text-muted-foreground",
          )}
        >
          {a.status === "offered" && <Pill tone="waiting">打</Pill>}
          {a.status === "waitlisted" && <span className="shrink-0 font-bold">補</span>}
          {dropped && (
            <span className="flex items-center gap-1 text-xs font-bold">
              <XIcon className="size-3.5 shrink-0" strokeWidth={3} />
              {DROPPED_LABEL[a.status as keyof typeof DROPPED_LABEL]}
            </span>
          )}
          <span className="flex min-w-0 items-center gap-1">
            {(dropped || a.status === "waitlisted") && <VenueDot />}
            <span className="min-w-0">
              <span className="line-clamp-[var(--lines,2)] break-all">{a.venueName}</span>
              {a.status === "confirmed" && daily?.[a.id] ? <RateLine text={daily[a.id].toLocaleString("ja-JP")} /> : null}
            </span>
          </span>
        </span>
      );
    });
  }
  if (!cell.availability) return null;
  return (
    <span
      className={cn(
        "m-auto text-center text-lg leading-none font-bold",
        cell.availability === "ok" && "text-status-done",
        cell.availability === "maybe" && "text-status-waiting",
        cell.availability === "ng" && "text-[#98a2b3]",
      )}
      title={cell.availability === "ok" ? "稼働できる" : cell.availability === "maybe" ? "調整すれば可" : "稼働できない"}
    >
      {AVAILABILITY_MARK[cell.availability]}
    </span>
  );
}

/**
 * 埋まり具合のゲージ（ゲームの体力ゲージのように、どれだけ埋まったかを見せる）。
 * 今の月は今日から月末まで、ほかの月は月全体（中止の現場は除く）。
 */
export function BoardGauge({ board }: { board: Board }) {
  const todayIdx = board.days.findIndex((d) => d.isToday);
  const fill = fillOf(todayIdx >= 0 ? board.days.slice(todayIdx) : board.days);
  if (fill.required === 0) return null;
  return (
    <div className="mx-4 mb-2 rounded-xl border bg-card px-3 py-2.5 shadow-card" data-testid="board-gauge">
      <FillMeter compact label={todayIdx >= 0 ? "今日から月末" : "この月"} fill={fill} />
    </div>
  );
}

/** 表の下の凡例（マスと同じ見た目の見本と、その意味を組にして並べる） */
export function BoardLegend({ admin }: { admin?: boolean }) {
  const item = "inline-flex items-center gap-1.5";
  const sample = "inline-flex items-center gap-1 text-sm";
  return (
    <div className="mx-4 my-3 flex flex-col gap-3 rounded-2xl border bg-[#fcfcfd] p-4 text-sm text-muted-foreground">
      <div className="flex flex-col gap-1.5">
        <p className="font-semibold text-foreground">スタッフのマス</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className={item}>
            <span style={venueStyle("blue")} className={cn(TILE, VENUE_TILE, sample, "font-semibold")}>
              会場名
            </span>
            確定（会場の色）
          </span>
          <span className={item}>
            <span style={venueStyle("blue")} className={cn(sample, "rounded-md border border-dashed border-(--v-bar) bg-status-waiting-bg px-1 py-0.5 text-status-waiting")}>
              <Pill tone="waiting">打</Pill>会場名
            </span>
            打診中
          </span>
          <span className={item}>
            <span className={cn(sample, "rounded-md border border-dashed border-input bg-muted px-1 py-0.5")}>
              <b>補</b>会場名
            </span>
            補欠
          </span>
          <span className={item}>
            <span className={cn(TILE, RED_TILE, sample, "font-semibold")}>
              <XIcon className="size-3.5" strokeWidth={3} />
              キャンセル
            </span>
            キャンセル・当日不稼働
          </span>
          <span className={item}>
            <b className="text-status-done">○</b>稼働できる
            <b className="ml-2 text-status-waiting">△</b>調整すれば可
            <b className="ml-2 text-[#98a2b3]">×</b>できない
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="font-semibold text-foreground">現場のマス</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className={item}>
            <span className={cn(TILE, RED_TILE, sample, "font-semibold")}>
              <Pill tone="alert">欠2</Pill>
              1/3
            </span>
            欠員あり（確定/必要）
          </span>
          <span className={item}>
            <span style={venueStyle("purple")} className={cn(TILE, VENUE_TILE, sample, "font-semibold")}>
              <Pill tone="done">✓</Pill>
              3/3
            </span>
            そろった
          </span>
          <span className={item}>
            <Pill tone="waiting">打1</Pill>打診中の人数
          </span>
          <span className={item}>
            <span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">11</span>今日
          </span>
          <span className={item}>
            <span className="rounded bg-day-sat px-1.5 text-primary ring-1 ring-black/5">土</span>
            <span className="rounded bg-day-sun px-1.5 text-status-alert ring-1 ring-black/5">日・祝</span>
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="font-semibold text-foreground">
          会場の色{admin && <span className="ml-2 font-normal text-muted-foreground">（会場の画面で変えられます）</span>}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {VENUE_COLOR_KEYS.map((k) => (
            <span key={k} className="inline-flex items-center gap-1">
              <span aria-hidden className="inline-block size-3 rounded-full ring-1 ring-black/10" style={{ background: VENUE_COLORS[k].bar }} />
              {VENUE_COLORS[k].label}
            </span>
          ))}
        </div>
      </div>
      {admin && <p>マスを押すと、打診・確定や稼働可能日の入力ができます。</p>}
    </div>
  );
}
