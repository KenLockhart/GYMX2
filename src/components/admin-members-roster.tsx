"use client";

import { useState } from "react";
import { RoleForm } from "@/app/(app)/admin/role-form";
import type { AdminUser } from "@/lib/types";

type MemberRosterUser = AdminUser & { photoUrl: string | null };

const joinedDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function MemberPhoto({ user, name }: { user: MemberRosterUser; name: string }) {
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(user.photoUrl) && !failed;

  return (
    <div className="member-roster-photo" aria-hidden="true">
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed member photo URL
        <img
          src={user.photoUrl ?? undefined}
          alt=""
          loading="lazy"
          decoding="async"
          ref={(image) => {
            if (image?.complete && image.naturalWidth === 0) setFailed(true);
          }}
          onError={() => setFailed(true)}
          className="member-roster-photo-image"
        />
      ) : (
        <div className="member-roster-photo-fallback">
          <span>{initials(name) || "G"}</span>
        </div>
      )}
    </div>
  );
}

function joinedDate(createdAt: string) {
  const date = new Date(createdAt);
  return Number.isNaN(date.valueOf()) ? "—" : joinedDateFormatter.format(date);
}

function MemberCard({ user }: { user: MemberRosterUser }) {
  const name = user.display_name.trim() || user.email;
  const requestedCoach = user.coach_requested && user.role === "member";
  const formattedJoinedDate = joinedDate(user.created_at);

  return (
    <li className="member-roster-card-slot">
      <article className="member-roster-card">
        <div className="member-roster-photo-frame">
          <MemberPhoto key={user.photoUrl ?? "no-photo"} user={user} name={name} />
          {requestedCoach && (
            <span className="member-roster-request-badge">Coach requested</span>
          )}
        </div>

        <div className="member-roster-card-body">
          <div className="member-roster-identity">
            <h3>{name}</h3>
            <p className="member-roster-email">{user.email}</p>
          </div>

          <div className="member-roster-meta">
            <span className="member-roster-role">{user.role}</span>
            <span className="member-roster-joined">
              <span>Joined</span>
              <time dateTime={user.created_at}>{formattedJoinedDate}</time>
            </span>
          </div>

          <div className="member-roster-role-controls">
            <RoleForm user={user} />
          </div>
        </div>
      </article>
    </li>
  );
}

export function AdminMembersRoster({ users }: { users: MemberRosterUser[] }) {
  const count = users.length;

  return (
    <section className="members-roster" aria-labelledby="members-roster-heading">
      <div className="members-roster-heading">
        <h2 id="members-roster-heading">Live roster</h2>
        <p aria-live="polite">
          <span className="members-roster-count">{count}</span>
          {" "}matching {count === 1 ? "person" : "people"}
        </p>
      </div>

      {count > 0 ? (
        <ul className="member-roster-grid">
          {users.map((user) => (
            <MemberCard key={user.id} user={user} />
          ))}
        </ul>
      ) : (
        <div className="members-roster-empty">
          <p>No matching people in the roster.</p>
        </div>
      )}
    </section>
  );
}
