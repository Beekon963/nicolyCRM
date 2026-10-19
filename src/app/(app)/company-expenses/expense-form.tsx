"use client";

import { CameraIcon, CheckIcon, ChevronDownIcon, ImageIcon, Loader2Icon, PlusIcon, SparklesIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { DateQuickPick } from "@/components/app/date-quick-pick";
import { StickySubmitBar } from "@/components/app/sticky-submit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toaster";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { EXPENSE_LIMITS, EXPENSE_MAX_AMOUNT } from "@/lib/company-expenses";
import { isDateString, monthOf } from "@/lib/date";
import { parseYen } from "@/lib/money/format";
import { cn } from "@/lib/utils";
import { readReceiptAction, saveCompanyExpense, setCompanyExpenseVoided } from "./actions";

export type ExpenseFormValue = {
  id?: string;
  /** 払った人（null = まだ決めていない） */
  paidBy: string | null;
  spentOn: string;
  vendor: string;
  item: string;
  purpose: string;
  category: string;
  /** 金額の入力欄の文字 */
  amount: string;
  attendees: string;
  memo: string;
};

type Photo = { blob: Blob; preview: string };

/**
 * 写真を小さくする（約150万画素・長い辺 2400px まで、JPEG）。レシートの細かい字も読めて、送る量はおさえる。
 * 送るのは 900KB まで（画面から送れる大きさは 1MB まで）
 */
async function shrinkPhoto(file: File): Promise<Photo> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  for (const [pixels, quality] of [
    [1_500_000, 0.82],
    [1_500_000, 0.6],
    [800_000, 0.6],
  ] as const) {
    const scale = Math.min(1, Math.sqrt(pixels / (bmp.width * bmp.height)), 2400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", quality));
    if (blob && blob.size <= 900_000) return { blob, preview: URL.createObjectURL(blob) };
  }
  throw new Error("too large");
}

/**
 * 会社の経費を入れる・直す（Phase 16）。
 * いちばん速い入れ方: 「レシートを撮る」→ AI が日付・店・金額・区分を入れる → 確かめて「登録する」。
 * 手で入れるときは、金額 → 区分（ワンタップ）→ 店（前に入れた店から候補）→「登録する」。日付は今日、払った人は自分が最初から入っている
 */
export function ExpenseForm({
  initial,
  payers,
  categories,
  vendors,
  aiReady,
  receipt,
}: {
  initial: ExpenseFormValue;
  payers: { id: string; name: string }[];
  categories: string[];
  vendors: string[];
  aiReady: boolean;
  /** 直すとき: 保存してある領収書（写真を見るリンク・今のシートから取り込んだリンク） */
  receipt?: { src: string | null; url: string };
}) {
  const router = useRouter();
  const isNew = !initial.id;
  const [form, setForm] = useState<ExpenseFormValue>(initial);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [reading, setReading] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [otherCategory, setOtherCategory] = useState(false);
  const [added, setAdded] = useState<{ month: string; count: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  useUnsavedChanges(dirty);

  const set = <K extends keyof ExpenseFormValue>(k: K, v: ExpenseFormValue[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setDirty(true);
  };
  // 今の区分が候補にない（AI が読んだ・前に手で入れた）ときは、候補の先頭に足す
  const chips = form.category && !categories.includes(form.category) ? [form.category, ...categories] : categories;

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    let p: Photo;
    try {
      p = await shrinkPhoto(file);
    } catch {
      return void toast.error("この写真は読み込めませんでした。JPEG か PNG の写真を選んでください");
    }
    setPhoto(p);
    setDirty(true);
    setAiNote(null);
    if (!aiReady) return;
    setReading(true);
    const fd = new FormData();
    fd.set("receipt", p.blob, "receipt.jpg");
    const r = await readReceiptAction(fd).catch(() => null);
    setReading(false);
    if (!r) return void setAiNote("AI に読み取ってもらえませんでした。手で入れてください");
    if (!r.ok || !r.data) return void setAiNote(r.ok ? "読み取れませんでした。手で入れてください" : r.message);
    const got = r.data;
    setForm((f) => ({
      ...f,
      spentOn: got.spentOn ?? f.spentOn,
      vendor: got.vendor || f.vendor,
      item: got.item || f.item,
      amount: got.amount != null ? got.amount.toLocaleString("ja-JP") : f.amount,
      category: got.category || f.category,
    }));
    setAiNote(r.message ?? null);
  }

  function clearPhoto() {
    if (photo) URL.revokeObjectURL(photo.preview);
    setPhoto(null);
    setAiNote(null);
  }

  function submit() {
    const amount = parseYen(form.amount);
    if (amount == null || Number.isNaN(amount) || amount < 1) return void toast.error("金額を入れてください（税込・円）");
    if (amount > EXPENSE_MAX_AMOUNT) return void toast.error("金額が大きすぎます");
    if (!form.vendor.trim() && !form.item.trim()) return void toast.error("店・支払先を入れてください");
    if (!isDateString(form.spentOn)) return void toast.error("日付を選んでください");
    const fd = new FormData();
    if (form.id) fd.set("id", form.id);
    fd.set(
      "data",
      JSON.stringify({
        paidBy: form.paidBy,
        spentOn: form.spentOn,
        vendor: form.vendor,
        item: form.item,
        purpose: form.purpose,
        category: form.category,
        amount,
        attendees: form.attendees,
        memo: form.memo,
      }),
    );
    if (photo) fd.set("receipt", photo.blob, "receipt.jpg");
    start(async () => {
      const r = await saveCompanyExpense(fd);
      if (!r.ok || !r.data) return void toast.error(r.ok ? "保存できませんでした" : r.message);
      const id = r.data.id;
      setDirty(false);
      if (!isNew) {
        toast.success(r.message);
        return router.push(`/company-expenses?month=${monthOf(form.spentOn)}`);
      }
      toast.success(r.message, {
        action: {
          label: "元に戻す",
          onClick: async () => {
            const u = await setCompanyExpenseVoided(id, true);
            if (u.ok) toast.success("入れた経費を取り消しました");
            else toast.error(u.message);
            setAdded((a) => (a && a.count > 1 ? { ...a, count: a.count - 1 } : null));
          },
        },
      });
      // 続けて入れられるように、日付と払った人だけ残して空にする
      clearPhoto();
      setOtherCategory(false);
      setAdded((a) => ({ month: monthOf(form.spentOn), count: (a?.count ?? 0) + 1 }));
      setForm((f) => ({ ...initial, spentOn: f.spentOn, paidBy: f.paidBy }));
    });
  }

  function voidIt() {
    const id = form.id!;
    start(async () => {
      const r = await setCompanyExpenseVoided(id, true);
      if (!r.ok) return void toast.error(r.message);
      setDirty(false);
      toast.success(r.message, {
        action: {
          label: "元に戻す",
          onClick: async () => {
            const u = await setCompanyExpenseVoided(id, false);
            if (u.ok) {
              toast.success(u.message);
              router.refresh();
            } else toast.error(u.message);
          },
        },
      });
      router.push(`/company-expenses?month=${monthOf(initial.spentOn)}`);
    });
  }

  const busy = pending || reading;
  return (
    <form
      className="flex flex-col gap-5 px-4 pb-8"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {added && (
        <p className="flex items-start gap-2 rounded-xl bg-status-done-bg px-3 py-2 text-sm">
          <CheckIcon className="mt-0.5 size-4 shrink-0 text-status-done" aria-hidden />
          <span>
            この画面で {added.count}件入れました。続けて入れられます。
            <Link href={`/company-expenses?month=${added.month}`} className="ml-1 text-primary underline-offset-2 hover:underline">
              一覧を見る
            </Link>
          </span>
        </p>
      )}

      {/* 領収書（写真）。撮ると AI が読み取って下の欄に入れる */}
      <section aria-label="領収書" className="flex flex-col gap-2 rounded-2xl border bg-card p-3 shadow-card">
        <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-label="レシートを撮る" onChange={(e) => void onPhoto(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
        <input ref={library} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-label="レシートの写真を選ぶ" onChange={(e) => void onPhoto(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
        {photo || receipt?.src ? (
          <div className="flex items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- 撮ったばかりの写真・期限つきのリンクなので、そのまま出す */}
            <img src={photo?.preview ?? receipt!.src!} alt="領収書の写真" className="max-h-40 w-28 shrink-0 rounded-lg border object-contain" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {reading ? (
                <p className="flex items-center gap-2 text-sm font-semibold text-primary">
                  <Loader2Icon className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
                  AI が読み取っています…
                </p>
              ) : aiNote ? (
                <p className="flex items-start gap-2 text-sm">
                  <SparklesIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {aiNote}
                </p>
              ) : !photo && receipt?.src ? (
                <a href={receipt.src} target="_blank" rel="noreferrer" className="text-sm text-primary underline-offset-2 hover:underline">
                  大きく見る
                </a>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => camera.current?.click()}>
                  <CameraIcon />
                  撮り直す
                </Button>
                {photo && (
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={clearPhoto}>
                    <XIcon />
                    写真を外す
                  </Button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" size="lg" className="h-14" disabled={busy} onClick={() => camera.current?.click()}>
                <CameraIcon />
                レシートを撮る
              </Button>
              <Button type="button" size="lg" variant="outline" className="h-14" disabled={busy} onClick={() => library.current?.click()}>
                <ImageIcon />
                写真を選ぶ
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {aiReady ? "撮ると、AI が日付・店・金額・区分を読み取って下に入れます。写真は領収書として残ります。" : "写真は領収書として残ります（AI の読み取りは設定されていないので、下は手で入れてください）。"}
            </p>
          </>
        )}
        {receipt?.url && (
          <a href={receipt.url} target="_blank" rel="noreferrer" className="text-sm break-all text-primary underline-offset-2 hover:underline">
            今のシートの領収書のリンクを開く
          </a>
        )}
      </section>

      <div className="flex flex-col gap-1">
        <Label htmlFor="x-amount">金額（税込・必須）</Label>
        <div className="flex items-center gap-2">
          <Input
            id="x-amount"
            inputMode="numeric"
            autoComplete="off"
            className="h-14 max-w-56 text-2xl font-bold tabular-nums"
            value={form.amount}
            onChange={(e) => set("amount", e.target.value)}
          />
          <span className="text-lg">円</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span id="x-category" className="text-sm font-medium">
          区分
        </span>
        <div role="group" aria-labelledby="x-category" className="flex flex-wrap gap-2">
          {chips.map((c) => {
            const on = form.category === c;
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() => set("category", on ? "" : c)}
                className={cn(
                  "inline-flex h-11 items-center gap-1 rounded-full border px-4 text-base",
                  on ? "border-primary bg-brand-50 font-semibold text-primary" : "border-input text-muted-foreground",
                )}
              >
                {on && <CheckIcon className="size-4" />}
                {c}
              </button>
            );
          })}
          {!otherCategory && (
            <button type="button" onClick={() => setOtherCategory(true)} className="inline-flex h-11 items-center gap-1 rounded-full border border-dashed border-input px-4 text-base text-muted-foreground">
              <PlusIcon className="size-4" />
              ほかの区分
            </button>
          )}
        </div>
        {otherCategory && (
          <Input aria-label="ほかの区分" placeholder="例: 研修・書籍" maxLength={EXPENSE_LIMITS.category} className="max-w-64" value={chips.includes(form.category) ? "" : form.category} onChange={(e) => set("category", e.target.value)} autoFocus />
        )}
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="x-vendor">店・支払先（必須）</Label>
        <Input id="x-vendor" list="x-vendors" autoComplete="off" maxLength={EXPENSE_LIMITS.vendor} placeholder="例: カフェ さくら" value={form.vendor} onChange={(e) => set("vendor", e.target.value)} />
        <datalist id="x-vendors">
          {vendors.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      </div>

      {form.category === "飲食" && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="x-attendees">参加者</Label>
          <Input id="x-attendees" maxLength={EXPENSE_LIMITS.attendees} placeholder="例: 山田、取引先2名" value={form.attendees} onChange={(e) => set("attendees", e.target.value)} />
          <p className="text-sm text-muted-foreground">飲食は、だれと行ったかを入れておくと、あとで経理が困りません。</p>
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">日付</legend>
        <DateQuickPick
          value={form.spentOn}
          onChange={(v) => set("spentOn", v)}
          options={[
            { label: "今日", days: 0 },
            { label: "昨日", days: -1 },
          ]}
        />
        <Input type="date" aria-label="日付" className="max-w-56" value={form.spentOn} onChange={(e) => set("spentOn", e.target.value)} />
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <span id="x-payer" className="text-sm font-medium">
          払った人（立て替えた人）
        </span>
        <div role="group" aria-labelledby="x-payer" className="flex flex-wrap gap-2">
          {[...payers.map((p) => ({ id: p.id as string | null, name: p.name })), { id: null, name: "まだ決めていない" }].map((p) => {
            const on = form.paidBy === p.id;
            return (
              <button
                key={p.id ?? "none"}
                type="button"
                aria-pressed={on}
                onClick={() => set("paidBy", p.id)}
                className={cn(
                  "inline-flex h-11 items-center gap-1 rounded-full border px-4 text-base",
                  on ? "border-primary bg-brand-50 font-semibold text-primary" : "border-input text-muted-foreground",
                )}
              >
                {on && <CheckIcon className="size-4" />}
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      <details className="group rounded-md border" open={!isNew}>
        <summary className="flex h-12 cursor-pointer list-none items-center justify-between px-3 font-medium">
          詳細（買ったもの・用途・参加者・メモ）
          <ChevronDownIcon className="size-5 transition-transform group-open:rotate-180" />
        </summary>
        <div className="grid gap-4 border-t p-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="x-item">買ったもの・サービス</Label>
            <Input id="x-item" maxLength={EXPENSE_LIMITS.item} placeholder="例: 飲食代、コピー用紙" value={form.item} onChange={(e) => set("item", e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="x-purpose">用途</Label>
            <Input id="x-purpose" maxLength={EXPENSE_LIMITS.purpose} placeholder="例: 取引先との打ち合わせ" value={form.purpose} onChange={(e) => set("purpose", e.target.value)} />
          </div>
          {form.category !== "飲食" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="x-attendees-d">参加者</Label>
              <Input id="x-attendees-d" maxLength={EXPENSE_LIMITS.attendees} value={form.attendees} onChange={(e) => set("attendees", e.target.value)} />
            </div>
          )}
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="x-memo">メモ</Label>
            <Textarea id="x-memo" rows={2} maxLength={EXPENSE_LIMITS.memo} value={form.memo} onChange={(e) => set("memo", e.target.value)} />
          </div>
        </div>
      </details>

      {!isNew && (
        <div className="flex flex-col items-start gap-1">
          <Button type="button" variant="outline" disabled={busy} onClick={voidIt}>
            この経費を取り消す
          </Button>
          <p className="text-sm text-muted-foreground">取り消した経費は合計に入りません（記録は残ります）。</p>
        </div>
      )}

      <StickySubmitBar>
        <Button type="submit" size="lg" disabled={busy}>
          {pending ? "保存中…" : reading ? "読み取り中…" : isNew ? "登録する" : "保存する"}
        </Button>
      </StickySubmitBar>
    </form>
  );
}
