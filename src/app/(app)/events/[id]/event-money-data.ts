import "server-only";
import type { RateField } from "@/components/app/rate-fields";
import { getClientBilling, getIncentiveRates, loadMoneyInput } from "@/lib/data/money";
import type { Masters } from "@/lib/data/masters";
import { computeMoney, findRate, formatYen, RATE_LAYER_LABEL, type Rate } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import type { EventMoneyView } from "./event-money";

const text = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("ja-JP"));

/** ★ 現場の画面の「単価（この現場だけ）」に出すもの（オーナーのときだけ呼ぶ） */
export async function loadEventMoney(eventId: string, clientId: string, venueId: string, masters: Masters) {
  const supabase = await createClient();
  const [input, client, global, items] = await Promise.all([
    loadMoneyInput({ eventId }),
    getClientBilling(clientId),
    getIncentiveRates(),
    supabase.from("company_items").select("item_id").eq("company_id", clientId).then((r) => (r.data ?? []).map((x) => x.item_id)),
  ]);
  const result = computeMoney(input);
  const ev = result.events[0];
  const venueRates = client.venues.find((v) => v.id === venueId)?.rates ?? [];
  const standard = { event: [] as Rate[], clientVenue: venueRates, client: client.rates };
  const current = input.eventRates;

  const roleIds = [...new Set([...input.assignments.map((a) => a.roleId)])];
  const roles = masters.roles.filter((r) => r.is_active || roleIds.includes(r.id));
  const activeItems = masters.items.filter((i) => i.is_active);
  const useItems = items.length ? activeItems.filter((i) => items.includes(i.id)) : activeItems;

  const fallback = (kind: Rate["kind"], key: string | null) => {
    const r = findRate(standard, kind, key);
    return r ? `標準 ${formatYen(r.amount)}（${RATE_LAYER_LABEL[r.layer]}）` : "標準: 未設定";
  };
  const cur = (kind: Rate["kind"], key: string | null) =>
    current.find((r) => r.kind === kind && (kind === "per_person_day" ? r.roleId === key : kind === "per_item" ? r.itemId === key : true))?.amount;

  const rates: RateField[] = [
    ...roles.map((r) => ({ key: `d-${r.id}`, kind: "per_person_day" as const, roleId: r.id, itemId: null, label: r.name, text: text(cur("per_person_day", r.id)), fallback: fallback("per_person_day", r.id) })),
    { key: "e", kind: "per_event" as const, roleId: null, itemId: null, label: "現場固定", text: text(cur("per_event", null)), fallback: fallback("per_event", null) },
    ...useItems.map((i) => ({ key: `i-${i.id}`, kind: "per_item" as const, roleId: null, itemId: i.id, label: i.name, text: text(cur("per_item", i.id)), fallback: fallback("per_item", i.id) })),
  ];

  const incentives = useItems.map((i) => {
    const g = global.get(i.id);
    return {
      key: i.id,
      id: i.id,
      label: i.name,
      text: text(input.eventIncentiveRates.find((r) => r.itemId === i.id)?.amount),
      fallback: g == null ? "全体: 未設定" : `全体 ${formatYen(g)}`,
    };
  });

  const staffById = new Map(input.staff.map((s) => [s.id, s]));
  const daily = input.assignments
    .filter((a) => a.status === "confirmed")
    .map((a) => {
      const s = staffById.get(a.staffId);
      return {
        key: a.id,
        id: a.id,
        label: s?.name ?? "",
        sub: masters.roleById.get(a.roleId)?.name,
        text: text(input.dailyOverrides.find((d) => d.assignmentId === a.id)?.amount),
        fallback: s?.baseDailyRate == null ? "基本日当: 未設定" : `基本日当 ${formatYen(s.baseDailyRate)}`,
      };
    });

  const view: EventMoneyView = {
    status: ev?.status ?? "estimate",
    subtotal: ev?.bill.subtotal ?? 0,
    reward: ev?.reward ?? 0,
    expenses: ev?.expenses ?? 0,
    gross: ev?.gross ?? 0,
    missingRoles: (ev?.bill.missingRoles ?? []).map((id) => masters.roleById.get(id)?.name ?? ""),
    missingDaily: result.staff.filter((s) => s.missingDailyRate).map((s) => s.name),
  };
  return { view, rates, incentives, daily };
}
