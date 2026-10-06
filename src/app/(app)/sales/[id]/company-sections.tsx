"use client";

import { PencilIcon, PhoneIcon, PlusIcon, TrashIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { ChipSelect } from "@/components/app/chip-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { addCompanyLink, removeCompanyLink, saveCompanyItems, saveContact, type ContactInput } from "../actions";

function useRun() {
  const [pending, start] = useTransition();
  return [
    pending,
    (p: () => Promise<{ ok: boolean; message?: string }>, onOk?: () => void) =>
      start(async () => {
        const r = await p();
        if (r.ok) {
          toast.success(r.message ?? "保存しました");
          onOk?.();
        } else toast.error(r.message);
      }),
  ] as const;
}

type Contact = { id: string; name: string; title: string; phone: string; email: string; line: string; memo: string; is_active: boolean };

export function ContactsSection({ companyId, contacts }: { companyId: string; contacts: Contact[] }) {
  const [editing, setEditing] = useState<ContactInput | null>(null);
  const [pending, run] = useRun();
  const blank: ContactInput = { company_id: companyId, name: "", title: "", phone: "", email: "", line: "", memo: "", is_active: true };
  return (
    <div className="flex flex-col gap-2">
      {contacts.length === 0 && <p className="text-sm text-muted-foreground">担当者はまだ登録されていません</p>}
      <ul className="divide-y">
        {contacts.map((c) => (
          <li key={c.id} className={`flex items-start gap-2 py-2 ${c.is_active ? "" : "opacity-50"}`}>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {c.name}
                {c.title && <span className="ml-2 text-sm text-muted-foreground">{c.title}</span>}
              </p>
              <div className="flex flex-wrap gap-x-3 text-sm">
                {c.phone && (
                  <a href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`} className="inline-flex items-center gap-1 text-primary">
                    <PhoneIcon className="size-4" />
                    {c.phone}
                  </a>
                )}
                {c.email && <a href={`mailto:${c.email}`} className="text-primary">{c.email}</a>}
                {c.line && <span className="text-muted-foreground">LINE: {c.line}</span>}
              </div>
              {c.memo && <p className="text-sm text-muted-foreground">{c.memo}</p>}
            </div>
            <Button variant="ghost" size="icon" aria-label={`${c.name}を編集`} onClick={() => setEditing({ ...c, company_id: companyId })}>
              <PencilIcon />
            </Button>
          </li>
        ))}
      </ul>
      <Button variant="outline" size="sm" className="self-start" onClick={() => setEditing(blank)}>
        <PlusIcon />
        担当者を追加
      </Button>
      <Dialog open={editing != null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "担当者を編集" : "担当者を追加"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                run(() => saveContact(editing), () => setEditing(null));
              }}
            >
              {(
                [
                  ["name", "名前（必須）", "text"],
                  ["title", "役職", "text"],
                  ["phone", "電話", "tel"],
                  ["email", "メール", "email"],
                  ["line", "LINE", "text"],
                ] as const
              ).map(([k, label, type]) => (
                <div key={k} className="flex flex-col gap-1">
                  <Label htmlFor={`ct-${k}`}>{label}</Label>
                  <Input id={`ct-${k}`} type={type} required={k === "name"} value={editing[k]} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} />
                </div>
              ))}
              <div className="flex flex-col gap-1">
                <Label htmlFor="ct-memo">メモ</Label>
                <Textarea id="ct-memo" rows={2} value={editing.memo} onChange={(e) => setEditing({ ...editing, memo: e.target.value })} />
              </div>
              {editing.id && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-5" checked={!editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: !e.target.checked })} />
                  もう担当していない（一覧で薄く表示）
                </label>
              )}
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  保存する
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ItemsSection({ companyId, items, selected }: { companyId: string; items: { id: string; name: string }[]; selected: string[] }) {
  const [value, setValue] = useState(selected);
  const [pending, run] = useRun();
  const dirty = [...value].sort().join() !== [...selected].sort().join();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        この取引先の現場で、実績報告に出す獲得項目を選びます。何も選ばないと、すべての項目が出ます。
      </p>
      <ChipSelect label="使う獲得項目" options={items} value={value} onChange={setValue} />
      <Button size="sm" className="self-end" disabled={!dirty || pending} onClick={() => run(() => saveCompanyItems(companyId, value))}>
        保存する
      </Button>
    </div>
  );
}

export function LinksSection({ companyId, links }: { companyId: string; links: { id: string; title: string; url: string }[] }) {
  const [form, setForm] = useState({ title: "", url: "" });
  const [pending, run] = useRun();
  return (
    <div className="flex flex-col gap-2">
      <ul className="divide-y">
        {links.map((l) => (
          <li key={l.id} className="flex items-center gap-2 py-1">
            <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-primary">
              {l.title || l.url}
            </a>
            <Button variant="ghost" size="icon" aria-label="リンクを外す" disabled={pending} onClick={() => run(() => removeCompanyLink(companyId, l.id))}>
              <TrashIcon />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addCompanyLink({ company_id: companyId, ...form }), () => setForm({ title: "", url: "" }));
        }}
      >
        <Input aria-label="資料名" placeholder="資料名（例: 契約書）" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Input aria-label="URL" type="url" placeholder="https://" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        <Button type="submit" variant="outline" disabled={pending || !form.url}>
          追加
        </Button>
      </form>
    </div>
  );
}
