/**
 * 文面テンプレートの差し込み（要件 §4.12）。
 * `{名前}` のような差し込み項目を値に置き換える。値がない項目は空にする。
 */

export const TEMPLATE_VARIABLES = [
  "名前",
  "日付",
  "曜日",
  "時間",
  "集合時刻",
  "集合場所",
  "会場名",
  "住所",
  "役割",
  "持ち物",
  "マイページURL",
  "締切日",
  "対象月",
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateValues = Partial<Record<TemplateVariable, string | null | undefined>>;

const PATTERN = new RegExp(`\\{(${TEMPLATE_VARIABLES.join("|")})\\}`, "g");

export function renderTemplate(body: string, values: TemplateValues): string {
  return body
    .replace(PATTERN, (_, key: TemplateVariable) => values[key]?.trim() ?? "")
    .replace(/[ \t　]+$/gm, "");
}

/** 設定画面のプレビュー用の見本 */
export const SAMPLE_VALUES: TemplateValues = {
  名前: "山田",
  日付: "10/10",
  曜日: "土",
  時間: "10:00〜19:00",
  集合時刻: "9:30",
  集合場所: "従業員入口前",
  会場名: "DS〇〇駅前",
  住所: "東京都〇〇区〇〇1-2-3",
  役割: "クローザー",
  持ち物: "黒のパンツ・スニーカー",
  マイページURL: "https://（アプリのURL）/m/xxxxxxxx",
  締切日: "10/20(火)",
  対象月: "11月",
};

/** 時刻 "10:00:00" → "10:00"、"09:30:00" → "9:30" */
export function formatTime(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":");
  return `${Number(h)}:${m}`;
}

export function formatTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return "";
  return `${formatTime(start)}〜${formatTime(end)}`;
}
