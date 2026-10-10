"use client";

import { Share2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ShareButtons } from "@/components/app/share-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { issueShareLink, setShareLinkActive } from "./share-actions";

export type ShareLinkState = { url: string; active: boolean } | null;

/** 稼働表の「見るだけリンク」（現場リーダー・スタッフに LINE で送る） */
export function ShareLink({ link, isOwner }: { link: ShareLinkState; isOwner: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.message);
      setConfirmRotate(false);
      router.refresh();
    });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Share2Icon />
        見るだけリンク
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>見るだけリンク</DialogTitle>
            <DialogDescription>
              ログインなしで稼働表を見られるリンクです。現場リーダー・スタッフに LINE で送れます。金額・電話番号・打診中の情報は出ません。
            </DialogDescription>
          </DialogHeader>

          {!link ? (
            isOwner ? (
              <Button disabled={pending} onClick={() => run(issueShareLink)}>
                リンクを作る
              </Button>
            ) : (
              <p className="text-muted-foreground">まだリンクがありません。オーナーが作ると、ここに出ます。</p>
            )
          ) : (
            <div className="flex flex-col gap-3">
              <p className="flex items-center gap-2">
                {link.active ? <Badge tone="done">公開中</Badge> : <Badge tone="muted">止めています</Badge>}
              </p>
              {link.active && (
                <>
                  <p className="rounded bg-muted p-2 text-sm break-all" data-testid="share-url">
                    {link.url}
                  </p>
                  <ShareButtons text={`NICOLY の稼働表です（見るだけ）\n${link.url}`} />
                </>
              )}
              {isOwner && (
                <div className="flex flex-col gap-2 border-t pt-3">
                  {link.active ? (
                    <Button variant="outline" disabled={pending} onClick={() => run(() => setShareLinkActive(false))}>
                      リンクを止める（あとで再開できます）
                    </Button>
                  ) : (
                    <Button disabled={pending} onClick={() => run(() => setShareLinkActive(true))}>
                      再開する
                    </Button>
                  )}
                  {confirmRotate ? (
                    <div className="flex flex-col gap-2 rounded-md border border-status-alert/40 bg-status-alert-bg p-3">
                      <p className="text-status-alert">作り直すと、今のリンクはすぐに使えなくなります（元に戻せません）。新しいリンクを送り直してください。</p>
                      <div className="flex gap-2">
                        <Button variant="destructive" disabled={pending} onClick={() => run(issueShareLink)}>
                          作り直す
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmRotate(false)}>
                          やめる
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="ghost" onClick={() => setConfirmRotate(true)}>
                      リンクを作り直す（漏れたときなど）
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
