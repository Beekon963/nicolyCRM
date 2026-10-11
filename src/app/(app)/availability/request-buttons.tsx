"use client";

import { MessageCircleIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { MessageDialog, type Recipient } from "@/components/app/message-dialog";
import { ShareButtons } from "@/components/app/share-buttons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function RequestButtons({ groupText, reminders }: { groupText: string; reminders: Recipient[] }) {
  const [groupOpen, setGroupOpen] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  return (
    // 未提出の人がいるあいだは「個別リマインド」がいちばん大事なので先・青。全体向けは白
    <div className="mx-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {reminders.length > 0 && (
        <Button onClick={() => setRemindOpen(true)}>
          <MessageCircleIcon />
          未提出の人に個別リマインド（{reminders.length}人）
        </Button>
      )}
      <Button variant={reminders.length > 0 ? "outline" : "default"} onClick={() => setGroupOpen(true)}>
        <UsersIcon />
        全体向けの提出依頼
      </Button>
      <Dialog open={groupOpen} onOpenChange={setGroupOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>全体向けの提出依頼</DialogTitle>
            <DialogDescription>スタッフの LINE グループに送ってください。個別のリンクは不要です（各自のマイページから提出）。</DialogDescription>
          </DialogHeader>
          <pre className="whitespace-pre-wrap rounded bg-muted p-3 font-sans">{groupText}</pre>
          <ShareButtons text={groupText} />
        </DialogContent>
      </Dialog>
      <MessageDialog
        open={remindOpen}
        onOpenChange={setRemindOpen}
        title="個別リマインド"
        description="マイページURL付きの文面です。1人ずつ「LINEで送る」で送ってください。"
        recipients={reminders}
      />
    </div>
  );
}
