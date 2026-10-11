import "server-only";
import { strToU8, zipSync } from "fflate";
import { tablesToCsv } from "@/lib/export/backup-csv";
import { selectAll } from "@/lib/supabase/select-all";
import { createClient } from "@/lib/supabase/server";

/**
 * ★ 全データの一括ダウンロード（オーナーだけ。要件 §7 バックアップ）。
 * テーブルごとに1つの CSV（UTF-8 BOM 付き）にして ZIP にまとめる。
 * マイページの鍵・見るだけリンクの鍵など、漏れると入られてしまうものは入れない。
 */
const TABLES: { table: string; label: string; order: string }[] = [
  { table: "staff", label: "スタッフ", order: "id" },
  { table: "staff_private", label: "スタッフのお金・口座", order: "staff_id" },
  { table: "staff_roles", label: "スタッフの役割", order: "staff_id,role_id" },
  { table: "staff_areas", label: "スタッフのエリア", order: "staff_id,area_id" },
  { table: "staff_ng", label: "NGの組み合わせ", order: "id" },
  { table: "staff_notes", label: "稼働履歴メモ", order: "id" },
  { table: "companies", label: "会社（営業）", order: "id" },
  { table: "contacts", label: "先方の担当者", order: "id" },
  { table: "company_links", label: "関連資料のリンク", order: "id" },
  { table: "company_items", label: "取引先の獲得項目", order: "company_id,item_id" },
  { table: "company_billing", label: "取引先の請求設定", order: "company_id" },
  { table: "activities", label: "活動履歴", order: "id" },
  { table: "venues", label: "会場", order: "id" },
  { table: "event_groups", label: "現場のグループ", order: "id" },
  { table: "events", label: "現場", order: "id" },
  { table: "event_requirements", label: "必要人数", order: "event_id,role_id" },
  { table: "assignments", label: "アサイン", order: "id" },
  { table: "assignment_private", label: "日当の上書き", order: "assignment_id" },
  { table: "reports", label: "実績報告", order: "assignment_id" },
  { table: "report_items", label: "獲得件数", order: "assignment_id,item_id" },
  { table: "expenses", label: "交通費・経費", order: "id" },
  { table: "availability", label: "稼働可能日", order: "staff_id,date" },
  { table: "availability_submissions", label: "稼働可能日の提出", order: "staff_id,month" },
  { table: "client_rates", label: "標準単価", order: "id" },
  { table: "event_rates", label: "現場の単価上書き", order: "id" },
  { table: "incentive_rates", label: "インセンティブ単価", order: "item_id" },
  { table: "event_incentive_rates", label: "現場のインセンティブ上書き", order: "event_id,item_id" },
  { table: "payment_adjustments", label: "調整額", order: "id" },
  { table: "monthly_closings", label: "月次締め", order: "month" },
  { table: "closing_logs", label: "締めの履歴", order: "id" },
  { table: "invoices", label: "請求（締めた月）", order: "id" },
  { table: "payments", label: "支払い（締めた月）", order: "id" },
  { table: "monthly_targets", label: "月次目標", order: "month" },
  { table: "report_formats", label: "日報のフォーマット", order: "id" },
  { table: "training_slots", label: "研修の枠", order: "id" },
  { table: "training_bookings", label: "研修の予約", order: "id" },
  { table: "roles", label: "役割", order: "id" },
  { table: "items", label: "獲得項目", order: "id" },
  { table: "ranks", label: "ランク", order: "id" },
  { table: "rank_rates", label: "ランクの基準日当", order: "rank_id" },
  { table: "areas", label: "エリア", order: "id" },
  { table: "message_templates", label: "文面テンプレート", order: "kind" },
  { table: "settings", label: "設定", order: "key" },
  { table: "owner_settings", label: "お金の設定", order: "key" },
  { table: "app_users", label: "ユーザー", order: "id" },
  { table: "audit_logs", label: "変更履歴", order: "id" },
];

/** 全テーブルの CSV を ZIP にする（ファイル名は日本語。中に説明を1つ入れる） */
export async function buildBackupZip(today: string): Promise<Uint8Array> {
  const supabase = await createClient();
  const files: Record<string, Uint8Array> = {};
  const counts: string[] = [];
  for (const [i, t] of TABLES.entries()) {
    const rows = await selectAll((from, to) => {
      let q = supabase.from(t.table as "staff").select("*");
      for (const c of t.order.split(",")) q = q.order(c as "id");
      return q.range(from, to);
    });
    const name = `${String(i + 1).padStart(2, "0")}_${t.label}.csv`;
    files[name] = strToU8(tablesToCsv(rows as Record<string, unknown>[]));
    counts.push(`${name}: ${rows.length}行`);
  }
  files["はじめにお読みください.txt"] = strToU8(
    [
      `NICOLY CRM の全データ（${today} 時点）`,
      "",
      "・テーブルごとに1つの CSV です（Excel で開けます。文字コードは UTF-8）。",
      "・マイページ・見るだけリンク・研修の予約の鍵は入れていません。",
      "・口座・金額が入っています。大切に保管し、むやみに共有しないでください。",
      "",
      ...counts,
      "",
    ].join("\r\n"),
  );
  return zipSync(files, { level: 6 });
}
