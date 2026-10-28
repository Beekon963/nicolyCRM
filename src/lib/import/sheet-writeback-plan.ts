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
 * - ⭐️（確定の印）: CRM で確定したら「場所」と一緒にシフトに ⭐️ を書く（空欄か ○△× のときだけ）。確定が外れたら ⭐️ を ⭕️ に戻す。
 *   ○△× の書き戻しでは ⭐️ を上書きしない
 * - 行は設定（行がない人・取引先は行を足す。Phase 20）がオンのときだけ足す。足す位置と書くマスは planNewBlock で決める
 */
import { companyKey, searchNorm } from "@/lib/search";
import { venueKey } from "./line-plan";
import { isConfirmedMark, parseShift, type SheetLayout, type SheetShift } from "./month-sheet";

/** シフトの印の書き方（ok/maybe/ng = ○△×、confirmed = 確定した日の ⭐️） */
export type ShiftSymbols = { ok: string; maybe: string; ng: string; confirmed: string };
export const DEFAULT_SYMBOLS: ShiftSymbols = { ok: "⭕️", maybe: "🔺", ng: "❌", confirmed: "⭐️" };

/** シートで使っている ○△×⭐️ の書き方（いちばん多いもの。なければ ⭕️🔺❌⭐️） */
export function detectSymbols(rows: string[][], lay: SheetLayout): ShiftSymbols {
  const counts: Record<keyof ShiftSymbols, Map<string, number>> = { ok: new Map(), maybe: new Map(), ng: new Map(), confirmed: new Map() };
  for (const b of lay.staffBlocks) {
    for (const { col } of lay.dayCols) {
      const raw = (rows[b.shiftRow]?.[col] ?? "").trim();
      const st: keyof ShiftSymbols | null = isConfirmedMark(raw) ? "confirmed" : parseShift(raw);
      if (st) counts[st].set(raw, (counts[st].get(raw) ?? 0) + 1);
    }
  }
  const top = (st: keyof ShiftSymbols) => [...counts[st].entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? DEFAULT_SYMBOLS[st];
  return { ok: top("ok"), maybe: top("maybe"), ng: top("ng"), confirmed: top("confirmed") };
}

export type CellWrite = { row: number; col: number; value: string };

export type WriteItem =
  | { id: number; kind: "staff_day"; date: string; staffNames: string[]; venues: string[] }
  | { id: number; kind: "availability"; date: string; staffNames: string[]; status: SheetShift | null }
  | { id: number; kind: "client_day"; date: string; clientNames: string[]; events: { venue: string; required: number }[] };

export type ItemResult = { id: number; status: "done" | "skipped" | "failed"; message: string };
export type PlanResult = { writes: CellWrite[]; results: ItemResult[] };

const staffKey = (s: string) => searchNorm(s);

/** 下の段で、名前（CRM の名前・覚えた書き方のどれか）が合う組 */
export function findStaffBlock(lay: SheetLayout, names: string[]): SheetLayout["staffBlocks"][number] | null {
  const keys = names.map(staffKey).filter(Boolean);
  return lay.staffBlocks.find((b) => b.name && keys.includes(staffKey(b.name))) ?? null;
}

/** 上の段で、取引先名が合う組（同じ取引先が何組もあることがある） */
export function findClientBlocks(lay: SheetLayout, names: string[]): SheetLayout["clientBlocks"] {
  const ckeys = names.map(companyKey).filter(Boolean);
  return lay.clientBlocks.filter((b) => b.name && ckeys.includes(companyKey(b.name)));
}

export type NewBlockItem = { kind: "staff"; name: string; rank: string; station: string } | { kind: "client"; name: string };

export type NewBlock = {
  /** 足す3行の最初の行（0 始まり。この位置に入れる） */
  at: number;
  /** 見た目と計算式の手本（その段のいちばん下の組の最初の行） */
  templateRow: number;
  /** 見出し（単価 / 場所 / シフト など）と名前のマス。足したあとに書く（行の番号は足したあとのもの） */
  cells: CellWrite[];
};

/**
 * 足す組の位置と、名前・見出しのマス（Phase 20）。その段のいちばん下の組のすぐ下に足す。
 * その段に1組もないときは足せない（null）。日付のマス・単価の行は空のまま
 */
export function planNewBlock(rows: string[][], lay: SheetLayout, item: NewBlockItem): NewBlock | null {
  if (item.kind === "staff") {
    const last = lay.staffBlocks.at(-1);
    if (!last) return null;
    const at = last.shiftRow + 1;
    const cells: CellWrite[] = [
      { row: at, col: lay.labelCol, value: "単価" },
      { row: at + 1, col: lay.labelCol, value: "場所" },
      { row: at + 2, col: lay.labelCol, value: "シフト" },
      { row: at, col: lay.nameCol, value: item.name },
    ];
    if (item.rank && lay.rankCol !== lay.nameCol) cells.push({ row: at, col: lay.rankCol, value: item.rank });
    if (item.station && lay.stationCol !== lay.nameCol) cells.push({ row: at, col: lay.stationCol, value: item.station });
    return { at, templateRow: last.rateRow, cells };
  }
  const last = lay.clientBlocks.at(-1);
  if (!last) return null;
  const at = last.countRow + 1;
  // 取引先名の列: 名前が書いてある組の、単価の行で最初に文字があるマスの列（なければ左端）
  let nameCol = 0;
  for (const b of lay.clientBlocks) {
    const i = (rows[b.rateRow] ?? []).slice(0, lay.labelCol).findIndex((c) => c.trim());
    if (i >= 0) nameCol = i;
  }
  return {
    at,
    templateRow: last.rateRow,
    cells: [
      { row: at, col: lay.labelCol, value: "単価" },
      { row: at + 1, col: lay.labelCol, value: "現場" },
      { row: at + 2, col: lay.labelCol, value: "人数" },
      { row: at, col: nameCol, value: item.name },
    ],
  };
}

/**
 * 計算式の中の「E7」「E7:AI7」のような番地の行を delta だけずらす（$7 のように固定した行はそのまま。文字列の中は触らない）。
 * 手本の組の計算式を足した組に写すときに使う
 */
export function shiftFormulaRows(formula: string, delta: number): string {
  if (!formula.startsWith("=") || !delta) return formula;
  return formula.replace(/("[^"]*")|(?<![A-Za-z_\d])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, str: string | undefined, cAbs: string, col: string, rAbs: string, row: string) => {
    if (str) return str;
    if (rAbs) return m;
    const n = Number(row) + delta;
    return n > 0 ? `${cAbs}${col}${n}` : m;
  });
}

