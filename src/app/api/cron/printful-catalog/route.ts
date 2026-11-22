import { NextResponse, type NextRequest } from "next/server";
import { syncPrintfulCatalogToPrivateStage } from "@/lib/printful/catalog-runtime";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let result: Awaited<ReturnType<typeof syncPrintfulCatalogToPrivateStage>>;
  try {
    result = await syncPrintfulCatalogToPrivateStage();
  } catch {
    return NextResponse.json({ status: "persistence_failed" }, { status: 503 });
  }
  if (result.status === "disabled") return NextResponse.json({ status: "disabled" });
  if (result.status === "synced") {
    return NextResponse.json({
      status: result.status,
      products: result.productCount,
      variants: result.variantCount,
      availableVariants: result.availableVariantCount,
      revision: result.revision,
    });
  }
  return NextResponse.json({ status: result.status }, { status: 503 });
}
