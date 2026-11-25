import { NextResponse, type NextRequest } from "next/server";
import { runPrintfulApparelFulfillmentTick } from "@/lib/printful/apparel-fulfillment-runtime";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  try {
    const result = await runPrintfulApparelFulfillmentTick();
    return NextResponse.json({ status: result });
  } catch {
    return NextResponse.json({ status: "worker_unavailable" }, { status: 503 });
  }
}
