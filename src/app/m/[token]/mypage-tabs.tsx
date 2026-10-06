"use client";

import { CalendarCheckIcon, CalendarDaysIcon, ClipboardListIcon, HandIcon, HistoryIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function MypageTabs({ token, offers, reports }: { token: string; offers: number; reports: number }) {
  const pathname = usePathname();
  const base = `/m/${token}`;
  const tabs = [
    { href: base, label: "お願い", icon: HandIcon, badge: offers },
    { href: `${base}/schedule`, label: "予定", icon: CalendarDaysIcon },
    { href: `${base}/report`, label: "報告", icon: ClipboardListIcon, badge: reports },
    { href: `${base}/availability`, label: "稼働可能日", icon: CalendarCheckIcon },
    { href: `${base}/history`, label: "過去", icon: HistoryIcon },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto grid max-w-md grid-cols-5 border-t bg-background pb-[env(safe-area-inset-bottom)]">
      {tabs.map((t) => {
        const active = t.href === base ? pathname === base : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn("relative flex h-16 flex-col items-center justify-center gap-0.5 text-xs", active ? "font-bold text-primary" : "text-muted-foreground")}
          >
            <t.icon className="size-6" />
            {t.label}
            {t.badge ? (
              <span className="absolute top-1.5 left-1/2 ml-2 grid min-w-5 place-items-center rounded-full bg-status-alert px-1 text-[11px] font-bold text-white">
                {t.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
