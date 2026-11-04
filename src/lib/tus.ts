// Upload-Metadata holds comma-separated pairs of a key and a base64 value.
export function parseUploadMetadata(header: string | null) {
  const values: Record<string, string> = {};
  for (const pair of (header ?? "").split(",")) {
    const [key, encoded = ""] = pair.trim().split(" ");
    if (key) values[key] = Buffer.from(encoded, "base64").toString("utf8");
  }
  return values;
}

export function encodeUploadMetadata(values: Record<string, string | null>) {
  return Object.entries(values)
    .map(([key, value]) =>
      value === null ? key : `${key} ${Buffer.from(value, "utf8").toString("base64")}`,
    )
    .join(",");
}
