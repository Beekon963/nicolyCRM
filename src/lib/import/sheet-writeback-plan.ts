/**
 * 書き戻し（Phase 19）の、DB も Google も使わない計算。
 * CRM の今の状態（だれのその日はどの会場、取引先のその日はどの現場が何人、○△×）と、
 * シートのタブの中身を比べて、書き直すマスを決める。
 *
 * 守ること:
 * - 同じなら書かない（シートから読んだ分は、もう同じなので何もしない）
 * - 単価の行には触らない
 * - シートの書き方が CRM の会場と合わないマス（合わない名前）は消さない・上書きしない
 * - ○△× は消さない（CRM で消しても、シートの印はそのまま。消すのはシートで）
 * - 行は足さない（ない人・ない取引先は「行がありません」）
 */
import { companyKey, searchNorm } from "@/lib/search";
import { venueKey } from "./line-plan";
import { parseShift, type SheetLayout, type SheetShift } from "./month-sheet";

export type ShiftSymbols = { ok: string; maybe: string; ng: string };
export const DEFAULT_SYMBOLS: ShiftSymbols = { ok: "⭕️", maybe: "🔺", ng: "❌" };

/** シートで使っている ○△× の書き方（いちばん多いもの。なければ ⭕️🔺❌） */
export function detectSymbols(rows: string[][], lay: SheetLayout): ShiftSymbols {
  const counts: Record<SheetShift, Map<string, number>> = { ok: new Map(), maybe: new Map(), ng: new Map() };
  for (const b of lay.staffBlocks) {
    for (const { col } of lay.dayCols) {
      const raw = (rows[b.shiftRow]?.[col] ?? "").trim();
      const st = parseShift(raw);
      if (st) counts[st].set(raw, (counts[st].get(raw) ?? 0) + 1);
    }
  }
  const top = (st: SheetShift) => [...counts[st].entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? DEFAULT_SYMBOLS[st];
  return { ok: top("ok"), maybe: top("maybe"), ng: top("ng") };
}

export type CellWrite = { row: number; col: number; value: string };

export type WriteItem =
  | { id: number; kind: "staff_day"; date: string; staffNames: string[]; venues: string[] }
  | { id: number; kind: "availability"; date: string; staffNames: string[]; status: SheetShift | null }
  | { id: number; kind: "client_day"; date: string; clientNames: string[]; events: { venue: string; required: number }[] };

export type ItemResult = { id: number; status: "done" | "skipped" | "failed"; message: string };
export type PlanResult = { writes: CellWrite[]; results: ItemResult[] };

const staffKey = (s: string) => searchNorm(s);

export function planCellWrites(rows: string[][], lay: SheetLayout, items: WriteItem[], opts: { symbols: ShiftSymbols; knownVenueKeys: Set<string> }): PlanResult {
  const writes = new Map<string, CellWrite>();
  const results: ItemResult[] = [];
  const put = (row: number, col: number, value: string) => writes.set(`${row}:${col}`, { row, col, value });
  const current = (row: number, col: number) => (rows[row]?.[col] ?? "").trim();
  const colOf = (date: string) => lay.dayCols.find((d) => d.day === Number(date.slice(8)))?.col;
  const known = (text: string) => opts.knownVenueKeys.has(venueKey(text));
  const same = (a: string, b: string) => venueKey(a) === venueKey(b);
  const md = (date: string) => date.slice(5).replace("-", "/");

  for (const it of items) {
    const col = colOf(it.date);
    if (col == null) {
      results.push({ id: it.id, status: "failed", message: `${md(it.date)}: シートにその日の列がありません` });
      continue;
    }

    if (it.kind === "staff_day" || it.kind === "availability") {
      const keys = it.staffNames.map(staffKey).filter(Boolean);
      const block = lay.staffBlocks.find((b) => b.name && keys.includes(staffKey(b.name)));
      const who = it.staffNames[0] ?? "";
      if (!block) {
        results.push({ id: it.id, status: "failed", message: `${who} ${md(it.date)}: シートに${who}さんの行がありません（行を足すと次から書けます）` });
        continue;
      }
      if (it.kind === "staff_day") {
        const cur = current(block.placeRow, col);
        const want = it.venues.join("・");
        if (!it.venues.length) {
          if (!cur) results.push({ id: it.id, status: "done", message: `${who} ${md(it.date)}: 変更なし` });
          else if (!known(cur)) results.push({ id: it.id, status: "skipped", message: `${who} ${md(it.date)}: シートの「${cur}」は CRM の会場と合わないので触りません` });
          else {
            put(block.placeRow, col, "");
            results.push({ id: it.id, status: "done", message: `${who} ${md(it.date)}: 場所「${cur}」を消しました` });
          }
          continue;
        }
        if (cur && it.venues.some((v) => same(v, cur))) {
          results.push({ id: it.id, status: "done", message: `${who} ${md(it.date)}: 変更なし（${cur}）` });
          continue;
        }
        if (cur && !known(cur)) {
          results.push({ id: it.id, status: "skipped", message: `${who} ${md(it.date)}: シートの「${cur}」は CRM の会場と合わないので触りません` });
          continue;
        }
        put(block.placeRow, col, want);
        results.push({ id: it.id, status: "done", message: `${who} ${md(it.date)}: 場所に「${want}」を書きました` });
        continue;
      }
      // availability
      const curRaw = current(block.shiftRow, col);
      const cur = parseShift(curRaw);
      if (!it.status) {
        results.push({ id: it.id, status: cur ? "skipped" : "done", message: cur ? `${who} ${md(it.date)}: CRM に○△×がないので、シートの「${curRaw}」はそのままにします` : `${who} ${md(it.date)}: 変更なし` });
        continue;
      }
      if (cur === it.status) {
        results.push({ id: it.id, status: "done", message: `${who} ${md(it.date)}: 変更なし（${curRaw}）` });
        continue;
      }
      if (curRaw && !cur) {
        results.push({ id: it.id, status: "skipped", message: `${who} ${md(it.date)}: シートの「${curRaw}」は○△×として読めないので触りません` });
        continue;
      }
      const sym = opts.symbols[it.status];
      put(block.shiftRow, col, sym);
      results.push({ id: it.id, status: "done", message: `${who} ${md(it.date)}: シフトに「${sym}」を書きました` });
      continue;
    }

    // client_day
    const ckeys = it.clientNames.map(companyKey).filter(Boolean);
    const blocks = lay.clientBlocks.filter((b) => b.name && ckeys.includes(companyKey(b.name)));
    const client = it.clientNames[0] ?? "";
    if (!blocks.length) {
      results.push({ id: it.id, status: "failed", message: `${client} ${md(it.date)}: シートに取引先「${client}」の行がありません（行を足すと次から書けます）` });
      continue;
    }
    const cells = blocks.map((b) => ({ b, venue: current(b.venueRow, col), count: current(b.countRow, col), used: false }));
    const wanted = it.events.filter((e) => e.venue);
    const pending: typeof wanted = [];
    const notes: string[] = [];
    // 1. もうその現場が書いてある枠はそのまま（人数だけ合わせる）
    for (const e of wanted) {
      const hit = cells.find((c) => !c.used && c.venue && same(c.venue, e.venue));
      if (!hit) {
        pending.push(e);
        continue;
      }
      hit.used = true;
      if (e.required > 0 && Number.parseInt(hit.count.normalize("NFKC"), 10) !== e.required) {
        put(hit.b.countRow, col, String(e.required));
        notes.push(`「${hit.venue}」の人数を ${e.required} に`);
      }
    }
    // 2. 空いている枠（空欄か、CRM にもうない会場）に入れる
    for (const e of pending) {
      const free = cells.find((c) => !c.used && (!c.venue || (known(c.venue) && !wanted.some((w) => same(w.venue, c.venue)))));
      if (!free) {
        results.push({ id: it.id, status: "failed", message: `${client} ${md(it.date)}: 「${e.venue}」を書く枠がありません（シートに${client}の行をもう1組足してください）` });
        continue;
      }
      free.used = true;
      put(free.b.venueRow, col, e.venue);
      if (e.required > 0) put(free.b.countRow, col, String(e.required));
      notes.push(`現場に「${e.venue}」${e.required > 0 ? `（${e.required}人）` : ""}を書きました`);
    }
    // 3. CRM にない現場が書いてある枠（CRM の会場と合うものだけ）は消す
    for (const c of cells) {
      if (c.used || !c.venue) continue;
      if (!known(c.venue)) {
        notes.push(`シートの「${c.venue}」は CRM の会場と合わないので触りません`);
        continue;
      }
      put(c.b.venueRow, col, "");
      put(c.b.countRow, col, "");
      notes.push(`現場「${c.venue}」を消しました`);
    }
    if (!results.some((r) => r.id === it.id)) results.push({ id: it.id, status: "done", message: `${client} ${md(it.date)}: ${notes.length ? notes.join("、") : "変更なし"}` });
  }
  return { writes: [...writes.values()], results };
}
