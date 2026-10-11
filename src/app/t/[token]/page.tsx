import { loadPublicSlots, slotParts } from "@/lib/data/trainings";
import { Message, Shell, trainingMetadata } from "../shell";
import { SlotPicker } from "./slot-picker";

export const metadata = trainingMetadata;

/** 研修の予約（ログイン不要。予約用リンクの鍵で開く）。空いている日時を選んでお名前を入れる */
export default async function TrainingBookingPage({ params }: PageProps<"/t/[token]">) {
  const { token } = await params;
  const r = await loadPublicSlots(token);
  if (!r.ok) return <Message title="予約のページを開けません" text={r.error} />;
  return (
    <Shell>
      <p className="text-muted-foreground">ご都合のよい日時を選んで、お名前を入れてください。</p>
      {r.slots.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">いま予約できる日時はありません。担当者にご連絡ください。</p>
      ) : (
        <SlotPicker token={token} slots={r.slots.map((s) => ({ id: s.id, title: s.title, note: s.note, left: s.left, ...slotParts(s.startsAt, s.endsAt) }))} />
      )}
    </Shell>
  );
}
