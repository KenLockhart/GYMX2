import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/client";
import {
  isWithinLiveFullscreenRegion,
  LiveFullscreenRegion,
} from "@/components/live-fullscreen";

function renderRegion(
  locale: "en" | "es",
  controlPlacement: "overlay" | "inline" | "outside" = "overlay",
) {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <LiveFullscreenRegion
        label="Coach / Alex"
        className="relative aspect-video"
        controlPlacement={controlPlacement}
      >
        <video data-track-slot="remote" />
      </LiveFullscreenRegion>
    </I18nProvider>,
  );
}

describe("LiveFullscreenRegion", () => {
  it("renders one in-place video slot and an accessible participant control", () => {
    const html = renderRegion("en");

    expect(html).toContain('aria-label="Expand Coach / Alex"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('data-live-fullscreen-region="true"');
    expect(html.match(/<video\b/g)).toHaveLength(1);
    expect(html).toContain('data-track-slot="remote"');
  });

  it("localizes the expand and keyboard exit labels", () => {
    const html = renderRegion("es");

    expect(html).toContain('aria-label="Expandir Coach / Alex"');
    expect(html).toContain("Expandir");
  });

  it("keeps compact controls outside clipped circular video frames", () => {
    const html = renderRegion("en", "outside");

    expect(html).toContain("-right-2 -top-2");
    expect(html).toContain('aria-label="Expand Coach / Alex"');
  });

  it("keeps parent and individual regions active through nested native fullscreen", () => {
    const child = {} as Element;
    const unrelated = {} as Element;
    const contains = vi.fn((element: Element) => element === child);
    const parent = { contains } as unknown as HTMLElement;

    expect(isWithinLiveFullscreenRegion(parent, child)).toBe(true);
    expect(isWithinLiveFullscreenRegion(parent, unrelated)).toBe(false);
    expect(contains).toHaveBeenCalledTimes(2);
  });
});
