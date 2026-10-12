/**
 * 日報のフォーマット（取引先ごとの LINE 用の書式）。集めた実績報告から、書式どおりの文章を作る。
 *
 * 書式は4つに分かれる。出来上がりは「はじめ」→（現場ごとに「現場ごと」→ その現場の人ごとに「1人ごと」）→「おわり」。
 * 「現場ごと」に {稼働者}・{獲得した項目}・{所感} を使うと、現場の全員分を1つにまとめた報告になる（NextWave の形）。
 * スタッフのマイページでは、本人の1人分だけで作る。
 * 金額は扱わない（差し込みにも入れない）。
 */

import { sumCounts } from "@/lib/count";

export type ReportFormatBlocks = { header: string; eventBlock: string; personBlock: string; footer: string };

export type ReportPerson = {
  name: string;
  role: string;
  /** 獲得項目ごとの件数（並び順どおり。未報告は null）。notes は項目の下に書くメモ（LINE の報告を変換したときだけ） */
  items: ReportItem[];
  comment: string;
  /** 報告がまだ（件数が入っていない） */
  unreported?: boolean;
};

export type ReportItem = { name: string; count: number | null; notes?: string[] };

export type ReportEvent = {
  venueName: string;
  time: string;
  people: ReportPerson[];
  /** {稼働者} をこの名前にする（LINE の報告を変換したとき。件数のない人も入れるため） */
  workers?: string[];
  /** {所感} をこの文にする（LINE の報告を変換したとき） */
  remark?: string;
};

export type ReportDay = { date: string; weekday: string; clientName: string; events: ReportEvent[] };

/** 差し込み項目（設定画面のボタン用）。{件数:項目名} は獲得項目ごとに足す */
export const REPORT_VARIABLES = {
  header: ["日付", "曜日", "取引先", "現場数", "人数", "稼働者", "件数一覧", "獲得した項目", "当日・後日の実績", "件数合計", "所感"],
  eventBlock: ["日付", "曜日", "取引先", "会場", "時間", "人数", "稼働者", "件数一覧", "獲得した項目", "当日・後日の実績", "件数合計", "所感"],
  personBlock: ["日付", "曜日", "取引先", "会場", "名前", "役割", "件数一覧", "獲得した項目", "当日・後日の実績", "件数合計", "コメント"],
  footer: ["日付", "曜日", "取引先", "現場数", "人数", "稼働者", "件数一覧", "獲得した項目", "当日・後日の実績", "件数合計", "所感"],
} as const satisfies Record<keyof ReportFormatBlocks, readonly string[]>;

/** 稼働開始の報告（現場に着いたとき「稼働します」）で使える差し込み */
export const START_VARIABLES = ["日付", "曜日", "取引先", "会場", "時間", "稼働者", "人数"] as const;

/** 差し込みの意味（設定画面で、ボタンの横に小さく出す） */
export const REPORT_VARIABLE_HINT: Record<string, string> = {
  件数一覧: "全部の項目を1行に（新規 3 / MNP 0）",
  獲得した項目: "獲得した項目だけ1行ずつ（0件は出さない）",
  "当日・後日の実績": "「当日」「後日」に分けて「新規1(山田)」の形で1人ずつ（後日は「〇〇（後日）」の項目）",
  稼働者: "その現場の全員の名前（、でつなぐ）",
  所感: "全員のコメント（2人以上なら名前つき）",
};

export const REPORT_BLOCK_LABEL: Record<keyof ReportFormatBlocks, { label: string; hint: string }> = {
  header: { label: "はじめ", hint: "最初に1回だけ（日付・取引先など）" },
  eventBlock: { label: "現場ごと", hint: "現場（会場）ごとに1回" },
  personBlock: { label: "1人ごと", hint: "その現場の1人ごとに1回（名前・件数・コメント）" },
  footer: { label: "おわり", hint: "最後に1回だけ（合計など）" },
};

/** 獲得項目ごとの件数を足し合わせる（名前の並びは最初に出てきた順） */
function sumItems(people: ReportPerson[]): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const p of people) for (const i of p.items) m.set(i.name, sumCounts([m.get(i.name), i.count]));
  return [...m.entries()].map(([name, count]) => ({ name, count }));
}

const LATER = /[（(]後日[)）]$/;

/** 「新規1」「RMMNP2」（見本どおり間をあけない。名前が数字で終わるときだけ「あんしんセキュリティ999 1」のように間をあける） */
const countLabel = (name: string, count: number) => (/[0-9０-９]$/.test(name) ? `${name} ${count}` : `${name}${count}`);

/**
 * NICOLY フォーマットの実績: 「当日」「後日」に分け、項目ごとに「新規1(山田)」の形で1人ずつ。項目の下にメモ、項目の間は1行あける。
 * 後日は名前が「〇〇（後日）」の項目（見出しの下では「（後日）」を外す）。1件もなければ「なし」
 */
function dayLaterList(people: ReportPerson[]): string {
  const order: string[] = [];
  for (const p of people) for (const i of p.items) if ((i.count ?? 0) > 0 && !order.includes(i.name)) order.push(i.name);
  const section = (later: boolean) =>
    order
      .filter((name) => LATER.test(name) === later)
      .map((name) =>
        people
          .flatMap((p) =>
            p.items
              .filter((i) => i.name === name && (i.count ?? 0) > 0)
              .map((i) => [countLabel(name.replace(LATER, ""), i.count!) + (p.name.trim() ? `(${p.name.trim()})` : ""), ...(i.notes ?? [])].join("\n")),
          )
          .join("\n"),
      )
      .join("\n\n");
  const today = section(false);
  const later = section(true);
  return [today && `当日\n${today}`, later && `後日\n${later}`].filter(Boolean).join("\n\n") || "なし";
}

