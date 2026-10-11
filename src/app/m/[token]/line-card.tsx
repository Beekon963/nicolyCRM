"use client";

import { LineLink } from "@/components/app/line-link";
import { startLineLink, unlinkLine } from "./actions";

/** マイページの「LINE でお知らせを受け取る」（Phase 5） */
export function LineCard({ token, linked, botName }: { token: string; linked: boolean; botName: string }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border p-4" data-testid="mypage-line">
      <h2 className="text-lg font-bold">LINE でお知らせを受け取る</h2>
      <LineLink
        linked={linked}
        botName={botName}
        what="現場が確定したときと前日に、お知らせが届きます。"
        start={() => startLineLink(token)}
        unlink={() => unlinkLine(token)}
      />
    </section>
  );
}
