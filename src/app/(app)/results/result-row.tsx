"use client";

import { HistoryIcon } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { CountStepper } from "@/components/app/count-stepper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toaster";
import { DIFF_REASON, INPUT_SOURCE } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { confirmEventAsReported, confirmResult, getReportHistory } from "./actions";

export type ResultItem = { item_id: string; name: string; reported: number | null; confirmed: number | null; reason: keyof typeof DIFF_REASON | null; note: string };

export type ResultAssignment = {
  id: string;
  staffId: string;
  name: string;
  role: string;
  submitted: boolean;
  confirmed: boolean;
  source: "self" | "admin" | null;
  comment: string;
  items: ResultItem[];
};

type History = Awaited<ReturnType<typeof getReportHistory>>;

export function ConfirmEventButton({ eventId, count }: { eventId: string; count: number }) {
  const [pending, start] = useTransition();
  if (!count) return null;
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await confirmEventAsReported(eventId);
          if (r.ok) toast.success(r.message);
          else toast.error(r.message);
        })
      }
    >
      速報どおり確定（{count}人）
    </Button>
  );
}

export function ResultRow({ a, itemNames }: { a: ResultAssignment; itemNames: Map<string, string> }) {
  const [items, setItems] = useState(
    a.items.map((i) => ({ ...i, value: i.confirmed ?? i.reported ?? 0 })),
  );
  const [pending, start] = useTransition();
  const [history, setHistory] = useState<History | null>(null);
  const [editing, setEditing] = useState(!a.confirmed);
  const proxy = !a.submitted;

  const set = (id: string, patch: Partial<(typeof items)[number]>) => setItems((xs) => xs.map((x) => (x.item_id === id ? { ...x, ...patch } : x)));

  return (
    <li className={cn("flex flex-col gap-2 p-3", a.confirmed && !editing && "bg-status-done-bg/40")}>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/staff/${a.staffId}`} className="font-medium hover:underline">
          {a.name}
        </Link>
        <span className="text-sm text-muted-foreground">{a.role}</span>
        {a.confirmed ? <Badge tone="done">確定済み</Badge> : a.submitted ? <Badge tone="waiting">報告済み・未確定</Badge> : <Badge tone="alert">未報告</Badge>}
        {a.source === "admin" && <span className="text-xs text-muted-foreground">入力: {INPUT_SOURCE.admin}</span>}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground"
          onClick={() => start(async () => setHistory(await getReportHistory(a.id)))}
        >
          <HistoryIcon />
          履歴
        </Button>
      </div>
      {a.comment && <p className="rounded bg-muted px-2 py-1 text-sm">「{a.comment}」</p>}
      {proxy && editing && <p className="text-sm text-muted-foreground">未報告です。LINE などで聞いた件数を入れて確定できます（代理入力）。</p>}

      <ul className="flex flex-col gap-2">
        {items.map((i) => {
          const differs = !proxy && i.reported != null && i.reported !== i.value;
          return (
            <li key={i.item_id} className="flex flex-col gap-1 rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-24 flex-1">{i.name}</span>
                {!proxy && <span className="text-sm text-muted-foreground">速報 {i.reported ?? "−"}</span>}
                {editing ? (
                  <CountStepper label={`${a.name}の${i.name}の確定件数`} value={i.value} onChange={(v) => set(i.item_id, { value: v })} />
                ) : (
                  <span className="font-bold">確定 {i.confirmed ?? 0}</span>
                )}
              </div>
              {editing && differs && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <NativeSelect
                    aria-label={`${i.name}の差分の理由`}
                    value={i.reason ?? ""}
                    onChange={(e) => set(i.item_id, { reason: (e.target.value || null) as ResultItem["reason"] })}
                    className={cn(!i.reason && "border-status-alert")}
                  >
                    <option value="">差分の理由を選ぶ（必須）</option>
                    {(Object.keys(DIFF_REASON) as (keyof typeof DIFF_REASON)[]).map((k) => (
                      <option key={k} value={k}>
                        {DIFF_REASON[k]}
                      </option>
                    ))}
                  </NativeSelect>
                  <Input aria-label={`${i.name}の差分のメモ`} placeholder={i.reason === "other" ? "メモ（必須）" : "メモ（任意）"} value={i.note} onChange={(e) => set(i.item_id, { note: e.target.value })} />
                </div>
              )}
              {!editing && i.reason && (
                <p className="text-sm text-muted-foreground">
                  差分の理由: {DIFF_REASON[i.reason]}
                  {i.note && `（${i.note}）`}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex justify-end gap-2">
        {editing ? (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await confirmResult(a.id, items.map((i) => ({ item_id: i.item_id, confirmed: i.value, reason: i.reason, note: i.note })));
                if (!r.ok) return void toast.error(r.message);
                toast.success(`${a.name}さん: ${r.message}`);
                setEditing(false);
              })
            }
          >
            {a.confirmed ? "修正して確定" : proxy ? "代理で入力して確定" : "確定する"}
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            修正する
          </Button>
        )}
      </div>

      <Dialog open={history != null} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{a.name}さんの実績の履歴</DialogTitle>
          </DialogHeader>
          {history?.length ? (
            <ol className="flex flex-col gap-2 text-sm">
              {history.map((h, idx) => (
                <li key={idx} className="rounded border p-2">
                  <p className="text-muted-foreground">
                    {new Date(h.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} / {h.by_staff ? "本人（マイページ）" : (h.user_name ?? "不明")}
                  </p>
                  <p>{describe(h, itemNames)}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">履歴はまだありません</p>
          )}
        </DialogContent>
      </Dialog>
    </li>
  );
}

function describe(h: History[number], itemNames: Map<string, string>) {
  const b = (h.before ?? {}) as Record<string, unknown>;
  const n = (h.after ?? {}) as Record<string, unknown>;
  if (h.table_name === "reports") {
    if (h.action === "insert") return "報告を作成";
    if (h.changed_fields?.includes("confirmed_at")) return n.confirmed_at ? "確定" : "確定を取り消し";
    if (h.changed_fields?.includes("comment")) return `コメント: 「${b.comment ?? ""}」→「${n.comment ?? ""}」`;
    return "報告を更新";
  }
  const name = itemNames.get(String(h.item_id)) ?? "項目";
  const parts: string[] = [];
  if (h.action === "insert") parts.push(`${name}: 速報 ${n.reported_count ?? "−"}${n.confirmed_count != null ? ` / 確定 ${n.confirmed_count}` : ""}`);
  else {
    if (h.changed_fields?.includes("reported_count")) parts.push(`${name} の速報: ${b.reported_count ?? "−"} → ${n.reported_count ?? "−"}`);
    if (h.changed_fields?.includes("confirmed_count")) parts.push(`${name} の確定: ${b.confirmed_count ?? "−"} → ${n.confirmed_count ?? "−"}`);
    if (n.diff_reason) parts.push(`理由: ${DIFF_REASON[n.diff_reason as keyof typeof DIFF_REASON]}${n.diff_note ? `（${n.diff_note}）` : ""}`);
  }
  return parts.join(" / ") || `${name} を更新`;
}
