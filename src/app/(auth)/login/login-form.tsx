"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/browser";
import { sendLoginLink, type LinkState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LinkState, FormData>(sendLoginLink, null);
  const [googlePending, setGooglePending] = useState(false);

  async function signInWithGoogle() {
    setGooglePending(true);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Button size="lg" variant="outline" onClick={signInWithGoogle} disabled={googlePending}>
        <GoogleIcon />
        Google でログイン
      </Button>

      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        または
        <span className="h-px flex-1 bg-border" />
      </div>

      <form action={action} className="flex flex-col gap-3">
        <Label htmlFor="email">メールアドレス</Label>
        <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required placeholder="you@example.com" />
        <Button type="submit" disabled={pending}>
          {pending ? "送信中…" : "ログイン用のリンクを受け取る"}
        </Button>
        {state && (
          <p role="status" className={state.ok ? "text-status-done" : "text-status-alert"}>
            {state.message}
          </p>
        )}
      </form>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.5-1.1 2.8-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1C3.3 21.3 7.4 24 12 24z" />
      <path fill="#FBBC05" d="M5.3 14.3c-.2-.7-.4-1.5-.4-2.3s.1-1.6.4-2.3V6.6H1.3C.5 8.2 0 10 0 12s.5 3.8 1.3 5.4l4-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4C18 1.2 15.2 0 12 0 7.4 0 3.3 2.7 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
    </svg>
  );
}
