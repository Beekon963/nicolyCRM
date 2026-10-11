"use client";

import { SettingsIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import type { TrainingSettings } from "@/lib/data/trainings";
import { saveTrainingSettings } from "./actions";

/** 研修の設定（オーナー）: Google カレンダーとつなぐ・初めに入れておく研修の名前と参加の URL */
export function TrainingSettingsButton({ settings, serviceEmail }: { settings: TrainingSettings; serviceEmail: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(settings);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <SettingsIcon />
        カレンダー連携・設定
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>研修の設定</DialogTitle>
            <DialogDescription>Google カレンダーとつなぐと、予定が入っている時間の枠は予約の画面に出さず、予約が入るとカレンダーに予定を入れます。</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await saveTrainingSettings(v);
                if (!r.ok) {
                  toast.error(r.message);
                  router.refresh();
                  return;
                }
                toast.success(r.message);
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor="tr-cal">Google カレンダーの ID（つながないときは空）</Label>
              <Input id="tr-cal" value={v.calendarId} placeholder="例: nicoly@gmail.com" onChange={(e) => setV({ ...v, calendarId: e.target.value })} />
              <div className="text-sm text-muted-foreground">
                {serviceEmail ? (
                  <ol className="list-decimal pl-5">
                    <li>Google カレンダーの「設定と共有」を開く</li>
                    <li>
                      「特定のユーザーまたはグループと共有する」に <b className="break-all text-foreground">{serviceEmail}</b> を「予定の変更」で追加
                    </li>
                    <li>「カレンダーの統合」の「カレンダー ID」をここに貼る（ふだんのカレンダーなら Gmail のアドレス）</li>
                  </ol>
                ) : (
                  <p>シートへの書き出しと同じ Google の設定がまだないので、カレンダーとはつなげません（予約は使えます）。</p>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="tr-title">研修の名前（枠を作るときに初めに入れておく）</Label>
              <Input id="tr-title" value={v.defaultTitle} maxLength={50} onChange={(e) => setV({ ...v, defaultTitle: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="tr-url">参加の URL（いつも同じ Zoom・Meet を使うとき）</Label>
              <Input id="tr-url" type="url" inputMode="url" placeholder="https://" value={v.defaultUrl} onChange={(e) => setV({ ...v, defaultUrl: e.target.value })} />
            </div>
            <Button type="submit" disabled={pending}>
              {pending ? "保存しています…" : "保存"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
