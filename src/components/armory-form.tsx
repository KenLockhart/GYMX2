"use client";

import Link from "next/link";
import { useState } from "react";
import { prepareArmoryUpload, saveArmoryItem } from "@/app/(app)/armory/actions";
import { ActionForm, Field, FormStatus, SubmitButton } from "@/components/form-parts";
import { ARMORY_CATEGORIES, DEFAULT_SIZES, PLATFORM_FEE_PERCENT, describeSize, type ArmoryKind } from "@/lib/armory";
import { createBrowserSupabase } from "@/lib/supabase/client";

export type ArmoryFormValues = {
  id: string;
  kind: ArmoryKind;
  category: string;
  title: string;
  description: string;
  price: string;
  shipping: string;
  sizes: string;
  buy_url: string;
  file_path: string;
  file_name: string;
  image_path: string;
  image_url: string | null;
  visible_to_all: boolean;
};

type Upload = { status: "idle" | "uploading" | "done" | "error"; message?: string };

function UploadField({
  label,
  hint,
  accept,
  bucket,
  current,
  onUploaded,
  onCleared,
}: {
  label: string;
  hint: string;
  accept: string;
  bucket: "armory-files" | "armory-images";
  current: string | null;
  onUploaded: (path: string, fileName: string) => void;
  onCleared?: () => void;
}) {
  const [upload, setUpload] = useState<Upload>({ status: "idle" });

  async function handleFile(file: File) {
    setUpload({ status: "uploading", message: `Uploading ${file.name} (${describeSize(file.size)})...` });
    const prepared = await prepareArmoryUpload({ bucket, file_name: file.name, size: file.size });
    if (prepared.error || !prepared.path || !prepared.token) {
      setUpload({ status: "error", message: prepared.error ?? "We couldn't start the upload." });
      return;
    }
    const { error } = await createBrowserSupabase()
      .storage.from(bucket)
      .uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type || undefined });
    if (error) {
      setUpload({ status: "error", message: "The upload stopped. Check your connection and try again." });
      return;
    }
    onUploaded(prepared.path, file.name);
    setUpload({ status: "done", message: `Uploaded ${file.name}.` });
  }

  return (
    <div className="space-y-1.5">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{label}</span>
        <input
          type="file"
          accept={accept}
          disabled={upload.status === "uploading"}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
          className="field-input file:mr-3 file:rounded file:border-0 file:bg-surface file:px-3 file:py-1 file:text-foreground"
        />
      </label>
      <p className="text-xs text-muted">{hint}</p>
      {current && upload.status === "idle" && (
        <p className="flex items-center gap-3 text-sm">
          <span className="text-muted">Current: {current}</span>
          {onCleared && (
            <button type="button" onClick={onCleared} className="text-link text-sm">
              Remove
            </button>
          )}
        </p>
      )}
      {upload.message && (
        <p
          role={upload.status === "error" ? "alert" : "status"}
          className={`text-sm ${upload.status === "error" ? "text-danger" : upload.status === "done" ? "text-success" : "text-muted"}`}
        >
          {upload.message}
        </p>
      )}
    </div>
  );
}

