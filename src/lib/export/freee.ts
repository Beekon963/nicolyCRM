/**
 * freee 会計の「取引のインポート」用 CSV。
 * - 取引先ごとの請求 → 収入（売上）
 * - スタッフごとの支払い → 支出（報酬・交通費経費・源泉の預り金を1つの取引にまとめた複数行）
 * 列の並びは FREEE_COLUMNS（この設定ファイル）で変えられる。勘定科目・税区分はお金の設定画面で変えられる。
 * どちらも未決済で取り込み、決済（入金・振込）は freee 側で口座の明細と合わせる。
 */

/** 列の並び（freee の取引インポートのテンプレートの見出しと同じ名前にする） */
export const FREEE_COLUMNS = [
  "収支区分",
  "管理番号",
  "発生日",
  "決済期日",
  "取引先コード",
  "取引先",
  "勘定科目",
  "税区分",
  "金額",
  "税計算区分",
  "税額",
  "備考",
  "品目",
  "部門",
  "メモタグ（複数指定可、カンマ区切り）",
  "決済日",
  "決済口座",
  "決済金額",
] as const;

export type FreeeColumn = (typeof FREEE_COLUMNS)[number];

export type FreeeSettings = {
  salesAccount: string;
  salesTax: string;
  rewardAccount: string;
  expenseAccount: string;
  /** インボイス登録ありのスタッフ */
  purchaseTaxRegistered: string;
  /** インボイス登録なしのスタッフ（空なら発生日で自動: 2026年9月まで 控80、10月から 控50） */
  purchaseTaxUnregistered: string;
  withholdingAccount: string;
  withholdingTax: string;
};

export const DEFAULT_FREEE_SETTINGS: FreeeSettings = {
  salesAccount: "売上高",
  salesTax: "課税売上10%",
  rewardAccount: "外注費",
  expenseAccount: "旅費交通費",
  purchaseTaxRegistered: "課対仕入10%",
  purchaseTaxUnregistered: "",
  withholdingAccount: "預り金",
  withholdingTax: "対象外",
};

/** インボイス登録なしの相手からの仕入れの税区分（経過措置。発生日で変わる） */
export function unregisteredPurchaseTax(date: string): string {
  return date < "2026-10-01" ? "課対仕入（控80）10%" : "課対仕入（控50）10%";
}

export type FreeeInvoice = { clientName: string; subtotal: number; tax: number; total: number };
export type FreeePayment = {
  staffName: string;
  invoiceRegistered: boolean;
  /** 報酬（日当＋インセンティブ＋調整額） */
  reward: number;
  expense: number;
  withholding: number;
  net: number;
};

type Row = Partial<Record<FreeeColumn, string | number>>;

/** freee の日付（YYYY/MM/DD） */
const slash = (d: string) => d.replaceAll("-", "/");

/**
 * 取引の行を作る。month は YYYY-MM、occurredOn は発生日（月末）、dueOn は報酬の支払日。
 * 差引支払額が0円以下の人は取引にできないので skipped に入れて返す。
 */
export function buildFreeeRows(
  input: { month: string; occurredOn: string; dueOn: string; invoices: FreeeInvoice[]; payments: FreeePayment[] },
  settings: FreeeSettings,
): { rows: (string | number)[][]; skipped: string[] } {
  const ym = input.month.replace("-", "");
  const label = `${Number(input.month.slice(0, 4))}年${Number(input.month.slice(5, 7))}月分`;
  const date = slash(input.occurredOn);
  const rows: Row[] = [];
  const skipped: string[] = [];

  input.invoices
    .filter((i) => i.total > 0)
    .forEach((i, k) => {
      rows.push({
        収支区分: "収入",
        管理番号: `${ym}-C${String(k + 1).padStart(2, "0")}`,
        発生日: date,
        取引先: i.clientName,
        勘定科目: settings.salesAccount,
        税区分: settings.salesTax,
        金額: i.total,
        税額: i.tax,
        備考: `${label} 請求`,
      });
    });

  const unregistered = settings.purchaseTaxUnregistered || unregisteredPurchaseTax(input.occurredOn);
  let k = 0;
  for (const p of input.payments) {
    if (p.net <= 0) {
      skipped.push(p.staffName);
      continue;
    }
    k++;
    const tax = p.invoiceRegistered ? settings.purchaseTaxRegistered : unregistered;
    const lines: Row[] = [];
    if (p.reward !== 0) lines.push({ 勘定科目: settings.rewardAccount, 税区分: tax, 金額: p.reward, 備考: `${label} 報酬` });
    if (p.expense !== 0) lines.push({ 勘定科目: settings.expenseAccount, 税区分: tax, 金額: p.expense, 備考: `${label} 交通費・経費` });
    if (p.withholding !== 0) lines.push({ 勘定科目: settings.withholdingAccount, 税区分: settings.withholdingTax, 金額: -p.withholding, 備考: `${label} 源泉所得税` });
    // 1行目に取引の情報、2行目からは収支区分を空にして発生日をそろえる（freee の複数行の取引）
    lines.forEach((l, i) =>
      rows.push(
        i === 0
          ? { 収支区分: "支出", 管理番号: `${ym}-S${String(k).padStart(3, "0")}`, 発生日: date, 決済期日: slash(input.dueOn), 取引先: p.staffName, ...l }
          : { 発生日: date, ...l },
      ),
    );
  }

  return { rows: [[...FREEE_COLUMNS], ...rows.map((r) => FREEE_COLUMNS.map((c) => r[c] ?? ""))], skipped };
}
