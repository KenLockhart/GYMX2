"use client";

import { useLocale } from "./client";
import { translate, type Tr } from "./phrases";

// <T>English text</T> shows the text in the viewer's language. Works in server and client components.
export function T({
  children,
  vars,
}: {
  children?: React.ReactNode;
  vars?: Record<string, string | number>;
}) {
  const locale = useLocale();
  return (
    <>
      {typeof children === "string"
        ? translate(children, locale, vars)
        : children}
    </>
  );
}

// For text in attributes (labels, placeholders) inside client components.
export function useTr(): Tr {
  const locale = useLocale();
  return (text, vars) => translate(text, locale, vars);
}