export function ArmoryForm({
  initial,
  submitLabel,
  payouts,
}: {
  initial: ArmoryFormValues;
  submitLabel: string;
  // "ready": the coach can be paid. "missing": they need to set up payouts first. "platform": GYMX2's own item.
  payouts: "ready" | "missing" | "platform";
}) {
  const [kind, setKind] = useState<ArmoryKind>(initial.kind);
  const [filePath, setFilePath] = useState(initial.file_path);
  const [fileName, setFileName] = useState(initial.file_name);
  const [imagePath, setImagePath] = useState(initial.image_path);
  const [imageLabel, setImageLabel] = useState(initial.image_path ? "cover image" : "");

  return (
    <ActionForm action={saveArmoryItem} className="max-w-xl space-y-5">
      <input type="hidden" name="id" value={initial.id} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="file_path" value={kind === "download" || kind === "paid" ? filePath : ""} />
      <input type="hidden" name="file_name" value={kind === "download" || kind === "paid" ? fileName : ""} />
      <input type="hidden" name="image_path" value={imagePath} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">How do people get it?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["link", "Buy it elsewhere", "Link to your shop, Amazon, Gumroad and so on."],
              ["download", "Free download", "Upload a file members download here."],
              [
                "paid",
                "Sell a digital file",
                payouts === "platform"
                  ? "An ebook or program members pay for and download. Sales go to GYMX2."
                  : `An ebook or program members pay for and download. You get the sale minus GYMX2's ${PLATFORM_FEE_PERCENT}% fee.`,
              ],
              [
                "product",
                "Sell gear",
                payouts === "platform"
                  ? "Shirts and other physical items. Buyers pick a size and give an address; you ship it."
                  : `Shirts and other physical items. Buyers pick a size and give an address; you ship it and keep the shipping fee.`,
              ],
            ] as const
          ).map(([value, title, detail]) => (
            <label
              key={value}
              className={`cursor-pointer rounded-lg border p-3 ${kind === value ? "border-accent bg-surface-raised" : "border-border"}`}
            >
              <input
                type="radio"
                name="kind_choice"
                value={value}
                checked={kind === value}
                onChange={() => setKind(value)}
                className="sr-only"
              />
              <span className="block font-semibold">{title}</span>
              <span className="block text-sm text-muted">{detail}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Category</span>
        <select name="category" defaultValue={initial.category} className="field-input">
          {ARMORY_CATEGORIES.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </select>
      </label>
      <Field label="Title" name="title" maxLength={120} required defaultValue={initial.title} />
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Description (optional)</span>
        <textarea
          name="description"
          rows={4}
          maxLength={4000}
          defaultValue={initial.description}
          className="field-input"
        />
      </label>

      {kind === "product" ? (
        <>
          {payouts === "missing" && (
            <p role="status" className="rounded-lg border border-accent bg-surface p-3 text-sm">
              Before members can buy this, connect where your money goes.{" "}
              <Link href="/armory/payouts" className="text-link">
                Set up payouts
              </Link>
              . You can save the item now.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Price in USD"
              name="price"
              inputMode="decimal"
              placeholder="49.95"
              required
              defaultValue={initial.price}
            />
            <Field
              label="Shipping fee in USD"
              name="shipping"
              inputMode="decimal"
              placeholder="5.99"
              defaultValue={initial.shipping}
              hint="Added at checkout. Leave blank or 0 for free shipping. US addresses only for now."
            />
          </div>
          <Field
            label="Sizes (optional)"
            name="sizes"
            placeholder={DEFAULT_SIZES}
            defaultValue={initial.sizes}
            hint="Separate with commas. Buyers must pick one. Leave blank if there's only one version."
          />
        </>
      ) : kind === "link" ? (
        <>
          <Field
            label="Shop link"
            name="buy_url"
            type="url"
            placeholder="https://"
            maxLength={1000}
            required
            defaultValue={initial.buy_url}
          />
          <Field
            label="Price in USD (optional)"
            name="price"
            inputMode="decimal"
            placeholder="24.99"
            defaultValue={initial.price}
            hint="Shown so members know the cost before they leave GYMX2. Leave blank to hide it."
          />
        </>
      ) : (
        <>
        {kind === "paid" && (
          <>
            {payouts === "missing" && (
              <p role="status" className="rounded-lg border border-accent bg-surface p-3 text-sm">
                Before members can buy this, connect where your money goes.{" "}
                <Link href="/armory/payouts" className="text-link">
                  Set up payouts
                </Link>
                . You can save the item now.
              </p>
            )}
            <Field
              label="Price in USD"
              name="price"
              inputMode="decimal"
              placeholder="19.99"
              required
              defaultValue={initial.price}
              hint={
                payouts === "platform"
                  ? "At least $1.00."
                  : `At least $1.00. Stripe's card fees also come out of your share.`
              }
            />
          </>
        )}
        <UploadField
          label={kind === "paid" ? "File buyers download" : "File to download"}
          hint="PDF, EPUB, ZIP, MP3, MP4, PNG or JPG, up to 50 MB."
          accept=".pdf,.epub,.zip,.mp3,.mp4,.png,.jpg,.jpeg"
          bucket="armory-files"
          current={fileName || null}
          onUploaded={(path, name) => {
            setFilePath(path);
            setFileName(name);
          }}
        />
        </>
      )}

      <UploadField
        label="Cover image (optional)"
        hint="PNG, JPG or WebP, up to 5 MB. A square or portrait image looks best."
        accept=".png,.jpg,.jpeg,.webp"
        bucket="armory-images"
        current={imageLabel || null}
        onUploaded={(path, name) => {
          setImagePath(path);
          setImageLabel(name);
        }}
        onCleared={() => {
          setImagePath("");
          setImageLabel("");
        }}
      />

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="visible_to_all"
          defaultChecked={initial.visible_to_all}
          className="mt-0.5 size-4 accent-accent"
        />
        <span>
          Show to everyone on GYMX2
          <span className="block text-muted">
            Off: only members who joined you see it. On: anyone signed in can find it in the Armory.
          </span>
        </span>
      </label>

      <FormStatus />
      <SubmitButton pendingText="Saving..." className="btn-primary">
        {submitLabel}
      </SubmitButton>
    </ActionForm>
  );
}
