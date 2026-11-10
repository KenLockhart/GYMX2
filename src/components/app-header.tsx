"use client";

import {
  ChevronDown,
  LogOut,
  Menu,
  MessageCircle,
  Search,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { signOut } from "@/app/(auth)/actions";
import { NavIcon } from "@/components/nav-icon";
import { NotificationBell } from "@/components/notification-bell";
import { isActive, type NavGroup, type NavItem } from "@/lib/nav";

type Props = {
  me: string;
  name: string;
  initials: string;
  roleLabel: string;
  primary: NavItem[];
  groups: NavGroup[];
  destinations: NavItem[];
  messagesHref: string;
  messagesLabel: string;
  unreadMessages: number;
  unreadNotifications: number;
  // Badges on menu items, by href (open reports, for example).
  badges: Record<string, number>;
};

function Badge({
  count,
  tone = "accent",
}: {
  count: number;
  tone?: "accent" | "danger";
}) {
  if (count <= 0) return null;
  return (
    <span
      className={`min-w-5 rounded-full px-1.5 text-center text-xs font-bold leading-5 ${
        tone === "danger"
          ? "bg-danger text-background"
          : "bg-accent text-accent-foreground"
      }`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

// Closes a popover on outside click or Escape.
function useDismiss(
  open: boolean,
  close: () => void,
  ref: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
}

export function AppHeader(props: Props) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuOpen, () => setMenuOpen(false), menuRef);

  // Close everything after navigating.
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMenuOpen(false);
    setDrawerOpen(false);
    setSearchOpen(false);
  }

  // Ctrl+K or Cmd+K opens search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const menuBadge = Object.values(props.badges).reduce((a, b) => a + b, 0);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link
          href="/dashboard"
          className="font-display text-2xl font-bold uppercase tracking-wide text-foreground"
        >
          Gym<span className="text-accent">X2</span>
        </Link>
        <span aria-hidden className="mx-2 hidden h-7 w-px bg-border lg:block" />

        <nav
          aria-label="Main"
          className="hidden min-w-0 flex-1 items-center gap-0.5 lg:flex xl:gap-1"
        >
          {props.primary.map((entry) => {
            const active = isActive(pathname, entry.href);
            return (
              <Link
                key={entry.href}
                href={entry.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-2 rounded-md px-2.5 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? "text-accent"
                    : "text-foreground/85 hover:bg-surface-raised hover:text-foreground"
                }`}
              >
                <NavIcon
                  name={entry.icon}
                  className="hidden size-[18px] xl:block"
                />
                {entry.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2.5 -bottom-[13px] h-0.5 rounded-full bg-accent"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label="Search pages (Ctrl+K)"
            className="grid size-10 place-items-center rounded-full text-foreground/85 hover:bg-surface-raised hover:text-foreground"
          >
            <Search aria-hidden className="size-5" strokeWidth={1.8} />
          </button>
          <Link
            href={props.messagesHref}
            aria-current={
              isActive(pathname, props.messagesHref) ? "page" : undefined
            }
            className={`relative grid size-10 place-items-center rounded-full hover:bg-surface-raised ${
              isActive(pathname, props.messagesHref)
                ? "text-accent"
                : "text-foreground/85 hover:text-foreground"
            }`}
          >
            <MessageCircle aria-hidden className="size-5" strokeWidth={1.8} />
            <span className="sr-only">
              {props.messagesLabel}
              {props.unreadMessages > 0 && `, ${props.unreadMessages} unread`}
            </span>
            {props.unreadMessages > 0 && (
              <span aria-hidden className="absolute right-0.5 top-0.5">
                <Badge count={props.unreadMessages} />
              </span>
            )}
          </Link>
          <NotificationBell
            me={props.me}
            initialCount={props.unreadNotifications}
          />

          <div ref={menuRef} className="relative hidden lg:block">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
              className="ml-1 flex items-center gap-1 rounded-full py-1 pl-1 pr-2 hover:bg-surface-raised"
            >
              <span className="relative grid size-9 place-items-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                {props.initials}
                {menuBadge > 0 && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-background bg-danger"
                  />
                )}
              </span>
              <ChevronDown
                aria-hidden
                className={`size-4 text-muted transition-transform ${menuOpen ? "rotate-180" : ""}`}
              />
              <span className="sr-only">
                Your menu{menuBadge > 0 && `, ${menuBadge} open reports`}
              </span>
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-40 mt-2 max-h-[calc(100vh-5rem)] w-72 overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-2xl"
              >
                <div className="flex items-center gap-3 border-b border-border px-2 pb-3 pt-1">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                    {props.initials}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{props.name}</p>
                    <p className="text-xs text-muted">{props.roleLabel}</p>
                  </div>
                </div>
                <MenuGroups
                  groups={props.groups}
                  badges={props.badges}
                  pathname={pathname}
                />
                <form action={signOut} className="border-t border-border pt-1">
                  <button
                    type="submit"
                    role="menuitem"
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm text-muted hover:bg-surface-raised hover:text-foreground"
                  >
                    <LogOut
                      aria-hidden
                      className="size-[18px]"
                      strokeWidth={1.8}
                    />
                    Log out
                  </button>
                </form>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={`Open menu${menuBadge > 0 ? `, ${menuBadge} open reports` : ""}`}
            aria-expanded={drawerOpen}
            className="relative grid size-10 place-items-center rounded-full hover:bg-surface-raised lg:hidden"
          >
            <Menu aria-hidden className="size-6" strokeWidth={1.8} />
            {menuBadge > 0 && (
              <span
                aria-hidden
                className="absolute right-1.5 top-1.5 size-2.5 rounded-full bg-danger"
              />
            )}
          </button>
        </div>
      </div>

      {drawerOpen &&
        createPortal(
          <Drawer
            {...props}
            pathname={pathname}
            onClose={() => setDrawerOpen(false)}
          />,
          document.body,
        )}
      {searchOpen &&
        createPortal(
          <SearchDialog
            destinations={props.destinations}
            onClose={() => setSearchOpen(false)}
          />,
          document.body,
        )}
    </header>
  );
}

function MenuGroups({
  groups,
  badges,
  pathname,
}: {
  groups: NavGroup[];
  badges: Record<string, number>;
  pathname: string;
}) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.title} className="py-1.5">
          <p className="px-2 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-widest text-muted">
            {group.title}
          </p>
          {group.items.map((entry) => {
            const active = isActive(pathname, entry.href);
            return (
              <Link
                key={entry.href}
                href={entry.href}
                role="menuitem"
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-2 py-2 text-sm ${
                  active
                    ? "bg-accent/10 font-semibold text-accent"
                    : "hover:bg-surface-raised"
                }`}
              >
                <NavIcon name={entry.icon} className="size-[18px] shrink-0" />
                <span className="flex-1">{entry.label}</span>
                <Badge count={badges[entry.href] ?? 0} tone="danger" />
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

// The phone and tablet menu: everything in one panel.
function Drawer(props: Props & { pathname: string; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const onClose = useRef(props.onClose);
  useEffect(() => {
    onClose.current = props.onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose.current();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="Close menu"
        onClick={props.onClose}
        className="absolute inset-0 bg-black/70"
      />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="absolute inset-y-0 right-0 flex w-[min(20rem,88vw)] flex-col overflow-y-auto border-l border-border bg-surface outline-none"
      >
        <div className="flex items-center gap-3 border-b border-border p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
            {props.initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{props.name}</p>
            <p className="text-xs text-muted">{props.roleLabel}</p>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Close menu"
            className="grid size-10 place-items-center rounded-full hover:bg-surface-raised"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>
        <nav aria-label="Main" className="p-2">
          {props.primary.map((entry) => {
            const active = isActive(props.pathname, entry.href);
            return (
              <Link
                key={entry.href}
                href={entry.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 font-semibold ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-surface-raised"
                }`}
              >
                <NavIcon name={entry.icon} />
                {entry.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border px-2 pb-2">
          <MenuGroups
            groups={props.groups}
            badges={props.badges}
            pathname={props.pathname}
          />
        </div>
        <form action={signOut} className="mt-auto border-t border-border p-2">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-muted hover:bg-surface-raised hover:text-foreground"
          >
            <LogOut aria-hidden className="size-5" strokeWidth={1.8} />
            Log out
          </button>
        </form>
      </div>
    </div>
  );
}

// Jump to any page by name.
function SearchDialog({
  destinations,
  onClose,
}: {
  destinations: NavItem[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? destinations.filter(
          (d) => d.label.toLowerCase().includes(q) || d.href.includes(q),
        )
      : destinations;
  }, [destinations, query]);
  const go = (entry: NavItem | undefined) => {
    if (!entry) return;
    onClose();
    router.push(entry.href);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search pages"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search aria-hidden className="size-5 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") go(results[index]);
            }}
            placeholder="Jump to a page..."
            aria-label="Page name"
            aria-controls="search-results"
            aria-activedescendant={
              results[index] ? `search-${index}` : undefined
            }
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
          />
          <kbd className="hidden rounded border border-border px-1.5 text-xs text-muted sm:block">
            Esc
          </kbd>
        </div>
        <ul
          id="search-results"
          role="listbox"
          className="max-h-[50vh] overflow-y-auto p-2"
        >
          {results.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted">
              No page called &ldquo;{query}&rdquo;.
            </li>
          )}
          {results.map((entry, i) => (
            <li
              key={entry.href}
              id={`search-${i}`}
              role="option"
              aria-selected={i === index}
            >
              <button
                type="button"
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(entry)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${i === index ? "bg-accent/10 text-accent" : ""}`}
              >
                <NavIcon name={entry.icon} className="size-[18px]" />
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
