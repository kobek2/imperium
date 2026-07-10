"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Legacy `/directory#national-metrics` redirects to the economy page. */
export function DirectoryHashScroll() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/directory") return;

    const handleHash = () => {
      const raw = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
      if (raw === "national-metrics") {
        window.location.replace("/economy");
        return;
      }
      if (!raw) return;
      requestAnimationFrame(() => {
        document.getElementById(raw)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    };

    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, [pathname]);

  return null;
}
