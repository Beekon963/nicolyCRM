"use client";

import { Link2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ShareButtons } from "@/components/app/share-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import { issueTrainingLink, setTrainingLinkActive } from "./actions";

/** 研修の予約用リンク（受ける人に LINE で送る）。作る・作り直す・止めるはオーナー */
export function TrainingLink({ link, isOwner }: { link: { url: string; active: boolean } | null; isOwner: boolean }) {
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
        <Link2Icon />
        予約用リンク
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>予約用リンク</DialogTitle>
            <DialogDescription>ログインなしで研修の日時を選んで予約できるリンクです。受ける人に LINE で送ります。ほかの人の名前・連絡先は見えません。</DialogDescription>
          </DialogHeader>
          {!link ? (
            isOwner ? (
              <Button disabled={pending} onClick={() => run(issueTrainingLink)}>
                リンクを作る
              </Button>
            ) : (
              <p className="text-muted-foreground">まだリンクがありません。オーナーが作ると、ここに出ます。</p>
            )
          ) : (
            <div className="flex flex-col gap-3">
              <p>{link.active ? <Badge tone="done">受付中</Badge> : <Badge tone="muted">止めています</Badge>}</p>
              {link.active && (
                <>
                  <p className="rounded bg-muted p-2 text-sm break-all" data-testid="training-url">
                    {link.url}
                  </p>
                  <ShareButtons text={`オンライン研修の予約はこちらからお願いします。ご都合のよい日時を選んでください。\n${link.url}`} />
                </>
              )}
              {isOwner && (
                <div className="flex flex-col gap-2 border-t pt-3">
                  {link.active ? (
                    <Button variant="outline" disabled={pending} onClick={() => run(() => setTrainingLinkActive(false))}>
                      受付を止める（あとで再開できます）
                    </Button>
                  ) : (
                    <Button disabled={pending} onClick={() => run(() => setTrainingLinkActive(true))}>
                      再開する
                    </Button>
                  )}
                  {confirmRotate ? (
                    <div className="flex flex-col gap-2 rounded-md border border-status-alert/40 bg-status-alert-bg p-3">
                      <p className="text-status-alert">作り直すと、今のリンクと、予約した人の控えのリンクがすぐに使えなくなります（元に戻せません）。予約はそのまま残ります。</p>
                      <div className="flex gap-2">
                        <Button variant="destructive" disabled={pending} onClick={() => run(issueTrainingLink)}>
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
