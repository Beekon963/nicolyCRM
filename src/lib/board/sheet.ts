/**
 * 稼働表を、今の月のスプレッドシートと同じ並びの表（行 × 列の文字）にする（Phase 1.5 の書き出し）。
 * - 1行目: 日付、2行目: ランク / 名前 / 最寄り駅 / 曜日
 * - 上の段: 取引先ごと・会場ごとに「現場 / 人数（確定/必要）」、その下に「欠員」
 * - 下の段: スタッフごとに「場所（確定した現場）/ シフト（⭕️🔺❌）」、右端に稼働日数
 * 金額（単価・売上など）は書き出さない（共有するシートのため）。
 */
import type { Board } from "./index";

const SHIFT: Record<string, string> = { ok: "⭕️", maybe: "🔺", ng: "❌" };

/** シートのタブ名（今のシートと同じ 202611 の形） */
export function sheetTitle(month: string) {
  return month.replace("-", "");
}

export function boardToSheetValues(board: Board, updatedAt: string): string[][] {
  const days = board.days;
  const m = Number(board.month.slice(5));
  const row = (head: [string, string, string, string], cells: string[], tail = "") => [...head, ...cells, tail];

  const rows: string[][] = [
    row([`最終更新 ${updatedAt}（CRM から自動。ここで直しても CRM には戻りません）`, "", "", "日付"], days.map((d) => `${m}/${d.day}`), "稼働日数"),
    row(["ランク", "名前", "最寄り駅", "曜日"], days.map((d) => (d.holiday ? `${d.weekday}・祝` : d.weekday))),
  ];

  // 上の段: 取引先ごと、会場ごとに2行
  for (const c of board.clients) {
    const venues = [...new Set(days.flatMap((d) => (c.cells[d.date] ?? []).map((e) => e.venueName)))];
    venues.forEach((venue, i) => {
      const chip = (date: string) => (c.cells[date] ?? []).find((e) => e.venueName === venue);
      rows.push(
        row([i === 0 ? c.name : "", "", "", "現場"], days.map((d) => (chip(d.date) ? (chip(d.date)!.cancelled ? `${venue}（中止）` : venue) : ""))),
        row(["", "", "", "人数"], days.map((d) => {
          const e = chip(d.date);
          return e && !e.cancelled ? `${e.confirmed}/${e.required}` : "";
        })),
      );
    });
  }
  rows.push(row(["", "", "", "欠員"], days.map((d) => (d.shortage > 0 ? String(d.shortage) : ""))));

  // 下の段: スタッフごとに2行
  for (const s of board.staff) {
    rows.push(
      row(
        [s.rankName ?? "", s.name, s.station, "場所"],
        days.map((d) =>
          s.cells[d.date].assignments
            .filter((a) => a.status === "confirmed")
            .map((a) => a.venueName)
            .join(" / "),
        ),
        String(s.workedDays),
      ),
      row(["", "", "", "シフト"], days.map((d) => (s.cells[d.date].availability ? SHIFT[s.cells[d.date].availability!] : ""))),
    );
  }
  return rows;
}
