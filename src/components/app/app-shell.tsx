"use client";

import { LogOutIcon, PlusIcon, SearchIcon } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AppUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { MORE_TAB, NAV_ITEMS, isActive, visibleItems } from "./nav-items";

export function AppShell({ user, children }: { user: AppUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const items = visibleItems(user.role);
  const tabs = [...items.filter((i) => i.tab), MORE_TAB];
  const moreActive = items.some((i) => i.more && isActive(pathname, i.href)) || pathname === "/more";

  return (
    <div className="flex min-h-dvh w-full">
      {/* PC: 左サイドバー */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-background md:flex">
        <Link href="/" className="flex items-center gap-2 px-4 py-4">
          <Image src="/logo.png" alt="" width={36} height={28} />
          <span className="text-lg font-bold">NICOLY CRM</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
          {items
            .filter((i) => i.sidebar)
            .map((i) => (
              <Link
                key={i.href}
                href={i.href}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-md px-3 text-base hover:bg-accent",
                  isActive(pathname, i.href) && "bg-primary/10 font-bold text-primary",
                )}
              >
                <i.icon className="size-5" />
                {i.label}
              </Link>
            ))}
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
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
          <Link href="/" className="md:hidden" aria-label="ホーム">
            <Image src="/logo.png" alt="" width={36} height={28} />
          </Link>
          <form action="/search" className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
            <input
              name="q"
              type="search"
              placeholder="名前・会場などで検索"
              aria-label="検索"
              className="h-11 w-full rounded-full border border-input bg-muted/50 pr-3 pl-10 text-base outline-none focus-visible:border-ring focus-visible:bg-background"
            />
          </form>
        </header>

        <main className="flex w-full min-w-0 flex-1 flex-col pb-24 md:pb-8">{children}</main>
      </div>

      {/* スマホ: 右下の ＋（現場を作る） */}
      <Link
        href="/events/new"
        aria-label="現場を作る"
        className="fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg md:hidden"
      >
        <PlusIcon className="size-7" />
      </Link>

      {/* スマホ: 下部タブ */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
        {tabs.map((t) => {
          const active = t.href === "/more" ? moreActive : isActive(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-0.5 text-xs",
                active ? "font-bold text-primary" : "text-muted-foreground",
              )}
            >
              <t.icon className="size-6" />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export { NAV_ITEMS };
