"use client";

import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { ShareButtons } from "@/components/app/share-buttons";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type Recipient = { id: string; name: string; text: string; sent?: boolean };

/**
 * 1人ずつ「LINEで送る」/「コピー」する画面（要件 §4.3）。
 * 文面にはその人のマイページURLが入るので、1人ずつ送る。onSent で送信済みにする。
 */
export function MessageDialog({
  open,
  onOpenChange,
  title,
  description,
  recipients,
  onSent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  recipients: Recipient[];
  onSent?: (id: string) => void;
}) {
  const [sent, setSent] = useState<string[]>([]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="bottom" className="md:top-1/2 md:bottom-auto md:left-1/2 md:max-w-2xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <ul className="flex flex-col gap-4">
          {recipients.map((r) => {
            const done = r.sent || sent.includes(r.id);
            return (
              <li key={r.id} className="flex flex-col gap-2 rounded-md border p-3">
                <p className="flex items-center gap-2 font-bold">
                  {r.name}
                  {done && (
                    <Badge tone="done">
                      <CheckIcon className="size-3" />
                      送信済み
                    </Badge>
                  )}
                </p>
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted p-2 font-sans text-sm">{r.text}</pre>
                <ShareButtons
                  text={r.text}
                  onSent={() => {
                    setSent((s) => [...s, r.id]);
                    onSent?.(r.id);
                  }}
                />
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
