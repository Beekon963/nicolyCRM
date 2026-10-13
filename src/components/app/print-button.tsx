"use client";

import { PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** 印刷・PDF に保存（スマホは共有 →「PDF」、PC は「送信先: PDF に保存」）。印刷ではアプリのメニューなどは出ない */
export function PrintButton({ children = "PDF に保存（印刷）", variant = "default" }: { children?: React.ReactNode; variant?: "default" | "outline" }) {
  return (
    <Button type="button" variant={variant} onClick={() => window.print()}>
      <PrinterIcon />
      {children}
    </Button>
  );
}
