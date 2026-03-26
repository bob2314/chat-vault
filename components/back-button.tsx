"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";

type BackButtonProps = {
  fallbackHref?: Route;
  label?: string;
  className?: string;
};

export function BackButton({
  fallbackHref = "/",
  label = "← Back",
  className = "button secondary"
}: BackButtonProps) {
  const router = useRouter();

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }

  return (
    <button type="button" className={className} onClick={handleBack}>
      {label}
    </button>
  );
}
