"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useT } from "@/i18n/client";

const DEFAULT_EXPANDED_CLASS =
  "fixed inset-0 z-[100] overflow-auto bg-black p-3 sm:p-6 [&_video]:object-contain [&_video]:object-center";

export function isWithinLiveFullscreenRegion(
  region: Pick<HTMLElement, "contains"> | HTMLElement,
  fullscreenElement: Element | null,
) {
  return Boolean(
    fullscreenElement &&
      (region === fullscreenElement || region.contains(fullscreenElement)),
  );
}

export type LiveFullscreenRegionProps = {
  /** Short accessible name for this video tile or the whole live room. */
  label: string;
  children: ReactNode;
  /** Frame/layout classes used while the region is inline. */
  className?: string;
  /** Optional layout override for the fixed fullscreen/in-page fallback state. */
  expandedClassName?: string;
  /** Room-level controls stay in their own row so they do not cover the first tile on mobile. */
  controlPlacement?: "overlay" | "inline" | "outside";
  /** Compact icon variant for small circular participant previews. */
  compactControl?: boolean;
};

export function useLiveFullscreenRegion() {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [nativeActive, setNativeActive] = useState(false);
  const [fallbackActive, setFallbackActive] = useState(false);
  const fallbackRef = useRef(false);
  const nativeOwnerRef = useRef(false);
  const isExpanded = nativeActive || fallbackActive;

  useEffect(() => {
    const container = containerRef.current;
    const doc = container?.ownerDocument;
    if (!container || !doc) return;

    const syncFullscreen = () => {
      const fullscreenElement = doc.fullscreenElement;
      const active = isWithinLiveFullscreenRegion(container, fullscreenElement);
      const owner = fullscreenElement === container;
      setNativeActive(active);
      if (active) setFallbackActive(false);
      if (nativeOwnerRef.current && !active && !fallbackRef.current)
        buttonRef.current?.focus();
      nativeOwnerRef.current = owner;
    };

    doc.addEventListener("fullscreenchange", syncFullscreen);
    return () => doc.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    fallbackRef.current = fallbackActive;
  }, [fallbackActive, nativeActive]);

  useEffect(() => {
    if (!fallbackActive) return;
    const container = containerRef.current;
    const doc = container?.ownerDocument;
    const body = doc?.body;
    if (!container || !doc || !body) return;
    const previousOverflow = body.style.overflow;
    const previousScrollX = doc.defaultView?.scrollX ?? 0;
    const previousScrollY = doc.defaultView?.scrollY ?? 0;
    // Lock page scrolling while the in-page fullscreen fallback is active.
    // eslint-disable-next-line react-hooks/immutability
    body.style.overflow = "hidden";

    const isTopmostFallbackRegion = () => {
      const activeRegions = Array.from(
        doc.querySelectorAll<HTMLElement>(
          '[data-live-fullscreen-region][data-fallback-active="true"]',
        ),
      );
      const nested = activeRegions.filter(
        (candidate) => candidate !== container && container.contains(candidate),
      );
      return nested.length === 0;
    };

    const focusableElements = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostFallbackRegion()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setFallbackActive(false);
        buttonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;

      const elements = focusableElements();
      if (!elements.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = doc.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    doc.addEventListener("keydown", onKeyDown);
    return () => {
      doc.removeEventListener("keydown", onKeyDown);
      // Restore the exact inline value instead of assuming the page was scrollable.
      body.style.overflow = previousOverflow;
      doc.defaultView?.scrollTo(previousScrollX, previousScrollY);
    };
  }, [fallbackActive]);

  const exit = useCallback(async () => {
    const container = containerRef.current;
    const doc = container?.ownerDocument;
    if (
      container &&
      doc?.fullscreenElement &&
      isWithinLiveFullscreenRegion(container, doc.fullscreenElement) &&
      doc.exitFullscreen
    ) {
      try {
        for (let depth = 0; depth < 8; depth += 1) {
          const active = doc.fullscreenElement;
          if (!active || !isWithinLiveFullscreenRegion(container, active)) break;
          await doc.exitFullscreen();
        }
      } catch {
        setNativeActive(false);
        setFallbackActive(false);
        buttonRef.current?.focus();
      }
      return;
    }
    setNativeActive(false);
    setFallbackActive(false);
    buttonRef.current?.focus();
  }, []);

  const toggle = useCallback(async () => {
    if (isExpanded) {
      await exit();
      return;
    }

    const container = containerRef.current;
    if (container?.requestFullscreen) {
      try {
        await container.requestFullscreen();
        if (
          isWithinLiveFullscreenRegion(
            container,
            container.ownerDocument.fullscreenElement,
          )
        ) {
          setNativeActive(true);
          return;
        }
      } catch {
        // Some mobile browsers expose Fullscreen API methods without allowing this element.
      }
    }
    setFallbackActive(true);
  }, [exit, isExpanded]);

  return {
    containerRef,
    buttonRef,
    isExpanded,
    fallbackActive,
    toggle,
    exit,
  };
}

export function LiveFullscreenRegion({
  label,
  children,
  className = "relative",
  expandedClassName = DEFAULT_EXPANDED_CLASS,
  controlPlacement = "overlay",
  compactControl = false,
}: LiveFullscreenRegionProps) {
  const t = useT().common.fullscreen;
  const { containerRef, buttonRef, isExpanded, toggle, fallbackActive } =
    useLiveFullscreenRegion();

  return (
    <div
      ref={containerRef}
      data-live-fullscreen-region
      data-expanded={isExpanded ? "true" : "false"}
      data-fallback-active={fallbackActive ? "true" : "false"}
      className={isExpanded ? expandedClassName : className}
      role={fallbackActive ? "dialog" : isExpanded ? "region" : undefined}
      aria-label={isExpanded ? label : undefined}
      aria-modal={fallbackActive ? true : undefined}
      tabIndex={isExpanded ? -1 : undefined}
    >
      <div
        className={
          controlPlacement === "inline"
            ? "mb-2 flex justify-end gap-2"
            : `absolute z-20 flex items-center gap-2 ${
                controlPlacement === "outside" && !isExpanded
                  ? "-right-2 -top-2"
                  : "right-2 top-2"
              }`
        }
      >
        {isExpanded && (
          <span className="rounded bg-black/75 px-2 py-1 text-xs text-white">
            {t.escapeHint}
          </span>
        )}
        <button
          ref={buttonRef}
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void toggle();
          }}
          aria-label={`${isExpanded ? t.exit : t.expand} ${label}`}
          aria-pressed={isExpanded}
          className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border px-3 py-2 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${compactControl ? "border-transparent bg-transparent px-2 opacity-0 group-hover:border-white/20 group-hover:bg-black/35 group-hover:opacity-100 hover:border-white/20 hover:bg-black/35 hover:opacity-100 focus-visible:border-white/40 focus-visible:bg-black/75 focus-visible:opacity-100 max-sm:border-white/15 max-sm:bg-black/35 max-sm:opacity-100" : "border-white/40 bg-black/75 hover:bg-black"}`}
        >
          {compactControl ? (
            <>
              <span aria-hidden="true" className="text-base leading-none">⤢</span>
              <span className="sr-only">{`${isExpanded ? t.exit : t.expand} ${label}`}</span>
            </>
          ) : (
            isExpanded ? t.exit : t.expand
          )}
        </button>
      </div>
      {children}
    </div>
  );
}
