"use client";

import { ChevronDownIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { saveVenue, type VenueInput } from "./actions";

const EMPTY: VenueInput = {
  name: "",
  kana: "",
  address: "",
  nearest_station: "",
  prefecture: "",
  area_id: "",
  access_notes: "",
  green_room: "",
  parking: "",
  memo: "",
  is_active: true,
};

export function VenueForm({ initial, areas }: { initial?: VenueInput; areas: { id: string; name: string }[] }) {
  const router = useRouter();
  const [form, setForm] = useState<VenueInput>(initial ?? EMPTY);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  useUnsavedChanges(dirty);
  const isNew = !initial?.id;
  const set = <K extends keyof VenueInput>(k: K, v: VenueInput[K]) => {
    setForm({ ...form, [k]: v });
    setDirty(true);
  };
  const text = (k: keyof VenueInput, label: string, props: React.ComponentProps<"input"> = {}) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`v-${k}`}>{label}</Label>
      <Input id={`v-${k}`} value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value as never)} {...props} />
    </div>
  );

  return (
    <form
      className="flex flex-col gap-4 px-4 pb-8"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveVenue(form);
          if (r.ok && r.data) {
            toast.success(r.message);
            setDirty(false);
            router.push(`/venues/${r.data.id}`);
          } else if (!r.ok) toast.error(r.message);
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {text("name", "会場名（必須）", { required: true })}
        {text("address", "住所（テレアポなどは空でよい）")}
        {text("nearest_station", "最寄り駅")}
        <div className="flex flex-col gap-1">
          <Label htmlFor="v-area">エリア</Label>
          <NativeSelect id="v-area" value={form.area_id ?? ""} onChange={(e) => set("area_id", e.target.value)}>
            <option value="">未設定</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <details className="group rounded-md border" open={!isNew}>
        <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-3 font-medium">
          詳細（入館方法・控室・駐車場など）
          <ChevronDownIcon className="size-5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-4 border-t p-3 sm:grid-cols-2">
          {text("kana", "かな")}
          {text("prefecture", "都道府県")}
          {(["access_notes", "green_room", "parking", "memo"] as const).map((k) => (
            <div key={k} className="flex flex-col gap-1 sm:col-span-2">
              <Label htmlFor={`v-${k}`}>{{ access_notes: "入館方法", green_room: "控室", parking: "駐車場", memo: "メモ" }[k]}</Label>
              <Textarea id={`v-${k}`} rows={2} value={form[k]} onChange={(e) => set(k, e.target.value)} />
            </div>
          ))}
          {!isNew && (
            <label className="flex items-center gap-3">
              <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} />
              使用中（使わなくなったらオフ。過去のデータは残ります）
            </label>
          )}
        </div>
      </details>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "保存中…" : isNew ? "登録する" : "保存する"}
      </Button>
    </form>
  );
}
