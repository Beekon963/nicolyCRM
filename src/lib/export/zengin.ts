/**
 * 全銀協フォーマット（総合振込）の振込データ。1行120バイト、Shift_JIS（半角カナ）、行末は CRLF。
 * ヘッダー（1）→ データ（2）× 人数 → トレーラー（8）→ エンド（9）。
 * 文字は半角カナの大文字・英大文字・数字・記号だけ（kana.ts で直してから渡す）。
 */
import { toZenginKana } from "./kana";

export type AccountType = "ordinary" | "checking";

export type ZenginSender = {
  /** 委託者コード（銀行から通知される10桁） */
  requesterCode: string;
  /** 委託者名（カナ） */
  requesterName: string;
  bankCode: string;
  bankName: string;
  branchCode: string;
  branchName: string;
  accountType: AccountType;
  accountNumber: string;
};

export type ZenginTransfer = {
  /** 画面で知らせるときの名前（ファイルには入れない） */
  label: string;
  bankCode: string;
  bankName: string;
  branchCode: string;
  branchName: string;
  accountType: AccountType | null;
  accountNumber: string;
  holderKana: string;
  amount: number;
};

const ACCOUNT_CODE: Record<AccountType, string> = { ordinary: "1", checking: "2" };

/** 英数カナ（左寄せ・空白埋め・はみ出しは切る） */
const x = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s.padEnd(n, " "));
/** 数字（右寄せ・0埋め） */
const n9 = (v: string | number, n: number) => String(v).padStart(n, "0");

function kana(s: string): string {
  const r = toZenginKana(s);
  return r.ok ? r.value : "";
}

/** 送る側の設定の不足・誤り（なければ空） */
export function senderProblems(s: Partial<ZenginSender>): string[] {
  const out: string[] = [];
  if (!/^\d{10}$/.test(s.requesterCode ?? "")) out.push("委託者コード（10桁）");
  if (!s.requesterName || !toZenginKana(s.requesterName).ok) out.push("委託者名（カナ）");
  if (!/^\d{4}$/.test(s.bankCode ?? "")) out.push("振込元の銀行番号（4桁）");
  if (!/^\d{3}$/.test(s.branchCode ?? "")) out.push("振込元の支店番号（3桁）");
  if (!s.accountType) out.push("振込元の預金種目");
  if (!/^\d{1,7}$/.test(s.accountNumber ?? "")) out.push("振込元の口座番号（7桁まで）");
  return out;
}

/** 振込先の不足・誤り（なければ空） */
export function transferProblems(t: ZenginTransfer): string[] {
  const out: string[] = [];
  if (!/^\d{4}$/.test(t.bankCode)) out.push("銀行番号");
  if (!/^\d{3}$/.test(t.branchCode)) out.push("支店番号");
  if (!t.accountType) out.push("口座種別");
  if (!/^\d{1,7}$/.test(t.accountNumber)) out.push("口座番号（7桁まで）");
  if (!t.holderKana.trim()) out.push("口座名義（カナ）");
  else if (!toZenginKana(t.holderKana).ok) out.push(`口座名義に使えない文字（${(toZenginKana(t.holderKana) as { bad: string[] }).bad.join("")}）`);
  if (!Number.isInteger(t.amount) || t.amount <= 0) out.push("振込金額");
  if (t.amount > 9_999_999_999) out.push("振込金額が大きすぎます");
  return out;
}

/** 振込データの文字列（1行120文字。transferDate は YYYY-MM-DD） */
export function buildZengin(sender: ZenginSender, transferDate: string, transfers: ZenginTransfer[]): string {
  const problems = senderProblems(sender);
  if (problems.length) throw new Error(`振込元の設定が足りません: ${problems.join("・")}`);
  const bad = transfers.filter((t) => transferProblems(t).length);
  if (bad.length) throw new Error(`口座の情報が足りない人がいます: ${bad.map((t) => t.label).join("・")}`);

  const mmdd = transferDate.slice(5, 7) + transferDate.slice(8, 10);
  const lines = [
    "1" + "21" + "0" + n9(sender.requesterCode, 10) + x(kana(sender.requesterName), 40) + mmdd +
      n9(sender.bankCode, 4) + x(kana(sender.bankName), 15) + n9(sender.branchCode, 3) + x(kana(sender.branchName), 15) +
      ACCOUNT_CODE[sender.accountType] + n9(sender.accountNumber, 7) + x("", 17),
    ...transfers.map(
      (t) =>
        "2" + n9(t.bankCode, 4) + x(kana(t.bankName), 15) + n9(t.branchCode, 3) + x(kana(t.branchName), 15) + x("", 4) +
        ACCOUNT_CODE[t.accountType!] + n9(t.accountNumber, 7) + x(kana(t.holderKana), 30) + n9(t.amount, 10) +
        "0" + x("", 10) + x("", 10) + "7" + " " + x("", 7),
    ),
    "8" + n9(transfers.length, 6) + n9(transfers.reduce((a, t) => a + t.amount, 0), 12) + x("", 101),
    "9" + x("", 119),
  ];
  for (const l of lines) if (l.length !== 120) throw new Error(`振込データの1行が120文字ではありません（${l.length}文字）`);
  return lines.join("\r\n") + "\r\n";
}

/** Shift_JIS にする（使う文字は ASCII と半角カナだけなので、表を持たずに変換できる） */
export function encodeZengin(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) out[i] = c;
    else if (c >= 0xff61 && c <= 0xff9f) out[i] = c - 0xfec0;
    else throw new Error(`振込データに使えない文字があります（${text[i]}）`);
  }
  return out;
}
