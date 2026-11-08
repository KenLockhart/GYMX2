import Link from "next/link";
import { BrandLink } from "@/components/brand-link";

const pillars = [
  { title: "Mind", description: "Build the discipline, focus and mindset that keep you showing up." },
  { title: "Body", description: "Train with programs and videos from coaches who know their craft." },
  { title: "Spirit", description: "Stay motivated with a coach and a community in your corner." },
];

const features = [
  {
    title: "Tasks",
    description: "Work through workouts, nutrition lessons and mindset videos your coach assigns.",
  },
  {
    title: "Calendar",
    description: "See every session your coach schedules and let them know if you're coming.",
  },
  {
    title: "Connect",
    description: "Message your coach directly and follow them on social media.",
  },
  {
    title: "The Armory",
    description: "Get ebooks, programs and gear from your coaches and GYMX2.",
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
          Mind <span aria-hidden="true">•</span> Body <span aria-hidden="true">•</span> Spirit
        </p>
        <h1 className="max-w-3xl text-5xl leading-none sm:text-7xl">
          Get fit. Learn nutrition. Get your mind right.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          GYMX2 is where coaches and members unite to train the whole person, with programs, live sessions and
          a coach you can actually talk to.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/signup" className="btn-primary">
            Join GYMX2
          </Link>
          <Link href="/login" className="btn-secondary">
            Log in
          </Link>
        </div>

        <ul className="mt-16 grid gap-6 sm:grid-cols-3">
          {pillars.map((pillar) => (
            <li key={pillar.title} className="border-l-2 border-accent pl-4">
              <h2 className="text-3xl uppercase">{pillar.title}</h2>
              <p className="mt-1 text-muted">{pillar.description}</p>
            </li>
          ))}
        </ul>

        <ul className="mt-12 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
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
