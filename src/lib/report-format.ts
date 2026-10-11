/**
 * 日報のフォーマット（取引先ごとの LINE 用の書式）。集めた実績報告から、書式どおりの文章を作る。
 *
 * 書式は4つに分かれる。出来上がりは「はじめ」→（現場ごとに「現場ごと」→ その現場の人ごとに「1人ごと」）→「おわり」。
 * スタッフのマイページでは、本人の1人分だけで作る。
 * 金額は扱わない（差し込みにも入れない）。
 */

export type ReportFormatBlocks = { header: string; eventBlock: string; personBlock: string; footer: string };

export type ReportPerson = {
  name: string;
  role: string;
  /** 獲得項目ごとの件数（並び順どおり。未報告は null） */
  items: { name: string; count: number | null }[];
  comment: string;
  /** 報告がまだ（件数が入っていない） */
  unreported?: boolean;
};

export type ReportEvent = { venueName: string; time: string; people: ReportPerson[] };

export type ReportDay = { date: string; weekday: string; clientName: string; events: ReportEvent[] };

/** 差し込み項目（設定画面のボタン用）。{件数:項目名} は獲得項目ごとに足す */
export const REPORT_VARIABLES = {
  header: ["日付", "曜日", "取引先", "現場数", "人数", "件数一覧", "件数合計"],
  eventBlock: ["日付", "曜日", "取引先", "会場", "時間", "人数", "件数一覧", "件数合計"],
  personBlock: ["日付", "曜日", "取引先", "会場", "名前", "役割", "件数一覧", "件数合計", "コメント"],
  footer: ["日付", "曜日", "取引先", "現場数", "人数", "件数一覧", "件数合計"],
} as const satisfies Record<keyof ReportFormatBlocks, readonly string[]>;

export const REPORT_BLOCK_LABEL: Record<keyof ReportFormatBlocks, { label: string; hint: string }> = {
  header: { label: "はじめ", hint: "最初に1回だけ（日付・取引先など）" },
  eventBlock: { label: "現場ごと", hint: "現場（会場）ごとに1回" },
  personBlock: { label: "1人ごと", hint: "その現場の1人ごとに1回（名前・件数・コメント）" },
  footer: { label: "おわり", hint: "最後に1回だけ（合計など）" },
};

/** 獲得項目ごとの件数を足し合わせる（名前の並びは最初に出てきた順） */
function sumItems(people: ReportPerson[]): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const p of people) for (const i of p.items) m.set(i.name, (m.get(i.name) ?? 0) + (i.count ?? 0));
  return [...m.entries()].map(([name, count]) => ({ name, count }));
}

function itemList(items: { name: string; count: number | null }[]): string {
  return items.map((i) => `${i.name} ${i.count ?? 0}`).join(" / ");
}

const total = (items: { count: number | null }[]) => items.reduce((a, i) => a + (i.count ?? 0), 0);

function fill(block: string, values: Record<string, string>, items: { name: string; count: number | null }[]): string {
  return block.replace(/\{([^{}]+)\}/g, (whole, key: string) => {
    if (key.startsWith("件数:")) {
      const name = key.slice(3).trim();
      const hit = items.find((i) => i.name === name);
      return String(hit?.count ?? 0);
    }
    return key in values ? values[key] : whole;
  });
}

/** 書式どおりの文章にする。空の部分は詰め、行末の空白・3行以上の空行を整える */
export function renderReport(format: ReportFormatBlocks, day: ReportDay): string {
  const people = day.events.flatMap((e) => e.people);
  const dayItems = sumItems(people);
  const common = { 日付: day.date, 曜日: day.weekday, 取引先: day.clientName };
  const dayValues = { ...common, 現場数: String(day.events.length), 人数: String(people.length), 件数一覧: itemList(dayItems), 件数合計: String(total(dayItems)) };

  const parts: string[] = [];
  if (format.header.trim()) parts.push(fill(format.header, dayValues, dayItems));
  for (const e of day.events) {
    const evItems = sumItems(e.people);
    const evValues = { ...common, 会場: e.venueName, 時間: e.time, 人数: String(e.people.length), 件数一覧: itemList(evItems), 件数合計: String(total(evItems)) };
    if (format.eventBlock.trim()) parts.push(fill(format.eventBlock, evValues, evItems));
    for (const p of e.people) {
      if (!format.personBlock.trim()) continue;
      const pValues = {
        ...common,
        会場: e.venueName,
        名前: p.name,
        役割: p.role,
        件数一覧: p.unreported ? "（未報告）" : itemList(p.items),
        件数合計: p.unreported ? "（未報告）" : String(total(p.items)),
        コメント: p.comment,
      };
      parts.push(fill(format.personBlock, pValues, p.items));
    }
  }
  if (format.footer.trim()) parts.push(fill(format.footer, dayValues, dayItems));

  return parts
    .join("\n")
    .split("\n")
    .map((l) => l.replace(/[ \t　]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 設定画面のプレビュー用の見本 */
export const SAMPLE_DAY: ReportDay = {
  date: "10/10",
  weekday: "土",
  clientName: "〇〇モバイル",
  events: [
    {
      venueName: "DS〇〇駅前",
      time: "10:00〜19:00",
      people: [
        { name: "山田", role: "クローザー", items: [{ name: "新規", count: 3 }, { name: "MNP", count: 1 }], comment: "午後から来店が増えました" },
        { name: "佐藤", role: "キャッチャー", items: [{ name: "新規", count: 1 }, { name: "MNP", count: 0 }], comment: "" },
      ],
    },
  ],
};
