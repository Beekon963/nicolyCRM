/** Server Action の戻り値（画面にそのまま出せる日本語のメッセージを返す） */
export type ActionResult<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; message: string };

type PgError = { code?: string; message?: string; details?: string } | null | undefined;

/** DB のエラーを画面向けの日本語にする */
export function dbErrorMessage(error: PgError, fallback = "保存できませんでした。もう一度お試しください。"): string {
  if (!error) return fallback;
  switch (error.code) {
    case "23505":
      return "同じ内容がすでに登録されています。";
    case "23514":
      return "入力内容を確認してください。";
    case "23503":
      return "関係するデータが見つかりません。画面を読み込み直してください。";
    case "42501":
      return "この操作をする権限がありません。";
    case "P0001":
      // DB 側で日本語のメッセージを出している（締め済み・取引先の種別など）
      return error.message ?? fallback;
    default:
      return fallback;
  }
}

export function ok<T>(message?: string, data?: T): ActionResult<T> {
  return { ok: true, message, data };
}

export function fail(message: string): ActionResult<never> {
  return { ok: false, message };
}
