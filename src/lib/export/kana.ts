/**
 * 全銀フォーマットで使える文字（半角カナの大文字・半角英大文字・数字・一部の記号）に直す。
 * 例: 「やまだ　たろう」→「ﾔﾏﾀﾞ ﾀﾛｳ」、「キャッシュ」→「ｷﾔﾂｼﾕ」（小さい文字は大きく）
 */

const FULL = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン";
const HALF = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ";
const SMALL: Record<string, string> = { ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ", ャ: "ヤ", ュ: "ユ", ョ: "ヨ", ッ: "ツ", ヮ: "ワ", ヵ: "カ", ヶ: "ケ" };
const DAKUTEN = "ガギグゲゴザジズゼゾダヂヅデドバビブベボ";
const DAKUTEN_BASE = "カキクケコサシスセソタチツテトハヒフヘホ";
const HANDAKUTEN = "パピプペポ";
const HANDAKUTEN_BASE = "ハヒフヘホ";
/** 全銀で使える半角の記号 */
const SYMBOLS = " ().-/,";

export type KanaResult = { ok: true; value: string } | { ok: false; bad: string[] };

export function toZenginKana(input: string): KanaResult {
  // 全角英数・半角カナを正規化（NFKC で半角カナは全角に、全角英数は半角になる）
  const s = input
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[ー－‐―−]/g, "-")
    .replace(/[\s　]+/g, " ")
    .trim()
    .toUpperCase();
  let out = "";
  const bad: string[] = [];
  for (const raw of s) {
    const c = SMALL[raw] ?? raw;
    if (/[0-9A-Z]/.test(c) || SYMBOLS.includes(c)) out += c;
    else if (FULL.includes(c)) out += HALF[FULL.indexOf(c)];
    else if (DAKUTEN.includes(c)) out += HALF[FULL.indexOf(DAKUTEN_BASE[DAKUTEN.indexOf(c)])] + "ﾞ";
    else if (HANDAKUTEN.includes(c)) out += HALF[FULL.indexOf(HANDAKUTEN_BASE[HANDAKUTEN.indexOf(c)])] + "ﾟ";
    else if (c === "ヴ") out += "ｳﾞ";
    else if (c === "ヰ") out += "ｲ";
    else if (c === "ヱ") out += "ｴ";
    else if (c === "・") out += ".";
    else if (!bad.includes(c)) bad.push(c);
  }
  return bad.length ? { ok: false, bad } : { ok: true, value: out };
}
