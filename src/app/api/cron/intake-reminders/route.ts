import { NextResponse, type NextRequest } from "next/server";
import { runMemberIntakeReminders } from "@/lib/member-intake-reminders";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    return NextResponse.json(await runMemberIntakeReminders());
  } catch {
    // Keep server response/log free of member and health details.
    return new NextResponse("Intake reminder run failed", { status: 500 });
  }
}
