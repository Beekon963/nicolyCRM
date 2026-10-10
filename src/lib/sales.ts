/**
 * 営業・追客（要件 §4.8）の決まりごと。画面とサーバーの両方から使う（DB には触れない）。
 */
import type { Database } from "@/lib/supabase/database.types";

type Enums = Database["public"]["Enums"];
export type CompanyStatus = Enums["company_status"];
export type ActivityKind = Enums["activity_kind"];
export type ActivityResult = Enums["activity_result"];

/** 次回アクション日と「次にやること」が必須の状態（取引中・見送り以外。要件 §4.8） */
export function needsNextAction(status: CompanyStatus) {
  return status !== "active" && status !== "dormant";
}

type SortableCompany = {
  name: string;
  status: CompanyStatus;
  priority: Enums["priority"];
  next_action_date: string | null;
  next_action: string;
};

/** 次回アクションが未設定（必須なのに日付か「次にやること」が空） */
export function isNextActionMissing(c: Pick<SortableCompany, "status" | "next_action_date" | "next_action">) {
  return needsNextAction(c.status) && (!c.next_action_date || !c.next_action.trim());
}

/**
 * 一覧の並び（要件 §9-8: 直近・要対応が上）。
 * ① 次回アクション日が今日以前（古い順）→ ② 必須なのに未設定 → ③ 先の予定（近い順）→ ④ 予定のない取引中・見送り。
 * 同じ組の中は優先度（高 → 低）→ 名前。
 */
export function sortCompanies<T extends SortableCompany>(companies: T[], today: string): T[] {
  const group = (c: T) => {
    if (c.next_action_date && c.next_action_date <= today) return 0;
    if (isNextActionMissing(c)) return 1;
    if (c.next_action_date) return 2;
    return 3;
  };
  const prio = { high: 0, mid: 1, low: 2 } as const;
  return [...companies].sort(
    (a, b) =>
      group(a) - group(b) ||
      (a.next_action_date ?? "").localeCompare(b.next_action_date ?? "") ||
      prio[a.priority] - prio[b.priority] ||
      a.name.localeCompare(b.name, "ja"),
  );
}

/** 結果ごとの「次にやること」の候補（記録の画面で最初から入れておき、直せる） */
export const NEXT_ACTION_SUGGESTION: Record<ActivityResult, string> = {
  reached: "次の連絡をする",
  absent: "もう一度電話する",
  callback: "折り返しがなければ電話する",
  sent_material: "資料の感想を聞く",
  appointment: "商談する",
  declined: "",
};

/**
 * 記録したあとのステータスの候補。進んだことがはっきりしているときだけ1段進める
 * （取引中・見送り・休眠は自動では変えない。画面の「詳細」でいつでも選び直せる）
 */
export function suggestStatus(current: CompanyStatus, kind: ActivityKind, result: ActivityResult | null): CompanyStatus {
  if (current === "active" || current === "dormant" || result == null || result === "absent") return current;
  const order: CompanyStatus[] = ["not_contacted", "contacted", "meeting_set", "met"];
  const at = order.indexOf(current);
  let next: CompanyStatus = "contacted";
  if (result === "appointment") next = "meeting_set";
  if (kind === "meeting" && result !== "declined") next = "met";
  return order.indexOf(next) > at ? next : current;
}

/**
 * 記録の画面を開いたときの次回アクション。先の予定が入っていればそのまま残せるように出し、
 * 今日以前（＝この連絡で済んだ）なら空から選んでもらう
 */
export function initialNextAction(c: { next_action_date: string | null; next_action: string }, today: string) {
  if (c.next_action_date && c.next_action_date > today) return { date: c.next_action_date, text: c.next_action };
  return { date: null, text: "" };
}
