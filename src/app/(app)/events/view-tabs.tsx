import { CalendarIcon, ListIcon, TableIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** 現場の見え方の切り替え（リスト / カレンダー / 稼働表） */
export function EventsViewTabs({ current, month }: { current: "list" | "calendar" | "board"; month: string }) {
  const tabs = [
    { key: "list", label: "リスト", href: "/events", icon: ListIcon },
    { key: "calendar", label: "カレンダー", href: `/events?view=calendar&month=${month}`, icon: CalendarIcon },
    { key: "board", label: "稼働表", href: `/events/board?month=${month}`, icon: TableIcon },
  ] as const;
  return (
    <div className="mx-4 mb-2 flex gap-1 rounded-lg bg-muted p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={cn("flex h-11 flex-1 items-center justify-center gap-1 rounded-md", t.key === current ? "bg-background font-bold shadow-sm" : "text-muted-foreground")}
        >
          <t.icon className="size-4" />
          {t.label}
        </Link>
      ))}
    </div>
  );
}
