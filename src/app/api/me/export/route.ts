import { NextResponse } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { buildDataExport } from "@/lib/data-export";

// GET /api/me/export: download everything GYMX2 keeps about the signed-in person, as JSON.
export async function GET() {
  const account = await getCurrentAccount();
  if (!account)
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const data = await buildDataExport({
    id: account.profile.id,
    email: account.email,
  });
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="gymx2-data-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
