"use client";

import { usePathname } from "next/navigation";
import { HistoryBackButton } from "@/components/history-back-button";

/**
 * Renders the global back button on every route except the home root ("/"),
 * where there's no meaningful destination to navigate back to.
 */
export function MaybeBackButton() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  return <HistoryBackButton />;
}
