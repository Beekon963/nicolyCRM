import "server-only";
import { companyKey, digitsOnly, searchNorm } from "@/lib/search";
import { createClient } from "@/lib/supabase/server";
import { parseBankCell } from "./bank";
import type { ImportTarget } from "./fields";

export type PreviewRow = {
  index: number;
  values: Record<string, string>;
  errors: string[];
  warnings: string[];
  duplicate?: { id: string; name: string };
  inFileDuplicateOf?: number;
};

const STATUS: Record<string, "active" | "paused" | "ended"> = { "": "active", 稼働中: "active", 休止: "paused", 終了: "ended" };
const WITHHOLDING: Record<string, "none" | "fee" | "sales_agent"> = { "": "none", なし: "none", "報酬・料金": "fee", 報酬料金: "fee", 外交員報酬: "sales_agent" };
const nk = (s: string) => s.normalize("NFKC").toUpperCase().replace(/\s+/g, "");
const split = (s: string) => s.split(/[・,、/／\s]+/).map((x) => x.trim()).filter(Boolean);
const yen = (s: string) => s.normalize("NFKC").replace(/[¥円,\s]/g, "");

/** 取り込みの材料（マスタ・既存データ）をまとめて読む */
export async function loadContext() {
  const supabase = await createClient();
  const [ranks, roles, areas, rates, staff, companies, venues] = await Promise.all([
    supabase.from("ranks").select("id, name"),
    supabase.from("roles").select("id, name"),
    supabase.from("areas").select("id, name"),
    supabase.from("rank_rates").select("rank_id, base_daily_rate"),
    supabase.from("staff").select("id, name, phone_digits"),
    supabase.from("companies").select("id, name, kind, name_key"),
    supabase.from("venues").select("id, name"),
  ]);
  return {
    ranks: ranks.data ?? [],
    roles: roles.data ?? [],
    areas: areas.data ?? [],
    rankRates: new Map((rates.data ?? []).map((r) => [r.rank_id, r.base_daily_rate])),
    staff: staff.data ?? [],
    companies: companies.data ?? [],
    venues: venues.data ?? [],
  };
}

export type ImportContext = Awaited<ReturnType<typeof loadContext>>;

export function validateRows(target: ImportTarget, rows: Record<string, string>[], ctx: ImportContext, isOwner: boolean): PreviewRow[] {
  const seen = new Map<string, number>();
  return rows.map((raw, index) => {
    const v = Object.fromEntries(Object.entries(raw).map(([k, x]) => [k, (x ?? "").trim()]));
    const errors: string[] = [];
    const warnings: string[] = [];
    let duplicate: PreviewRow["duplicate"];
    let key = "";
    if (!v.name) errors.push(target === "staff" ? "氏名が空です" : target === "venue" ? "会場名が空です" : "会社名が空です");

    if (target === "staff") {
      const d = digitsOnly(v.phone);
      if (v.phone && (d.length < 10 || d.length > 11)) warnings.push("電話番号の桁数がおかしいかもしれません");
      if (d) {
        key = d;
        const ex = ctx.staff.find((s) => s.phone_digits === d);
        if (ex) duplicate = { id: ex.id, name: ex.name };
      }
      if (v.rank && !ctx.ranks.some((r) => nk(r.name) === nk(v.rank))) errors.push(`ランク「${v.rank}」は設定にありません`);
      for (const r of split(v.roles ?? "")) if (!ctx.roles.some((x) => nk(x.name) === nk(r))) errors.push(`役割「${r}」は設定にありません`);
      const newAreas = split(v.areas ?? "").filter((a) => !ctx.areas.some((x) => nk(x.name) === nk(a)));
      if (newAreas.length) warnings.push(`エリア「${newAreas.join("・")}」を新しく作ります`);
      if (!((v.status ?? "") in STATUS)) errors.push(`状態「${v.status}」は 稼働中 / 休止 / 終了 のどれかにしてください`);
      if (isOwner) {
        if (v.base_daily_rate && !/^\d+$/.test(yen(v.base_daily_rate))) errors.push(`基本日当「${v.base_daily_rate}」が数字ではありません`);
        if (!v.base_daily_rate && v.rank) {
          const rank = ctx.ranks.find((r) => nk(r.name) === nk(v.rank));
          const rate = rank && ctx.rankRates.get(rank.id);
          if (rate != null) warnings.push(`基本日当は空なので、ランクの基準日当 ${rate.toLocaleString("ja-JP")}円 を入れます`);
        }
        if (v.withholding_method && !(v.withholding_method in WITHHOLDING)) errors.push(`源泉の方式「${v.withholding_method}」は なし / 報酬・料金 / 外交員報酬 のどれかにしてください`);
        const inv = (v.invoice_number ?? "").toUpperCase().replace(/[\s-]/g, "");
        if (inv && !/^T\d{13}$/.test(inv)) errors.push("インボイス登録番号は「T」＋13桁の数字です");
        if (v.bank_cell) {
          const b = parseBankCell(v.bank_cell);
          if (!b.account_number || !b.bank_branch) warnings.push("口座情報の一部を読み取れませんでした。取り込み後に確認してください");
          if (!v.account_holder_kana) warnings.push("口座名義（カナ）がありません。取り込み後に入力してください");
        }
      }
    } else if (target === "venue") {
      key = searchNorm(v.name);
      const ex = ctx.venues.find((x) => searchNorm(x.name) === key);
      if (ex) duplicate = { id: ex.id, name: ex.name };
      const area = v.area ?? "";
      if (area && !ctx.areas.some((x) => nk(x.name) === nk(area))) warnings.push(`エリア「${area}」を新しく作ります`);
    } else {
      key = companyKey(v.name);
      const ex = ctx.companies.find((c) => c.name_key === key);
      if (ex) {
        duplicate = { id: ex.id, name: ex.name };
        if (ex.kind !== target) warnings.push(`「${ex.kind === "client" ? "取引先" : "協力会社"}」として登録済みです`);
      }
    }

    let inFileDuplicateOf: number | undefined;
    if (key) {
      if (seen.has(key)) inFileDuplicateOf = seen.get(key);
      else seen.set(key, index);
    }
    if (inFileDuplicateOf != null) warnings.push(`このファイルの ${inFileDuplicateOf + 2} 行目と同じです`);
    return { index, values: v, errors, warnings, duplicate, inFileDuplicateOf };
  });
}

export const IMPORT_MAPS = { STATUS, WITHHOLDING, nk, split, yen };
