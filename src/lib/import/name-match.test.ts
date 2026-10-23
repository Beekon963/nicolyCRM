import { describe, expect, it } from "vitest";
import { defaultChoices, type PlanContext } from "./month-sheet-plan";
import { nearClientRows, nearStaffRows, suggestChoices, suggestClientMatch, suggestForUnmatched, suggestPlaceMatch, suggestStaffMatch, suggestVenueMatch } from "./name-match";
import type { ParsedMonthSheet } from "./month-sheet";

// 架空の名簿・取引先・会場
const staff = [
  { id: "s1", name: "検証 太郎", kana: "けんしょう たろう", line_name: "たろ" },
  { id: "s2", name: "検証 花子", kana: "けんしょう はなこ", line_name: null },
  { id: "s3", name: "試験 次郎", kana: "しけん じろう", line_name: "ジロー" },
];
const clients = [
  { id: "c1", name: "株式会社アオゾラ通信" },
  { id: "c2", name: "ミドリ商事" },
  { id: "c3", name: "ミドリ商事 関西支社" },
];
const venues = [
  { id: "v1", name: "DSサンプル大宮西口" },
  { id: "v2", name: "イオン架空モール" },
  { id: "v3", name: "研修センター" },
];

describe("近い名前の候補", () => {
  it("スタッフ: 名字だけ・ふりがな・LINE の表示名・敬称ちがいで1人に決まるとき", () => {
    expect(suggestStaffMatch("試験", staff)).toMatchObject({ id: "s3", why: "名字（または名前）が同じ" });
    expect(suggestStaffMatch("しけん じろう", staff)).toMatchObject({ id: "s3", why: "ふりがなが同じ" });
    expect(suggestStaffMatch("ジロー", staff)).toMatchObject({ id: "s3", why: "LINE の表示名が同じ" });
    expect(suggestStaffMatch("検証太郎さん", staff)).toMatchObject({ id: "s1", why: "名前が同じ（空白や敬称の違い）" });
    expect(suggestStaffMatch("花子", staff)).toMatchObject({ id: "s2" });
  });

  it("スタッフ: 同じ名字の人が2人以上いるときは出さない", () => {
    expect(suggestStaffMatch("検証", staff)).toBeNull();
    expect(suggestStaffMatch("知らない 人", staff)).toBeNull();
    expect(suggestStaffMatch("", staff)).toBeNull();
  });

  it("取引先: 「株式会社」の違いだけ、名前の一部が同じ（1件だけのとき）", () => {
    expect(suggestClientMatch("アオゾラ通信（株）", clients)).toMatchObject({ id: "c1", why: "「株式会社」などの違いだけ" });
    expect(suggestClientMatch("アオゾラ", clients)).toMatchObject({ id: "c1", why: "名前の一部が同じ" });
    // 「ミドリ商事」はそのままの名前と「関西支社」の2件に当たるので、同じ名前のほうを選ぶ
    expect(suggestClientMatch("ミドリ商事", clients)).toMatchObject({ id: "c2" });
    // 「ミドリ」は2件に含まれるので決めない
    expect(suggestClientMatch("ミドリ", clients)).toBeNull();
    expect(suggestClientMatch("知らない商事", clients)).toBeNull();
  });

  it("会場: 「DS」「店内」などの違いだけ、名前の一部が同じ", () => {
    expect(suggestVenueMatch("サンプル大宮西口 店内", venues)).toMatchObject({ id: "v1", why: "「DS」「店内」などの違いだけ" });
    expect(suggestVenueMatch("架空モール", venues)).toMatchObject({ id: "v2", why: "名前の一部が同じ" });
    expect(suggestVenueMatch("ないモール", venues)).toBeNull();
  });

  it("下の段にだけある場所: その会場でいちばん多い取引先。同じ件数で並べば出さない", () => {
    const events = [
      { client_id: "c1", venue_id: "v3" },
      { client_id: "c1", venue_id: "v3" },
      { client_id: "c2", venue_id: "v3" },
    ];
    expect(suggestPlaceMatch("研修センター", { clients, venues, events })).toMatchObject({ id: "c1", why: "「研修センター」の現場は 株式会社アオゾラ通信 が 2件" });
    expect(suggestPlaceMatch("研修センター", { clients, venues, events: events.slice(1) })).toBeNull();
    // 現場がなくても、場所の名前に取引先の名前が入っていれば
    expect(suggestPlaceMatch("アオゾラ通信 研修", { clients, venues, events: [] })).toMatchObject({ id: "c1", why: "場所の名前に取引先の名前が入っている" });
    expect(suggestPlaceMatch("どこか", { clients, venues, events: [] })).toBeNull();
  });

  it("合わない名前のそれぞれに候補を付ける（ないものは付けない）", () => {
    const r = suggestForUnmatched(
      { clients: ["アオゾラ通信（株）", "知らない商事"], venues: ["架空モール"], staff: ["試験", "検証"], places: [{ place: "研修センター", days: [3] }] },
      { clients, venues, staff, events: [{ client_id: "c2", venue_id: "v3" }] },
    );
    expect(Object.keys(r.clients)).toEqual(["アオゾラ通信（株）"]);
    expect(r.venues["架空モール"].id).toBe("v2");
    expect(Object.keys(r.staff)).toEqual(["試験"]);
    expect(r.places["研修センター"].id).toBe("c2");
  });

  it("月の稼働表の取り込み: 同じ名前で決まらなかったものに候補を入れて、最初から選んでおく", () => {
    // 研修センターの現場は CRM にはない月（下の段にだけある場所になる）。取引先の候補は、ほかの月の現場の多さで決める
    const ctx: PlanContext = { today: "2026-10-22", clients, venues, staff, events: [] };
    const parsed: ParsedMonthSheet = {
      month: 11,
      days: [1, 2, 3],
      warnings: [],
      clients: [{ name: "アオゾラ通信（株）", lines: [{ day: 1, venue: "架空モール", required: 1, rate: null, transport: false }] }, { name: "知らない商事", lines: [{ day: 2, venue: "ないモール", required: 1, rate: null, transport: false }] }],
      staff: [
        { rank: "", name: "試験", station: "", places: [{ day: 3, place: "研修センター" }], shifts: [], rates: [] },
        { rank: "", name: "検証", station: "", places: [], shifts: [{ day: 1, status: "ok" }], rates: [] },
      ],
    };
    const base = defaultChoices(parsed, ctx, "2026-11");
    expect(base.clients["アオゾラ通信（株）"]).toBe("c1"); // 「株式会社」の違いは同じ名前として決まる
    expect(base.staff["試験"]).toBe("skip");
    const { choices, suggested } = suggestChoices(parsed, { ...ctx, events: [{ id: "e1", date: "2026-10-03", client_id: "c2", venue_id: "v3" }] }, base);
    expect(choices.clients["知らない商事"]).toBe("new");
    expect(choices.venues["架空モール"]).toBe("v2");
    expect(suggested.venues["架空モール"].why).toBe("名前の一部が同じ");
    expect(choices.venues["ないモール"]).toBe("new");
    expect(choices.staff["試験"]).toBe("s3");
    expect(choices.staff["検証"]).toBe("skip"); // 2人に当たるので候補なし
    expect(choices.places["研修センター"]).toBe("c2");
    expect(suggested.places["研修センター"].why).toContain("ミドリ商事 が 1件");
    // 元の選び方は変えない
    expect(base.staff["試験"]).toBe("skip");
  });

  it("行を足す前の確認: シートの行の名前のうち、この人・この取引先かもしれないもの（覚えた対応づけがある名前は除く）", () => {
    const rowNames = ["検証 太郎", "試験", "ジロー", "知らない 人", ""];
    expect(nearStaffRows("s3", rowNames, staff, new Set())).toEqual(["試験", "ジロー"]);
    expect(nearStaffRows("s3", rowNames, staff, new Set(["試験"]))).toEqual(["ジロー"]);
    expect(nearStaffRows("s2", rowNames, staff, new Set())).toEqual([]);
    expect(nearClientRows("c1", ["アオゾラ通信（株）", "ミドリ商事", ""], clients, new Set())).toEqual(["アオゾラ通信（株）"]);
    expect(nearClientRows("c3", ["ミドリ商事"], clients, new Set())).toEqual([]);
  });
});
