import { describe, expect, it } from "vitest";
import { decodeCsv, parseCsv } from "@/lib/csv";
import { readAcademyCsv } from "./academy";

/** アカデミーの管理画面の CSV と同じ形（BOM 付き・CRLF）。名前はダミー */
const HEAD = "ID,氏名,状態,ロードマップ,称号,携帯（章）,電気・ガス（章）,カード（章）,光（章）,端末（章）,知識テスト,総合ロープレ,現場チェック,稼働判断,ヒアリング評価,初回ガイド,最後に学習した日時";
const csv = (...lines: string[]) => parseCsv(decodeCsv(new TextEncoder().encode("﻿" + [HEAD, ...lines].join("\r\n") + "\r\n")));

describe("アカデミーの進み具合の CSV", () => {
  it("1人1行で、称号・分野・テスト・ロープレ・現場チェック・稼働判断を読む", () => {
    const r = readAcademyCsv(
      csv(
        "learner01,山田 太郎,利用中,14/45,携帯を案内できる,8/8・テスト合格,3/6,0/5,0/7,0/9,合格,実技合格,5/5,稼働可,2,読了,2026/10/12 23:30",
        "learner02,佐藤 花子,利用中,3/45,見習い,3/8,0/6,0/5,0/7,0/9,未合格（最新 60点）,依頼中（受付待ち）,1/5,保留,0,スキップ,2026/10/13 00:10",
        "learner03,鈴木 一郎,停止中,0/45,見習い,0/8,0/6,0/5,0/7,0/9,未受験,まだ,0/5,未判定,0,未,",
      ),
    );
    expect(r?.warnings).toEqual([]);
    expect(r?.rows).toHaveLength(3);
    expect(r?.rows[0]).toEqual({
      academyId: "learner01",
      name: "山田 太郎",
      active: true,
      roadmap: { done: 14, total: 45 },
      title: "携帯を案内できる",
      areas: [
        { name: "携帯", done: 8, total: 8, test: true },
        { name: "電気・ガス", done: 3, total: 6, test: false },
        { name: "カード", done: 0, total: 5, test: false },
        { name: "光", done: 0, total: 7, test: false },
        { name: "端末", done: 0, total: 9, test: false },
      ],
      knowledge: "合格",
      knowledgeOk: true,
      roleplay: "実技合格",
      roleplayOk: true,
      field: { done: 5, total: 5 },
      decision: "ready",
      hearing: 2,
      guide: "読了",
      // 日本時間 23:30 = UTC 14:30
      lastStudiedAt: "2026-10-12T14:30:00.000Z",
    });
    // 言葉はアカデミーの書き方のまま（全角のかっこも）
    expect(r?.rows[1]).toMatchObject({ title: "見習い", knowledge: "未合格（最新 60点）", knowledgeOk: false, roleplay: "依頼中（受付待ち）", roleplayOk: false, decision: "hold", guide: "スキップ" });
    expect(r?.rows[2]).toMatchObject({ active: false, decision: "none", knowledge: "未受験", lastStudiedAt: null });
  });

  it("日本時間の 0 時すぎは、UTC では前の日になる", () => {
    const r = readAcademyCsv(csv("learner02,佐藤 花子,利用中,3/45,見習い,3/8,0/6,0/5,0/7,0/9,未受験,まだ,1/5,保留,0,未,2026/10/13 00:10"));
    expect(r?.rows[0].lastStudiedAt).toBe("2026-10-12T15:10:00.000Z");
  });

  it("ログイン（ID の列）のない行・同じログインの2行目は読まずに知らせる", () => {
    const r = readAcademyCsv(
      csv(
        "learner01,山田 太郎,利用中,1/45,見習い,1/8,0/6,0/5,0/7,0/9,未受験,まだ,0/5,未判定,0,未,",
        ",田中 次郎,利用中,1/45,見習い,1/8,0/6,0/5,0/7,0/9,未受験,まだ,0/5,未判定,0,未,",
        "learner01,山田 太郎,利用中,2/45,見習い,2/8,0/6,0/5,0/7,0/9,未受験,まだ,0/5,未判定,0,未,",
      ),
    );
    expect(r?.rows.map((x) => x.roadmap)).toEqual([{ done: 1, total: 45 }]);
    expect(r?.warnings).toEqual(["田中 次郎さんの行は、ログインの欄が空なので読みませんでした", "ログイン「learner01」が2回あったので、最初の行だけ読みました"]);
  });

  it("分野が増えても・半角のかっこでも読む。知らない列は読まない", () => {
    const table = parseCsv(["ID,氏名,称号,携帯(章),新しい分野（章）,メモ,稼働判断", "learner09,高橋 三郎,携帯を案内できる,8/8・テスト合格,2/4,なにか,稼働可"].join("\n"));
    const r = readAcademyCsv(table);
    expect(r?.rows[0].areas).toEqual([
      { name: "携帯", done: 8, total: 8, test: true },
      { name: "新しい分野", done: 2, total: 4, test: false },
    ]);
    // ない列はからっぽ・未判定のまま
    expect(r?.rows[0]).toMatchObject({ decision: "ready", knowledge: "", roleplay: "", field: null, roadmap: null, hearing: 0, lastStudiedAt: null, active: true });
  });

  it("おかしな数字は読まない（できた数が全部より多い・日付でない）", () => {
    const r = readAcademyCsv(csv("learner05,伊藤 四郎,利用中,50/45,見習い,9/8,abc,0/5,0/7,0/9,未受験,まだ,7/5,未判定,-3,未,2026/13/40 25:00"));
    expect(r?.rows[0]).toMatchObject({ roadmap: null, field: null, hearing: 0, lastStudiedAt: null });
    expect(r?.rows[0].areas.slice(0, 2)).toEqual([
      { name: "携帯", done: 0, total: 0, test: false },
      { name: "電気・ガス", done: 0, total: 0, test: false },
    ]);
  });

  it("アカデミーの CSV でなければ null（スタッフ名簿など）", () => {
    expect(readAcademyCsv(parseCsv("氏名,かな,電話\n山田 太郎,やまだ たろう,090-0000-0000"))).toBeNull();
    expect(readAcademyCsv([])).toBeNull();
  });
});
