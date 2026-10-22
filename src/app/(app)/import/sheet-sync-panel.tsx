"use client";

import { CheckCircle2Icon, ChevronDownIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import type { NameOption, SheetAliasRow, SheetSyncStatus } from "@/lib/data/sheet-sync";
import { type Suggestion, type Suggestions, suggestionCount } from "@/lib/import/name-match";
import { formatShortJa, formatTimeJst, toJstDateString } from "@/lib/date";
import type { AliasKind } from "@/lib/import/sheet-sync-plan";
import { cn } from "@/lib/utils";
import { deleteSheetAlias, saveSheetAlias, saveSheetAliases, saveSheetSyncSettings, syncSheetNow, writebackNow } from "./sheet-sync-actions";

const KIND_LABEL: Record<AliasKind, string> = { client: "取引先", venue: "会場", staff: "スタッフ", place: "下の段にだけある場所（研修など）" };

export function ranAtLabel(iso: string): string {
  const d = new Date(iso);
  return `${formatShortJa(toJstDateString(d))} ${formatTimeJst(d)}`;
}

type Options = { clients: NameOption[]; venues: NameOption[]; staff: NameOption[] };

/**
 * シートを自動で読む（Phase 18）: 設定・最後の結果・合わない名前の対応づけ。オーナーだけ。
 * 読む元が空なら、書き出し先（いつもの管理用シート）をそのまま読む。
 * 合わない名前には CRM の中で近いもの（候補。Phase 20）を最初から選んでおく。決めるのはオーナー。
 */
export function SheetSyncPanel({ status, aliases, options, suggestions, roles }: { status: SheetSyncStatus; aliases: SheetAliasRow[]; options: Options; suggestions: Suggestions; roles: NameOption[] }) {
  const [enabled, setEnabled] = useState(status.enabled);
  const [writeback, setWriteback] = useState(status.writeback);
  const [addRows, setAddRows] = useState(status.addRows);
  const [url, setUrl] = useState(status.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${status.spreadsheetId}/edit` : "");
  const [roleId, setRoleId] = useState(status.roleId ?? roles[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [detail, setDetail] = useState(false);
  const last = status.last;
  const source = status.spreadsheetId ?? status.exportSpreadsheetId;

  const save = (next?: Partial<{ enabled: boolean; writeback: boolean; addRows: boolean }>) =>
    start(async () => {
      const r = await saveSheetSyncSettings({ enabled: next?.enabled ?? enabled, url, roleId, writeback: next?.writeback ?? writeback, addRows: next?.addRows ?? addRows });
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });
  const syncNow = () =>
    start(async () => {
      const r = await syncSheetNow();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });
  const writeNow = () =>
    start(async () => {
      const r = await writebackNow();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    });

  return (
    <Card id="sheet-sync" data-testid="sheet-sync">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          シートを自動で読む
          {enabled ? <Badge tone="done">10分ごと</Badge> : <Badge>止めている</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          いつもの管理用スプレッドシートの今月・来月のタブ（202611 など）を CRM が読んで、現場・人数・確定した人・○△×・単価を入れます。シートに書けば10分以内に CRM にも入り、シートから消したものは CRM からも外れます（今日より前の分・報告のある分は残ります）。CRM にもう一度入れる必要はありません。
        </p>

        {/* 最後の結果 */}
        <div role="status" className={cn("flex flex-col gap-1 rounded-md border px-3 py-2 text-sm", last && !last.ok ? "border-status-alert-border bg-status-alert-bg" : "bg-muted/40")}>
          {last ? (
            <>
              <span className="flex flex-wrap items-center gap-2">
                {last.ok ? <CheckCircle2Icon className="size-4 text-status-done" /> : <TriangleAlertIcon className="size-4 text-status-alert" />}
                <span className="font-semibold">最後に読んだ: {ranAtLabel(last.ranAt)}</span>
              </span>
              <span className="break-words">{last.message}</span>
              {last.report.months.length > 0 && (
                <button type="button" className="flex w-fit items-center gap-1 text-primary" onClick={() => setDetail(!detail)} aria-expanded={detail}>
                  <ChevronDownIcon className={cn("size-4 transition-transform", detail && "rotate-180")} />
                  くわしく
                </button>
              )}
              {detail && (
                <ul className="flex flex-col gap-2 border-t pt-2">
                  {last.report.months.map((m) => (
                    <li key={m.month}>
                      <span className="font-semibold">{m.tab}</span>
                      {m.ok ? (
                        <ul className="list-disc pl-5">
                          <li>現場: 新しく {m.eventsCreated}件（すでにあった {m.eventsReused}件はそのまま）、確定の予定 {m.assignments}件、稼働可能日 {m.availability}件</li>
                          {m.removed.events + m.removed.assignments + m.removed.availability > 0 && (
                            <li>
                              シートから消えたので外した: 現場 {m.removed.events}件・予定 {m.removed.assignments}件・稼働可能日 {m.removed.availability}件
                            </li>
                          )}
                          {m.kept.map((k) => (
                            <li key={k}>シートから消えたが CRM に残した: {k}</li>
                          ))}
                          {m.warnings.map((w) => (
                            <li key={w} className="text-muted-foreground">
                              {w}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span>: {m.message}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <span>まだ読んでいません。「今すぐ読む」で試せます</span>
          )}
        </div>

        {/* 設定 */}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ss-url">読む元の URL（管理用スプレッドシート）</Label>
            <Input id="ss-url" value={url} placeholder={status.exportSpreadsheetId ? "空なら、シートへの書き出し先と同じシートを読みます" : "https://docs.google.com/spreadsheets/d/…"} onChange={(e) => setUrl(e.target.value)} />
            {!source && !url && <p className="text-sm text-status-alert">読む元がまだありません。URL を貼るか、稼働表の「シートへの書き出し」で書き出し先を決めてください</p>}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ss-role">人数を入れる役割</Label>
            <NativeSelect id="ss-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-h-11 items-center gap-2">
            <Switch
              checked={enabled}
              disabled={pending}
              aria-label="自動で読む"
              onCheckedChange={(v) => {
                setEnabled(v);
                save({ enabled: v });
              }}
            />
            <span className="font-semibold">自動で読む（10分ごと）</span>
          </label>
          <Button variant="outline" disabled={pending} onClick={() => save()}>
            保存する
          </Button>
          <Button disabled={pending || !(source || url)} onClick={syncNow} className="gap-1.5">
            <RefreshCwIcon className={cn("size-4", pending && "motion-safe:animate-spin")} />
            今すぐ読む
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">Google の設定（docs/setup.md ⑨）がなくても、「リンクを知っている全員」が見られるシートなら読めます。シートの単価の列も入るので、読めるのはオーナーだけです。</p>

        {/* 合わない名前 */}
        {status.unmatchedCount > 0 && <UnmatchedList status={status} options={options} suggestions={suggestions} />}

        {/* 書き戻し（Phase 19） */}
        <div className="flex flex-col gap-3 border-t pt-4" data-testid="sheet-writeback">
          <p className="flex items-center gap-2 font-semibold">
            CRM で入れたものをシートにも書く（書き戻し）
            {writeback ? <Badge tone="done">2分ごと</Badge> : <Badge>止めている</Badge>}
          </p>
          <p className="text-sm text-muted-foreground">
            CRM で確定・辞退・現場を作る・人数を直す・○△×を入れると、いつものシートの同じマス（場所・シフト・現場・人数）にも2分以内に書きます（単価の行は書きません）。シートに行がない人・取引先は、下の「行を足す」がオンなら行を足してから書き、オフなら書けなかったものとして下に出ます。
          </p>
          {!status.googleConfigured && (
            <p className="text-sm text-status-alert">Google の設定（docs/setup.md ⑨ のサービスアカウント。シートに「編集者」で共有）がまだないので、オンにしてもシートには書けません。</p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex min-h-11 items-center gap-2">
              <Switch
                checked={writeback}
                disabled={pending}
                aria-label="シートにも書く"
                onCheckedChange={(v) => {
                  setWriteback(v);
                  save({ writeback: v });
                }}
              />
              <span className="font-semibold">シートにも書く（2分ごと）</span>
            </label>
            <Button variant="outline" disabled={pending || !writeback} onClick={writeNow}>
              今すぐ書く
            </Button>
            {status.pendingWrites > 0 && writeback && <span className="text-sm text-muted-foreground">まだ書いていないマス: {status.pendingWrites}</span>}
          </div>
          <div className="flex flex-col gap-1" data-testid="sheet-add-rows">
            <label className="flex min-h-11 items-center gap-2">
              <Switch
                checked={addRows}
                disabled={pending}
                aria-label="行を足す"
                onCheckedChange={(v) => {
                  setAddRows(v);
                  save({ addRows: v });
                }}
              />
              <span className="font-semibold">シートに行がない人・取引先は、行を足す</span>
            </label>
            <p className="text-sm text-muted-foreground">
              オンにすると、書くときにその人・取引先の行がなければ、その段のいちばん下に3行の組（単価 / 場所 / シフト、単価 / 現場 / 人数）を足してから書きます。見た目と右側の計算式（出勤日数など）はすぐ上の組を写し、単価の行は空のままです。名字だけなど似た名前の行がもうあるときは足さずに知らせます（上の「合わない名前」で決めてください）。
            </p>
          </div>
          {status.recentWrites.length > 0 && (
            <ul className="divide-y rounded-md border text-sm" data-testid="sheet-writeback-recent">
              {status.recentWrites.map((w, i) => (
                <li key={i} className="flex items-start gap-2 px-3 py-1.5">
                  <Badge tone={w.status === "done" ? "done" : w.status === "failed" ? "alert" : "waiting"} className="mt-0.5 shrink-0">
                    {w.status === "done" ? "書いた" : w.status === "failed" ? "書けなかった" : "触らなかった"}
                  </Badge>
                  <span className="min-w-0 flex-1 break-words">
                    {w.message}
                    {w.count > 1 && <span className="ml-1 text-muted-foreground">×{w.count}</span>}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{w.at ? ranAtLabel(w.at) : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {aliases.length > 0 && <AliasList aliases={aliases} />}
      </CardContent>
    </Card>
  );
}

function UnmatchedList({ status, options, suggestions }: { status: SheetSyncStatus; options: Options; suggestions: Suggestions }) {
  const u = status.unmatched;
  const rows: { kind: AliasKind; name: string; note?: string; suggestion?: Suggestion }[] = [
    ...u.clients.map((name) => ({ kind: "client" as const, name, suggestion: suggestions.clients[name] })),
    ...u.venues.map((name) => ({ kind: "venue" as const, name, suggestion: suggestions.venues[name] })),
    ...u.staff.map((name) => ({ kind: "staff" as const, name, suggestion: suggestions.staff[name] })),
    ...u.places.map((p) => ({ kind: "place" as const, name: p.place, note: `${p.days.join("・")}日`, suggestion: suggestions.places[p.place] })),
  ];
  // 決めたもの（行ごとの結果の文）。まとめて決めたときも1件ずつ決めたときも、ここに入る
  const [done, setDone] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const key = (r: { kind: AliasKind; name: string }) => `${r.kind}:${r.name}`;
  const withSuggestion = rows.filter((r) => r.suggestion && !done[key(r)]);
  const decideAll = () =>
    start(async () => {
      const r = await saveSheetAliases(withSuggestion.map((x) => ({ kind: x.kind, sheetName: x.name, target: x.suggestion!.id })));
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      setDone((d) => ({ ...d, ...Object.fromEntries(withSuggestion.map((x) => [key(x), `${x.suggestion!.name} に決めました`])) }));
    });
  return (
    <div className="flex flex-col gap-2 rounded-md border border-status-waiting-border bg-status-waiting-bg p-3" data-testid="sheet-sync-unmatched">
      <p className="flex items-center gap-2 font-semibold">
        <TriangleAlertIcon className="size-4 text-status-waiting" />
        シートの名前が CRM と合わないもの
        <Badge tone="waiting">{rows.length}件</Badge>
      </p>
      <p className="text-sm text-muted-foreground">
        どれのことか決めると覚えておき、次に読むときから入ります（まだ入っていません）。
        {suggestionCount(suggestions) > 0 && "近いものがあるときは「候補」として先に選んであります。違うときは選び直してください。"}
      </p>
      {withSuggestion.length > 0 && (
        <Button variant="outline" disabled={pending} onClick={decideAll} className="self-start">
          候補どおりにまとめて決める（{withSuggestion.length}件）
        </Button>
      )}
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <UnmatchedRow key={key(r)} row={r} options={options} done={done[key(r)]} onDone={(msg) => setDone((d) => ({ ...d, [key(r)]: msg }))} />
        ))}
      </ul>
    </div>
  );
}

function UnmatchedRow({ row, options, done, onDone }: { row: { kind: AliasKind; name: string; note?: string; suggestion?: Suggestion }; options: Options; done?: string; onDone: (message: string) => void }) {
  const [target, setTarget] = useState(row.suggestion?.id ?? "");
  const [pending, start] = useTransition();
  // place（下の段にだけある場所）は「その現場の取引先」を選ぶ
  const list = row.kind === "staff" ? options.staff : row.kind === "venue" ? options.venues : options.clients;
  const canCreate = row.kind === "venue" || row.kind === "client";
  const decide = () =>
    start(async () => {
      const r = await saveSheetAlias({ kind: row.kind, sheetName: row.name, target });
      if (!r.ok) return void toast.error(r.message);
      toast.success(r.message);
      onDone(r.message ?? "決めました");
    });
  return (
    <li className="flex flex-col gap-1.5 rounded-md bg-background p-2 sm:flex-row sm:items-center sm:gap-2">
      <span className="min-w-0 flex-1">
        <Badge className="mr-1.5">{KIND_LABEL[row.kind]}</Badge>
        <span className="font-semibold break-words">{row.name}</span>
        {row.note && <span className="ml-1 text-sm text-muted-foreground">{row.note}</span>}
        {row.suggestion && !done && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            <Badge tone="waiting">候補</Badge>
            {row.suggestion.name}（{row.suggestion.why}）
          </span>
        )}
      </span>
      {done ? (
        <span className="text-sm text-status-done">{done}</span>
      ) : (
        <span className="flex items-center gap-2">
          <NativeSelect aria-label={`${row.name} の対応づけ`} value={target} disabled={pending} onChange={(e) => setTarget(e.target.value)} className="min-w-0 flex-1 sm:w-56">
            <option value="">{row.kind === "place" ? "どの取引先の現場か…" : "どれのことか…"}</option>
            {list.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
            {canCreate && <option value="new">この名前で新しく作る</option>}
            <option value="skip">取り込まない</option>
          </NativeSelect>
          <Button size="sm" variant="outline" disabled={pending || !target} onClick={decide}>
            決める
          </Button>
        </span>
      )}
    </li>
  );
}

function AliasList({ aliases }: { aliases: SheetAliasRow[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [gone, setGone] = useState<string[]>([]);
  const rows = aliases.filter((a) => !gone.includes(a.id));
  if (!rows.length) return null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <button type="button" className="flex w-fit items-center gap-1 text-primary" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronDownIcon className={cn("size-4 transition-transform", open && "rotate-180")} />
        覚えた対応づけ（{rows.length}件）
      </button>
      {open && (
        <ul className="divide-y rounded-md border">
          {rows.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-2">
              <Badge>{KIND_LABEL[a.kind]}</Badge>
              <span className="min-w-0 flex-1 break-words">
                {a.sheetName} → {a.targetName ?? "取り込まない"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await deleteSheetAlias(a.id);
                    if (!r.ok) return void toast.error(r.message);
                    setGone((g) => [...g, a.id]);
                  })
                }
              >
                消す
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
