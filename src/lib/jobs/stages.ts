/**
 * 案件 × スタッフ の段階（Phase 21）。DB の enum candidate_stage と同じ並び。
 * だれの番か（自分・本人・取引先）と「次にやること」をここで決め、画面・ホーム・カンバンで同じ見せ方にする。
 */
import type { Tone } from "@/components/ui/badge";

export const STAGES = ["candidate", "staff_ok", "sheet_sent", "slots_collected", "slots_sent", "interview_set", "interviewed", "passed", "briefed", "failed", "withdrawn"] as const;
export type Stage = (typeof STAGES)[number];

/** だれの番か。us = 自分（NICOLY）、staff = 本人、client = 取引先、none = 待つだけ・終わり */
export type Turn = "us" | "staff" | "client" | "none";

export type StageInfo = { label: string; short: string; tone: Tone; turn: Turn; next: string };

export const STAGE_INFO: Record<Stage, StageInfo> = {
  candidate: { label: "候補", short: "候補", tone: "muted", turn: "us", next: "本人に稼働できるか確認する" },
  staff_ok: { label: "本人OK", short: "OK", tone: "waiting", turn: "us", next: "スキルシートを取引先に出す" },
  sheet_sent: { label: "スキルシート提出済", short: "シート", tone: "waiting", turn: "staff", next: "本人から面談の候補日時を3つもらう" },
  slots_collected: { label: "候補日あり", short: "候補日", tone: "waiting", turn: "us", next: "候補日時を取引先にまとめて送る" },
  slots_sent: { label: "候補日送付済", short: "送付済", tone: "waiting", turn: "client", next: "取引先から面談の日時・リンクを待つ" },
  interview_set: { label: "面談日時共有済", short: "面談待ち", tone: "waiting", turn: "none", next: "面談を待つ（終わったら「面談済」にする）" },
  interviewed: { label: "面談済", short: "合否待ち", tone: "waiting", turn: "client", next: "取引先から合否を待つ" },
  passed: { label: "合格", short: "合格", tone: "done", turn: "us", next: "現場詳細をもらって本人に展開する（確定連絡）" },
  briefed: { label: "現場詳細展開済", short: "完了", tone: "done", turn: "none", next: "完了" },
  failed: { label: "不合格", short: "不合格", tone: "alert", turn: "us", next: "別の案件を探す" },
  withdrawn: { label: "辞退・取り下げ", short: "辞退", tone: "muted", turn: "none", next: "" },
};

/** まっすぐ進む順（合格のあとは現場詳細展開済で終わり）。不合格・辞退は横道 */
export const FLOW: Stage[] = ["candidate", "staff_ok", "sheet_sent", "slots_collected", "slots_sent", "interview_set", "interviewed", "passed", "briefed"];

/** 次の段階（合否は interviewed から passed / failed のどちらかを選ぶので、ここでは passed） */
export function nextStage(stage: Stage): Stage | null {
  const i = FLOW.indexOf(stage);
  return i >= 0 && i < FLOW.length - 1 ? FLOW[i + 1] : null;
}

/** まだ進んでいる（終わっていない）段階か */
export const isActive = (stage: Stage) => stage !== "briefed" && stage !== "failed" && stage !== "withdrawn";

/** 合格して現場に入れる段階か */
export const isPassed = (stage: Stage) => stage === "passed" || stage === "briefed";

/** 面談の日時が過ぎたら、面談日時共有済でも自分の番（「面談済」にする） */
export function turnOf(stage: Stage, interviewAt: string | null | undefined, now: Date): Turn {
  if (stage === "interview_set" && interviewAt && new Date(interviewAt).getTime() < now.getTime()) return "us";
  return STAGE_INFO[stage].turn;
}

export const TURN_LABEL: Record<Turn, string> = { us: "自分の番", staff: "本人待ち", client: "取引先待ち", none: "" };

/** 色: 赤 = 自分の番で24時間以上、黄 = 自分の番・相手待ち、緑 = 合格、灰 = 終わり */
export function urgencyOf(stage: Stage, stageChangedAt: string, interviewAt: string | null | undefined, now: Date): Tone {
  if (isPassed(stage)) return stage === "briefed" ? "done" : "done";
  if (stage === "failed") return "alert";
  if (stage === "withdrawn") return "muted";
  const turn = turnOf(stage, interviewAt, now);
  if (turn === "us") return now.getTime() - new Date(stageChangedAt).getTime() > 24 * 3600_000 ? "alert" : "waiting";
  return "waiting";
}

/** カンバンの列（段階をまとめる） */
export const KANBAN_COLUMNS: { key: string; label: string; stages: Stage[] }[] = [
  { key: "candidate", label: "候補", stages: ["candidate"] },
  { key: "staff_ok", label: "本人OK", stages: ["staff_ok"] },
  { key: "sheet_sent", label: "シート提出", stages: ["sheet_sent"] },
  { key: "slots_collected", label: "候補日あり", stages: ["slots_collected"] },
  { key: "waiting", label: "面談待ち", stages: ["slots_sent", "interview_set"] },
  { key: "interviewed", label: "合否待ち", stages: ["interviewed"] },
  { key: "passed", label: "合格", stages: ["passed", "briefed"] },
  { key: "failed", label: "不合格・辞退", stages: ["failed", "withdrawn"] },
];

export const columnOf = (stage: Stage) => KANBAN_COLUMNS.find((c) => c.stages.includes(stage))!.key;

/** 「〇〇さんの段階は…」の点（●●●○○○○○○）: 進んだ分だけ塗る。不合格・辞退は塗らない */
export function progressDots(stage: Stage): { filled: number; total: number } {
  const total = FLOW.length;
  if (stage === "failed" || stage === "withdrawn") return { filled: 0, total };
  return { filled: FLOW.indexOf(stage) + 1, total };
}
