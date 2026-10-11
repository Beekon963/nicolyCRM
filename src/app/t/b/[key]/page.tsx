import { CalendarPlusIcon, CheckCircle2Icon, VideoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { googleCalendarAddUrl } from "@/lib/google/calendar";
import { slotLabel, trainingError } from "@/lib/data/trainings";
import { createAnonClient } from "@/lib/supabase/server";
import { Message, Shell, trainingMetadata } from "../../shell";
import { CancelBooking } from "./cancel-booking";

export const metadata = trainingMetadata;

type Booking = { name: string; title: string; starts_at: string; ends_at: string; meeting_url: string; note: string; cancelled: boolean; can_cancel: boolean; error?: string };

/** 予約の控え（ログイン不要。予約のときに返した控えの鍵で開く）。参加の URL・カレンダーに追加・キャンセル */
export default async function TrainingBookingDetailPage({ params }: PageProps<"/t/b/[key]">) {
  const { key } = await params;
  const { data } = await createAnonClient().rpc("training_public_booking", { p_cancel_token: key });
  const r = (data ?? { error: "unavailable" }) as Booking;
  if (r.error) return <Message title="予約を開けません" text={trainingError(r.error)} />;
  return (
    <Shell>
      <p className={r.cancelled ? "text-lg font-bold text-muted-foreground" : "flex items-center gap-2 text-lg font-bold text-status-done"}>
        {!r.cancelled && <CheckCircle2Icon />}
        {r.cancelled ? "この予約はキャンセルしました" : "予約しました"}
      </p>
      <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 rounded-lg border p-4">
        <dt className="text-muted-foreground">研修</dt>
        <dd className="font-bold">{r.title}</dd>
        <dt className="text-muted-foreground">日時</dt>
        <dd className="font-bold">{slotLabel(r.starts_at, r.ends_at)}</dd>
        <dt className="text-muted-foreground">お名前</dt>
        <dd>{r.name}</dd>
        {r.note && (
          <>
            <dt className="text-muted-foreground">ご案内</dt>
            <dd className="whitespace-pre-wrap">{r.note}</dd>
          </>
        )}
      </dl>
      {!r.cancelled && (
        <>
          {r.meeting_url ? (
            <Button asChild size="lg">
              <a href={r.meeting_url} target="_blank" rel="noreferrer">
                <VideoIcon />
                オンラインの研修に入る
              </a>
            </Button>
          ) : (
            <p className="text-muted-foreground">参加する URL は、担当者から別にお知らせします。</p>
          )}
          <Button asChild variant="outline">
            <a href={googleCalendarAddUrl({ title: r.title, start: new Date(r.starts_at), end: new Date(r.ends_at), details: r.meeting_url })} target="_blank" rel="noreferrer">
              <CalendarPlusIcon />
              Google カレンダーに追加
            </a>
          </Button>
          <p className="text-sm text-muted-foreground">このページを保存（ブックマーク）しておくと、あとで見直したりキャンセルしたりできます。</p>
          {r.can_cancel && <CancelBooking bookingKey={key} />}
        </>
      )}
    </Shell>
  );
}
