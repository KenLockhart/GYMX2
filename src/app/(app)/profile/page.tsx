import type { Metadata } from "next";
import { requireAccount } from "@/lib/auth";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Your profile" };

export default async function ProfilePage() {
  const { profile, email } = await requireAccount();

  return (
    <div className="space-y-6">
      <h1 className="text-5xl">Your profile</h1>
      <ProfileForm profile={profile} email={email} />
    </div>
  );
}
