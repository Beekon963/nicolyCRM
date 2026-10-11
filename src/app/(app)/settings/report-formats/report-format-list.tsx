"use client";

import { PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { REPORT_BLOCK_LABEL, REPORT_VARIABLES, renderReport, type ReportDay, type ReportFormatBlocks, SAMPLE_DAY } from "@/lib/report-format";
import { cn } from "@/lib/utils";
import { saveReportFormat } from "./actions";

export type FormatRow = ReportFormatBlocks & { id: string | null; name: string; companyId: string | null; forStaff: boolean; isActive: boolean };

const BLOCKS = ["header", "eventBlock", "personBlock", "footer"] as const;

/** 見本の値（獲得項目は実際の名前で、件数は 3, 1, 0, …） */
function sampleDay(itemNames: string[]): ReportDay {
  if (!itemNames.length) return SAMPLE_DAY;
  const counts = (seed: number) => itemNames.map((name, i) => ({ name, count: Math.max(0, seed - i * 2) }));
  return {
    ...SAMPLE_DAY,
    events: SAMPLE_DAY.events.map((e) => ({ ...e, people: e.people.map((p, k) => ({ ...p, items: counts(k === 0 ? 3 : 1) })) })),
  };
}

export function ReportFormatList({ formats, clients, itemNames }: { formats: FormatRow[]; clients: { id: string; name: string }[]; itemNames: string[] }) {
  const [drafts, setDrafts] = useState<FormatRow[]>([]);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  useUnsavedChanges(dirtyIds.size > 0);
  const setDirty = (key: string, dirty: boolean) =>
    setDirtyIds((prev) => {
      const next = new Set(prev);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  const base = formats.find((f) => f.companyId == null) ?? formats[0];

  return (
    <div className="flex flex-col gap-4 px-4 pb-8">
      {formats.length === 0 && drafts.length === 0 && (
        <p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground">フォーマットがありません。下の「新しいフォーマットを作る」から作ってください。</p>
      )}
      {formats.map((f) => (
        <FormatEditor key={f.id} initial={f} clients={clients} itemNames={itemNames} onDirty={(d) => setDirty(f.id!, d)} />
      ))}
      {drafts.map((f, i) => (
        <FormatEditor
          key={`draft-${i}`}
          initial={f}
          clients={clients}
          itemNames={itemNames}
          open
          onDirty={(d) => setDirty(`draft-${i}`, d)}
          onCreated={() => {
            setDirty(`draft-${i}`, false);
            setDrafts((ds) => ds.filter((_, k) => k !== i));
          }}
        />
      ))}
      <Button
        variant="outline"
        className="self-start"
        onClick={() =>
          setDrafts((ds) => [
            ...ds,
            {
              id: null,
              name: "",
              companyId: null,
              forStaff: true,
              isActive: true,
              header: base?.header ?? "【日報】{日付}（{曜日}）{取引先}",
              eventBlock: base?.eventBlock ?? "■{会場}",
              personBlock: base?.personBlock ?? "{名前}（{役割}）\n{件数一覧}\n{コメント}",
              footer: base?.footer ?? "",
            },
          ])
        }
      >
        <PlusIcon />
        新しいフォーマットを作る
      </Button>
    </div>
  );
}

function FormatEditor({
  initial,
  clients,
  itemNames,
  open = false,
  onDirty,
  onCreated,
}: {
  initial: FormatRow;
  clients: { id: string; name: string }[];
  itemNames: string[];
  open?: boolean;
  onDirty: (dirty: boolean) => void;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [focus, setFocus] = useState<(typeof BLOCKS)[number]>("personBlock");
  const [pending, start] = useTransition();
  const refs = useRef<Partial<Record<(typeof BLOCKS)[number], HTMLTextAreaElement | null>>>({});
  const dirty = JSON.stringify(f) !== JSON.stringify(saved);

  const update = (next: FormatRow) => {
    setF(next);
    onDirty(JSON.stringify(next) !== JSON.stringify(saved));
  };

  function insert(block: (typeof BLOCKS)[number], v: string) {
    const el = refs.current[block];
    const token = `{${v}}`;
    const body = f[block];
    if (!el) return update({ ...f, [block]: body + token });
    const { selectionStart: s, selectionEnd: e } = el;
    update({ ...f, [block]: body.slice(0, s) + token + body.slice(e) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  }

  const clientName = clients.find((c) => c.id === f.companyId)?.name;
  const preview = renderReport(f, { ...sampleDay(itemNames), clientName: clientName ?? SAMPLE_DAY.clientName });
  const save = () =>
    start(async () => {
      const r = await saveReportFormat(f.id, f);
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      setSaved(f);
      onDirty(false);
      if (!f.id) onCreated?.();
      router.refresh();
    });

  return (
    <details open={open} className={cn("group rounded-lg border", !f.isActive && "opacity-70")}>
      <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <span className="font-bold">{f.name || "（名前のないフォーマット）"}</span>
        <span className="text-sm text-muted-foreground">
          {clientName ?? "すべての取引先"}
          {f.forStaff && " ・ マイページにも出す"}
          {!f.isActive && " ・ 使っていない"}
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`fmt-name-${f.id ?? "new"}`}>名前</Label>
            <Input id={`fmt-name-${f.id ?? "new"}`} placeholder="例: NextWave用" value={f.name} onChange={(e) => update({ ...f, name: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`fmt-client-${f.id ?? "new"}`}>使う取引先</Label>
            <NativeSelect id={`fmt-client-${f.id ?? "new"}`} value={f.companyId ?? ""} onChange={(e) => update({ ...f, companyId: e.target.value || null })}>
              <option value="">すべての取引先</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <label className="flex min-h-11 items-center gap-3">
            <Switch checked={f.forStaff} onCheckedChange={(v) => update({ ...f, forStaff: v })} aria-label="スタッフのマイページにも出す" />
            スタッフのマイページにも出す（報告のあと「LINE用にコピー」）
          </label>
          <label className="flex min-h-11 items-center gap-3">
            <Switch checked={f.isActive} onCheckedChange={(v) => update({ ...f, isActive: v })} aria-label="このフォーマットを使う" />
            このフォーマットを使う
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            {BLOCKS.map((b) => (
              <div key={b} className="flex flex-col gap-1">
                <Label htmlFor={`fmt-${b}-${f.id ?? "new"}`}>{REPORT_BLOCK_LABEL[b].label}</Label>
                <p className="-mt-1 text-sm text-muted-foreground">{REPORT_BLOCK_LABEL[b].hint}</p>
                <Textarea
                  id={`fmt-${b}-${f.id ?? "new"}`}
                  ref={(el) => {
                    refs.current[b] = el;
                  }}
                  rows={b === "personBlock" ? 4 : 2}
                  value={f[b]}
                  onFocus={() => setFocus(b)}
                  onChange={(e) => update({ ...f, [b]: e.target.value })}
                />
                {focus === b && (
                  <div className="flex flex-wrap gap-1">
                    {[...REPORT_VARIABLES[b], ...itemNames.map((n) => `件数:${n}`)].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => insert(b, v)}
                        className="h-9 rounded-full border px-3 text-sm text-muted-foreground hover:bg-accent"
                      >
                        {`{${v}}`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-muted-foreground">プレビュー（見本の値。1現場・2人）</p>
            <pre className="min-h-40 rounded-md bg-[#8cabd8]/20 p-3 font-sans text-base whitespace-pre-wrap">{preview || "（文面がありません）"}</pre>
            <Button className="self-end" disabled={!dirty || pending} onClick={save}>
              {pending ? "保存中…" : f.id ? "保存する" : "このフォーマットを作る"}
            </Button>
          </div>
        </div>
      </div>
    </details>
  );
}
