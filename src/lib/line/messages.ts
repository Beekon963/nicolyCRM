/**
 * LINE の社内向けのお知らせの文（Phase 5）。スタッフ向けの文は、文面テンプレート（確定連絡・前日リマインド）を使う。
 * 金額は入れない（管理者にも届くため）。
 */
import { formatShortJa } from "@/lib/date";

export type AdminConfirm = {
  date: string;
  venue: string;
  client: string;
  role: string;
  staffName: string;
  /** その役割の確定人数 / 必要人数 */
  confirmed: number;
  required: number;
  /** 本人がマイページで回答したとき true */
  bySelf: boolean;
};

export function adminConfirmText(a: AdminConfirm): string {
  const left = a.required - a.confirmed;
  return [
    `【確定】${formatShortJa(a.date)} ${a.venue}（${a.client}）`,
    `${a.staffName}さん（${a.role}）${a.bySelf ? " ※本人がマイページで「参加できる」" : ""}`,
    `${a.role} ${a.confirmed}/${a.required}名 ${left > 0 ? `あと${left}名` : "そろいました"}`,
  ].join("\n");
}

export type AdminDrop = {
  date: string;
  venue: string;
  client: string;
  role: string;
  staffName: string;
  status: "cancelled" | "no_show";
  /** その現場の今の欠員（人） */
  shortage: number;
};

/** キャンセル・当日不稼働（Phase 6） */
export function adminDropText(a: AdminDrop): string {
  return [
    `【${a.status === "cancelled" ? "キャンセル" : "当日不稼働"}】${formatShortJa(a.date)} ${a.venue}（${a.client}）`,
    `${a.staffName}さん（${a.role}）`,
    a.shortage > 0 ? `欠員${a.shortage}名。代わりの人を探してください` : "欠員はありません",
  ].join("\n");
}

export type AdminEvent = { date: string; venue: string; client: string; requirements: { role: string; count: number }[] };

const MAX_LINES = 10;

export function adminEventsText(events: AdminEvent[], actorName: string | null): string {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  const lines = sorted.slice(0, MAX_LINES).map((e) => `${formatShortJa(e.date)} ${e.venue}（${e.client}）${e.requirements.map((r) => `${r.role}${r.count}`).join("・")}`);
  if (sorted.length > MAX_LINES) lines.push(`ほか${sorted.length - MAX_LINES}件`);
  return [`【新しい現場】${sorted.length}件${actorName ? `（${actorName}さんが登録）` : ""}`, ...lines].join("\n");
}

/** つないだときの返事 */
export function linkedText(name: string, kind: "staff" | "user"): string {
  return kind === "staff"
    ? `${name}さん、つながりました。現場が確定したときと、前日に、ここへお知らせが届きます。`
    : `${name}さん、つながりました。スタッフの確定や新しい現場のお知らせが、ここへ届きます。`;
}

export const LINK_FAILED_TEXT = "コードが見つからないか、期限（30分）が切れています。マイページ（または CRM の「LINE の通知」）から、もう一度コードを出してください。";
