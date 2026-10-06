import Image from "next/image";
import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "ログイン | NICOLY CRM" };

const ERRORS: Record<string, string> = {
  not_allowed: "このアカウントは利用できません。オーナーに確認してください。",
  link_expired: "ログイン用のリンクの有効期限が切れているか、すでに使われています。もう一度リンクを受け取ってください。",
  oauth: "Google でログインできませんでした。招待されたメールアドレスの Google アカウントでログインしてください。",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;
  const rawNext = typeof params.next === "string" ? params.next : "/";
  // 外部サイトへ飛ばされないよう、アプリ内のパスだけ受け付ける
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (!error && (await getAppUser())) redirect(next);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-4 py-12">
      <div className="flex flex-col items-center gap-3">
        <Image src="/logo.png" alt="" width={96} height={74} priority />
        <h1 className="text-2xl font-bold">NICOLY CRM</h1>
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-status-alert/30 bg-status-alert-bg p-3 text-status-alert">
          {ERRORS[error] ?? "ログインできませんでした。もう一度お試しください。"}
        </p>
      )}
      <LoginForm next={next} />
    </main>
  );
}
