import { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { buildFormCoachPageCsp, isFormCoachProcessingPage } from "@/lib/form-coach/runtime-security";

export async function proxy(request: NextRequest) {
  const processingPage = isFormCoachProcessingPage(request.nextUrl.pathname);
  let requestForSession = request;
  let pageCsp: string | null = null;
  if (processingPage) {
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    pageCsp = buildFormCoachPageCsp({
      nonce,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      development: process.env.NODE_ENV === "development",
    });
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", pageCsp);
    requestForSession = new NextRequest(request, { headers: requestHeaders });
  }

  const response = await updateSession(requestForSession);
  if (pageCsp) response.headers.set("Content-Security-Policy", pageCsp);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|icon-192.png|icon-512.png|form-coach-assets/|form-coach-worker/).*)",
  ],
};
