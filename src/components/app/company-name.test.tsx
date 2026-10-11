import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompanyName } from "./company-name";

describe("会社名の折り返し", () => {
  it("「株式会社」などはひとかたまりにし、本体とのあいだだけ折り返せる", () => {
    expect(renderToStaticMarkup(<CompanyName name="アオゾラ通信株式会社" />)).toBe('アオゾラ通信<wbr/><span class="whitespace-nowrap">株式会社</span>');
    expect(renderToStaticMarkup(<CompanyName name="株式会社ミライセールス" />)).toBe('<span class="whitespace-nowrap">株式会社</span><wbr/>ミライセールス');
    expect(renderToStaticMarkup(<CompanyName name="（株）サンプル" />)).toBe('<span class="whitespace-nowrap">（株）</span><wbr/>サンプル');
  });
  it("法人の種類がない名前はそのまま", () => {
    expect(renderToStaticMarkup(<CompanyName name="DSサンプル" />)).toBe("DSサンプル");
  });
});