/** 手本の組（3行）の計算式を、足した組に写すマス（日付の列は写さない。計算式でないマスも写さない） */
export function copiedFormulas(template: string[][], lay: SheetLayout, templateRow: number, at: number): CellWrite[] {
  const dayCols = new Set(lay.dayCols.map((d) => d.col));
  const out: CellWrite[] = [];
  template.forEach((r, i) =>
    r.forEach((v, col) => {
      if (!v.startsWith("=") || dayCols.has(col) || col === lay.labelCol) return;
      out.push({ row: at + i, col, value: shiftFormulaRows(v, at - templateRow) });
    }),
  );
  return out;
}

export function planCellWrites(rows: string[][], lay: SheetLayout, items: WriteItem[], opts: { symbols: ShiftSymbols; knownVenueKeys: Set<string> }): PlanResult {
  const writes = new Map<string, CellWrite>();
  const results: ItemResult[] = [];
  const put = (row: number, col: number, value: string) => writes.set(`${row}:${col}`, { row, col, value });
  /** マスの今の中身（この計画でもう書くことにしたものがあればそれ） */
  const current = (row: number, col: number) => writes.get(`${row}:${col}`)?.value ?? (rows[row]?.[col] ?? "").trim();
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
      const block = findStaffBlock(lay, it.staffNames);
      const who = it.staffNames[0] ?? "";
      if (!block) {
        results.push({ id: it.id, status: "failed", message: `${who} ${md(it.date)}: シートに${who}さんの行がありません（「行を足す」をオンにすると自動で足します）` });
        continue;
      }
      if (it.kind === "staff_day") {
        const cur = current(block.placeRow, col);
        const want = it.venues.join("・");
        const notes: string[] = [];
        let status: ItemResult["status"] = "done";
        if (!it.venues.length) {
          if (cur && !known(cur)) {
            status = "skipped";
            notes.push(`シートの「${cur}」は CRM の会場と合わないので触りません`);
          } else if (cur) {
            put(block.placeRow, col, "");
            notes.push(`場所「${cur}」を消しました`);
          }
        } else if (cur && it.venues.some((v) => same(v, cur))) {
          // 場所はもう書いてある
        } else if (cur && !known(cur)) {
          status = "skipped";
          notes.push(`シートの「${cur}」は CRM の会場と合わないので触りません`);
        } else {
          put(block.placeRow, col, want);
          notes.push(`場所に「${want}」を書きました`);
        }
        // シフトの印: 確定なら ⭐️（空欄か ○△× のときだけ書く。読めない印は触らない）、確定が外れたら ⭐️ → ⭕️（出られる日だったので）
        if (status !== "skipped") {
          const shiftRaw = current(block.shiftRow, col);
          if (it.venues.length) {
            if (!isConfirmedMark(shiftRaw) && (!shiftRaw || parseShift(shiftRaw))) {
              put(block.shiftRow, col, opts.symbols.confirmed);
              notes.push(`シフトに「${opts.symbols.confirmed}」を書きました`);
            }
          } else if (isConfirmedMark(shiftRaw)) {
            put(block.shiftRow, col, opts.symbols.ok);
            notes.push(`シフトの「${shiftRaw}」を「${opts.symbols.ok}」に戻しました`);
          }
        }
        results.push({ id: it.id, status, message: `${who} ${md(it.date)}: ${notes.length ? notes.join("、") : `変更なし${cur ? `（${cur}）` : ""}`}` });
        continue;
      }
      // availability
      const curRaw = current(block.shiftRow, col);
      if (isConfirmedMark(curRaw) && it.status && it.status !== "ok") {
        results.push({ id: it.id, status: "skipped", message: `${who} ${md(it.date)}: シートの「${curRaw}」は確定の印なので触りません` });
        continue;
      }
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
    const blocks = findClientBlocks(lay, it.clientNames);
    const client = it.clientNames[0] ?? "";
    if (!blocks.length) {
      results.push({ id: it.id, status: "failed", message: `${client} ${md(it.date)}: シートに取引先「${client}」の行がありません（「行を足す」をオンにすると自動で足します）` });
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
