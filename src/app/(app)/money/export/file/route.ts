import { notFound } from "next/navigation";
import { getAppUser } from "@/lib/auth";
import { buildExport, EXPORT_KINDS, type ExportKind } from "@/lib/data/exports";

/** ★ 書き出しのファイル（オーナーだけ。管理者・ログインしていない人には 404） */
export async function GET(req: Request) {
  const user = await getAppUser();
  if (user?.role !== "owner") notFound();
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as ExportKind;
  const month = url.searchParams.get("month") ?? "";
  if (!EXPORT_KINDS.includes(kind) || (kind !== "backup" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) notFound();

  const file = await buildExport(kind, month);
  if (!file.ok) return new Response(file.message, { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } });
  // 日本語のファイル名は RFC 5987 の書き方で渡す（古いブラウザ用に英数字の名前も付ける）
  const ascii = `nicoly-${kind}-${kind === "backup" ? "all" : month}.${file.filename.split(".").pop()}`;
  return new Response(file.body as BodyInit, {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "cache-control": "no-store",
    },
  });
}
