import type { Metadata } from "next";
import { homepageMetadata } from "@/components/homepage/content";
import { HomepagePage } from "@/components/homepage/homepage-page";
import "@/components/homepage/homepage.css";

export const metadata: Metadata = homepageMetadata;

export default function Home() {
  return <HomepagePage />;
}
