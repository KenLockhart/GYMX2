import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/client";
import { UploadForm } from "./upload-form";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

describe("UploadForm Daily Content mode", () => {
  it("uses a private field and removes the audience selector for manager uploads", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="en">
        <UploadForm returnTo="/library/daily-content" dailyContentUpload />
      </I18nProvider>,
    );
    expect(html).toContain('name="visibility" value="private"');
    expect(html).not.toContain('<select name="visibility"');
  });

  it("preserves the regular Library visibility control", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="en"><UploadForm /></I18nProvider>,
    );
    expect(html).toContain('name="visibility"');
    expect(html).toContain('value="members" selected=""');
  });
});
