import { CalendarIcon, ListIcon, TableIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** 現場の見え方の切り替え（稼働表 / リスト / カレンダー。いちばんよく使う稼働表を先に。Phase 13） */
export function EventsViewTabs({ current, month }: { current: "list" | "calendar" | "board"; month: string }) {
  const tabs = [
    { key: "board", label: "稼働表", href: `/events/board?month=${month}`, icon: TableIcon },
    { key: "list", label: "リスト", href: "/events", icon: ListIcon },
    { key: "calendar", label: "カレンダー", href: `/events?view=calendar&month=${month}`, icon: CalendarIcon },
  ] as const;
  return (
    <div className="mx-4 mb-2 flex gap-1 rounded-xl bg-muted p-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={cn("flex h-11 flex-1 items-center justify-center gap-1 rounded-md", t.key === current ? "bg-background font-semibold text-foreground shadow-[0_1px_3px_rgb(16_24_40/0.1),0_1px_2px_rgb(16_24_40/0.06)]" : "text-muted-foreground")}
        >
          <t.icon className="size-4" />
          {t.label}
        </Link>
      ))}
    </div>
  );
}
