import Link from "next/link";
import { BrandLink } from "@/components/brand-link";

const features = [
  {
    title: "Tasks",
    description: "Work through video assignments from the coaches you follow.",
  },
  {
    title: "Calendar",
    description: "Keep every session and meeting in one place.",
  },
  {
    title: "Connect",
    description: "Reach your coaches directly and find them on social media.",
  },
  {
    title: "The Armory",
    description: "Pick up ebooks and gear chosen for your training.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <BrandLink />
        <Link href="/login" className="text-link">
          Log in
        </Link>
      </header>

      <main className="flex flex-1 flex-col justify-center py-12">
        <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-accent">
          Private pilot
        </p>
        <h1 className="max-w-3xl text-5xl leading-none sm:text-7xl">
          Train with the people you actually want to follow.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          GYMX2 brings members and fitness coaches together, whatever kind of training you do.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/signup" className="btn-primary">
            Join GYMX2
          </Link>
          <Link href="/login" className="btn-secondary">
            Log in
          </Link>
        </div>

        <ul className="mt-16 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
          {features.map((feature) => (
            <li key={feature.title} className="bg-surface p-6">
              <h2 className="text-2xl">{feature.title}</h2>
              <p className="mt-2 text-muted">{feature.description}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
