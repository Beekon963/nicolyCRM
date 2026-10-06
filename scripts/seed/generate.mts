/**
 * 開発用のダミーデータ（supabase/seed.sql）を作る。
 *
 *   npm run db:seed:generate   # seed.sql だけ作る
 *   npm run db:reset           # 作ってからローカル DB を作り直す
 *
 * - 実在の人名・電話番号・口座は使わない（電話は 090-0000-xxxx、銀行は「ダミー銀行」）。
 * - 日付は実行した日（日本時間）を基準にする。前月〜翌月の現場ができる。
 * - 乱数は固定のシードを使うので、同じ日に作れば同じ内容になる。
 * - 金額の「目印」（SENTINELS）は、管理者に金額が漏れていないかのテストで使う。
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SEED_PASSWORD, SEED_USERS, SENTINELS } from "./constants.mts";

// ---------------------------------------------------------------------------
// 乱数（固定シード）
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261006);
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

let uuidCounter = 0;
/** 決まった形の UUID（読みやすさとテストのため） */
function uuid(prefix: number): string {
  uuidCounter += 1;
  const hex = uuidCounter.toString(16).padStart(12, "0");
  return `${prefix.toString(16).padStart(8, "0")}-0000-4000-8000-${hex}`;
}

const q = (v: string | null | undefined) => (v == null ? "null" : `'${v.replaceAll("'", "''")}'`);
const n = (v: number | null | undefined) => (v == null ? "null" : String(v));
const b = (v: boolean) => (v ? "true" : "false");

