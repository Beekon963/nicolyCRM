import { describe, expect, it } from "vitest";
import { selectAll } from "./select-all";

describe("selectAll", () => {
  it("1000行ずつ取り、足りなくなったら止める", async () => {
    const all = Array.from({ length: 2345 }, (_, i) => i);
    const calls: [number, number][] = [];
    const rows = await selectAll(async (from, to) => {
      calls.push([from, to]);
      return { data: all.slice(from, to + 1), error: null };
    });
    expect(rows).toEqual(all);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("ちょうど1000行のときは、空のページを確かめてから止める", async () => {
    const rows = await selectAll(async (from) => ({ data: from === 0 ? Array.from({ length: 1000 }, () => 1) : [], error: null }));
    expect(rows).toHaveLength(1000);
  });

  it("エラーは投げる", async () => {
    await expect(selectAll(async () => ({ data: null, error: { message: "だめ" } }))).rejects.toThrow("だめ");
  });
});
