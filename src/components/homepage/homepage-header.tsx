"use client";

import Link from "next/link";
import { type KeyboardEvent, useRef, useState } from "react";
import { BrandLink } from "@/components/brand-link";

const navigation = [
  { label: "Explore", href: "#explore" },
  { label: "Disciplines", href: "#disciplines" },
  { label: "Community", href: "#community" },
  { label: "About", href: "#about" },
] as const;

export function HomepageHeader() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && menuOpen) {
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <header className="homepage-header" onKeyDown={handleKeyDown}>
      <div className="homepage-header-inner">
        <BrandLink />

        <button
          ref={menuButtonRef}
          type="button"
          className="homepage-menu-toggle"
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={menuOpen}
          aria-controls="homepage-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true" className="homepage-menu-icon">
            <span />
            <span />
          </span>
        </button>

        <nav
          id="homepage-navigation"
          aria-label="Main navigation"
          className={menuOpen ? "homepage-nav is-open" : "homepage-nav"}
        >
          {navigation.map((item) => (
            <Link key={item.href} href={item.href} onClick={closeMenu}>
              {item.label}
            </Link>
          ))}
          <Link href="/login" className="homepage-mobile-login" onClick={closeMenu}>
            Log in
          </Link>
        </nav>

        <div className="homepage-header-actions">
          <Link href="/login" className="homepage-login-link">
            Log in
          </Link>
          <Link href="/signup" className="homepage-join-link">
            Join GymX2
          </Link>
        </div>
      </div>
    </header>
  );
}