function itemList(items: { name: string; count: number | null }[]): string {
  return items.map((i) => `${i.name} ${i.count ?? 0}`).join(" / ");
}

const total = (items: { count: number | null }[]) => sumCounts(items.map((i) => i.count));

/** 獲得した項目だけを「項目 件数」で1行ずつ（0件は出さない。1つもなければ「なし」） */
function gotList(items: { name: string; count: number | null }[]): string {
  const got = items.filter((i) => (i.count ?? 0) > 0);
  return got.length ? got.map((i) => `${i.name} ${i.count}`).join("\n") : "なし";
}

/** 稼働した人の名前（、でつなぐ） */
function workerNames(people: ReportPerson[]): string {
  return people
    .map((p) => p.name.trim())
    .filter(Boolean)
    .join("、");
}

/** コメント（所感）。2人以上のときは、だれのコメントか分かるように名前を付ける */
function remarks(people: ReportPerson[]): string {
  const withComment = people.filter((p) => p.comment.trim());
  if (people.length <= 1) return withComment.map((p) => p.comment.trim()).join("\n");
  return withComment.map((p) => `${p.name}：${p.comment.trim()}`).join("\n");
}

function fill(block: string, values: Record<string, string>, items: ReportItem[]): string {
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
  const dayValues = {
    ...common,
    現場数: String(day.events.length),
    人数: String(people.length),
    稼働者: day.events.some((e) => e.workers) ? day.events.flatMap((e) => e.workers ?? e.people.map((p) => p.name)).join("、") : workerNames(people),
    件数一覧: itemList(dayItems),
    獲得した項目: gotList(dayItems),
    "当日・後日の実績": dayLaterList(people),
    件数合計: String(total(dayItems)),
    所感: day.events.some((e) => e.remark != null) ? day.events.map((e) => e.remark ?? remarks(e.people)).filter(Boolean).join("\n") : remarks(people),
  };

  const parts: string[] = [];
  if (format.header.trim()) parts.push(fill(format.header, dayValues, dayItems));
  for (const e of day.events) {
    const evItems = sumItems(e.people);
    const evValues = {
      ...common,
      会場: e.venueName,
      時間: e.time,
      人数: String(e.people.length),
      稼働者: e.workers ? e.workers.join("、") : workerNames(e.people),
      件数一覧: itemList(evItems),
      獲得した項目: gotList(evItems),
      "当日・後日の実績": dayLaterList(e.people),
      件数合計: String(total(evItems)),
      所感: e.remark ?? remarks(e.people),
    };
    if (format.eventBlock.trim()) parts.push(fill(format.eventBlock, evValues, evItems));
    for (const p of e.people) {
      if (!format.personBlock.trim()) continue;
      const pValues = {
        ...common,
        会場: e.venueName,
        名前: p.name,
        役割: p.role,
        件数一覧: p.unreported ? "（未報告）" : itemList(p.items),
        獲得した項目: p.unreported ? "（未報告）" : gotList(p.items),
        "当日・後日の実績": p.unreported ? "（未報告）" : dayLaterList([p]),
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

/**
 * 稼働開始の報告の文（現場に着いたら LINE に送る）。1つの現場の分だけ作る。
 * 稼働者は同じ現場の全員（2名以上の現場は代表者が全員の名前を書いて送るため）
 */
export function renderStart(template: string, day: ReportDay): string {
  const e = day.events[0];
  if (!template.trim() || !e) return "";
  const values = {
    日付: day.date,
    曜日: day.weekday,
    取引先: day.clientName,
    会場: e.venueName,
    時間: e.time,
    稼働者: workerNames(e.people),
    人数: String(e.people.length),
  };
  return fill(template, values, [])
    .split("\n")
    .map((l) => l.replace(/[ \t　]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 書式の見本（設定画面の「見本から作る」）。取引先からいただいた形をそのまま入れておく。
 * - NextWave: 現場ごとに1通（2人以上の現場は全員分をまとめる）。【実績】は獲得した項目だけ1行ずつ
 */
export const REPORT_PRESETS: { key: string; name: string; note: string; blocks: ReportFormatBlocks; start: string }[] = [
  {
    key: "nextwave",
    name: "NextWave（ネクストウェーブ）",
    note: "現場ごとに1通。2人以上の現場は全員分をまとめます。【実績】は獲得した項目だけ1行ずつ",
    blocks: {
      header: "",
      // 最後の改行は、現場が2つ以上のときに1行あけるため
      eventBlock: "【ネクストウェーブ報告フォーマット】\n\n日付：{日付}\n{会場}\n稼働者：{稼働者}\n\n【実績】\n{獲得した項目}\n\n【所感】\n{所感}\n",
      personBlock: "",
      footer: "",
    },
    // 稼働開始時は、現場名と稼働者名を書いて「稼働します」（2名以上は代表者が全員の名前を書く）
    start: "{会場}\n稼働者：{稼働者}\n稼働します",
  },
  {
    key: "nicoly",
    name: "NICOLY",
    note: "現場ごとに1通。【実績】は「当日」「後日」に分けて「新規1(山田)」の形。所感は最後に（なければ出ません）",
    blocks: {
      header: "",
      eventBlock: "【NICOLY フォーマット】\n\n{日付} {会場}\n{稼働者}\n\n【実績】\n{当日・後日の実績}\n\n{所感}\n",
      personBlock: "",
      footer: "",
    },
    start: "",
  },
];

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
