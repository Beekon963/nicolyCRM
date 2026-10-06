/**
 * 1つのセルに入った口座情報（例: 「埼玉りそな銀行　小鹿野支店　普通　3749858」）を分ける。
 * 分けられない部分は銀行名にまとめて残し、取り込み後に直してもらう。
 */
export type BankParts = {
  bank_name: string;
  bank_branch: string;
  account_type: "ordinary" | "checking" | null;
  account_number: string;
};

export function parseBankCell(cell: string): BankParts {
  const parts = cell
    .normalize("NFKC")
    .split(/[\s　/／,、]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: BankParts = { bank_name: "", bank_branch: "", account_type: null, account_number: "" };
  const rest: string[] = [];
  for (const p of parts) {
    if (/^(普通|普通預金|総合)$/.test(p)) out.account_type = "ordinary";
    else if (/^(当座|当座預金)$/.test(p)) out.account_type = "checking";
    else if (/^\d{4,8}$/.test(p) && !out.account_number) out.account_number = p;
    else if (/(支店|出張所|営業部|本店)$/.test(p) && !out.bank_branch) out.bank_branch = p;
    else rest.push(p);
  }
  if (rest.length && !out.bank_name) out.bank_name = rest.shift()!;
  if (rest.length && !out.bank_branch) out.bank_branch = rest.shift()!;
  if (rest.length) out.bank_name = [out.bank_name, ...rest].join(" ");
  return out;
}
