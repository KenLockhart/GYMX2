"use client";

import { useTr } from "@/i18n/t";

import { useState, useTransition } from "react";
import { setFollow, setMute } from "@/app/(app)/community/preferences/actions";

export function PeopleList({
  title,
  empty,
  people: initial,
  action,
}: {
  title: string;
  empty: string;
  people: { id: string; name: string }[];
  action: "unfollow" | "unmute";
}) {
  const tr = useTr();
  const [people, setPeople] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove(id: string) {
    setError(null);
    start(async () => {
      const result =
        action === "unfollow"
          ? await setFollow(id, false)
          : await setMute(id, false);
      if (result.error) return setError(result.error);
      setPeople((current) => current.filter((person) => person.id !== id));
    });
  }

  return (
    <section className="space-y-3" aria-labelledby={`list-${action}`}>
      <h2 id={`list-${action}`} className="text-3xl">
        {title}
      </h2>
      {people.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {people.map((person) => (
            <li
              key={person.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="font-semibold">{person.name}</span>
              <button
                type="button"
                onClick={() => remove(person.id)}
                disabled={pending}
                className="btn-secondary px-3 py-1.5 text-sm"
              >
                {action === "unfollow" ? tr("Unfollow") : tr("Unmute")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {tr(error)}
        </p>
      )}
    </section>
  );
}
