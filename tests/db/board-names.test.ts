import { describe, expect, it } from "vitest";
import { asRole } from "./helpers";

/**
 * 稼働表の短い名前の元（Phase 22）: 取引先の「扱うキャリア」と会場の「場所の短い名前」。金額ではないので管理者も読める・入れられる
 */
describe("扱うキャリアと場所の短い名前", () => {
  it("キャリアは決まった値だけ、短い名前は20文字まで", async () => {
    // 失敗する SQL はトランザクションを止めるので、1つの asRole に1つだけ
    await asRole("owner", async (c) => {
      const id = (await c.query(`insert into public.companies (kind, name, carrier) values ('client', '架空通信', 'docomo') returning id`)).rows[0].id;
      expect((await c.query(`select carrier from public.companies where id = $1`, [id])).rows[0].carrier).toBe("docomo");
      await expect(c.query(`update public.companies set carrier = 'foo' where id = $1`, [id])).rejects.toThrow();
    });
    await asRole("owner", async (c) => {
      const v = (await c.query(`insert into public.venues (name, short_name) values ('架空モール 北', '北') returning id`)).rows[0].id;
      expect((await c.query(`select short_name from public.venues where id = $1`, [v])).rows[0].short_name).toBe("北");
      await expect(c.query(`update public.venues set short_name = repeat('あ', 21) where id = $1`, [v])).rejects.toThrow();
    });
  });

  it("管理者も入れられる・読める（金額ではない）", async () => {
    await asRole("manager", async (c) => {
      const id = (await c.query(`insert into public.companies (kind, name, carrier) values ('client', '架空通信', 'au') returning id`)).rows[0].id;
      expect((await c.query(`select carrier from public.companies where id = $1`, [id])).rows[0].carrier).toBe("au");
      const v = (await c.query(`insert into public.venues (name, short_name) values ('架空モール 南', '南') returning id`)).rows[0].id;
      expect((await c.query(`select short_name from public.venues where id = $1`, [v])).rows[0].short_name).toBe("南");
    });
  });
});
