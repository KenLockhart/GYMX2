import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAccount } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validation";

// Files are private. Row security answers "may this person see the item?", and only then
// is a link made that works for one minute and downloads under the original file name.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const account = await getCurrentAccount();
  if (!account) return NextResponse.redirect(new URL("/login", request.url));

  const { id } = await params;
  if (!idSchema.safeParse(id).success) return new NextResponse("Not found", { status: 404 });

  const supabase = await createClient();
  const { data: item } = await supabase
    .from("armory_items")
    .select("kind, file_path, file_name")
    .eq("id", id)
    .maybeSingle();
  if (!item || item.kind !== "download" || !item.file_path) {
    return new NextResponse("Not found", { status: 404 });
  }

  const { data, error } = await createAdminClient()
    .storage.from("armory-files")
    .createSignedUrl(item.file_path as string, 60, { download: (item.file_name as string) ?? true });
  if (error || !data) return new NextResponse("This file can't be downloaded right now.", { status: 503 });

  return NextResponse.redirect(data.signedUrl, { status: 303 });
}
