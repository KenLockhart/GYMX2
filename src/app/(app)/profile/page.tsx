import type { Metadata } from "next";
import { deletionBlocker } from "@/lib/account-deletion";
import { requireAccount } from "@/lib/auth";
import { DeleteAccountForm } from "./delete-account-form";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const { profile, email } = await requireAccount();
  const blocker = await deletionBlocker(profile);

  return (
    <div className="space-y-10">
      <div className="space-y-6">
        <h1 className="text-5xl">Your profile</h1>
        <ProfileForm profile={profile} email={email} />
      </div>

      <section aria-labelledby="delete-account" className="space-y-4 border-t border-border pt-8">
        <h2 id="delete-account" className="text-2xl">
          Delete your account
        </h2>
        {blocker || profile.role === "admin" ? (
          <p className="max-w-xl text-sm text-muted">{blocker}</p>
        ) : (
          <DeleteAccountForm role={profile.role === "coach" ? "coach" : "member"} />
        )}
      </section>
    </div>
  );
}
