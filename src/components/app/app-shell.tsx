"use client";

import { CalendarPlusIcon, ClipboardPasteIcon, LogOutIcon, MessageSquarePlusIcon, PlusIcon, SearchIcon, XIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { getMenuCountsAction } from "@/app/(app)/menu-actions";
import type { AppUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { RecordActivityPicker } from "./activity-sheet";
import { AiAssistant } from "./ai-assistant";
import { CountBadge } from "./count-badge";
import { DropAlerts } from "./drop-alerts";
import { MORE_TAB, NAV_GROUPS, NAV_ITEMS, type NavItem, isActive, visibleItems } from "./nav-items";

export function AppShell({ user, aiReady, children }: { user: AppUser; aiReady: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const items = visibleItems(user.role);
  const tabs = [...items.filter((i) => i.tab), MORE_TAB];
  const moreActive = items.some((i) => i.more && isActive(pathname, i.href)) || pathname === "/more";
  const counts = useMenuCounts(pathname);
  const moreWaiting = Object.values(counts).some((c) => c.count > 0);

  return (
    <div className="flex min-h-dvh w-full">
      {/* PC: 左サイドバー */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-background md:flex print:hidden">
        <Link href="/" className="flex items-center gap-2 px-4 py-4">
          <Image src="/logo.png" alt="" width={36} height={28} />
          <span className="text-lg font-bold">NICOLY CRM</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2" aria-label="メニュー">
          {/* 毎日使う画面を上に、そのあとは見出しごとにまとめる */}
          {items
            .filter((i) => i.sidebar && !i.group)
            .map((i) => (
              <SideLink key={i.href} item={i} active={isActive(pathname, i.href)} count={counts[i.href]} />
            ))}
          {NAV_GROUPS.map((g) => {
            const list = items.filter((i) => i.sidebar && i.group === g.key);
            if (!list.length) return null;
            return (
              <div key={g.key} className="flex flex-col gap-0.5">
                <p className="px-3 pt-4 pb-1 text-xs font-semibold text-[#667085]">{g.label}</p>
                {list.map((i) => (
                  <SideLink key={i.href} item={i} active={isActive(pathname, i.href)} count={counts[i.href]} />
                ))}
              </div>
            );
          })}
        </nav>
        <div className="border-t p-3 text-sm">
          <p className="truncate font-medium">{user.name}</p>
          <p className="text-muted-foreground">{user.role === "owner" ? "オーナー" : "管理者"}</p>
          <form action="/auth/signout" method="post" className="mt-2">
            <button className="flex h-11 items-center gap-2 text-muted-foreground hover:text-foreground">
              <LogOutIcon className="size-4" />
              ログアウト
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 上部: 横断検索 */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur print:hidden">
          <Link href="/" className="md:hidden" aria-label="ホーム">
            <Image src="/logo.png" alt="" width={36} height={28} />
          </Link>
          <form action="/search" className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
            <Suspense fallback={<SearchInput />}>
              <SearchInputWithQuery />
            </Suspense>
          </form>
          <AiAssistant role={user.role} ready={aiReady} />
        </header>

        <main className="flex w-full min-w-0 flex-1 flex-col pb-24 md:pb-8 print:pb-0">{children}</main>
        {/* キャンセル・当日不稼働のお知らせ（ポップアップ） */}
        <DropAlerts />
      </div>

      {/* スマホ: 右下の ＋（現場を作る / 活動を記録）。入力画面では保存ボタンと重ならないよう一覧の画面だけに出す */}
      {(pathname === "/" || pathname === "/events" || pathname === "/events/board" || pathname === "/sales") && <CreateFab />}

      {/* スマホ: 下部タブ */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
        {tabs.map((t) => {
          const active = t.href === "/more" ? moreActive : isActive(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.go ?? t.href}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-0.5 text-xs",
                active ? "font-bold text-primary" : "text-muted-foreground",
              )}
            >
              {/* 選んでいるタブはアイコンを丸い札で囲む */}
              <span className={cn("relative grid h-8 w-14 place-items-center rounded-full transition-colors", active && "bg-brand-50 motion-safe:animate-pop")}>
                <t.icon className="size-6" />
                {/* 「その他」の中に待っているもの（実績確認・経費・稼働可能日）があれば小さな点 */}
                {t.href === "/more" && moreWaiting && (
                  <span className="absolute top-0.5 right-3 size-2.5 rounded-full bg-status-waiting-solid ring-2 ring-background">
                    <span className="sr-only">（待っているものがあります）</span>
                  </span>
                )}
              </span>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export { NAV_ITEMS };

/** サイドバーの1項目。選んでいるメニューは、薄い青の地と青い太字。待っている件数があれば右に札 */
function SideLink({ item: i, active, count }: { item: NavItem; active: boolean; count?: Count }) {
  return (
    <Link
      href={i.go ?? i.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        // 長い名前（稼働可能日の提出状況など）は2行に折り返す（件数の札があっても切れないように）
        "flex min-h-10 items-center gap-3 rounded-xl px-3 py-1.5 text-base leading-snug font-medium text-[#344054] transition-colors hover:bg-accent",
        active && "bg-brand-50 font-semibold text-primary hover:bg-brand-50",
      )}
    >
      <i.icon className={cn("size-5 shrink-0", active ? "text-primary" : "text-[#667085]")} />
      <span className="min-w-0">{i.label}</span>
      {count && <CountBadge count={count.count} late={count.late} label={i.label} />}
    </Link>
  );
}

/** 右下の ＋。押すと「現場を作る」「活動を記録」を出す（画面一覧 §1） */
function CreateFab() {
  const [menu, setMenu] = useState(false);
  const [record, setRecord] = useState(false);
  const hidden = useHideOnScrollDown();
  const item = "flex h-12 items-center gap-2 rounded-full border bg-background px-5 text-base font-semibold shadow-raised";
  return (
    <div className="md:hidden">
      {menu && <button type="button" aria-label="閉じる" className="fixed inset-0 z-40 bg-black/20" onClick={() => setMenu(false)} />}
      {menu && (
        <div className="fixed right-4 bottom-[calc(9rem+env(safe-area-inset-bottom))] z-40 flex flex-col items-end gap-2">
          <Link href="/events/new" className={item} onClick={() => setMenu(false)}>
            <CalendarPlusIcon className="size-5 text-primary" />
            現場を作る
          </Link>
          <Link href="/events/from-text" className={item} onClick={() => setMenu(false)}>
            <ClipboardPasteIcon className="size-5 text-primary" />
            募集の文から作る
          </Link>
          <button
            type="button"
            className={item}
            onClick={() => {
              setMenu(false);
              setRecord(true);
            }}
          >
            <MessageSquarePlusIcon className="size-5 text-primary" />
            活動を記録
          </button>
        </div>
      )}
      <button
        type="button"
        aria-label={menu ? "閉じる" : "作成"}
        aria-expanded={menu}
        onClick={() => setMenu(!menu)}
        // 下へ読み進めているあいだは隠す（一覧の右端の「欠2」などに重ならないように）。上へ戻すとまた出る
        className={cn(
          "fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-[inset_0_-3px_0_rgb(0_0_0/0.2),0_10px_24px_-6px_rgb(0_74_174/0.55)] transition-[translate,opacity] duration-200 motion-safe:active:translate-y-px",
          hidden && !menu && "pointer-events-none translate-y-24 opacity-0",
        )}
      >
        {menu ? <XIcon className="size-7" /> : <PlusIcon className="size-7" />}
      </button>
      <RecordActivityPicker open={record} onOpenChange={setRecord} />
    </div>
  );
}

/** 上の検索窓。検索結果の画面では、探した言葉を残しておく（続けて直しやすいように） */
function SearchInputWithQuery() {
  const pathname = usePathname();
  const q = useSearchParams().get("q") ?? "";
  const value = pathname === "/search" ? q : "";
  return <SearchInput key={value} defaultValue={value} />;
}

function SearchInput({ defaultValue }: { defaultValue?: string }) {
  return (
    <input
      name="q"
      type="search"
      defaultValue={defaultValue}
      // スマホの幅（375px）でも切れずに収まる長さ。収まらないときは「…」
      placeholder="名前・電話で検索"
      aria-label="検索"
      className="h-11 w-full text-ellipsis rounded-full border border-input bg-muted/50 pr-3 pl-10 text-base outline-none focus-visible:border-ring focus-visible:bg-background"
    />
  );
}

type Count = { count: number; late: boolean };

/** メニューの「待っている件数」。画面を移るたびに聞き直す（ほかの人が確定・承認した分も反映するため） */
function useMenuCounts(pathname: string) {
  const [counts, setCounts] = useState<Record<string, Count>>({});
  useEffect(() => {
    let alive = true;
    getMenuCountsAction()
      .then((c) => alive && setCounts(c))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [pathname]);
  return counts;
}

/** 下へスクロールしているあいだ true（上へ戻す・いちばん上にいるときは false） */
function useHideOnScrollDown() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 8) return;
      setHidden(y > last && y > 80);
      last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return hidden;
}
