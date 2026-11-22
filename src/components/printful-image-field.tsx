"use client";

import { useState } from "react";
import { UploadField } from "@/components/armory-form";

export function PrintfulImageField({ initialPath, managedItemId }: { initialPath: string | null; managedItemId: string }) {
  const [path, setPath] = useState(initialPath ?? "");
  const [name, setName] = useState(() => initialPath?.split("/").at(-1) ?? "");

  return (
    <div className="space-y-2">
      <input type="hidden" name="image_path" value={path} />
      <UploadField
        label="Approved preview image"
        hint="PNG, JPG or WebP, up to 5 MB. This stays on the private draft until publication."
        accept=".png,.jpg,.jpeg,.webp"
        bucket="armory-images"
        managedItemId={managedItemId}
        current={name || null}
        onUploaded={(uploadedPath, uploadedName) => {
          setPath(uploadedPath);
          setName(uploadedName);
        }}
        onCleared={() => {
          setPath("");
          setName("");
        }}
      />
    </div>
  );
}
