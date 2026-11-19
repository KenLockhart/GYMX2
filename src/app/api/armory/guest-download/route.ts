import { NextResponse, type NextRequest } from "next/server";
import { verifyGuestArmoryPurchasePayment } from "@/lib/armory-purchases";
import { verifyGuestArmoryToken } from "@/lib/guest-armory-token";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const privateHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
};

function failure(status = 404) {
  return NextResponse.json(
    { error: "This download link is invalid, expired, or unavailable." },
    { status, headers: privateHeaders },
  );
}

export async function POST(request: NextRequest) {
  const secret = process.env.GUEST_ARMORY_DOWNLOAD_SECRET;
  if (!secret || secret.length < 32) return failure(503);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return failure();
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 4096) return failure();
  const reader = request.body?.getReader();
  if (!reader) return failure();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > 4096) {
        await reader.cancel();
        return failure();
      }
      chunks.push(value);
    }
  } catch {
    return failure();
  }
  let body: unknown;
  try {
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return failure();
  }
  const token =
    body && typeof body === "object" && typeof (body as { token?: unknown }).token === "string"
      ? (body as { token: string }).token
      : "";
  if (!token || token.length > 2048) return failure();

  const claim = verifyGuestArmoryToken(token, secret);
  if (!claim) return failure();

  const order = await verifyGuestArmoryPurchasePayment({
    purchaseId: claim.purchaseId,
    sessionId: claim.sessionId,
    itemId: claim.itemId,
  }).catch(() => null);
  if (!order) return failure();

  const { data, error } = await createAdminClient()
    .storage.from("armory-files")
    .createSignedUrl(order.filePath, 60, { download: order.fileName });
  if (error || !data?.signedUrl) return failure();

  return NextResponse.json(
    { url: data.signedUrl },
    { headers: privateHeaders },
  );
}
