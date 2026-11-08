import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
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
  description: "Coaches and members, together: get fit, learn nutrition and get your mind right.",
};

export const viewport: Viewport = {
  themeColor: "#0d0f0c",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${barlow.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
