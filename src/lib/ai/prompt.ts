import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TextBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { addDays, formatLongJa } from "@/lib/date";
import { getMasters } from "@/lib/data/masters";
import { TEMPLATE_KIND, USER_ROLE } from "@/lib/labels";
import type { AiContext } from "./common";

/**
 * AI アシスタントへの指示（Phase 4-4）。
 * 変わらない部分（ルール・操作マニュアル）は先頭にまとめてキャッシュし、毎回変わる部分（今日・利用者・マスタ）はあとに置く。
 */

const RULES = `あなたは NICOLY（docomo 関連の携帯の催事を受託し、個人事業主のスタッフに再委託する会社）の社内CRM の AI アシスタントです。
使う人はオーナーと管理者です。スマホで使うことが多いので、短く、分かりやすく答えてください。

# 話し方
- 日本語で、専門用語を使わずに答える。ID・英語の値・システムの言葉（null など）は画面に出さない
- マークダウンの記号（# や ** や表）は使わない。箇条書きは「・」、手順は「1.」「2.」
- 言葉: 業務委託なので「シフト・出勤・勤怠」は「稼働・稼働可能日」、「給与・給料」は「報酬」、「従業員・社員」は「スタッフ」と言う

# データの質問
- 数字や名前は、必ず道具で調べてから答える。推測で作らない。見つからないときはそう伝える
- 人の名前は search で探す。名字だけ・LINE の表示名でも探せる。同じ名前の人が複数いたら、どの人か聞く
- 「今日」「明日」「来週」は日本時間で考える（今日の日付は下に書いてある）

# 金額
- 管理者には金額（単価・日当・インセンティブ単価・売上・報酬・支払額・粗利）を答えない。聞かれたら「金額はオーナーだけが見られます」と答える
- 金額を調べる道具（money_month）があるのはオーナーのときだけ

# 登録・変更（大事）
- 登録・変更は、必ず propose_* の道具で「確認カード」を出す。あなたが直接登録することはできない
- 確認カードを出したら「内容を確かめて『登録する』を押してください」と短く伝える。登録したとは言わない
- ID は道具で確かめたものだけを使う。分からない・合わないところは、カードを出す前に聞く
- できない操作（削除・お金の設定・締め・権限の変更など）は、画面のどこで行うかを案内する

# 画像（LINE のスクショなど）
- まず、何の情報か判断する: 実績の報告（件数・コメント） / 稼働可能日（行ける日・行けない日） / 現場の依頼（日付・会場・人数） / 営業のやりとり
- 読み取った内容を短く整理して見せる。読み取れない・自信がないところは「？」を付けてはっきり伝える
- 名前は search、現場は list_events（日付と会場）で確かめてから、合う propose_* で確認カードを出す
- 実績の報告は「速報」として入る。確定は「実績確認」の画面で行うと伝える
- 報告の項目名は、獲得項目の名前に合わせる。取引先が使う獲得項目を決めているときは、その中から選ぶ
- 下の「言いかえ表」にある書き方（例: キヘン）は、その項目にする。「（仮）」と書いてあれば「（仮）」の付いた項目にする
- どの項目か分からない書き方は、推測で選ばずに「？」を付けて聞く

# 文面の下書き
- LINE にそのまま貼れる形で書く。下の「文面テンプレート」の書き方・言葉づかいに合わせる
- マイページの URL など、スタッフ本人の鍵は扱えない。必要なら「現場の画面の『確定連絡』『打診』から送ると URL が入ります」と案内する
- 日報（取引先ごとの書式の件数の文章）は daily_report で作れる

# 使い方の案内
- 下の「操作マニュアル」に沿って、画面の場所（例: その他 → 研修の予約）と押すボタンを案内する。マニュアルにないことは「分かりません」と伝える

# 個人情報
- 電話番号・住所・口座は道具から返らない。必要なら、その画面で見てもらう`;

let manualCache: string | null = null;
async function manual(): Promise<string> {
  if (manualCache != null) return manualCache;
  try {
    manualCache = await readFile(path.join(process.cwd(), "docs/manual_admin.md"), "utf8");
  } catch {
    manualCache = "";
  }
  return manualCache;
}

export async function buildSystem(ctx: AiContext): Promise<TextBlockParam[]> {
  const { supabase, user, today } = ctx;
  const [masters, { data: clients }, { data: templates }, { data: formats }, { data: aliases }, text] = await Promise.all([
    getMasters(),
    supabase.from("companies").select("id, name, company_items(item_id)").eq("kind", "client").eq("is_active", true).order("name").limit(100),
    supabase.from("message_templates").select("kind, body"),
    supabase.from("report_formats").select("name").eq("is_active", true).order("sort_order"),
    supabase.from("item_aliases").select("alias, item_id, company:companies(name)").order("alias").limit(300),
    manual(),
  ]);
  const active = <T extends { is_active: boolean }>(xs: T[]) => xs.filter((x) => x.is_active);
  const itemName = (id: string) => masters.itemById.get(id)?.name ?? "";
  // 取引先が使う獲得項目を決めているときは、その名前も出す（NextWave の公認名称など）
  const clientLine = (c: { id: string; name: string; company_items: { item_id: string }[] }) => {
    const names = c.company_items.filter((i) => masters.itemById.get(i.item_id)?.is_active).map((i) => itemName(i.item_id));
    return `- ${c.name}: ${c.id}${names.length ? `（使う獲得項目: ${names.join("、")}）` : ""}`;
  };
  const dynamic = [
    `# 今日と使っている人`,
    `今日: ${formatLongJa(today)}（${today}）、明日: ${addDays(today, 1)}`,
    `使っている人: ${user.name}（${USER_ROLE[user.role]}）${user.role === "manager" ? "。金額は答えない" : ""}`,
    ``,
    `# 役割（role_id）`,
    ...active(masters.roles).map((r) => `- ${r.name}: ${r.id}`),
    `# 獲得項目（item_id）`,
    ...active(masters.items).map((i) => `- ${i.name}: ${i.id}`),
    `# ランク: ${active(masters.ranks).map((r) => r.name).join("、")}`,
    `# エリア: ${active(masters.areas).map((a) => a.name).join("、")}`,
    `# 取引先（client_id）`,
    ...(clients ?? []).map(clientLine),
    `# 言いかえ表（LINE の報告の書き方 → 獲得項目。かっこの取引先の現場だけで使う。かっこがなければ全部の取引先）`,
    ...((aliases ?? []).length ? (aliases ?? []).map((a) => `- ${a.alias} → ${itemName(a.item_id)}${a.company ? `（${a.company.name}）` : ""}`) : ["なし"]),
    `# 日報のフォーマット: ${(formats ?? []).map((f) => f.name).join("、") || "なし"}`,
    ``,
    `# 文面テンプレート（{名前} などは差し込み）`,
    ...(templates ?? []).map((t) => `## ${TEMPLATE_KIND[t.kind]?.label ?? t.kind}\n${t.body}`),
  ].join("\n");
  return [
    { type: "text", text: `${RULES}\n\n# 操作マニュアル（オーナー・管理者向け）\n${text}`, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamic },
  ];
}
