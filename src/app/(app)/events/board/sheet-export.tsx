"use client";

import { CheckCircle2Icon, ExternalLinkIcon, SheetIcon, XCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toaster";
import { exportSheetNow, saveSheetExportTarget } from "./sheet-export-actions";

export type SheetExportState = {
  spreadsheetId: string | null;
  last: { ranAt: string; ok: boolean; message: string } | null;
  /** 共有に追加してもらうサービスアカウントのメールアドレス（オーナーにだけ渡す） */
  serviceEmail: string | null;
};

/** 稼働表をスプレッドシートへ自動で書き出す設定と、今すぐ書き出すボタン */
export function SheetExport({ state, isOwner }: { state: SheetExportState; isOwner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(state.spreadsheetId ? `https://docs.google.com/spreadsheets/d/${state.spreadsheetId}/edit` : "");
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
      router.refresh();
    });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <SheetIcon />
        シートへの書き出し
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>シートへの書き出し</DialogTitle>
            <DialogDescription>
              稼働表（今月と来月）を、今と同じ形のスプレッドシートに10分ごとに書き出します。見るだけ用です（シートで直しても CRM には戻りません）。金額・電話番号は書き出しません。
            </DialogDescription>
          </DialogHeader>

          {state.spreadsheetId ? (
            <a
              href={`https://docs.google.com/spreadsheets/d/${state.spreadsheetId}/edit`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 text-primary underline"
            >
              書き出し先のスプレッドシートを開く
              <ExternalLinkIcon className="size-4" />
            </a>
          ) : (
            <p className="text-muted-foreground">書き出し先はまだ決まっていません。{isOwner ? "下にスプレッドシートの URL を入れてください。" : "オーナーが設定すると書き出されます。"}</p>
          )}

          {state.last && (
            <p className={state.last.ok ? "flex items-start gap-1 text-status-done" : "flex items-start gap-1 text-status-alert"} role="status">
              {state.last.ok ? <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" /> : <XCircleIcon className="mt-0.5 size-4 shrink-0" />}
              <span>
                最後の書き出し {state.last.ranAt}: {state.last.message}
              </span>
            </p>
          )}

          {isOwner && (
            <div className="flex flex-col gap-2 border-t pt-3">
              <Label htmlFor="sheet-url">書き出し先のスプレッドシートの URL</Label>
              <Input id="sheet-url" value={url} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={(e) => setUrl(e.target.value)} />
              {state.serviceEmail ? (
                <p className="text-sm text-muted-foreground break-all">
                  そのスプレッドシートの「共有」に <b className="text-foreground">{state.serviceEmail}</b> を「編集者」で追加してください。
                </p>
              ) : (
                <p className="text-sm text-status-alert">Google のサービスアカウントが未設定です（手順は docs/setup.md の「シートへの自動書き出し」）。</p>
              )}
              <Button variant="outline" disabled={pending} onClick={() => run(() => saveSheetExportTarget(url))}>
                {url.trim() ? "書き出し先を保存" : "書き出しを止める"}
              </Button>
            </div>
          )}

          <Button disabled={pending || !state.spreadsheetId} onClick={() => run(exportSheetNow)}>
            {pending ? "書き出し中…" : "今すぐ書き出す"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