// ---------------------------------------------------------------------------
// 日付（日本時間）
// ---------------------------------------------------------------------------
function todayJst(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
function nextMonthStart(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}
function prevMonthStart(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}
function daysInMonth(monthFirst: string): number {
  const [y, m] = monthFirst.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// 素材（すべて架空）
// ---------------------------------------------------------------------------
const SURNAMES: [string, string][] = [
  ["青木", "あおき"], ["石川", "いしかわ"], ["上田", "うえだ"], ["遠藤", "えんどう"], ["大野", "おおの"],
  ["加藤", "かとう"], ["木村", "きむら"], ["久保", "くぼ"], ["小林", "こばやし"], ["斎藤", "さいとう"],
  ["清水", "しみず"], ["杉山", "すぎやま"], ["関口", "せきぐち"], ["高橋", "たかはし"], ["千葉", "ちば"],
  ["土屋", "つちや"], ["中村", "なかむら"], ["西田", "にしだ"], ["野口", "のぐち"], ["橋本", "はしもと"],
  ["平野", "ひらの"], ["藤井", "ふじい"], ["本田", "ほんだ"], ["松本", "まつもと"], ["三浦", "みうら"],
  ["村上", "むらかみ"], ["森田", "もりた"], ["山口", "やまぐち"], ["吉田", "よしだ"], ["渡辺", "わたなべ"],
];
const GIVEN: [string, string][] = [
  ["翔太", "しょうた"], ["大輔", "だいすけ"], ["健太", "けんた"], ["拓也", "たくや"], ["直樹", "なおき"],
  ["亮", "りょう"], ["悠斗", "ゆうと"], ["蓮", "れん"], ["陽菜", "ひな"], ["美咲", "みさき"],
  ["彩", "あや"], ["結衣", "ゆい"], ["莉子", "りこ"], ["葵", "あおい"], ["真央", "まお"],
  ["優", "ゆう"], ["颯", "はやて"], ["海斗", "かいと"], ["沙也加", "さやか"], ["奈々", "なな"],
];
const STATIONS = [
  "大宮駅", "浦和駅", "川越駅", "所沢駅", "船橋駅", "柏駅", "千葉駅", "横浜駅", "川崎駅", "町田駅",
  "立川駅", "八王子駅", "池袋駅", "新宿駅", "渋谷駅", "品川駅", "錦糸町駅", "北千住駅", "吉祥寺駅", "府中駅",
];
const AREAS = ["東京23区東", "東京23区西", "東京多摩", "埼玉", "千葉", "神奈川", "北関東・山梨"];

const CLIENTS = [
  "株式会社サンプルモバイル", "アオゾラ通信株式会社", "株式会社ミライセールス", "ひかりプロモーション株式会社",
  "株式会社ネクストフィールド", "株式会社ツナグ販売", "スマイルキャリア株式会社", "株式会社エールリンク",
];
const PARTNERS = [
  "株式会社クローズワン", "合同会社セールスブリッジ", "株式会社アップセルズ", "株式会社フロントライン",
  "株式会社イベントプロ", "株式会社モバイルクルー", "有限会社トップクローザー", "株式会社リンクスタッフ",
  "株式会社ブーストセールス", "株式会社ハーモニー販売",
];
const VENUES: { name: string; kana: string; station: string; pref: string; area: number; address: string }[] = [
  { name: "DSサンプル大宮西口", kana: "でぃーえすさんぷるおおみやにしぐち", station: "大宮駅", pref: "埼玉県", area: 3, address: "埼玉県さいたま市大宮区桜木町1-0-0" },
  { name: "DSサンプル浦和", kana: "でぃーえすさんぷるうらわ", station: "浦和駅", pref: "埼玉県", area: 3, address: "埼玉県さいたま市浦和区高砂1-0-0" },
  { name: "ショッピングモール川越", kana: "しょっぴんぐもーるかわごえ", station: "川越駅", pref: "埼玉県", area: 3, address: "埼玉県川越市脇田町0-0" },
  { name: "ファミリーモール所沢", kana: "ふぁみりーもーるところざわ", station: "所沢駅", pref: "埼玉県", area: 3, address: "埼玉県所沢市日吉町0-0" },
  { name: "DSサンプル船橋", kana: "でぃーえすさんぷるふなばし", station: "船橋駅", pref: "千葉県", area: 4, address: "千葉県船橋市本町1-0-0" },
  { name: "ショッピングモール柏", kana: "しょっぴんぐもーるかしわ", station: "柏駅", pref: "千葉県", area: 4, address: "千葉県柏市末広町0-0" },
  { name: "DSサンプル千葉中央", kana: "でぃーえすさんぷるちばちゅうおう", station: "千葉駅", pref: "千葉県", area: 4, address: "千葉県千葉市中央区富士見1-0-0" },
  { name: "ベイサイドモール幕張", kana: "べいさいどもーるまくはり", station: "海浜幕張駅", pref: "千葉県", area: 4, address: "千葉県千葉市美浜区ひび野0-0" },
  { name: "DSサンプル横浜西口", kana: "でぃーえすさんぷるよこはまにしぐち", station: "横浜駅", pref: "神奈川県", area: 5, address: "神奈川県横浜市西区南幸1-0-0" },
  { name: "DSサンプル川崎", kana: "でぃーえすさんぷるかわさき", station: "川崎駅", pref: "神奈川県", area: 5, address: "神奈川県川崎市川崎区駅前本町0-0" },
  { name: "ショッピングモール海老名", kana: "しょっぴんぐもーるえびな", station: "海老名駅", pref: "神奈川県", area: 5, address: "神奈川県海老名市中央1-0-0" },
  { name: "ファミリーモール町田", kana: "ふぁみりーもーるまちだ", station: "町田駅", pref: "東京都", area: 2, address: "東京都町田市原町田6-0-0" },
  { name: "DSサンプル立川", kana: "でぃーえすさんぷるたちかわ", station: "立川駅", pref: "東京都", area: 2, address: "東京都立川市曙町2-0-0" },
  { name: "DSサンプル八王子", kana: "でぃーえすさんぷるはちおうじ", station: "八王子駅", pref: "東京都", area: 2, address: "東京都八王子市旭町0-0" },
  { name: "ショッピングモール府中", kana: "しょっぴんぐもーるふちゅう", station: "府中駅", pref: "東京都", area: 2, address: "東京都府中市宮町1-0-0" },
  { name: "DSサンプル吉祥寺", kana: "でぃーえすさんぷるきちじょうじ", station: "吉祥寺駅", pref: "東京都", area: 1, address: "東京都武蔵野市吉祥寺本町1-0-0" },
  { name: "DSサンプル池袋東口", kana: "でぃーえすさんぷるいけぶくろひがしぐち", station: "池袋駅", pref: "東京都", area: 1, address: "東京都豊島区南池袋1-0-0" },
  { name: "DSサンプル新宿", kana: "でぃーえすさんぷるしんじゅく", station: "新宿駅", pref: "東京都", area: 1, address: "東京都新宿区西新宿1-0-0" },
  { name: "家電ストア渋谷", kana: "かでんすとあしぶや", station: "渋谷駅", pref: "東京都", area: 1, address: "東京都渋谷区道玄坂2-0-0" },
  { name: "DSサンプル錦糸町", kana: "でぃーえすさんぷるきんしちょう", station: "錦糸町駅", pref: "東京都", area: 0, address: "東京都墨田区江東橋3-0-0" },
  { name: "ショッピングモール北千住", kana: "しょっぴんぐもーるきたせんじゅ", station: "北千住駅", pref: "東京都", area: 0, address: "東京都足立区千住旭町0-0" },
  { name: "家電ストア有明", kana: "かでんすとあありあけ", station: "有明駅", pref: "東京都", area: 0, address: "東京都江東区有明1-0-0" },
  { name: "ファミリーモール亀有", kana: "ふぁみりーもーるかめあり", station: "亀有駅", pref: "東京都", area: 0, address: "東京都葛飾区亀有3-0-0" },
  { name: "DSサンプル宇都宮", kana: "でぃーえすさんぷるうつのみや", station: "宇都宮駅", pref: "栃木県", area: 6, address: "栃木県宇都宮市駅前通り1-0-0" },
  { name: "テレアポ", kana: "てれあぽ", station: "", pref: "", area: -1, address: "" },
];

const ITEM_NAMES = ["新規", "MNP", "機種変更", "ドコモ光", "home 5G", "dカード・でんき等の付帯"];
const RANK_NAMES = ["SS", "S", "A＋", "A", "B", "C", "D", "E"];
const RANK_RATES = [21000, 19000, 18000, 17000, 16000, 15000, 14000, 13000];

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------
const out: string[] = [];
const sql = (s: string) => out.push(s);

const today = todayJst();
const thisMonth = monthStart(today);
const prevMonth = prevMonthStart(today);
const nextMonth = nextMonthStart(today);

sql(`-- 自動生成ファイル（scripts/seed/generate.mts）。編集しない。基準日: ${today}（日本時間）`);
sql("set session_replication_role = replica; -- 監査ログ・ロックなどのトリガーを止めて流し込む");

// 利用者
for (const u of Object.values(SEED_USERS)) {
  sql(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', ${q(u.id)}, 'authenticated', 'authenticated', ${q(u.email)},
  extensions.crypt(${q(SEED_PASSWORD)}, extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');`);
  sql(`insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), ${q(u.id)}, ${q(u.id)}, jsonb_build_object('sub', ${q(u.id)}, 'email', ${q(u.email)}, 'email_verified', true), 'email', now(), now(), now());`);
}
sql(`insert into public.app_users (id, name, email, role, is_active) values
  (${q(SEED_USERS.owner.id)}, ${q(SEED_USERS.owner.name)}, ${q(SEED_USERS.owner.email)}, 'owner', true),
  (${q(SEED_USERS.manager.id)}, ${q(SEED_USERS.manager.name)}, ${q(SEED_USERS.manager.email)}, 'manager', true),
  (${q(SEED_USERS.inactive.id)}, ${q(SEED_USERS.inactive.name)}, ${q(SEED_USERS.inactive.email)}, 'manager', false);`);

const sel = (table: string, name: string) => `(select id from public.${table} where name = ${q(name)})`;

// エリア
const areaIds = AREAS.map(() => uuid(0xa));
sql(
  `insert into public.areas (id, name, sort_order) values\n` +
    AREAS.map((a, i) => `  (${q(areaIds[i])}, ${q(a)}, ${i + 1})`).join(",\n") +
    ";",
);

// ランクの基準日当（★）
sql(
  `insert into public.rank_rates (rank_id, base_daily_rate) values\n` +
    RANK_NAMES.map((r, i) => `  (${sel("ranks", r)}, ${i === 0 ? SENTINELS.rankRate : RANK_RATES[i]})`).join(",\n") +
    ";",
);

// インセンティブ単価（★）
const INCENTIVES = [1000, 1500, 500, 2000, 1500, 300];
sql(
  `insert into public.incentive_rates (item_id, amount) values\n` +
    ITEM_NAMES.map((it, i) => `  (${sel("items", it)}, ${i === 0 ? SENTINELS.incentiveRate : INCENTIVES[i]})`).join(",\n") +
    ";",
);

// 会社
type Company = { id: string; name: string; kind: "client" | "partner" };
const companies: Company[] = [];
const statuses = ["not_contacted", "contacted", "meeting_set", "met", "active", "dormant"] as const;
CLIENTS.forEach((name, i) => {
  const id = uuid(0xc);
  companies.push({ id, name, kind: "client" });
  sql(`insert into public.companies (id, kind, name, phone, address, status, priority, owner_user_id, next_action_date, next_action, memo)
values (${q(id)}, 'client', ${q(name)}, ${q(`03-0000-${String(1000 + i).padStart(4, "0")}`)}, ${q("東京都千代田区丸の内0-0-0")}, 'active',
  ${q(pick(["high", "mid", "low"]))}, ${q(i % 2 ? SEED_USERS.manager.id : SEED_USERS.owner.id)}, ${q(addDays(today, int(-3, 10)))}, ${q(pick(["来月の案件を確認", "請求内容の確認", "新しい会場の相談"]))}, '');`);
  sql(`insert into public.contacts (company_id, name, title, phone, email) values (${q(id)}, ${q(`${pick(SURNAMES)[0]} 担当`)}, ${q(pick(["営業部長", "担当", "マネージャー"]))}, ${q(`080-0000-${String(2000 + i).padStart(4, "0")}`)}, ${q(`client${i + 1}@example.com`)});`);
  sql(`insert into public.company_billing (company_id, closing_day, bill_transport) values (${q(id)}, 0, ${b(i % 3 === 0)});`);
});
PARTNERS.forEach((name, i) => {
  const id = uuid(0xc);
  companies.push({ id, name, kind: "partner" });
  const status = statuses[i % 6];
  const hasNext = status !== "active" && status !== "dormant" ? i % 4 !== 0 : false;
  sql(`insert into public.companies (id, kind, name, phone, status, priority, owner_user_id, next_action_date, next_action)
values (${q(id)}, 'partner', ${q(name)}, ${q(`03-0000-${String(3000 + i).padStart(4, "0")}`)}, ${q(status)}, ${q(pick(["high", "mid", "low"]))},
  ${q(i % 2 ? SEED_USERS.manager.id : SEED_USERS.owner.id)}, ${hasNext ? q(addDays(today, int(-5, 14))) : "null"}, ${q(hasNext ? pick(["電話でアポ取り", "資料を送る", "商談日程の調整"]) : "")});`);
});
const clients = companies.filter((c) => c.kind === "client");

// 取引先ごとに使う獲得項目（1社だけ絞る）
sql(
  `insert into public.company_items (company_id, item_id) values\n` +
    ["新規", "MNP", "機種変更"].map((it) => `  (${q(clients[7].id)}, ${sel("items", it)})`).join(",\n") +
    ";",
);

// 標準単価（★）: 取引先ごと（人日・成果）、一部は取引先×会場
clients.forEach((c, i) => {
  const closer = 22000 + (i % 4) * 1000;
  sql(`insert into public.client_rates (company_id, kind, role_id, amount) values
  (${q(c.id)}, 'per_person_day', ${sel("roles", "クローザー")}, ${i === 0 ? SENTINELS.clientRate : closer}),
  (${q(c.id)}, 'per_person_day', ${sel("roles", "キャッチャー")}, ${closer - 7000}),
  (${q(c.id)}, 'per_person_day', ${sel("roles", "ディレクター")}, ${closer + 3000});`);
  if (i % 2 === 0) {
    sql(`insert into public.client_rates (company_id, kind, item_id, amount) values (${q(c.id)}, 'per_item', ${sel("items", "MNP")}, 5000);`);
  }
});

// 会場
const venueIds: string[] = [];
VENUES.forEach((v) => {
  const id = uuid(0x7);
  venueIds.push(id);
  sql(`insert into public.venues (id, name, kana, address, nearest_station, prefecture, area_id, access_notes, green_room, parking, memo)
values (${q(id)}, ${q(v.name)}, ${q(v.kana)}, ${q(v.address)}, ${q(v.station)}, ${q(v.pref)}, ${v.area >= 0 ? q(areaIds[v.area]) : "null"},
  ${q(v.address ? "従業員入口から入館。受付で「NICOLYです」と伝える" : "")}, ${q(v.address ? pick(["バックヤード奥", "3階会議室", "なし（休憩は外で）"]) : "")},
  ${q(v.address ? pick(["なし", "提携駐車場あり（2時間無料）", "近隣のコインパーキング"]) : "")}, '');`);
});
// 取引先×会場の標準単価（★）
sql(`insert into public.client_rates (company_id, venue_id, kind, role_id, amount) values (${q(clients[1].id)}, ${q(venueIds[0])}, 'per_person_day', ${sel("roles", "クローザー")}, 27000);`);

// スタッフ
type Staff = { id: string; name: string; rank: number; roles: string[]; areas: number[]; status: string };
const staff: Staff[] = [];
const usedNames = new Set<string>();
for (let i = 0; i < 40; i++) {
  let sname: [string, string], gname: [string, string], name: string;
  do {
    sname = pick(SURNAMES);
    gname = pick(GIVEN);
    name = `${sname[0]} ${gname[0]}`;
  } while (usedNames.has(name));
  usedNames.add(name);
  const rank = Math.min(7, Math.floor(rand() * rand() * 9) + (i < 4 ? 0 : 2));
  const roles = chance(0.7) ? ["クローザー"] : ["キャッチャー"];
  if (chance(0.35)) roles.push(roles[0] === "クローザー" ? "キャッチャー" : "クローザー");
  if (rank <= 2 && chance(0.4)) roles.push("ディレクター");
  const area1 = int(0, 6);
  const areas = chance(0.5) ? [area1, (area1 + 1) % 7] : [area1];
  const status = i === 37 ? "ended" : i >= 35 ? "paused" : "active";
  const id = uuid(0x5);
  staff.push({ id, name, rank, roles, areas, status });
  sql(`insert into public.staff (id, name, kana, phone, line_name, nearest_station, rank_id, status, memo)
values (${q(id)}, ${q(name)}, ${q(`${sname[1]} ${gname[1]}`)}, ${q(`090-0000-${String(i + 1).padStart(4, "0")}`)}, ${q(gname[1])},
  ${q(pick(STATIONS))}, ${sel("ranks", RANK_NAMES[rank])}, ${q(status)}, ${q(i % 9 === 0 ? "キャッチ力〇 / クローザー力◎ / 知識: docomo, au" : "")});`);
  for (const r of roles) sql(`insert into public.staff_roles (staff_id, role_id) values (${q(id)}, ${sel("roles", r)});`);
  for (const a of areas) sql(`insert into public.staff_areas (staff_id, area_id) values (${q(id)}, ${q(areaIds[a])});`);
  sql(`insert into public.staff_private (staff_id, base_daily_rate, withholding_method, invoice_number, contract_date, bank_name, bank_branch, account_type, account_number, account_holder_kana)
values (${q(id)}, ${i === 0 ? SENTINELS.baseDailyRate : RANK_RATES[rank]}, ${q(pick(["none", "none", "fee", "sales_agent"]))},
  ${chance(0.3) ? q(`T${String(1000000000000 + i).padStart(13, "0")}`) : "null"}, ${q(addDays(today, -int(30, 400)))},
  'ダミー銀行', ${q(pick(["本店", "駅前支店", "中央支店"]))}, 'ordinary', ${q(i === 0 ? SENTINELS.accountNumber : String(1000000 + i * 7))}, ${q(`${sname[1]} ${gname[1]}`)});`);
}
const activeStaff = staff.filter((s) => s.status === "active");

// NG 設定
sql(`insert into public.staff_ng (staff_id, venue_id, reason) values (${q(staff[3].id)}, ${q(venueIds[2])}, '会場側から指名NG');`);
sql(`insert into public.staff_ng (staff_id, company_id, reason) values (${q(staff[5].id)}, ${q(clients[2].id)}, '過去のトラブルのため');`);

// 稼働可能日（今月・翌月）。8割が提出済み
for (const s of activeStaff) {
  for (const month of [thisMonth, nextMonth]) {
    const submitRate = month === thisMonth ? 0.9 : 0.6;
    if (!chance(submitRate)) continue;
    const days = daysInMonth(month);
    const values: string[] = [];
    for (let d = 0; d < days; d++) {
      const date = addDays(month, d);
      const wd = weekday(date);
      const p = wd === 0 || wd === 6 ? 0.8 : 0.35;
      const r = rand();
      const st = r < p ? "ok" : r < p + 0.1 ? "maybe" : chance(0.5) ? "ng" : null;
      if (st) values.push(`(${q(s.id)}, ${q(date)}, ${q(st)}, 'self')`);
    }
    if (values.length) sql(`insert into public.availability (staff_id, date, status, source) values\n  ${values.join(",\n  ")};`);
    sql(`insert into public.availability_submissions (staff_id, month, memo, submitted_at, source) values (${q(s.id)}, ${q(month)}, ${q(chance(0.2) ? "土日は午後からなら可" : "")}, now(), 'self');`);
  }
}

// 現場（前月1日〜翌月半ば、週末中心で約100件）
type Ev = { id: string; date: string; client: Company; venue: number; req: Record<string, number> };
const events: Ev[] = [];
const start = prevMonth;
const end = addDays(nextMonth, 14);
let groupCount = 0;
for (let date = start; date <= end; date = addDays(date, 1)) {
  const wd = weekday(date);
  const isWeekend = wd === 0 || wd === 6;
  const count = isWeekend ? int(2, 4) : chance(0.45) ? 1 : 0;
  for (let k = 0; k < count; k++) {
    const venue = int(0, VENUES.length - 2);
    const client = clients[(venue + k) % clients.length];
    const req: Record<string, number> = { クローザー: int(1, 2) };
    if (chance(0.6)) req["キャッチャー"] = 1;
    if (chance(0.15)) req["ディレクター"] = 1;
    events.push({ id: uuid(0xe), date, client, venue, req });
  }
}
// テレアポ（平日にいくつか）
for (let i = 0; i < 4; i++) {
  const date = addDays(thisMonth, 2 + i * 5);
  events.push({ id: uuid(0xe), date, client: clients[0], venue: VENUES.length - 1, req: { クローザー: 1 } });
}
// 一括作成のグループ（同じ会場の週末連続）を1つ
const groupId = uuid(0x9);
sql(`insert into public.event_groups (id, name, created_by) values (${q(groupId)}, ${q(`${VENUES[8].name} 週末`)}, ${q(SEED_USERS.owner.id)});`);
groupCount++;

const staffBusy = new Map<string, Set<string>>(); // date -> staff ids
const assignmentRows: string[] = [];
const reportRows: string[] = [];
const reportItemRows: string[] = [];
const expenseRows: string[] = [];
const noteRows: string[] = [];

for (const ev of events) {
  const v = VENUES[ev.venue];
  const inGroup = ev.venue === 8 && ev.date >= thisMonth;
  sql(`insert into public.events (id, client_id, venue_id, date, start_time, end_time, meeting_time, meeting_place, belongings, notes, group_id, created_by)
values (${q(ev.id)}, ${q(ev.client.id)}, ${q(venueIds[ev.venue])}, ${q(ev.date)}, '10:00', '19:00', '09:30',
  ${q(v.address ? "従業員入口前" : "事務所")}, ${q(v.address ? "黒のパンツ・スニーカー、筆記用具" : "")}, ${q(chance(0.3) ? "駐車場の出入口付近はチラシ配布NG" : "")},
  ${inGroup ? q(groupId) : "null"}, ${q(SEED_USERS.owner.id)});`);
  for (const [role, cnt] of Object.entries(ev.req)) {
    sql(`insert into public.event_requirements (event_id, role_id, required_count) values (${q(ev.id)}, ${sel("roles", role)}, ${cnt});`);
  }

  const daysFromToday = (() => {
    const [y1, m1, d1] = ev.date.split("-").map(Number);
    const [y2, m2, d2] = today.split("-").map(Number);
    return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000);
  })();
  const busy = staffBusy.get(ev.date) ?? new Set<string>();
  staffBusy.set(ev.date, busy);

  for (const [role, cnt] of Object.entries(ev.req)) {
    // 未来の現場は一部を欠員のままにする
    let fill = cnt;
    if (daysFromToday >= 0 && chance(0.2)) fill = Math.max(0, cnt - 1);
    const candidates = activeStaff.filter((s) => s.roles.includes(role) && !busy.has(s.id));
    for (let k = 0; k < fill && candidates.length; k++) {
      const s = candidates.splice(Math.floor(rand() * candidates.length), 1)[0];
      busy.add(s.id);
      const aid = uuid(0xaa);
      let status = "confirmed";
      if (daysFromToday < 0 && chance(0.04)) status = "no_show";
      else if (daysFromToday < 0 && chance(0.03)) status = "cancelled";
      else if (daysFromToday >= 0 && chance(0.25)) status = "offered";
      const offeredAt = `(timestamptz ${q(`${ev.date} 12:00+09`)} - interval '${int(5, 20)} days')`;
      const responded = status === "offered" ? "null" : `${offeredAt} + interval '${int(1, 30)} hours'`;
      const noticeSent = status === "confirmed" && chance(0.85) ? `${offeredAt} + interval '2 days'` : "null";
      const reminderSent = status === "confirmed" && daysFromToday < 1 ? `timestamptz ${q(`${addDays(ev.date, -1)} 18:00+09`)}` : "null";
      assignmentRows.push(
        `(${q(aid)}, ${q(ev.id)}, ${q(s.id)}, ${sel("roles", role)}, ${q(status)}, ${offeredAt}, ${responded}, ${status === "offered" ? "null" : "'self'"}, ${noticeSent}, ${reminderSent}, ${status === "cancelled" || status === "no_show" ? q(pick(["self", "no_contact", "client"])) : "null"}, ${q(SEED_USERS.owner.id)})`,
      );
      if (status === "cancelled" || status === "no_show") {
        noteRows.push(`(${q(s.id)}, ${q(ev.date)}, 'last_minute_cancel', ${q(`${status === "cancelled" ? "キャンセル" : "当日不稼働"}（${ev.date.slice(5).replace("-", "/")} ${v.name}）`)}, true, ${q(aid)})`);
      }
      // 実績（過去の確定分）
      if (status === "confirmed" && daysFromToday <= 0) {
        const reported = daysFromToday <= -3 ? chance(0.95) : chance(0.6);
        if (reported) {
          const confirmed = daysFromToday <= -8 ? true : daysFromToday <= -2 ? chance(0.5) : false;
          reportRows.push(
            `(${q(aid)}, ${q(chance(0.3) ? pick(["客足少なめ", "午後から好調", "雨で人通り少", "MNP の相談多め"]) : "")}, timestamptz ${q(`${ev.date} 20:30+09`)}, 'self', ${confirmed ? `timestamptz ${q(`${addDays(ev.date, 3)} 10:00+09`)}` : "null"}, ${confirmed ? q(SEED_USERS.manager.id) : "null"})`,
          );
          const items = ev.client.id === clients[7].id ? ITEM_NAMES.slice(0, 3) : ITEM_NAMES;
          for (const it of items) {
            const base = role === "クローザー" ? 1.2 : 0.4;
            const rep = Math.max(0, Math.round((rand() * 2 - 0.3) * base * (it === "MNP" || it === "新規" ? 2 : 1)));
            if (rep === 0 && chance(0.6)) continue;
            let conf: number | null = confirmed ? rep : null;
            let reason = "null";
            if (confirmed && rep > 0 && chance(0.1)) {
              conf = rep - 1;
              reason = q(pick(["cancelled", "rejected", "input_error"]));
            }
            reportItemRows.push(`(${q(aid)}, ${sel("items", it)}, ${rep}, ${n(conf)}, ${reason})`);
          }
          if (v.address) {
            const transport = int(3, 15) * 100 + (chance(0.5) ? 40 : 0);
            const approved = confirmed || chance(0.3);
            expenseRows.push(`(${q(aid)}, ${q(s.id)}, 'transport', ${transport}, ${q(`${pick(STATIONS)}〜${v.station}`)}, ${q(approved ? "approved" : "pending")}, 'self', ${approved ? q(SEED_USERS.manager.id) : "null"}, ${approved ? "now()" : "null"})`);
          }
        }
      }
    }
  }
  // 補欠を1件
  if (daysFromToday > 3 && chance(0.08)) {
    const cand = activeStaff.filter((s) => !busy.has(s.id));
    if (cand.length) {
      const s = pick(cand);
      busy.add(s.id);
      assignmentRows.push(
        `(${q(uuid(0xaa))}, ${q(ev.id)}, ${q(s.id)}, ${sel("roles", "クローザー")}, 'waitlisted', now() - interval '2 days', now() - interval '1 day', 'self', null, null, null, ${q(SEED_USERS.owner.id)})`,
      );
    }
  }
}

if (assignmentRows.length) {
  sql(
    `insert into public.assignments (id, event_id, staff_id, role_id, status, offered_at, responded_at, response_source, confirm_notice_sent_at, reminder_sent_at, cancel_reason_code, created_by) values\n  ` +
      assignmentRows.join(",\n  ") +
      ";",
  );
}
if (reportRows.length) {
  sql(`insert into public.reports (assignment_id, comment, submitted_at, source, confirmed_at, confirmed_by) values\n  ${reportRows.join(",\n  ")};`);
}
if (reportItemRows.length) {
  sql(`insert into public.report_items (assignment_id, item_id, reported_count, confirmed_count, diff_reason) values\n  ${reportItemRows.join(",\n  ")};`);
}
if (expenseRows.length) {
  sql(`insert into public.expenses (assignment_id, staff_id, kind, amount, memo, status, source, reviewed_by, reviewed_at) values\n  ${expenseRows.join(",\n  ")};`);
}
if (noteRows.length) {
  sql(`insert into public.staff_notes (staff_id, date, kind, memo, is_auto, assignment_id) values\n  ${noteRows.join(",\n  ")};`);
}
sql(`insert into public.staff_notes (staff_id, date, kind, memo) values
  (${q(staff[1].id)}, ${q(addDays(today, -20))}, 'good', '店長からお礼の連絡あり'),
  (${q(staff[6].id)}, ${q(addDays(today, -12))}, 'late', '電車遅延で15分遅れ（事前連絡あり）');`);

// 日当の上書き・調整額の目印（★）
sql(`insert into public.assignment_private (assignment_id, daily_rate_override)
select id, ${SENTINELS.dailyRateOverride} from public.assignments where status = 'confirmed' order by id limit 1;`);
sql(`insert into public.payment_adjustments (staff_id, month, amount, reason) values (${q(staff[2].id)}, ${q(prevMonth)}, ${SENTINELS.adjustment}, '前月分の精算');`);

sql(`insert into public.monthly_targets (month, revenue, gross_profit) values (${q(thisMonth)}, 5000000, 1800000);`);

sql("set session_replication_role = origin;");

const file = join(dirname(fileURLToPath(import.meta.url)), "../../supabase/seed.sql");
writeFileSync(file, out.join("\n\n") + "\n");
console.log(
  `seed.sql を作成しました（基準日 ${today}、スタッフ ${staff.length}人、会社 ${companies.length}社、会場 ${VENUES.length}か所、現場 ${events.length}件、アサイン ${assignmentRows.length}件、グループ ${groupCount}）`,
);
