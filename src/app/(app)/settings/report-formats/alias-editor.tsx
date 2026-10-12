"use client";

import { ArrowRightIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toaster";
import type { AliasRow } from "@/lib/data/report-dict";
import { deleteItemAlias, saveItemAlias } from "../../alias-actions";

/**
 * 言いかえ表（LINE のいつもの書き方 → 獲得項目の名前）。
 * 「LINEの報告を変換」で、ここにある書き方は自動でその項目になる。CRM の実績から日報を作るときも、項目名をここで直す
 */
export function AliasEditor({ aliases, clients, itemNames }: { aliases: AliasRow[]; clients: { id: string; name: string }[]; itemNames: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [alias, setAlias] = useState("");
  const [itemName, setItemName] = useState("");
  const clientName = (id: string | null) => (id ? (clients.find((c) => c.id === id)?.name ?? "（使っていない取引先）") : "すべての取引先");
  const groups = [...new Set(aliases.map((a) => a.companyId))].map((id) => ({ id, rows: aliases.filter((a) => a.companyId === id) }));

  return (
    <section className="mx-4 mb-8 flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-card" aria-labelledby="alias-title">
      <div>
        <h2 id="alias-title" className="text-[17px] font-bold">
          言いかえ表（LINE の書き方 → 公認名称）
        </h2>
        <p className="text-sm text-muted-foreground">
          「キヘン → 機種変更」「光 → ドコモ光 1G」のように、いつもの書き方を取引先の項目の名前に直します。「実績確認 → 日報 → LINEの報告を変換」で使います（変換の画面の「覚える」でも足せます）。
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">まだありません。下から足すか、変換の画面で「覚える」を押してください。</p>
      ) : (
        groups.map((g) => (
          <div key={g.id ?? "all"}>
            <h3 className="mb-1 text-sm font-semibold text-muted-foreground">{clientName(g.id)}</h3>
            <ul className="divide-y rounded-xl border">
              {g.rows.map((a) => (
                <li key={a.id} className="flex min-h-12 items-center gap-2 px-3">
                  <span className="font-medium">{a.alias}</span>
                  <ArrowRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`「${a.alias}」を消す`}
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await deleteItemAlias(a.id);
                        if (!r.ok) return void toast.error(r.message);
                        toast.success(r.message);
                        router.refresh();
                      })
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      <form
        className="grid gap-2 border-t pt-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveItemAlias(clientId || null, alias, itemName);
            if (!r.ok) return void toast.error(r.message);
            toast.success(r.message);
            setAlias("");
            setItemName("");
            router.refresh();
          });
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="alias-client">取引先</Label>
          <NativeSelect id="alias-client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="">すべての取引先</option>
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="alias-text">いつもの書き方</Label>
          <Input id="alias-text" placeholder="例: キヘン" value={alias} onChange={(e) => setAlias(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="alias-item">公認名称（獲得項目）</Label>
          <NativeSelect id="alias-item" value={itemName} onChange={(e) => setItemName(e.target.value)}>
            <option value="">選んでください</option>
            {itemNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" disabled={pending || !alias.trim() || !itemName}>
          <PlusIcon />
          足す
        </Button>
      </form>
    </section>
  );
}
