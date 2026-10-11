/**
 * 稼働表を、今の月のスプレッドシートと同じ並びの表（行 × 列の文字）にする（Phase 1.5 の書き出し）。
 * - 1行目: 日付、2行目: ランク / 名前 / 最寄り駅 / 曜日
 * - 上の段: 取引先ごと・会場ごとに「単価 / 現場 / 人数（確定/必要）」の3行（今のシートと同じ並び）、その下に「欠員」
 * - 下の段: スタッフごとに「単価 / 場所（確定した現場）/ シフト（⭕️🔺❌）」の3行、右端に稼働日数
 * 金額（単価・売上など）は書き出さない（共有するシートのため）。「単価」の行は並びを今のシートとそろえるために置き、中は空にする。
 */
import type { Board } from "./index";

const SHIFT: Record<string, string> = { ok: "⭕️", maybe: "🔺", ng: "❌" };

/**
 * シートのタブ名。いつもの管理用シートに書き出しても、手で作った「202611」などのタブと重ならないよう
 * 「CRM 202611」にする（CRM はこの名前のタブにしか書かない）。
 */
export function sheetTitle(month: string) {
  return `CRM ${month.replace("-", "")}`;
}

/** CRM が書き出したタブの左上（A1）の書き出し。これで始まらないタブには書かない */
const MARK = "最終更新 ";
const MARK_TAIL = "（CRM から自動。ここで直しても CRM には戻りません）";

/**
 * 同じ名前のタブがすでにあるとき、そこに書いてよいか（左上が空か、CRM が書いたものだけ）。
 * 人が作ったタブを上書きしないための安全装置。
 */
export function canOverwriteTab(a1: string | null | undefined): boolean {
  const v = (a1 ?? "").trim();
  return v === "" || (v.startsWith(MARK) && v.endsWith(MARK_TAIL));
}

export function boardToSheetValues(board: Board, updatedAt: string): string[][] {
  const days = board.days;
  const m = Number(board.month.slice(5));
  const row = (head: [string, string, string, string], cells: string[], tail = "") => [...head, ...cells, tail];

  const rows: string[][] = [
    row([`${MARK}${updatedAt}${MARK_TAIL}`, "", "", "日付"], days.map((d) => `${m}/${d.day}`), "稼働日数"),
    row(["ランク", "名前", "最寄り駅", "曜日"], days.map((d) => (d.holiday ? `${d.weekday}・祝` : d.weekday))),
  ];

  // 上の段: 取引先ごと・会場ごとに「単価 / 現場 / 人数」の3行（今のシートと同じ並び。単価は共有するので書かない）
  for (const c of board.clients) {
    const venues = [...new Set(days.flatMap((d) => (c.cells[d.date] ?? []).map((e) => e.venueName)))];
    venues.forEach((venue, i) => {
      const chip = (date: string) => (c.cells[date] ?? []).find((e) => e.venueName === venue);
      rows.push(
        row([i === 0 ? c.name : "", "", "", "単価"], days.map(() => "")),
        row(["", "", "", "現場"], days.map((d) => (chip(d.date) ? (chip(d.date)!.cancelled ? `${venue}（中止）` : venue) : ""))),
        row(["", "", "", "人数"], days.map((d) => {
          const e = chip(d.date);
          return e && !e.cancelled ? `${e.confirmed}/${e.required}` : "";
        })),
      );
    });
  }
  rows.push(row(["", "", "", "欠員"], days.map((d) => (d.shortage > 0 ? String(d.shortage) : ""))));

  // 下の段: スタッフごとに「単価 / 場所 / シフト」の3行（今のシートと同じ並び。名前は1行目、単価は書かない）
  for (const s of board.staff) {
    rows.push(
      row([s.rankName ?? "", s.name, s.station, "単価"], days.map(() => ""), String(s.workedDays)),
      row(
        ["", "", "", "場所"],
        days.map((d) =>
          s.cells[d.date].assignments
            .filter((a) => a.status === "confirmed")
            .map((a) => a.venueName)
            .join(" / "),
        ),
      ),
      row(["", "", "", "シフト"], days.map((d) => (s.cells[d.date].availability ? SHIFT[s.cells[d.date].availability!] : ""))),
    );
  }
  return rows;
}
