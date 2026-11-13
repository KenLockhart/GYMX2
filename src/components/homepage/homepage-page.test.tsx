import {
  createElement,
  type CSSProperties,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { disciplines, homepageMetadata } from "./content";
import { HomepagePage } from "./homepage-page";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    onClick,
    ...props
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    onClick?: () => void;
  }) =>
    createElement(
      "a",
      { href, className, onClick, ...props },
      children,
    ),
}));

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    sizes,
    loading,
    style,
  }: {
    src: string;
    alt: string;
    sizes?: string;
    loading?: "lazy" | "eager";
    style?: CSSProperties;
  }) => createElement("img", { src, alt, sizes, loading: loading ?? "lazy", style }),
}));

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function renderHomepage() {
  return renderToStaticMarkup(createElement(HomepagePage));
}

describe("homepage", () => {
  it("provides dedicated search metadata without inheriting the generic title", () => {
    expect(homepageMetadata.title).toEqual({
      absolute:
        "GymX2 | Discover Coaches, Instructors & Physical Performance Creators",
    });
    expect(homepageMetadata.description).toContain("sport, dance, movement");
  });

  it("renders the approved headline, complete discipline list, and working section anchors", () => {
    const html = renderHomepage();

    expect(html).toContain("Your passion.");
    expect(html).toContain("Your craft.");
    expect(html).toContain("Your influence.");
    expect(html).toContain("Find your people. Develop your potential.");
    expect(html).toContain('href="#explore"');
    expect(html).toContain('href="#disciplines"');
    expect(html).toContain('href="#community"');
    expect(html).toContain('href="#about"');

    const headingCount = html.match(/<h1\b/g)?.length ?? 0;
    const renderedIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id);
    const fragmentTargets = [...html.matchAll(/href="#([^"]+)"/g)].map(([, id]) => id);
    expect(headingCount).toBe(1);
    expect(renderedIds).toHaveLength(new Set(renderedIds).size);
    for (const target of fragmentTargets) {
      expect(renderedIds).toContain(target);
    }

    expect(disciplines).toHaveLength(10);
    for (const discipline of disciplines) {
      expect(html).toContain(escapeHtml(discipline.title));
      expect(html).toContain(discipline.image);
    }
    expect(html).toContain("Dance &amp; Ballet");
    expect(html).toContain("Watch. Learn. Get Inspired.");
    expect(html).toContain("Your journey starts here.");
    expect(html).toContain("More than a platform. A community.");
    expect(html).toContain("Your passion deserves a place to grow.");
    expect(html).toContain("Your next chapter starts with GymX2.");
  });

  it("keeps promotional people and scenes clearly illustrative and account media private", () => {
    const html = renderHomepage();
    const imageTags = html.match(/<img\b[^>]*>/g) ?? [];

    expect(imageTags).toHaveLength(14);
    expect(imageTags.every((tag) => tag.includes('src="/homepage/'))).toBe(true);
    expect(html).toContain("Illustrative promotional imagery");
    expect(html).toContain("Role examples only");
    expect(html).toContain("These are promotional examples, not videos.");
    expect(html).toContain("Available content and access depend on the coach and membership.");
    expect(html).not.toContain("/profile-photos/");
    expect(html).not.toContain("/coach-photos/");
    expect(html).not.toContain("profile_photos");
    expect(html).not.toContain("coach_profiles_public");
  });

  it("routes learner and coach calls to existing account flows and explains approval", () => {
    const html = renderHomepage();

    expect(html).toContain('href="/signup?next=%2Fcoaches"');
    expect(html).toContain('href="/signup?next=%2Fprofile"');
    expect(html).toContain("I am a Coach");
    expect(html).toContain("administrator must approve coach access");
    expect(html).toContain("I’M HERE TO LEARN");
    expect(html).toContain("I’M HERE TO INSPIRE");
    expect(html).toContain("Share your coaching focus");
    expect(html).toContain("Build lessons and programs");
  });
});
