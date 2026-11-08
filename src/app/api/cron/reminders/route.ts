import { NextResponse, type NextRequest } from "next/server";
import { runEveningReminders, runMorningReminders } from "@/lib/reminder-jobs";

// Called by Vercel on a schedule (see vercel.json). Vercel sends the CRON_SECRET as a bearer token,
// so nobody else can trigger a round of emails.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const job = request.nextUrl.searchParams.get("job");
  try {
    if (job === "morning") return NextResponse.json(await runMorningReminders());
    if (job === "evening") return NextResponse.json(await runEveningReminders());
  } catch (error) {
    console.error("Reminder run failed", error);
    return new NextResponse("Reminder run failed", { status: 500 });
  }
  return new NextResponse("Unknown job", { status: 400 });
}
