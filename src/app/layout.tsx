import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { I18nProvider } from "@/i18n/client";
import { LOCALE_TAG } from "@/i18n/config";
import { getBrowserLocale } from "@/i18n/server";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const barlow = Barlow_Condensed({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "GYMX2",
    template: "%s | GYMX2",
  },
  description:
    "Coaches and members, together: get fit, learn nutrition and get your mind right.",
};

export const viewport: Viewport = {
  themeColor: "#0d0f0c",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The language chosen on this browser (kept in step with the account's on log-in and on switching).
  const locale = await getBrowserLocale();
  return (
    <html
      lang={LOCALE_TAG[locale]}
      className={`${inter.variable} ${barlow.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider locale={locale}>
          {children}
          <SiteFooter />
        </I18nProvider>
      </body>
    </html>
  );
}
