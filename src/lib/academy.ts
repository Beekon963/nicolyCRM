/**
 * NICOLY アカデミーの記録（Phase 14）。DB の行（academy_progress）→ 画面に出す形。
 * 取り込みは src/lib/import/academy.ts（CSV を読む）と、スタッフ → アカデミーの進み具合 の画面。
 */
import type { AcademyArea, AcademyDecision } from "@/lib/import/academy";
import type { Database } from "@/lib/supabase/database.types";

type Row = Database["public"]["Tables"]["academy_progress"]["Row"];

export type AcademyProgress = {
  staffId: string;
  academyId: string;
  academyName: string;
  active: boolean;
  roadmap: { done: number; total: number } | null;
  title: string;
  areas: AcademyArea[];
  knowledge: string;
  knowledgeOk: boolean;
  roleplay: string;
  roleplayOk: boolean;
  field: { done: number; total: number } | null;
  decision: AcademyDecision;
  hearing: number;
  guide: string;
  lastStudiedAt: string | null;
  importedAt: string;
};

/** 一覧・候補に出す札の中身 */
export type AcademyBadge = { title: string; decision: AcademyDecision };

export function decisionOf(v: string | null | undefined): AcademyDecision {
  return v === "ready" || v === "hold" ? v : "none";
}

const fraction = (done: number | null, total: number | null) => (done != null && total != null ? { done, total } : null);

/** 分野の一覧（DB の jsonb）。形の合わないものは読まない */
export function areasOf(json: unknown): AcademyArea[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const { name, done, total, test } = a as Record<string, unknown>;
    if (typeof name !== "string" || typeof done !== "number" || typeof total !== "number") return [];
    return [{ name, done, total, test: test === true }];
  });
}

/** 分野が全部終わったか（章を全部学習して、仕上げのテストにも合格） */
export function areaComplete(a: AcademyArea): boolean {
  return a.total > 0 && a.done >= a.total && a.test;
}

export function toAcademyProgress(row: Row): AcademyProgress {
  return {
    staffId: row.staff_id,
    academyId: row.academy_id,
    academyName: row.academy_name,
    active: row.active,
    roadmap: fraction(row.roadmap_done, row.roadmap_steps),
    title: row.title,
    areas: areasOf(row.areas),
    knowledge: row.knowledge,
    knowledgeOk: row.knowledge_ok,
    roleplay: row.roleplay,
    roleplayOk: row.roleplay_ok,
    field: fraction(row.field_done, row.field_items),
    decision: decisionOf(row.decision),
    hearing: row.hearing_count,
    guide: row.guide,
    lastStudiedAt: row.last_studied_at,
    importedAt: row.imported_at,
  };
}
