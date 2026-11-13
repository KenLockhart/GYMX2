"use client";

import Link from "next/link";
import { useState } from "react";
import {
  prepareArmoryUpload,
  saveArmoryItem,
} from "@/app/(app)/armory/actions";
import {
  ActionForm,
  Field,
  FormStatus,
  SubmitButton,
} from "@/components/form-parts";
import {
  DEFAULT_SIZES,
  categoriesFor,
  PLATFORM_FEE_PERCENT,
  describeSize,
  type ArmoryKind,
} from "@/lib/armory";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { T, useTr } from "@/i18n/t";

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

type Upload = {
  status: "idle" | "uploading" | "done" | "error";
  message?: string;
};

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
  const tr = useTr();
  const [upload, setUpload] = useState<Upload>({ status: "idle" });

  async function handleFile(file: File) {
    setUpload({
      status: "uploading",
      message: tr("Uploading {name} ({size})...", {
        name: file.name,
        size: describeSize(file.size),
      }),
    });
    const prepared = await prepareArmoryUpload({
      bucket,
      file_name: file.name,
      size: file.size,
    });
    if (prepared.error || !prepared.path || !prepared.token) {
      setUpload({
        status: "error",
        message: prepared.error ?? tr("We couldn't start the upload."),
      });
      return;
    }
    const { error } = await createBrowserSupabase()
      .storage.from(bucket)
      .uploadToSignedUrl(prepared.path, prepared.token, file, {
        contentType: file.type || undefined,
      });
    if (error) {
      setUpload({
        status: "error",
        message: tr("The upload stopped. Check your connection and try again."),
      });
      return;
    }
    onUploaded(prepared.path, file.name);
    setUpload({
      status: "done",
      message: tr("Uploaded {name}.", { name: file.name }),
    });
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
          <span className="text-muted">
            {tr("Current: {name}", {
              name: current === "cover image" ? tr("cover image") : current,
            })}
          </span>
          {onCleared && (
            <button
              type="button"
              onClick={onCleared}
              className="text-link text-sm"
            >
              <T>Remove</T>
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
  const tr = useTr();
  const [kind, setKind] = useState<ArmoryKind>(initial.kind);
  const [category, setCategory] = useState(initial.category);
  const categories = categoriesFor(kind);
  // Choosing gear picks the Gear category; a digital file can't stay in Gear.
  function chooseKind(next: ArmoryKind) {
    setKind(next);
    if (next === "product" || next === "preview") setCategory("gear");
    else if ((next === "download" || next === "paid") && category === "gear")
      setCategory("other");
  }
  const [filePath, setFilePath] = useState(initial.file_path);
  const [fileName, setFileName] = useState(initial.file_name);
  const [imagePath, setImagePath] = useState(initial.image_path);
  const [imageLabel, setImageLabel] = useState(
    initial.image_path ? "cover image" : "",
  );

  return (
    <ActionForm action={saveArmoryItem} className="max-w-xl space-y-5">
      <input type="hidden" name="id" value={initial.id} />
      <input type="hidden" name="kind" value={kind} />
      <input
        type="hidden"
        name="file_path"
        value={kind === "download" || kind === "paid" ? filePath : ""}
      />
      <input
        type="hidden"
        name="file_name"
        value={kind === "download" || kind === "paid" ? fileName : ""}
      />
      <input type="hidden" name="image_path" value={imagePath} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">
          <T>How do people get it?</T>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              [
                "preview",
                "Display gear only",
                "Show a physical product without allowing purchases.",
              ],
              [
                "link",
                "Buy it elsewhere",
                "Link to your shop, Amazon, Gumroad and so on.",
              ],
              [
                "download",
                "Free download",
                "Upload a file members download here.",
              ],
              [
                "paid",
                "Sell a digital file",
                payouts === "platform"
                  ? tr(
                      "An ebook or program members pay for and download. Sales go to GYMX2.",
                    )
                  : tr(
                      "An ebook or program members pay for and download. You get the sale minus GYMX2's {PLATFORM_FEE_PERCENT}% fee.",
                      { PLATFORM_FEE_PERCENT },
                    ),
              ],
              [
                "product",
                "Sell gear",
                payouts === "platform"
                  ? tr(
                      "Shirts and other physical items. Buyers pick a size and give an address; you ship it.",
                    )
                  : tr(
                      "Shirts and other physical items. Buyers pick a size and give an address; you ship it and keep the shipping fee.",
                    ),
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
                onChange={() => chooseKind(value)}
                className="sr-only"
              />
              <span className="block font-semibold">
                <T>{title}</T>
              </span>
              <span className="block text-sm text-muted">
                <T>{detail}</T>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">
          <T>Category</T>
        </span>
        <select
          name="category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="field-input"
        >
          {categories.map((option) => (
            <option key={option.value} value={option.value}>
              <T>{option.label}</T>
            </option>
          ))}
        </select>
      </label>
      <Field
        label={tr("Title")}
        name="title"
        maxLength={120}
        required
        defaultValue={initial.title}
      />
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">
          <T>Description (optional)</T>
        </span>
        <textarea
          name="description"
          rows={4}
          maxLength={4000}
          defaultValue={initial.description}
          className="field-input"
        />
      </label>

      {kind === "product" || kind === "preview" ? (
        <>
          {kind === "product" && payouts === "missing" && (
            <p
              role="status"
              className="rounded-lg border border-accent bg-surface p-3 text-sm"
            >
              <T>Before members can buy this, connect where your money goes.</T>{" "}
              <Link href="/armory/payouts" className="text-link">
                <T>Set up payouts</T>
              </Link>
              <T>. You can save the item now.</T>
            </p>
          )}
          {kind === "preview" && (
            <p role="status" className="rounded-lg border border-accent bg-surface p-3 text-sm">
              <T>Display only: members can view this product, but cannot purchase it.</T>
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={tr("Price in USD")}
              name="price"
              inputMode="decimal"
              placeholder="49.95"
              required
              defaultValue={initial.price}
            />
            <Field
              label={tr("Shipping fee in USD")}
              name="shipping"
              inputMode="decimal"
              placeholder="5.99"
              defaultValue={initial.shipping}
              hint={tr(
                "Added at checkout. Leave blank or 0 for free shipping. US addresses only for now.",
              )}
            />
          </div>
          <Field
            label={tr("Sizes (optional)")}
            name="sizes"
            placeholder={DEFAULT_SIZES}
            defaultValue={initial.sizes}
            hint={tr(
              "Separate with commas. Buyers must pick one. Leave blank if there's only one version.",
            )}
          />
        </>
      ) : kind === "link" ? (
        <>
          <Field
            label={tr("Shop link")}
            name="buy_url"
            type="url"
            placeholder={tr("https://")}
            maxLength={1000}
            required
            defaultValue={initial.buy_url}
          />
          <Field
            label={tr("Price in USD (optional)")}
            name="price"
            inputMode="decimal"
            placeholder="24.99"
            defaultValue={initial.price}
            hint={tr(
              "Shown so members know the cost before they leave GYMX2. Leave blank to hide it.",
            )}
          />
        </>
      ) : (
        <>
          {kind === "paid" && (
            <>
              {payouts === "missing" && (
                <p
                  role="status"
                  className="rounded-lg border border-accent bg-surface p-3 text-sm"
                >
                  <T>
                    Before members can buy this, connect where your money goes.
                  </T>{" "}
                  <Link href="/armory/payouts" className="text-link">
                    <T>Set up payouts</T>
                  </Link>
                  <T>. You can save the item now.</T>
                </p>
              )}
              <Field
                label={tr("Price in USD")}
                name="price"
                inputMode="decimal"
                placeholder="19.99"
                required
                defaultValue={initial.price}
                hint={
                  payouts === "platform"
                    ? tr("At least $1.00.")
                    : tr(
                        "At least $1.00. Stripe's card fees also come out of your share.",
                      )
                }
              />
            </>
          )}
          <UploadField
            label={
              kind === "paid"
                ? tr("File buyers download")
                : tr("File to download")
            }
            hint={tr("PDF, EPUB, ZIP, MP3, MP4, PNG or JPG, up to 50 MB.")}
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
        label={tr("Cover image (optional)")}
        hint={tr(
          "PNG, JPG or WebP, up to 5 MB. A square or portrait image looks best.",
        )}
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
          <T>Show to everyone on GYMX2</T>
          <span className="block text-muted">
            <T>
              Off: only members who joined you see it. On: anyone signed in can
              find it in the Armory.
            </T>
          </span>
        </span>
      </label>

      <FormStatus />
      <SubmitButton pendingText={tr("Saving...")} className="btn-primary">
        {submitLabel}
      </SubmitButton>
    </ActionForm>
  );
}
