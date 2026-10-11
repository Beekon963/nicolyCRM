import { describe, expect, it } from "vitest";
import { adminConfirmText, adminEventsText } from "./messages";

describe("社内向けの LINE のお知らせ", () => {
  it("確定: 日付・会場・取引先・名前・役割と、あと何名かを出す", () => {
    const t = adminConfirmText({ date: "2026-10-20", venue: "DS中央", client: "テスト通信", role: "クローザー", staffName: "青木 太郎", confirmed: 1, required: 2, bySelf: true });
    expect(t).toBe("【確定】10/20(火) DS中央（テスト通信）\n青木 太郎さん（クローザー） ※本人がマイページで「参加できる」\nクローザー 1/2名 あと1名");
  });

  it("確定: 全員そろったら「そろいました」。管理者が確定したときは本人の回答の印を出さない", () => {
    const t = adminConfirmText({ date: "2026-10-20", venue: "DS中央", client: "テスト通信", role: "クローザー", staffName: "青木", confirmed: 2, required: 2, bySelf: false });
    expect(t.split("\n")[1]).toBe("青木さん（クローザー）");
    expect(t).toContain("2/2名 そろいました");
  });

  it("新しい現場: 日付の順に並べ、10件を超えたら「ほか〇件」にまとめる", () => {
    const ev = (d: number) => ({ date: `2026-10-${String(d).padStart(2, "0")}`, venue: "DS中央", client: "テスト通信", requirements: [{ role: "クローザー", count: 2 }, { role: "キャッチャー", count: 1 }] });
    const t = adminEventsText([ev(12), ev(11), ...Array.from({ length: 10 }, (_, i) => ev(13 + i))], "森部");
    const lines = t.split("\n");
    expect(lines[0]).toBe("【新しい現場】12件（森部さんが登録）");
    expect(lines[1]).toBe("10/11(日) DS中央（テスト通信）クローザー2・キャッチャー1");
    expect(lines.at(-1)).toBe("ほか2件");
    expect(t).not.toMatch(/円/);
  });
});
