"use client";

import { RefreshCwIcon, TrashIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { copyText, ShareButtons } from "@/components/app/share-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { formatShortJa } from "@/lib/date";
import { NOTE_KIND } from "@/lib/labels";
import { addNg, addNote, removeNg, rotateMypageToken } from "../actions";

function useAction() {
  const [pending, start] = useTransition();
  const run = (p: () => Promise<{ ok: boolean; message?: string }>, onOk?: () => void) =>
    start(async () => {
      const r = await p();
      if (r.ok) {
        toast.success(r.message ?? "保存しました");
        onOk?.();
      } else toast.error(r.message);
    });
  return [pending, run] as const;
}

export function MypageUrlCard({ staffId, name, url }: { staffId: string; name: string; url: string }) {
  const [pending, run] = useAction();
  const text = `${name}さん\nNICOLY のマイページです。打診への回答・実績報告・稼働可能日の提出はここからできます。ホーム画面に追加しておくと便利です。\n${url}`;
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => copyText(url)}
        className="truncate rounded-md bg-muted px-3 py-2 text-left font-mono text-sm"
        title="タップでコピー"
      >
        {url}
      </button>
      <ShareButtons text={text} size="sm" />
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-muted-foreground"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("マイページURLを再発行します。今のURLはすぐに使えなくなります。よろしいですか？")) return;
          run(() => rotateMypageToken(staffId));
        }}
      >
        <RefreshCwIcon />
        URLを再発行
      </Button>
    </div>
  );
}

type Option = { id: string; name: string };

export function NgSection({
  staffId,
  items,
  venues,
  clients,
}: {
  staffId: string;
  items: { id: string; reason: string; venue: Option | null; company: Option | null }[];
  venues: Option[];
  clients: Option[];
}) {
  const [pending, run] = useAction();
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">NG はありません</p>
      ) : (
        <ul className="divide-y">
          {items.map((n) => (
            <li key={n.id} className="flex items-center gap-2 py-1">
              <Badge tone="alert">{n.venue ? "会場NG" : "取引先NG"}</Badge>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{n.venue?.name ?? n.company?.name}</span>
                {n.reason && <span className="block text-sm text-muted-foreground">{n.reason}</span>}
              </span>
              <Button variant="ghost" size="icon" aria-label="NG を外す" disabled={pending} onClick={() => run(() => removeNg(staffId, n.id))}>
                <TrashIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addNg({ staffId, target, reason }), () => {
            setTarget("");
            setReason("");
          });
        }}
      >
        <NativeSelect aria-label="NG にする会場・取引先" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">NG にする会場・取引先を選ぶ</option>
          <optgroup label="会場">
            {venues.map((v) => (
              <option key={v.id} value={`venue:${v.id}`}>
                {v.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="取引先">
            {clients.map((c) => (
              <option key={c.id} value={`company:${c.id}`}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </NativeSelect>
        <Input aria-label="理由" placeholder="理由（任意）" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button type="submit" variant="outline" disabled={pending || !target}>
          追加
        </Button>
      </form>
    </div>
  );
}

export function NotesSection({
  staffId,
  today,
  notes,
}: {
  staffId: string;
  today: string;
  notes: { id: string; date: string; kind: keyof typeof NOTE_KIND; memo: string; is_auto: boolean }[];
}) {
  const [pending, run] = useAction();
  const [form, setForm] = useState({ date: today, kind: "other" as keyof typeof NOTE_KIND, memo: "" });
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addNote({ staffId, ...form }), () => setForm({ ...form, memo: "" }));
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" aria-label="日付" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <NativeSelect aria-label="種類" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as keyof typeof NOTE_KIND })}>
            {(Object.keys(NOTE_KIND) as (keyof typeof NOTE_KIND)[]).map((k) => (
              <option key={k} value={k}>
                {NOTE_KIND[k].label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Textarea aria-label="内容" rows={2} placeholder="例: 電車遅延で15分遅れ（事前連絡あり）" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} />
        <Button type="submit" variant="outline" className="self-end" disabled={pending || !form.memo.trim()}>
          メモを追加
        </Button>
      </form>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">メモはまだありません</p>
      ) : (
        <ul className="divide-y">
          {notes.map((n) => (
            <li key={n.id} className="flex flex-col gap-1 py-2">
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{formatShortJa(n.date)}</span>
                <Badge tone={NOTE_KIND[n.kind].tone}>{NOTE_KIND[n.kind].label}</Badge>
                {n.is_auto && <span className="text-muted-foreground">自動記録</span>}
              </span>
              <span>{n.memo}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

