"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import type { GeneralSettings } from "@/lib/settings";
import { saveGeneralSettings } from "./actions";

export function GeneralForm({ initial }: { initial: GeneralSettings }) {
  const [form, setForm] = useState({
    availabilityDeadlineDay: String(initial.availabilityDeadlineDay),
    reportWindowDays: String(initial.reportWindowDays),
    transportIncluded: initial.transportIncluded,
    ...initial.companyProfile,
  });
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setDirty(true);
  };

  return (
    <form
      className="flex max-w-2xl flex-col gap-4 px-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveGeneralSettings(form);
          if (r.ok) {
            toast.success(r.message);
            setDirty(false);
          } else toast.error(r.message);
        });
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>締切・期限</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Label htmlFor="deadline">稼働可能日の提出締切（毎月この日までに翌月分）</Label>
          <div className="flex items-center gap-2">
            毎月
            <Input id="deadline" className="w-20" inputMode="numeric" value={form.availabilityDeadlineDay} onChange={set("availabilityDeadlineDay")} />
            日
          </div>
          <Label htmlFor="window">実績報告の期限（稼働日から）</Label>
          <div className="flex items-center gap-2">
            <Input id="window" className="w-20" inputMode="numeric" value={form.reportWindowDays} onChange={set("reportWindowDays")} />
            日後まで
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>交通費</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <label className="flex min-h-11 items-center gap-3">
            <Switch
              checked={form.transportIncluded}
              aria-label="日当は交通費込み"
              onCheckedChange={(v) => {
                setForm({ ...form, transportIncluded: v });
                setDirty(true);
              }}
            />
            日当は交通費込み
          </label>
          <p className="text-sm text-muted-foreground">
            オンのあいだは、マイページの実績報告に交通費の欄を出しません（その他の経費はこれまでどおり）。遠い現場は、現場の人の「…」で遠方の上乗せを選んでください。
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>会社情報</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Label htmlFor="cname">会社名</Label>
          <Input id="cname" value={form.name} onChange={set("name")} />
          <Label htmlFor="caddress">住所</Label>
          <Input id="caddress" value={form.address} onChange={set("address")} />
          <Label htmlFor="cphone">電話番号</Label>
          <Input id="cphone" type="tel" value={form.phone} onChange={set("phone")} />
          <Label htmlFor="cemail">メールアドレス</Label>
          <Input id="cemail" type="email" value={form.email} onChange={set("email")} />
        </CardContent>
      </Card>
      <Button type="submit" className="self-end" disabled={pending || !dirty}>
        {pending ? "保存中…" : "保存する"}
      </Button>
    </form>
  );
}
