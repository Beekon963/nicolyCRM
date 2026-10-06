"use client";

import { Toaster as Sonner } from "sonner";

/** 画面下の通知。「元に戻す」はここに出す（要件 §9-7） */
export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      offset={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
      mobileOffset={{ bottom: "calc(5rem + env(safe-area-inset-bottom))" }}
      toastOptions={{ classNames: { toast: "text-base", actionButton: "!h-9 !px-3 !text-sm" } }}
      duration={5000}
    />
  );
}

export { toast } from "sonner";
