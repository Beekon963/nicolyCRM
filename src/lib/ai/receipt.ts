import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { EXPENSE_LIMITS, EXPENSE_MAX_AMOUNT } from "@/lib/company-expenses";
import { isDateString, todayJst } from "@/lib/date";
import { aiClient, aiConfigured, aiErrorMessage, resolveModel } from "./config";

/**
 * レシート・領収書の写真から、日付・店・買ったもの・金額・区分を読み取る（Phase 16 会社の経費）。
 * 読み取った値は入力欄に入れるだけ。登録はオーナーが確かめて「登録する」を押したとき（AI は書き込まない）。
 * キーはサーバーだけで使い、モデルは ANTHROPIC_MODEL（空なら一番新しい高性能のもの）。
 */

const Receipt = z.object({
  is_receipt: z.boolean().describe("レシート・領収書・請求書の写真なら true"),
  date: z.string().nullable().describe("支払った日（YYYY-MM-DD）"),
  vendor: z.string().nullable().describe("店・支払先の名前"),
  item: z.string().nullable().describe("買ったもの・サービスを短く"),
  amount: z.number().int().nullable().describe("支払った合計金額（税込・円）"),
  category: z.string().nullable().describe("区分"),
});

export type ReceiptReading = { spentOn: string | null; vendor: string; item: string; amount: number | null; category: string };

export type ReceiptImage = { data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" };

/** AI に渡す決まり（最初の行の「レシートを読み取る係」は、画面テストの偽の AI が見分けるのにも使う） */
export function receiptPrompt(categories: string[], today = todayJst()): string {
  return [
    "あなたは、日本の会社の経費の記録を手伝うレシートを読み取る係です。写真のレシート・領収書から、次の値を読み取ってください。",
    `- date: 支払った日を YYYY-MM-DD で。和暦は西暦に直す。年が書いていなければ、今日（${today}）以前でいちばん近い日。読めなければ null`,
    "- vendor: 店・支払先の名前（支店名まで）。読めなければ null",
    "- item: 買ったもの・サービスを短く（例: 飲食代、タクシー代、コピー用紙、ソフトの利用料）",
    "- amount: 支払った合計金額（税込・円・整数）。「合計」「お支払い」の額で、お預かり・お釣り・小計・ポイントではない。読めなければ null",
    `- category: 次のうち一番近いもの: ${categories.map((c) => `「${c}」`).join("")}。どれにも合わなければ「その他」`,
    "- is_receipt: レシート・領収書・請求書の写真でなければ false（ほかは null）",
  ].join("\n");
}

export async function readReceipt(image: ReceiptImage, categories: string[]): Promise<{ ok: true; reading: ReceiptReading } | { ok: false; message: string }> {
  if (!aiConfigured()) return { ok: false, message: "AI の読み取りが設定されていません。手で入れてください（オーナーが Vercel の ANTHROPIC_API_KEY を入れると使えます）" };
  const client = aiClient();
  try {
    const res = await client.messages.parse({
      model: await resolveModel(client),
      max_tokens: 4000,
      system: receiptPrompt(categories),
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
            { type: "text", text: "このレシートを読み取ってください。" },
          ],
        },
      ],
      output_config: { effort: "low", format: zodOutputFormat(Receipt) },
    });
    const r = res.parsed_output;
    if (res.stop_reason === "refusal" || !r || !r.is_receipt) return { ok: false, message: "レシートが読み取れませんでした。手で入れてください" };
    const amount = r.amount != null && Number.isInteger(r.amount) && r.amount >= 1 && r.amount <= EXPENSE_MAX_AMOUNT ? r.amount : null;
    const reading: ReceiptReading = {
      spentOn: r.date && isDateString(r.date) ? r.date : null,
      vendor: (r.vendor ?? "").trim().slice(0, EXPENSE_LIMITS.vendor),
      item: (r.item ?? "").trim().slice(0, EXPENSE_LIMITS.item),
      amount,
      category: (r.category ?? "").trim().slice(0, EXPENSE_LIMITS.category),
    };
    if (!reading.vendor && !reading.item && reading.amount == null) return { ok: false, message: "レシートが読み取れませんでした。手で入れてください" };
    return { ok: true, reading };
  } catch (e) {
    // 会話の画面向けの「新しい会話で…」は、ここでは合わない
    if (e instanceof Anthropic.BadRequestError) return { ok: false, message: "この写真は読み取れませんでした。撮り直すか、手で入れてください" };
    return { ok: false, message: aiErrorMessage(e) };
  }
}
