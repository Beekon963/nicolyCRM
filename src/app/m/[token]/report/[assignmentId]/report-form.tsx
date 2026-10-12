"use client";

import { ChevronDownIcon, ClipboardPasteIcon, SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CountStepper } from "@/components/app/count-stepper";
import { type ConverterFormat, type ConverterResult, notesText, ReportConverter } from "@/components/app/report-converter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { matchPerson, type NameDict, normalizeName } from "@/lib/report-convert";
import { saveReport } from "../../actions";

type Item = { item_id: string; name: string; reported: number | null; confirmed: number | null };
type Expense = { amount: number; memo: string; status: "pending" | "approved" | "rejected" };

export function ReportForm({
  token,
  assignmentId,
  items,
  comment,
  expenses,
  transportIncluded = false,
  editable,
  converter,
}: {
  token: string;
  assignmentId: string;
  items: Item[];
  comment: string;
  expenses: { transport?: Expense; other?: Expense };
  /** 日当は交通費込み: 交通費の欄を出さない（前に出した交通費があれば、見るだけで出す） */
  transportIncluded?: boolean;
  editable: boolean;
  /** LINE に書いた報告を貼って件数を入れる（Phase 9）。書式があれば、取引先の形に直した文も出す */
  converter?: {
    dict: NameDict;
    formats: ConverterFormat[];
    defaults: { date: string; weekday: string; venue: string; workers: string[]; clientName: string };
    myName: string;
  };
}) {
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, number>>(Object.fromEntries(items.map((i) => [i.item_id, i.reported ?? 0])));
  const [text, setText] = useState(comment);
  const [transport, setTransport] = useState({ amount: expenses.transport?.amount ? String(expenses.transport.amount) : "", memo: expenses.transport?.memo ?? "" });
  const [other, setOther] = useState({ amount: expenses.other?.amount ? String(expenses.other.amount) : "", memo: expenses.other?.memo ?? "" });
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty);
  const touch = () => setDirty(true);
  const locked = (e?: Expense) => !editable || (e != null && e.status !== "pending");
  const yen = (v: string) => v.replace(/[^0-9]/g, "");
  const many = items.length > 12;
  const [query, setQuery] = useState("");
  // 開いたときに件数が入っていた項目を上に（入れている途中で並びが変わらないよう、最初の件数で決める）
  const [pinned] = useState(() => new Set(items.filter((i) => (i.reported ?? 0) > 0).map((i) => i.item_id)));
  const q = normalizeName(query);
  const [pasteOpen, setPasteOpen] = useState(false);

  /** 貼った報告のうち本人の分（名前のない行・本人の名前の行）の件数を入れる。メモと所感はコメントに */
  function apply(r: ConverterResult, mine: ConverterResult["rows"]) {
    const idByName = new Map(items.map((i) => [i.name, i.item_id]));
    const next: Record<string, number> = Object.fromEntries(items.map((i) => [i.item_id, 0]));
    for (const row of mine) {
      const id = row.name ? idByName.get(row.name) : undefined;
      if (id) next[id] += row.count;
    }
    setCounts(next);
    const memo = [r.parsed.comment, notesText(mine)].filter(Boolean).join("\n");
    if (memo && !text.includes(memo)) setText(text.trim() ? `${text.trim()}\n${memo}` : memo);
    touch();
    setPasteOpen(false);
    toast.success("件数を入れました。確かめて「送信する」を押してください");
  }

  const shown = (many ? [...items.filter((i) => pinned.has(i.item_id)), ...items.filter((i) => !pinned.has(i.item_id))] : items).filter(
    (i) => !q || normalizeName(i.name).includes(q) || (counts[i.item_id] ?? 0) > 0,
  );

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveReport(token, assignmentId, {
            items: items.map((i) => ({ item_id: i.item_id, count: counts[i.item_id] ?? 0 })),
            comment: text,
            transportAmount: Number(transport.amount || 0),
            transportMemo: transport.memo,
            otherAmount: Number(other.amount || 0),
            otherMemo: other.memo,
          });
          if (!r.ok) return void toast.error(r.message);
          toast.success(r.message);
          setDirty(false);
          router.push(`/m/${token}/report`);
        });
      }}
    >
      {editable && converter && (
        <details className="group rounded-lg border" open={pasteOpen} onToggle={(e) => setPasteOpen(e.currentTarget.open)}>
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 font-medium">
            <span className="flex items-center gap-2">
              <ClipboardPasteIcon aria-hidden className="size-5 text-primary" />
              LINE に書いた報告から入れる
            </span>
            <ChevronDownIcon className="size-5 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t p-3">
            <ReportConverter
              dict={converter.dict}
              formats={converter.formats}
              defaults={converter.defaults}
              showOutput={converter.formats.length > 0}
              footer={(r) => {
                const mine = r.rows.filter((row) => !row.person || matchPerson(row.person, [converter.myName]) != null);
                return (
                  <div className="flex flex-col gap-2 rounded-xl border p-3">
                    <p className="font-semibold">あなたの分</p>
                    <p className="text-sm break-words">{mine.length ? mine.map((row) => `${row.name ?? row.raw} ${row.count}`).join("・") : "あなたの名前の行がありません"}</p>
                    {r.unresolved > 0 && <p className="text-sm text-status-alert">「選んでください」の項目を選んでから入れてください。</p>}
                    <Button type="button" className="self-start" disabled={r.unresolved > 0 || mine.length === 0} onClick={() => apply(r, mine)}>
                      この件数を報告に入れる
                    </Button>
                  </div>
                );
              }}
            />
          </div>
        </details>
      )}

      <fieldset className="flex flex-col gap-3" disabled={!editable}>
        <legend className="mb-1 text-lg font-bold">獲得件数</legend>
        {/* 項目が多い取引先（公認名称が40以上など）は、さがして入れられるようにする。入れてある項目は上に */}
        {many && (
          <div className="relative">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="項目をさがす" placeholder={`項目をさがす（${items.length}項目）`} className="pl-10" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        )}
        {shown.length === 0 && <p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground">「{query}」の項目はありません</p>}
        {shown.map((i) => (
          <div key={i.item_id} className="flex items-center justify-between gap-2 rounded-lg border p-3">
            <span className="text-base font-medium">{i.name}</span>
            <CountStepper
              size="lg"
              label={i.name}
              value={counts[i.item_id] ?? 0}
              onChange={(n) => {
                setCounts({ ...counts, [i.item_id]: n });
                touch();
              }}
            />
          </div>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1">
        <Label htmlFor="comment">一言コメント（任意）</Label>
        <Textarea id="comment" rows={2} disabled={!editable} placeholder="例: 午後から好調でした" value={text} onChange={(e) => (setText(e.target.value), touch())} />
      </div>

      {transportIncluded && !expenses.transport ? (
        <p className="rounded-lg bg-muted p-3 text-sm">日当は交通費込みです（交通費の申請はありません）。</p>
      ) : (
      <fieldset className="flex flex-col gap-2 rounded-lg border p-3" disabled={transportIncluded || locked(expenses.transport)}>
        <legend className="px-1 font-bold">交通費</legend>
        {transportIncluded && <p className="text-sm text-muted-foreground">日当は交通費込みになったため、変更できません</p>}
        {expenses.transport && expenses.transport.status !== "pending" && (
          <p className="text-sm text-muted-foreground">{expenses.transport.status === "approved" ? "承認済み" : "却下"}のため変更できません</p>
        )}
        <div className="flex items-center gap-2">
          <Input aria-label="交通費の金額" inputMode="numeric" className="text-lg" placeholder="0" value={transport.amount} onChange={(e) => (setTransport({ ...transport, amount: yen(e.target.value) }), touch())} />
          円
        </div>
        <Input aria-label="交通費の区間" placeholder="区間（例: 大宮〜浦和 往復）" value={transport.memo} onChange={(e) => (setTransport({ ...transport, memo: e.target.value }), touch())} />
      </fieldset>
      )}

      <details className="group rounded-lg border" open={Boolean(expenses.other)}>
        <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-3 font-medium">
          その他の経費（任意）
          <ChevronDownIcon className="size-5 transition-transform group-open:rotate-180" />
        </summary>
        <fieldset className="flex flex-col gap-2 border-t p-3" disabled={locked(expenses.other)}>
          <div className="flex items-center gap-2">
            <Input aria-label="その他の経費の金額" inputMode="numeric" placeholder="0" value={other.amount} onChange={(e) => (setOther({ ...other, amount: yen(e.target.value) }), touch())} />
            円
          </div>
          <Input aria-label="その他の経費の内容" placeholder="内容（例: 駐車場代）" value={other.memo} onChange={(e) => (setOther({ ...other, memo: e.target.value }), touch())} />
        </fieldset>
      </details>

      {editable && (
        <div className="sticky bottom-20 z-20">
          <Button type="submit" size="lg" className="h-14 w-full text-lg shadow" disabled={pending}>
            {pending ? "送信中…" : "送信する"}
          </Button>
        </div>
      )}
    </form>
  );
}
