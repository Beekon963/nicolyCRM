"use client";

import { CheckIcon, CircleAlertIcon, PlusIcon, StarIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { formatShortJa } from "@/lib/date";
import { matchVenue, minutesBefore, parseRecruitText } from "@/lib/recruit-text";
import { cn } from "@/lib/utils";
import { saveVenue } from "../../venues/actions";
import { EventForm } from "../event-form";

type Opt = { id: string; name: string };

/**
 * 募集の文を貼る → 読み取った内容を見せる → 現場をまとめて作るフォーム（日付は読んだ日を並べる）。
 * 取引先は文からは分からないので選んでもらう。会場が CRM になければ、その名前で作れる
 */
export function FromTextClient({
  clients,
  venues: initialVenues,
  roles,
  holidays,
  today,
}: {
  clients: Opt[];
  venues: Opt[];
  roles: Opt[];
  holidays: Record<string, string>;
  today: string;
}) {
  const [text, setText] = useState("");
  const [venues, setVenues] = useState(initialVenues);
  const [pending, start] = useTransition();
  const parsed = useMemo(() => parseRecruitText(text, { today, roleNames: roles.map((r) => r.name) }), [text, today, roles]);
  const venue = matchVenue(parsed.venue, venues);
  const has = parsed.dates.length > 0;

  const defaults = {
    venue_id: venue?.id ?? "",
    start_time: parsed.start ?? undefined,
    end_time: parsed.end ?? undefined,
    meeting_time: parsed.start ? minutesBefore(parsed.start, 30) : undefined,
    // 文に役割がなければ、いつもどおり最初の役割を1人
    requirements: roles.map((r, i) => ({
      role_id: r.id,
      required_count: parsed.roles.length ? (parsed.roles.find((x) => x.name === r.name)?.count ?? 0) : i === 0 ? 1 : 0,
    })),
  };
  // 読んだ内容が変わったらフォームを作り直す（取引先などの選び直しは消える）
  const formKey = JSON.stringify([parsed, defaults.venue_id]);

  function createVenue() {
    start(async () => {
      const r = await saveVenue({
        name: parsed.venue,
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
      });
      if (!r.ok || !r.data) return void toast.error(r.message);
      toast.success(`会場「${parsed.venue}」を作りました。住所などはあとで会場の画面で入れてください`);
      setVenues((vs) => [...vs, { id: r.data!.id, name: parsed.venue }]);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 px-4">
        <Label htmlFor="recruit-text">取引先の募集の文を貼ってください</Label>
        <Textarea
          id="recruit-text"
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"例:\n■稼働場所\n〇〇モール\n■募集ポジション・人数\nクローザー：各日1名\n〈募集日〉11/1・5・6・10\n稼働時間：11時〜19時"}
        />
        <p className="text-sm text-muted-foreground">LINE の募集のメッセージを長押し →「コピー」で、ここに貼れます。単価などの金額は読みません。</p>
      </div>

      {text.trim() && (
        <section aria-label="読み取った内容" className="mx-4 flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-card">
          <h2 className="font-semibold">読み取った内容</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
            <Row label="日付" ok={has}>
              {has ? (
                <>
                  {parsed.dates.length}日（{formatShortJa(parsed.dates[0])}〜{formatShortJa(parsed.dates.at(-1)!)}）
                  {parsed.starred.length > 0 && (
                    <span className="ml-1 inline-flex items-center gap-0.5 whitespace-nowrap">
                      <StarIcon aria-hidden className="size-3.5 fill-current text-primary" />
                      優遇日 {parsed.starred.length}日
                    </span>
                  )}
                </>
              ) : (
                "読めませんでした。「11/5」「11月5日」の形の日付が入っているか確かめてください"
              )}
            </Row>
            <Row label="会場" ok={Boolean(venue)}>
              {venue ? (
                venue.name
              ) : parsed.venue ? (
                <span className="flex flex-col items-start gap-2">
                  <span>「{parsed.venue}」は会場にありません。下で選ぶか、この名前で作ってください</span>
                  <Button type="button" size="sm" variant="outline" disabled={pending} onClick={createVenue}>
                    <PlusIcon />
                    この名前で会場を作る
                  </Button>
                </span>
              ) : (
                "読めませんでした。下で選んでください"
              )}
            </Row>
            <Row label="時間" ok={Boolean(parsed.start)}>
              {parsed.start ? `${parsed.start}〜${parsed.end ?? ""}` : "読めませんでした。下で入れてください"}
            </Row>
            <Row label="人数" ok={parsed.roles.length > 0}>
              {parsed.roles.length ? parsed.roles.map((r) => `${r.name} ${r.count}人`).join("、") : "読めませんでした。下で入れてください"}
            </Row>
          </dl>
          {!has && (
            <p className="text-sm">
              日付を選んで作るときは
              <Button asChild variant="link" size="sm" className="h-auto px-1">
                <Link href="/events/bulk">期間でまとめて作る</Link>
              </Button>
              へ。
            </p>
          )}
        </section>
      )}

      {has && (
        <>
          <h2 className="px-4 font-semibold">取引先を選んで、内容を確かめてください</h2>
          <EventForm key={formKey} mode="dates" defaults={defaults} pickDates={{ dates: parsed.dates, starred: parsed.starred }} clients={clients} venues={venues} roles={roles} holidays={holidays} />
        </>
      )}
    </div>
  );
}

function Row({ label, ok, children }: { label: string; ok: boolean; children: React.ReactNode }) {
  return (
    <>
      <dt className="flex items-start gap-1 font-medium whitespace-nowrap">
        {ok ? (
          <CheckIcon aria-label="読めました" className="mt-1 size-4 text-status-done" />
        ) : (
          <CircleAlertIcon aria-label="読めませんでした" className="mt-1 size-4 text-status-waiting" />
        )}
        {label}
      </dt>
      <dd className={cn("min-w-0 break-words", !ok && "text-[#344054]")}>{children}</dd>
    </>
  );
}
