import { describe, expect, it } from "vitest";
import {
  bulkTargets,
  type EventLike,
  extendSelection,
  pickRole,
  rangeDates,
  toggleDate,
} from "./select";

const week = [
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
  "2026-11-06",
  "2026-11-07",
  "2026-11-08",
];

const ev = (
  p: Partial<EventLike> & Pick<EventLike, "id" | "date">,
): EventLike => ({
  venueId: "v1",
  venueName: "イオンモール架空村山",
  venueColor: "sky",
  venueShort: "村山",
  carrier: "docomo",
  clientName: "架空通信",
  cancelled: false,
  shortage: 1,
  ...p,
});

describe("複数日の選択", () => {
  it("anchor〜focus の範囲は表の並びで、逆向きでも同じ。表にない日は anchor だけ", () => {
    expect(rangeDates(week, "2026-11-03", "2026-11-05")).toEqual([
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
    expect(rangeDates(week, "2026-11-05", "2026-11-03")).toEqual([
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
    ]);
    expect(rangeDates(week, "2026-11-03", "2026-12-01")).toEqual([
      "2026-11-03",
    ]);
    expect(rangeDates(week, "2026-12-01", "2026-11-03")).toEqual([]);
  });

  it("タップで足す・外す。ドラッグはもともとの選択に範囲を足す（並びは表の順）", () => {
    const sel = { staffId: "s1", dates: ["2026-11-04"] };
    expect(toggleDate(sel, "2026-11-02", week).dates).toEqual([
      "2026-11-02",
      "2026-11-04",
    ]);
    expect(toggleDate(sel, "2026-11-04", week).dates).toEqual([]);
    expect(
      extendSelection(
        { staffId: "s1", dates: ["2026-11-02"] },
        week,
        "2026-11-05",
        "2026-11-07",
      ).dates,
    ).toEqual(["2026-11-02", "2026-11-05", "2026-11-06", "2026-11-07"]);
  });

  it("まとめて入れる先: 選んだ日に現場のある会場。日ごとの現場と、現場がない日。中止は除く。多い順 → 欠員の多い順", () => {
    const events = Object.fromEntries(
      [
        ev({ id: "e1", date: "2026-11-03" }),
        ev({ id: "e2", date: "2026-11-04" }),
        ev({
          id: "e3",
          date: "2026-11-04",
          venueId: "v2",
          venueName: "架空店",
          venueShort: "",
          carrier: "au",
          shortage: 3,
        }),
        ev({
          id: "e4",
          date: "2026-11-05",
          venueId: "v2",
          venueName: "架空店",
          cancelled: true,
        }),
        ev({ id: "e5", date: "2026-11-10" }),
      ].map((e) => [e.id, e]),
    );
    const t = bulkTargets(events, ["2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(t.map((x) => x.venueId)).toEqual(["v1", "v2"]);
    expect(t[0]).toMatchObject({
      events: { "2026-11-03": "e1", "2026-11-04": "e2" },
      missing: ["2026-11-05"],
      shortage: 2,
    });
    expect(t[1]).toMatchObject({
      events: { "2026-11-04": "e3" },
      missing: ["2026-11-03", "2026-11-05"],
      shortage: 3,
    });
    expect(bulkTargets(events, ["2026-11-06"])).toEqual([]);
  });

  it("役割: 空きがあってできる役割 → 空きのある役割 → できる役割 → 最初", () => {
    const byRole = {
      r1: { required: 1, shortage: 0 },
      r2: { required: 2, shortage: 1 },
      r3: { required: 1, shortage: 1 },
    };
    expect(pickRole(byRole, ["r3"])).toBe("r3");
    expect(pickRole(byRole, ["r1"])).toBe("r2");
    expect(pickRole({ r1: { required: 1, shortage: 0 } }, ["r1"])).toBe("r1");
    expect(pickRole({ r1: { required: 1, shortage: 0 } }, [])).toBe("r1");
    expect(pickRole({}, [], "r9")).toBe("r9");
  });
});
