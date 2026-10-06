/** テスト用: 文字列を Shift_JIS のバイト列にする（Excel で保存した CSV を再現） */
import { execFileSync } from "node:child_process";

export default function toShiftJis(text: string): Buffer {
  return execFileSync("iconv", ["-f", "UTF-8", "-t", "SHIFT_JIS"], { input: text });
}
