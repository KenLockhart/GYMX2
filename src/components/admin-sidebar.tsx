"use client";

import { ChevronDown, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NavIcon } from "@/components/nav-icon";
import { ADMIN_NAV, isActive, type NavItem } from "@/lib/nav";

function Item({
  entry,
  badge,
  pathname,
  prominent,
}: {
  entry: NavItem;
  badge?: number;
  pathname: string;
  prominent?: boolean;
}) {
  const active = isActive(pathname, entry.href);
  return (
    <Link
      href={entry.href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-xl px-3 text-sm transition-colors ${prominent ? "py-2 font-semibold" : "py-1.5"} ${
        active
          ? "bg-accent font-semibold text-accent-foreground"
          : "text-foreground/85 hover:bg-surface-raised hover:text-foreground"
      }`}
    >
      <NavIcon name={entry.icon} className="size-[18px] shrink-0" />
      <span className="flex-1">{entry.label}</span>
      {!!badge && (
        <span
          className={`min-w-5 rounded-full px-1.5 text-center text-xs font-bold leading-5 ${
            active
              ? "bg-accent-foreground text-accent"
              : "bg-danger text-background"
          }`}
        >
          {badge}
          <span className="sr-only"> waiting</span>
        </span>
      )}
    </Link>
  );
}

function Groups({
  badges,
  pathname,
}: {
  badges: Record<string, number>;
  pathname: string;
}) {
  return (
    <>
      <Item entry={ADMIN_NAV.overview} pathname={pathname} prominent />
      {ADMIN_NAV.groups.map((group) => (
        <div key={group.title} className="mt-3 border-t border-border pt-3">
          <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-widest text-muted">
            {group.title}
          </p>
          <div className="space-y-0.5">
            {group.items.map((entry) => (
              <Item
                key={entry.href}
                entry={entry}
                badge={badges[entry.href]}
                pathname={pathname}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

// The Admin Console menu: a sidebar on wide screens, a collapsible menu on phones.
export function AdminSidebar({ badges }: { badges: Record<string, number> }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  const current = [
    ADMIN_NAV.overview,
    ...ADMIN_NAV.groups.flatMap((g) => g.items),
  ].find((e) => isActive(pathname, e.href));
  const waiting = Object.values(badges).reduce((a, b) => a + b, 0);

  const heading = (
    <div className="flex items-center gap-3 px-1">
      <ShieldCheck
        aria-hidden
        className="size-9 shrink-0 text-accent"
        strokeWidth={1.6}
      />
      <div>
        <p className="font-semibold leading-tight">Admin Console</p>
        <p className="text-xs text-muted">Platform management</p>
      </div>
    </div>
  );

  return (
    <>
      <aside
        aria-label="Admin Console"
        className="hidden w-64 shrink-0 lg:block"
      >
        <nav
          aria-label="Admin"
          className="sticky top-24 max-h-[calc(100vh-7rem)] space-y-4 overflow-y-auto rounded-2xl border border-border bg-surface p-3"
        >
          {heading}
          <div>
            <Groups badges={badges} pathname={pathname} />
          </div>
        </nav>
      </aside>

      <div className="lg:hidden">
        <button
          type="button"
          aria-expanded={open}
          aria-controls="admin-menu"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-3 text-left"
        >
          <ShieldCheck
            aria-hidden
            className="size-6 shrink-0 text-accent"
            strokeWidth={1.6}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted">Admin Console</span>
            <span className="block truncate font-semibold">
              {current?.label ?? "Menu"}
            </span>
          </span>
          {waiting > 0 && (
            <span className="rounded-full bg-danger px-2 text-xs font-bold leading-5 text-background">
              {waiting} waiting
            </span>
          )}
          <ChevronDown
            aria-hidden
            className={`size-5 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && (
          <nav
            id="admin-menu"
            aria-label="Admin"
            className="mt-2 rounded-2xl border border-border bg-surface p-3"
          >
            <Groups badges={badges} pathname={pathname} />
          </nav>
        )}
      </div>
    </>
  );
}
