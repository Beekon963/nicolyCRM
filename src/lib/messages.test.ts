import { describe, expect, it } from "vitest";
import { buildMessage } from "./messages";

describe("送る文面", () => {
  it("現場とスタッフの情報が差し込まれる", () => {
    const text = buildMessage(
      "{名前}さん {日付}({曜日}) {時間} {会場名} {役割} 集合{集合時刻} {集合場所}\n{マイページURL}",
      {
        date: "2026-10-10",
        start_time: "10:00:00",
        end_time: "19:00:00",
        meeting_time: "09:30:00",
        meeting_place: "従業員入口",
        venue: { name: "DS駅前", address: "東京都" },
      },
      { name: "山田 太郎", mypage_token: "abc" },
      { siteUrl: "https://example.com", roleName: "クローザー" },
    );
    expect(text).toBe("山田さん 10/10(土) 10:00〜19:00 DS駅前 クローザー 集合9:30 従業員入口\nhttps://example.com/m/abc");
  });
});
