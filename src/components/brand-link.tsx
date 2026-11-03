import Link from "next/link";

export function BrandLink({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="font-display text-2xl font-bold uppercase tracking-wide text-foreground"
    >
      Gym<span className="text-accent">X2</span>
    </Link>
  );
}
