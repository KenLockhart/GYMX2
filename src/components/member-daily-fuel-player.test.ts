import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/image", () => ({ default: () => null }));

import { MemberDailyFuelPlayer } from "./member-daily-fuel-player";

type FakeScript = {
  src: string;
  async: boolean;
  dataset: Record<string, string>;
  removed: boolean;
  listeners: Record<string, (event: Event) => void>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  fire: (event: string) => void;
};

function fakeScript(): FakeScript {
  const listeners: Record<string, (event: Event) => void> = {};
  const script = {
    src: "",
    async: false,
    dataset: {} as Record<string, string>,
    removed: false,
    listeners,
    addEventListener: vi.fn((event: string, listener: (event: Event) => void) => {
      listeners[event] = listener;
    }),
    removeEventListener: vi.fn(),
    remove: vi.fn(() => {
      script.removed = true;
    }),
    fire(event: string) {
      listeners[event]?.({} as Event);
    },
  };
  return script;
}

describe("Cloudflare player SDK retry", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("removes a failed owned script and resolves after loading a replacement", async () => {
    const scripts: FakeScript[] = [];
    const documentStub = {
      querySelector: vi.fn(() => scripts.find((script) => !script.removed) ?? null),
      createElement: vi.fn(() => {
        return fakeScript() as unknown as HTMLScriptElement;
      }),
      head: {
        append: vi.fn((script: FakeScript) => scripts.push(script)),
      },
    } as unknown as Document;
    const windowStub: { Stream?: (iframe: HTMLIFrameElement) => { play: () => Promise<void> } } = {};
    vi.stubGlobal("document", documentStub);
    vi.stubGlobal("window", windowStub);

    const { loadStreamPlayerSdk } = await import("./member-daily-fuel-player");
    const firstAttempt = loadStreamPlayerSdk();
    expect(scripts).toHaveLength(1);
    scripts[0]!.fire("error");
    await expect(firstAttempt).rejects.toThrow("Player unavailable");
    expect(scripts[0]!.remove).toHaveBeenCalledOnce();

    const retry = loadStreamPlayerSdk();
    expect(scripts).toHaveLength(2);
    const play = vi.fn().mockResolvedValue(undefined);
    windowStub.Stream = () => ({ play });
    scripts[1]!.fire("load");
    await expect(retry).resolves.toBeUndefined();
    await windowStub.Stream({} as HTMLIFrameElement).play();
    expect(play).toHaveBeenCalledOnce();
  });

  it("renders a standalone player with its own 16:9 controls and focus styles", () => {
    const markup = renderToStaticMarkup(
      createElement(MemberDailyFuelPlayer, {
        title: "Assigned clip",
        playerUrl: "https://example.invalid/player",
        thumbnailUrl: null,
        totalDuration: 90,
        todayLabel: "Today",
        playLabel: "Play",
        pauseLabel: "Pause",
        loadingLabel: "Loading",
        unavailableLabel: "Unavailable",
        retryLabel: "Retry",
      }),
    );
    const styles = readFileSync(new URL("./member-daily-fuel-player.css", import.meta.url), "utf8");

    expect(markup).toContain('class="member-daily-fuel-player"');
    expect(markup).toContain('class="daily-fuel-controls"');
    expect(markup).not.toContain("member-dashboard");
    expect(styles).toContain(".member-daily-fuel-player {");
    expect(styles).toContain("aspect-ratio: 16 / 9;");
    expect(styles).toContain(".member-daily-fuel-player .daily-fuel-play:focus-visible");
    expect(styles).toContain(".member-daily-fuel-player .daily-fuel-controls {");
    expect(styles).toContain("min-height: 44px;");
    expect(styles).not.toContain(".member-dashboard");
  });
});
