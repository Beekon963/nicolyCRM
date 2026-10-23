import { describe, expect, it } from "vitest";
import { classifyPaste, detectReply, extractComment, parseAvailabilityText } from "./classify";

const today = "2026-10-22";

describe("稼働可能日の文を読む", () => {
  it("「11/1 ○」のような1行ずつの書き方", () => {
    const r = parseAvailabilityText("11/1 ○\n11/2(日) ×\n11/3 △\n11/4 OK\n11/5 NG", { today });
    expect(r.month).toBe("2026-11");
    expect(r.days).toEqual([
      { date: "2026-11-01", status: "ok" },
      { date: "2026-11-02", status: "ng" },
      { date: "2026-11-03", status: "maybe" },
      { date: "2026-11-04", status: "ok" },
      { date: "2026-11-05", status: "ng" },
    ]);
    expect(r.unread).toEqual([]);
  });

  it("日を並べて印を付ける書き方と、「他は×」「全部○」", () => {
    const r = parseAvailabilityText("11月\n1,2,5 ○\n10・11 △\n他は×", { today });
    expect(r.days.filter((d) => d.status === "ok").map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02", "2026-11-05"]);
    expect(r.days.filter((d) => d.status === "maybe").map((d) => d.date)).toEqual(["2026-11-10", "2026-11-11"]);
    expect(r.days.filter((d) => d.status === "ng")).toHaveLength(30 - 5);
    const all = parseAvailabilityText("12月は全部○です", { today });
    expect(all.month).toBe("2026-12");
    expect(all.days).toHaveLength(31);
    expect(all.days.every((d) => d.status === "ok")).toBe(true);
  });

  it("印が先の書き方「○: 1 2 3 / ×: 4」と、範囲「1〜5」「11/20-11/22」", () => {
    const r = parseAvailabilityText("○: 1 2 3\n×: 4\n△ 6〜8", { today, defaultMonth: "2026-11" });
    expect(r.days.map((d) => `${d.date.slice(8)}${d.status}`)).toEqual(["01ok", "02ok", "03ok", "04ng", "06maybe", "07maybe", "08maybe"]);
    const range = parseAvailabilityText("11/20-11/22 ○\n11/25〜27 ×", { today });
    expect(range.days.map((d) => `${d.date.slice(5)}${d.status}`)).toEqual(["11-20ok", "11-21ok", "11-22ok", "11-25ng", "11-26ng", "11-27ng"]);
  });

  it("月が書いてなければ集めている月（翌月）。年をまたぐ「1/5」は来年", () => {
    const r = parseAvailabilityText("5日 ○ 6日 ×", { today: "2026-12-20" });
    expect(r.month).toBe("2027-01");
    expect(r.days).toEqual([
      { date: "2027-01-05", status: "ok" },
      { date: "2027-01-06", status: "ng" },
    ]);
    expect(parseAvailabilityText("1/5 ○", { today: "2026-12-20" }).days[0].date).toBe("2027-01-05");
  });

  it("日付や印のない行は読まない。時刻・人数の数字は日付にしない", () => {
    const r = parseAvailabilityText("お疲れさまです\n11/3 ○ 10時から\n11/4 2人 ×", { today });
    expect(r.days).toEqual([
      { date: "2026-11-03", status: "ok" },
      { date: "2026-11-04", status: "ng" },
    ]);
    expect(parseAvailabilityText("よろしくお願いします", { today }).days).toEqual([]);
    expect(parseAvailabilityText("11/3\n11/4", { today }).unread).toEqual(["11/3", "11/4"]);
  });
});

describe("打診の返事", () => {
  it("短い文の「参加できます」「無理です」を見分ける。長い文は返事にしない", () => {
    expect(detectReply("参加できます！")).toEqual({ positive: true });
    expect(detectReply("大丈夫です、お願いします")).toEqual({ positive: true });
    expect(detectReply("すみません、その日は無理です")).toEqual({ positive: false });
    expect(detectReply("行けません🙏")).toEqual({ positive: false });
    expect(detectReply("新規2\n機種変更1")).toBeNull();
    expect(detectReply("参加できます。".repeat(20))).toBeNull();
  });
});

describe("貼った文の見分け", () => {
  const roleNames = ["クローザー", "キャッチャー"];
  it("案件詳細 → 会場のメモ", () => {
    const c = classifyPaste("【案件詳細】\n●開催場所\nDSサンプル大宮西口\n●集合場所\n1F 入口\n●服装\nスーツ", { today, roleNames });
    expect(c.kind).toBe("details");
    if (c.kind === "details") expect(c.detail.venue).toBe("DSサンプル大宮西口");
  });
  it("募集の文 → 現場を作る", () => {
    const c = classifyPaste("〈募集日〉\n11/1・5・6\n■稼働場所\nDSサンプル大宮西口\n■時間\n10:00-19:00\n募集：クローザー1名", { today, roleNames });
    expect(c.kind).toBe("recruit");
    if (c.kind === "recruit") expect(c.recruit.dates).toEqual(["2026-11-01", "2026-11-05", "2026-11-06"]);
  });
  it("件数の報告 → 速報（NICOLY フォーマットも、いつもの書き方も）", () => {
    const c = classifyPaste("10/21 DSサンプル大宮西口\n新規1(山田)\n機種変更2\n所感: 午後から混みました", { today, roleNames });
    expect(c.kind).toBe("report");
    const d = classifyPaste("大宮西口 山田\nPI1\nキヘン2\n応対数 20", { today, roleNames });
    expect(d.kind).toBe("report");
  });
  it("稼働可能日 → 確認カード、返事 → 返事待ちの一覧、分からない → AI", () => {
    expect(classifyPaste("11/1 ○\n11/2 ×", { today, roleNames }).kind).toBe("availability");
    expect(classifyPaste("参加できます！", { today, roleNames }).kind).toBe("reply");
    // 英数字の中の数字（E2E・ab12）は日付にしない。短い返事は日付がなければ返事
    expect(classifyPaste("E2E転送 参加できます！ab12", { today, roleNames }).kind).toBe("reply");
    expect(classifyPaste("11/3 参加できます", { today, roleNames }).kind).toBe("availability");
    expect(classifyPaste("来週の打ち合わせの件ですが", { today, roleNames }).kind).toBe("unknown");
  });
});

describe("報告の所感を拾う", () => {
  it("「所感: 〇〇」「【所感】」から下を所感にする（次の見出しまで）", () => {
    expect(extractComment("大宮 山田\nPI1\n所感: 午後から混みました\n雨でした")).toBe("午後から混みました\n雨でした");
    expect(extractComment("【実績】\n新規 1\n【所感】\n評価いただきました\n\n【公認名称】\n新規")).toBe("評価いただきました");
    expect(extractComment("PI1\nキヘン2")).toBe("");
  });
});

describe("案件まわりの文の見分け（Phase 21）", () => {
  const opts = { today, roleNames: ["クローザー"], defaultMonth: "2026-11" };

  it("案件の文（日付・会場・人数の行が並ぶ）→ 案件を作る", () => {
    const c = classifyPaste("20 架空モール外販　1名\n21 架空モール外販　2名\n\n単価\n20000円/日", opts);
    expect(c.kind).toBe("job");
    if (c.kind === "job") expect(c.job.lines).toHaveLength(2);
  });

  it("人員変更の文 → 入れ替えの確認、合否の連絡 → 合否の確認", () => {
    const re = classifyPaste("10月30日の架空モール 架空欠員のため人員変更。\n\n試験店 検証と試験\n\n架空モール 花子", opts);
    expect(re.kind).toBe("reassign");
    const ok = classifyPaste("お世話になっております。検証さん合格です！", opts);
    expect(ok.kind).toBe("result");
    if (ok.kind === "result") expect(ok.results).toEqual([{ name: "検証", passed: true }]);
  });

  it("面談の候補日時（日付と時間）→ だれの分か選ぶ。○△× があれば稼働可能日のまま", () => {
    const s = classifyPaste("10/26 20:00〜\n10/27 9:00〜12:00\n10/28 終日", opts);
    expect(s.kind).toBe("slots");
    if (s.kind === "slots") expect(s.slots.map((x) => x.text)).toEqual(["10/26 20:00〜", "10/27 9:00〜12:00", "10/28 終日"]);
    expect(classifyPaste("11/1 ○\n11/2 ×", opts).kind).toBe("availability");
    // 短い返事は返事のまま
    expect(classifyPaste("参加できます！", opts).kind).toBe("reply");
  });
});
