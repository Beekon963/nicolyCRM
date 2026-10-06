import "server-only";
import { addDays } from "@/lib/date";
import { holidaysBetween } from "@/lib/date/holidays";
import { listEvents } from "@/lib/data/events";
import type { pickParams } from "@/lib/params";
import { createClient } from "@/lib/supabase/server";

export const EVENT_FILTER_KEYS = ["view", "from", "to", "month", "client", "venue", "shortage", "status", "group"] as const;
export type EventFilterKey = (typeof EVENT_FILTER_KEYS)[number];

export async function loadEventList(filters: ReturnType<typeof pickParams<EventFilterKey>>) {
  const supabase = await createClient();
  const [{ events, from, to }, { data: clients }, { data: venues }, group] = await Promise.all([
    listEvents(filters),
    supabase.from("companies").select("id, name").eq("kind", "client").eq("is_active", true).order("name"),
    supabase.from("venues").select("id, name").eq("is_active", true).order("name"),
    filters.group ? supabase.from("event_groups").select("id, name").eq("id", filters.group).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return {
    events,
    from,
    to,
    clients: clients ?? [],
    venues: venues ?? [],
    group: group.data,
    holidays: holidaysBetween(addDays(from, -7), addDays(to, 7)),
  };
}

