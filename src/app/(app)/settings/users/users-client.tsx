"use client";

import { PlusIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { USER_ROLE } from "@/lib/labels";
import { inviteUser, setUserActive, setUserRole } from "./actions";

type User = { id: string; name: string; email: string; role: "owner" | "manager"; is_active: boolean };

export function UsersClient({ users, meId }: { users: User[]; meId: string }) {
  const [pending, start] = useTransition();

  function run(p: Promise<{ ok: boolean; message?: string }>) {
    start(async () => {
      const r = await p;
      if (r.ok) toast.success(r.message ?? "保存しました");
      else toast.error(r.message);
    });
  }

  return (
    <div className="flex flex-col gap-4 px-4">
      <InviteDialog />
      <ul className="divide-y rounded-lg border">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-medium">
                {u.name}
                {u.id === meId && <Badge tone="brand">自分</Badge>}
                {!u.is_active && <Badge tone="muted">無効</Badge>}
              </p>
              <p className="truncate text-sm text-muted-foreground">{u.email}</p>
            </div>
            <NativeSelect
              aria-label={`${u.name}の権限`}
              className="w-32"
              value={u.role}
              disabled={u.id === meId || pending}
              onChange={(e) => run(setUserRole(u.id, e.target.value as User["role"]))}
            >
              <option value="manager">{USER_ROLE.manager}</option>
              <option value="owner">{USER_ROLE.owner}</option>
            </NativeSelect>
            <label className="flex items-center gap-2 text-sm">
              有効
              <Switch
                checked={u.is_active}
                disabled={u.id === meId || pending}
                onCheckedChange={(v) => {
                  if (!v && !window.confirm(`${u.name}さんを無効にします。すぐにログインできなくなります。よろしいですか？`)) return;
                  run(setUserActive(u.id, v));
                }}
                aria-label={`${u.name}を有効にする`}
              />
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ name: "", email: "", role: "manager" as User["role"] });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="self-start">
          <PlusIcon />
          招待する
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ユーザーを招待</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await inviteUser(form);
              if (r.ok) {
                toast.success(r.message);
                setOpen(false);
                setForm({ name: "", email: "", role: "manager" });
              } else toast.error(r.message);
            });
          }}
        >
          <Label htmlFor="invite-name">名前</Label>
          <Input id="invite-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Label htmlFor="invite-email">メールアドレス（Google アカウントのアドレス）</Label>
          <Input
            id="invite-email"
            type="email"
            inputMode="email"
            required
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Label htmlFor="invite-role">権限</Label>
          <NativeSelect id="invite-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User["role"] })}>
            <option value="manager">管理者（金額は見られない）</option>
            <option value="owner">オーナー（すべて）</option>
          </NativeSelect>
          <DialogFooter className="mt-2">
            <Button type="submit" disabled={pending}>
              {pending ? "招待中…" : "招待する"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
