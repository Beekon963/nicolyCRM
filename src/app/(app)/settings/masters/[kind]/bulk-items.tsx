"use client";

import { ListPlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { itemLines, withProvisional } from "@/lib/items-bulk";
import { bulkAddItems } from "./actions";

/**
 * 獲得項目をまとめて登録する（取引先の公認名称の一覧を貼る）。
 * 取引先を選ぶと、その取引先の現場ではこの項目だけ出るようにする
 */
export function BulkItems({ clients }: { clients: { id: string; name: string }[] }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [provisional, setProvisional] = useState(true);
  const [clientId, setClientId] = useState("");
  const [pending, start] = useTransition();
  const lines = itemLines(text);
  const finalLines = provisional ? withProvisional(lines) : lines;

  return (
    <details className="group mx-4 mb-4 rounded-2xl border bg-card shadow-card">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-3 font-bold">
        <ListPlusIcon className="size-5 text-primary" />
        まとめて登録する（一覧を貼る）
      </summary>
      <form
        className="flex flex-col gap-3 border-t p-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await bulkAddItems(finalLines.join("\n"), clientId || null);
            if (!r.ok) return void toast.error(r.message);
            toast.success(r.message);
            setText("");
            router.refresh();
          });
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="bulk-items">項目の名前（1行に1つ）</Label>
          <Textarea id="bulk-items" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={"例:\n新規\n機種変更\nドコモ光 1G\nｄカードGOLD"} />
          <p className="text-sm text-muted-foreground">取引先からもらった公認名称の一覧をそのまま貼れます（【】の見出しの行は使いません）。もうある名前は作りません。</p>
        </div>
        <label className="flex min-h-11 items-center gap-3">
          <Checkbox checked={provisional} onCheckedChange={(v) => setProvisional(v === true)} aria-label="光・カードの（仮）の項目も作る" />
          光・カードの項目には「（仮）」の項目も作る（仮申し込みを分けて数える）
        </label>
        <div className="flex flex-col gap-1 sm:max-w-sm">
          <Label htmlFor="bulk-client">この取引先の現場で使う項目にする（任意）</Label>
          <NativeSelect id="bulk-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">選ばない（登録だけ）</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
          <p className="text-sm text-muted-foreground">選ぶと、その取引先の現場の報告ではこの項目だけが出ます。</p>
        </div>
        <Button type="submit" className="self-start" disabled={pending || finalLines.length === 0}>
          {pending ? "登録中…" : `${finalLines.length}項目を登録する`}
        </Button>
      </form>
    </details>
  );
}
