import { BrandLink } from "@/components/brand-link";
import { LanguageSwitch } from "@/components/language-switch";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <BrandLink />
        <LanguageSwitch />
      </div>
      <div className="rounded-lg border border-border bg-surface p-6 sm:p-8">
        {children}
      </div>
    </main>
  );
}
