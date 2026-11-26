"use client";

import { useEffect } from "react";

export function PrintfulReviewFocus({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    const section = document.getElementById("cost-review");
    if (!section) return;
    section.focus({ preventScroll: true });
    section.scrollIntoView({ block: "start" });
  }, [active]);

  return null;
}
