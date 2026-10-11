import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddressText } from "./address-text";

describe("住所の折り返し", () => {
  it("番地（1-0-0 など）はひとかたまりにする", () => {
    expect(renderToStaticMarkup(<AddressText address="神奈川県横浜市西区南幸1-0-0" />)).toBe('神奈川県横浜市西区南幸<span class="whitespace-nowrap">1-0-0</span>');
    expect(renderToStaticMarkup(<AddressText address="東京都渋谷区道玄坂２－０－０ サンプルビル" />)).toBe('東京都渋谷区道玄坂<span class="whitespace-nowrap">２－０－０</span> サンプルビル');
  });
  it("番地がなければそのまま", () => {
    expect(renderToStaticMarkup(<AddressText address="千葉県千葉市" />)).toBe("千葉県千葉市");
  });
});
