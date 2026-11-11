import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getT } from "@/i18n/server";
import { translateServerText } from "@/i18n/server-text";
import { deletionBlocker } from "@/lib/account-deletion";
import { requireAccount } from "@/lib/auth";
import { GoalsForm, SpecialtiesForm } from "@/components/goals-form";
import { PublicPageForm } from "@/components/public-page-form";
import { NotificationSettingsForm } from "@/components/notification-settings-form";
import { PushToggle } from "@/components/push-toggle";
import { NOTIFICATION_SETTINGS } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import { suggestSlug } from "@/lib/public-pages";
import { updateGoals, updateSpecialties } from "../welcome/actions";
import { DeleteAccountForm } from "./delete-account-form";
import { ProfileForm } from "./profile-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT()).profile.title };
}

export default async function ProfilePage() {
  const { profile, email } = await requireAccount();
  const blocker = await deletionBlocker(profile);
  const t = await getT();
  const locale = await getLocale();
  const p = t.profile;
  const supabase = await createClient();
  const { data: savedSettings } = await supabase
    .from("notification_settings")
    .select("type, in_app, push, email")
    .eq("user_id", profile.id);
  const notificationSettings = NOTIFICATION_SETTINGS.map((meta) => {
    const saved = (savedSettings ?? []).find((row) => row.type === meta.type);
    return {
      type: meta.type,
      inApp: (saved?.in_app as boolean | undefined) ?? true,
      push: (saved?.push as boolean | undefined) ?? meta.defaultPush,
      email: (saved?.email as boolean | undefined) ?? meta.defaultEmail,
    };
  });

  return (
    <div className="space-y-10">
      <div className="space-y-6">
        <h1 className="text-5xl">{p.title}</h1>
        {profile.role === "coach" && (
          <Link
            href="/profile/coach"
            className="flex items-center justify-between gap-3 rounded-2xl border border-accent/60 bg-accent/5 px-4 py-3 text-sm hover:bg-accent/10"
          >
            <span>
              <span className="font-semibold text-accent">
                {p.coachProfileLink}
              </span>{" "}
              <span className="text-muted">{p.coachProfileHint}</span>
            </span>
            <span aria-hidden className="text-accent">
              →
            </span>
          </Link>
        )}
        <ProfileForm profile={profile} email={email} />
      </div>

      {profile.role === "member" && (
        <section
          id="goals"
          aria-labelledby="goals-heading"
          className="scroll-mt-6 space-y-4 border-t border-border pt-8"
        >
          <h2 id="goals-heading" className="text-2xl">
            {p.goals.title}
          </h2>
          <p className="max-w-xl text-sm text-muted">
            {p.goals.body}{" "}
            <Link href="/welcome/matches" className="text-link">
              {p.goals.matches}
            </Link>
          </p>
          <GoalsForm
            action={updateGoals}
            initial={{
              goals: profile.goals,
              experience: profile.experience,
              focus: profile.focus,
            }}
            submitLabel={p.goals.save}
          />
        </section>
      )}

      {profile.role === "coach" && (
        <section
          id="specialties"
          aria-labelledby="specialties-heading"
          className="scroll-mt-6 space-y-3 border-t border-border pt-8"
        >
          <h2 id="specialties-heading" className="text-2xl">
            {p.specialties.title}
          </h2>
          <p className="max-w-xl text-sm text-muted">{p.specialties.body}</p>
          <SpecialtiesForm
            action={updateSpecialties}
            initial={profile.specialties}
          />
        </section>
      )}

      {profile.role === "coach" && (
        <section
          id="public-page"
          aria-labelledby="public-page-heading"
          className="scroll-mt-6 space-y-3 border-t border-border pt-8"
        >
          <h2 id="public-page-heading" className="text-2xl">
            {p.publicPage.title}
          </h2>
          <p className="max-w-xl text-sm text-muted">
            {p.publicPage.body}
            {profile.public_page && profile.public_slug && (
              <>
                {" "}
                <Link href={`/c/${profile.public_slug}`} className="text-link">
                  {p.publicPage.view}
                </Link>
              </>
            )}
          </p>
          <PublicPageForm
            slug={profile.public_slug ?? suggestSlug(profile.display_name)}
            on={profile.public_page}
          />
        </section>
      )}

      <section
        id="notifications"
        aria-labelledby="push"
        className="scroll-mt-6 space-y-3 border-t border-border pt-8"
      >
        <h2 id="push" className="text-2xl">
          {p.push.title}
        </h2>
        <p className="max-w-xl text-sm text-muted">
          {profile.role === "admin"
            ? p.push.admin
            : profile.role === "coach"
              ? p.push.coach
              : p.push.member}{" "}
          {p.push.eachDevice}
        </p>
        <PushToggle
          publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
        />
        <h3 className="pt-4 text-xl">{p.community.title}</h3>
        <p className="max-w-xl text-sm text-muted">{p.community.body}</p>
        <NotificationSettingsForm initial={notificationSettings} />
      </section>

      {profile.role !== "admin" && (
        <section
          aria-labelledby="affiliate"
          className="space-y-2 border-t border-border pt-8"
        >
          <h2 id="affiliate" className="text-2xl">
            {p.affiliate.title}
          </h2>
          <p className="max-w-xl text-sm text-muted">{p.affiliate.body}</p>
          <Link href="/affiliate" className="btn-secondary">
            {p.affiliate.open}
          </Link>
        </section>
      )}

      <section
        aria-labelledby="your-data"
        className="space-y-2 border-t border-border pt-8"
      >
        <h2 id="your-data" className="text-2xl">
          {p.data.title}
        </h2>
        <p className="max-w-xl text-sm text-muted">{p.data.body}</p>
        <a
          href="/api/me/export"
          download
          className="btn-secondary inline-block"
        >
          {p.data.download}
        </a>
      </section>

      <section
        aria-labelledby="delete-account"
        className="space-y-4 border-t border-border pt-8"
      >
        <h2 id="delete-account" className="text-2xl">
          {p.delete.title}
        </h2>
        {blocker || profile.role === "admin" ? (
          <p className="max-w-xl text-sm text-muted">
            {blocker && translateServerText(blocker, locale)}
          </p>
        ) : (
          <DeleteAccountForm
            role={profile.role === "coach" ? "coach" : "member"}
          />
        )}
      </section>
    </div>
  );
}
