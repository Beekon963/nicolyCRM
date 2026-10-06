/**
 * CSV 取り込みの項目定義（要件 §4.13）。列の自動対応づけに使う別名もここに書く。
 */
export type ImportTarget = "staff" | "client" | "partner" | "venue";

export type FieldDef = {
  key: string;
  label: string;
  required?: boolean;
  /** 列名の候補（自動で対応づける） */
  aliases: string[];
  /** 複数の列をまとめて入れられる（メモなど） */
  multi?: boolean;
  /** オーナーのみ（金額・口座など） */
  ownerOnly?: boolean;
  help?: string;
};

export const TARGETS: Record<ImportTarget, { label: string; fields: FieldDef[]; dupHelp: string }> = {
  staff: {
    label: "スタッフ名簿",
    dupHelp: "電話番号が同じスタッフを重複候補として出します",
    fields: [
      { key: "name", label: "氏名", required: true, aliases: ["氏名", "名前", "スタッフ名", "name"] },
      { key: "kana", label: "かな", aliases: ["かな", "カナ", "ふりがな", "フリガナ", "よみ"] },
      { key: "phone", label: "電話", aliases: ["電話", "電話番号", "携帯", "携帯番号", "tel", "phone"] },
      { key: "line_name", label: "LINE表示名", aliases: ["LINE表示名", "LINE名", "LINE"] },
      { key: "nearest_station", label: "最寄り駅", aliases: ["最寄り駅", "最寄駅", "駅"] },
      { key: "rank", label: "ランク", aliases: ["ランク", "rank"], help: "SS・S・A＋・A… など設定のランク名" },
      { key: "roles", label: "役割", aliases: ["役割", "ポジション"], help: "「クローザー・キャッチャー」のように複数可" },
      { key: "areas", label: "対応エリア", aliases: ["エリア", "対応エリア"], help: "設定にないエリアは新しく作ります" },
      { key: "status", label: "状態", aliases: ["状態", "ステータス"], help: "稼働中 / 休止 / 終了（空なら稼働中）" },
      {
        key: "memo",
        label: "メモ",
        multi: true,
        // Phase 0 決定8 の列と、メンバー名簿・スキルシートの仕事に関わる列。
        // 性別・生年月日・最終学歴・現住所・緊急連絡先は自動では選ばない（必要なら画面で選ぶ）
        aliases: [
          ...["メモ", "備考", "要確認メモ", "キャッチ力", "クローザー力", "立ち回り", "知識", "メールアドレス", "メール"],
          ...["誓約書送付", "受理", "誓約書受理", "口座登録", "旧ランク", "催事経験の開始", "経験キャリア", "経験形態"],
          ...["平均獲得件数", "直近実績", "副商材実績", "実績の区分", "人柄・強み", "直近入店店舗"],
        ],
        help: "複数の列を「列名: 値」でまとめて入れます",
      },
      { key: "base_daily_rate", label: "基本日当", ownerOnly: true, aliases: ["基本日当", "日当", "単価"], help: "空ならランクの基準日当" },
      { key: "withholding_method", label: "源泉徴収の方式", ownerOnly: true, aliases: ["源泉", "源泉徴収"], help: "なし / 報酬・料金 / 外交員報酬" },
      { key: "invoice_number", label: "インボイス登録番号", ownerOnly: true, aliases: ["インボイス", "インボイス登録番号", "登録番号"] },
      { key: "bank_cell", label: "口座（1つのセル）", ownerOnly: true, aliases: ["口座情報", "口座", "振込口座"], help: "「銀行 支店 種別 番号」を分けて取り込みます" },
      { key: "account_holder_kana", label: "口座名義（カナ）", ownerOnly: true, aliases: ["口座名義", "名義", "名義カナ"] },
    ],
  },
  client: {
    label: "取引先",
    dupHelp: "会社名が同じ（「株式会社」「(株)」などの違いは無視）会社を重複候補として出します",
    fields: [
      { key: "name", label: "会社名", required: true, aliases: ["会社名", "取引先", "取引先名", "社名", "name"] },
      { key: "kana", label: "かな", aliases: ["かな", "カナ", "フリガナ"] },
      { key: "phone", label: "電話", aliases: ["電話", "電話番号", "TEL"] },
      { key: "address", label: "住所", aliases: ["住所", "所在地"] },
      { key: "website", label: "Web", aliases: ["Web", "URL", "ホームページ", "HP"] },
      { key: "contact_name", label: "先方の担当者名", aliases: ["担当者", "担当者名", "先方担当"] },
      { key: "contact_phone", label: "担当者の電話", aliases: ["担当者電話", "担当者の電話"] },
      { key: "contact_email", label: "担当者のメール", aliases: ["メール", "メールアドレス", "担当者メール"] },
      { key: "memo", label: "メモ", multi: true, aliases: ["メモ", "備考"] },
    ],
  },
  partner: { label: "協力会社", dupHelp: "", fields: [] },
  venue: {
    label: "会場",
    dupHelp: "会場名が同じ会場を重複候補として出します",
    fields: [
      { key: "name", label: "会場名", required: true, aliases: ["会場名", "会場", "店舗名", "現場", "name"] },
      { key: "kana", label: "かな", aliases: ["かな", "カナ", "フリガナ"] },
      { key: "address", label: "住所", aliases: ["住所", "所在地"] },
      { key: "nearest_station", label: "最寄り駅", aliases: ["最寄り駅", "最寄駅", "駅"] },
      { key: "prefecture", label: "都道府県", aliases: ["都道府県", "県"] },
      { key: "area", label: "エリア", aliases: ["エリア"], help: "設定にないエリアは新しく作ります" },
      { key: "access_notes", label: "入館方法", aliases: ["入館方法", "入館"] },
      { key: "green_room", label: "控室", aliases: ["控室", "控え室"] },
      { key: "parking", label: "駐車場", aliases: ["駐車場"] },
      { key: "memo", label: "メモ", multi: true, aliases: ["メモ", "備考"] },
    ],
  },
};
TARGETS.partner = { ...TARGETS.client, label: "協力会社", fields: TARGETS.client.fields.map((f) => (f.key === "name" ? { ...f, aliases: [...f.aliases, "協力会社", "協力会社名"] } : f)) };

