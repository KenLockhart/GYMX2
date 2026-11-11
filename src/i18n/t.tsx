"use client";

import { useLocale } from "./client";
import { translate, type Tr } from "./phrases";

// <T>English text</T> shows the text in the viewer's language. Works in server and client components.
export function T({
  children,
  vars,
}: {
  children: string;
  vars?: Record<string, string | number>;
}) {
  return <>{translate(children, useLocale(), vars)}</>;
}

// For text in attributes (labels, placeholders) inside client components.
export function useTr(): Tr {
  const locale = useLocale();
  return (text, vars) => translate(text, locale, vars);
}
