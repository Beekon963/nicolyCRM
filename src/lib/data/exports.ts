import "server-only";
import { strToU8 } from "fflate";
import { toCsv } from "@/lib/csv";
import { monthRange, paymentDateOf, todayJst } from "@/lib/date";
import { buildBackupZip } from "@/lib/data/backup";
import { getMasters } from "@/lib/data/masters";
import { getExportSettings, getMoneySettings, getMonthMoney, type MonthMoney } from "@/lib/data/money";
import { buildFreeeRows } from "@/lib/export/freee";
import { invoiceCsvRows, paymentCsvRows } from "@/lib/export/money-csv";
import { buildZengin, encodeZengin, senderProblems, transferProblems, type ZenginSender, type ZenginTransfer } from "@/lib/export/zengin";
import { createClient } from "@/lib/supabase/server";

/**
 * ★ 書き出し（オーナーだけ）。請求集計・支払明細はどの月でも、freee・振込データは締めた月だけ。
 * 金額は締めた月はスナップショット、締めていない月はいまのデータでの計算（getMonthMoney）。
 */

export const EXPORT_KINDS = ["invoices", "payments", "freee", "zengin", "backup"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export type ExportFile = { ok: true; body: Uint8Array; filename: string; contentType: string } | { ok: false; message: string };

const label = (month: string) => `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`;

/** 振込データに入れる人（締めて「確定」になっていて、まだ支払済みでない、差引支払額が1円以上の人） */
async function zenginTransfers(money: MonthMoney): Promise<ZenginTransfer[]> {
  const targets = money.staff.filter((s) => money.payments[s.id]?.status === "confirmed" && s.totals.net > 0);
  if (!targets.length) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("staff_private")
    .select("staff_id, bank_code, bank_name, branch_code, bank_branch, account_type, account_number, account_holder_kana")
    .in(
      "staff_id",
      targets.map((s) => s.id),
    );
  const priv = new Map((data ?? []).map((p) => [p.staff_id, p]));
  return targets.map((s) => {
    const p = priv.get(s.id);
    return {
      label: s.name,
      bankCode: p?.bank_code ?? "",
      bankName: "",
      branchCode: p?.branch_code ?? "",
      branchName: "",
      accountType: p?.account_type ?? null,
      accountNumber: p?.account_number ?? "",
      holderKana: p?.account_holder_kana ?? "",
      amount: s.totals.net,
    };
  });
}

export type ExportStatus = {
  closing: MonthMoney["closing"];
  invoices: number;
  staff: number;
  payDate: string;
  freeeSkipped: string[];
  zengin: { senderProblems: string[]; ready: number; total: number; problems: { name: string; problems: string[] }[] };
};

/** 書き出しの画面に出す、月ごとの状況（足りない設定・口座の情報など） */
export async function getExportStatus(month: string): Promise<ExportStatus> {
  const [money, settings, exp] = await Promise.all([getMonthMoney(month), getMoneySettings(), getExportSettings()]);
  const transfers = money.closing === "closed" ? await zenginTransfers(money) : [];
  const problems = transfers.map((t) => ({ name: t.label, problems: transferProblems(t) })).filter((p) => p.problems.length);
  const ok = transfers.filter((t) => !transferProblems(t).length);
  return {
    closing: money.closing,
    invoices: money.clients.length,
    staff: money.staff.length,
    payDate: paymentDateOf(month, settings.paymentDay),
    freeeSkipped: money.staff.filter((s) => s.totals.net <= 0).map((s) => s.name),
    zengin: { senderProblems: senderProblems(exp.zengin), ready: ok.length, total: ok.reduce((a, t) => a + t.amount, 0), problems },
  };
}

const csvFile = (rows: unknown[][], filename: string): ExportFile => ({ ok: true, body: strToU8(toCsv(rows)), filename, contentType: "text/csv; charset=utf-8" });

export async function buildExport(kind: ExportKind, month: string): Promise<ExportFile> {
  if (kind === "backup") {
    const today = todayJst();
    return { ok: true, body: await buildBackupZip(today), filename: `NICOLY_全データ_${today}.zip`, contentType: "application/zip" };
  }
  const money = await getMonthMoney(month);
  const masters = await getMasters();
  const names = { role: (id: string) => masters.roleById.get(id)?.name ?? "", item: (id: string) => masters.itemById.get(id)?.name ?? "" };

  if (kind === "invoices") return csvFile(invoiceCsvRows(month, money.clients, names), `請求集計_${label(month)}.csv`);
  if (kind === "payments") return csvFile(paymentCsvRows(month, money.staff, money.payments, names), `支払明細_${label(month)}.csv`);

  if (money.closing !== "closed") return { ok: false, message: `${label(month)}を締めてから書き出してください` };
  const [settings, exp] = await Promise.all([getMoneySettings(), getExportSettings()]);
  const payDate = paymentDateOf(month, settings.paymentDay);

  if (kind === "freee") {
    const { rows } = buildFreeeRows(
      {
        month,
        occurredOn: monthRange(month).end,
        dueOn: payDate,
        invoices: money.clients.map((c) => ({ clientName: c.name, subtotal: c.subtotal, tax: c.tax, total: c.total })),
        payments: money.staff.map((s) => ({
          staffName: s.name,
          invoiceRegistered: s.invoiceRegistered,
          reward: s.totals.reward,
          expense: s.totals.expense,
          withholding: s.totals.withholding,
          net: s.totals.net,
        })),
      },
      exp.freee,
    );
    return csvFile(rows, `freee取引_${label(month)}.csv`);
  }

  // 振込データ（全銀）: 口座の情報がそろった人だけ入れる（足りない人は画面で知らせる）
  const problems = senderProblems(exp.zengin);
  if (problems.length) return { ok: false, message: `お金の設定で振込元を入れてください（${problems.join("・")}）` };
  const transfers = (await zenginTransfers(money)).filter((t) => !transferProblems(t).length);
  if (!transfers.length) return { ok: false, message: "振込データに入れる人がいません（確定で未払いの人がいないか、口座の情報が足りません）" };
  const text = buildZengin(exp.zengin as ZenginSender, payDate, transfers);
  return { ok: true, body: encodeZengin(text), filename: `総合振込_${label(month)}.txt`, contentType: "text/plain; charset=Shift_JIS" };
}