/** 取り込まない列（要件 §14「UPDRAFT のデータ」は作らない） */
export const IGNORED_HEADERS = ["UPD_ID", "整理番号"];

/** 列名の比較用。全角半角・空白の違いと、末尾の「(11月表)」のような補足は無視する */
const norm = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();

/** 列名から項目を自動で対応づける。{ 項目key: 列番号[] } */
export function autoMap(target: ImportTarget, headers: string[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const used = new Set<number>();
  for (const f of TARGETS[target].fields) {
    for (const [i, h] of headers.entries()) {
      if (used.has(i) || IGNORED_HEADERS.some((x) => norm(x) === norm(h))) continue;
      if (f.aliases.some((a) => norm(a) === norm(h))) {
        out[f.key] = [...(out[f.key] ?? []), i];
        used.add(i);
        if (!f.multi) break;
      }
    }
  }
  return out;
}

/** 対応づけに従って1行を { 項目key: 値 } にする（メモは「列名: 値」でまとめる） */
export function mapRow(target: ImportTarget, headers: string[], row: string[], mapping: Record<string, number[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of TARGETS[target].fields) {
    const cols = mapping[f.key] ?? [];
    if (!cols.length) continue;
    if (f.multi && cols.length > 1) {
      out[f.key] = cols
        .map((i) => ({ h: headers[i], v: (row[i] ?? "").trim() }))
        .filter((x) => x.v)
        .map((x) => `${x.h}: ${x.v}`)
        .join(" / ");
    } else out[f.key] = (row[cols[0]] ?? "").trim();
  }
  return out;
}
