import { isDateString, jstToInstant } from "@/lib/date";

/**
 * NICOLY アカデミーの「進み具合」の CSV を読む（Phase 14）。
 * アカデミーの管理画面の「CSV」で書き出すファイル（nicoly-progress.csv）。受講者1人が1行。
 *
 * 列: ID・氏名・状態・ロードマップ・称号・「携帯（章）」などの分野・知識テスト・総合ロープレ・
 *     現場チェック・稼働判断・ヒアリング評価・初回ガイド・最後に学習した日時
 * - 分野の列は見出しの「（章）」で見分ける（アカデミーに分野が増えても読める）
 * - 見出しのない列・知らない列は読まない。「ID」と「氏名」の列がなければ、アカデミーの CSV ではないとみなす
 * - 言葉（「合格」「依頼中（受付待ち）」など）はアカデミーの書き方のまま残し、CRM の画面にそのまま出す
 */

export type AcademyDecision = "ready" | "hold" | "none";

export type AcademyArea = { name: string; done: number; total: number; test: boolean };

export type AcademyRow = {
  /** アカデミーのログイン（CSV の「ID」の列）。CRM のスタッフとの結びつけに使う。画面では「ログイン」と出す */
  academyId: string;
  /** アカデミーでの氏名 */
  name: string;
  /** 利用中（停止中なら false） */
  active: boolean;
  /** ロードマップ（学習済みの章とテストの合計 / 全部） */
  roadmap: { done: number; total: number } | null;
  /** 称号（「見習い」「携帯を案内できる」など） */
  title: string;
  areas: AcademyArea[];
  /** 知識テスト（合格 / 旧版で合格 / 未合格（最新 70点） / 未受験） */
  knowledge: string;
  knowledgeOk: boolean;
  /** 総合ロープレ（実技合格 / 依頼中（受付待ち） / まだ など） */
  roleplay: string;
  roleplayOk: boolean;
  /** 現場チェック（達成した項目 / 全部） */
  field: { done: number; total: number } | null;
  /** 稼働判断（稼働可 / 保留 / 未判定） */
  decision: AcademyDecision;
  /** ヒアリング評価の記録の数 */
  hearing: number;
  /** 初回ガイド（読了 / スキップ / 未） */
  guide: string;
  /** 最後に学習した日時（ISO の瞬間）。ないときは null */
  lastStudiedAt: string | null;
};

export type AcademyCsv = { rows: AcademyRow[]; warnings: string[] };

/** アカデミーの CSV ではないときの案内 */
export const NOT_ACADEMY_CSV = "アカデミーの進み具合の CSV ではないようです。アカデミーの管理画面の「CSV」で書き出したファイルを選んでください";

const AREA_HEAD = /^(.+?)\s*[（(]章[）)]$/;
const FRACTION = /^(\d+)\s*\/\s*(\d+)/;
const STUDIED = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/;

/** 見分けるとき用（全角・半角をそろえる）。画面に出す言葉は raw のまま */
const norm = (s: string | undefined) => (s ?? "").normalize("NFKC").trim();
const raw = (s: string | undefined) => (s ?? "").trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

function fraction(v: string): { done: number; total: number } | null {
  const m = FRACTION.exec(norm(v));
  if (!m) return null;
  const done = Number(m[1]);
  const total = Number(m[2]);
  return done <= total && total <= 999 ? { done, total } : null;
}

function decisionOf(v: string): AcademyDecision {
  const s = norm(v);
  if (s === "稼働可") return "ready";
  if (s === "保留") return "hold";
  return "none";
}

/** 「2026/09/28 14:05」（日本時間）→ ISO の瞬間 */
function studiedAt(v: string): string | null {
  const m = STUDIED.exec(norm(v));
  if (!m) return null;
  const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if (!isDateString(date)) return null;
  const time = m[4] != null && Number(m[4]) < 24 ? `${m[4].padStart(2, "0")}:${m[5]}` : "00:00";
  return jstToInstant(date, time).toISOString();
}

/** CSV を読んだ2次元配列（parseCsv の結果）から、受講者ごとの記録を作る。アカデミーの CSV でなければ null */
export function readAcademyCsv(table: string[][]): AcademyCsv | null {
  const headAt = table.findIndex((r) => r.some((c) => norm(c) === "ID") && r.some((c) => norm(c) === "氏名"));
  if (headAt < 0) return null;
  const head = table[headAt].map(norm);
  const col = (name: string) => head.indexOf(name);
  const at = (row: string[], name: string) => {
    const i = col(name);
    return i < 0 ? "" : raw(row[i]);
  };
  // 分野の名前は見出しの書き方のまま（「電気・ガス（章）」→「電気・ガス」）
  const areaCols = head.flatMap((h, i) => (AREA_HEAD.test(h) ? [{ i, name: raw(table[headAt][i]).replace(/\s*[（(]章[）)]$/, "") }] : []));

  const rows: AcademyRow[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const row of table.slice(headAt + 1)) {
    const academyId = at(row, "ID");
    const name = at(row, "氏名");
    if (!academyId) {
      if (name) warnings.push(`${name}さんの行は、ログインの欄が空なので読みませんでした`);
      continue;
    }
    if (seen.has(academyId)) {
      warnings.push(`ログイン「${academyId}」が2回あったので、最初の行だけ読みました`);
      continue;
    }
    seen.add(academyId);
    const knowledge = at(row, "知識テスト");
    const roleplay = at(row, "総合ロープレ");
    rows.push({
      academyId: clip(academyId, 64),
      name: clip(name, 100),
      active: norm(at(row, "状態")) !== "停止中",
      roadmap: fraction(at(row, "ロードマップ")),
      title: clip(at(row, "称号"), 100),
      areas: areaCols.map(({ i, name: areaName }) => {
        const v = norm(row[i]);
        const f = fraction(v) ?? { done: 0, total: 0 };
        return { name: clip(areaName, 40), ...f, test: v.includes("テスト合格") };
      }),
      knowledge: clip(knowledge, 100),
      knowledgeOk: norm(knowledge) === "合格",
      roleplay: clip(roleplay, 100),
      roleplayOk: norm(roleplay) === "実技合格",
      field: fraction(at(row, "現場チェック")),
      decision: decisionOf(at(row, "稼働判断")),
      hearing: Math.max(0, Math.min(Number.parseInt(at(row, "ヒアリング評価"), 10) || 0, 999)),
      guide: clip(at(row, "初回ガイド"), 20),
      lastStudiedAt: studiedAt(at(row, "最後に学習した日時")),
    });
  }
  return { rows, warnings };
}
