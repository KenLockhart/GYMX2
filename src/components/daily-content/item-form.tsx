"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { saveDailyContentItem } from "@/app/(app)/daily-content/actions";
import { isDailyContentVideoVisibility } from "@/lib/daily-content";
import type {
  DailyContentActionState,
  DailyContentKind,
  DailyContentPortalItem,
  DailyContentPortalVideoOption,
} from "@/lib/daily-content";
import type { Messages } from "@/i18n/messages";

type Copy = Messages["library"]["dailyContent"];
const initialState: DailyContentActionState = { status: "idle" };

function kindLabel(kind: DailyContentKind, copy: Copy) {
  if (kind === "video") return copy.kindVideo;
  if (kind === "quote") return copy.kindQuote;
  return copy.kindAffirmation;
}

function optionStatus(option: DailyContentPortalVideoOption, copy: Copy) {
  if (option.status === "ready") return "";
  if (option.status === "failed") return copy.videoFailed;
  return copy.videoProcessing;
}

export function DailyContentItemForm({
  item,
  videoOptions,
  copy,
  uploadHref,
}: {
  item?: DailyContentPortalItem;
  videoOptions: DailyContentPortalVideoOption[];
  copy: Copy;
  uploadHref: string;
}) {
  const [state, formAction, pending] = useActionState(saveDailyContentItem, initialState);
  const [kind, setKind] = useState<DailyContentKind>(item?.kind ?? "video");
  const revision = item?.latestRevision;
  const revisionVideoId = revision?.videoId ?? null;
  const revisionVideoMissingFromPage = Boolean(
    revisionVideoId && !videoOptions.some((option) => option.id === revisionVideoId),
  );
  const readyVideos = videoOptions.filter(
    (option) => option.status === "ready" && isDailyContentVideoVisibility(option.visibility),
  );
  const canKeepVideo = readyVideos.length > 0 || Boolean(revisionVideoId);

  return (
    <form action={formAction} className="space-y-4" aria-label={item ? copy.editHeading : copy.createHeading}>
      <input type="hidden" name="item_id" value={item?.id ?? ""} />
      {item ? (
        <>
          <input type="hidden" name="kind" value={kind} />
          <p className="text-sm text-muted">{copy.kind}: <span className="font-semibold text-foreground">{kindLabel(kind, copy)}</span></p>
        </>
      ) : (
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">{copy.kind}</span>
          <select
            className="field-input min-h-11"
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.currentTarget.value as DailyContentKind)}
            disabled={pending}
          >
            <option value="video">{copy.kindVideo}</option>
            <option value="quote">{copy.kindQuote}</option>
            <option value="affirmation">{copy.kindAffirmation}</option>
          </select>
        </label>
      )}

      <label className="block space-y-1.5">
        <span className="text-sm font-semibold">{copy.titleLabel}</span>
        <input
          className="field-input min-h-11"
          name="title"
          type="text"
          required
          minLength={1}
          maxLength={120}
          defaultValue={item?.latestRevision?.titleSnapshot ?? item?.title ?? ""}
          disabled={pending}
          autoComplete="off"
        />
        <span className="block text-xs text-muted">{copy.titleHint}</span>
      </label>

      {kind === "video" && (
        <div className="space-y-2">
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">{copy.video}</span>
            <select
              className="field-input min-h-11"
              name="video_id"
              required
              defaultValue={revision?.videoId ?? ""}
              disabled={pending || !canKeepVideo}
            >
              <option value="" disabled>{copy.chooseVideo}</option>
              {revisionVideoMissingFromPage && revisionVideoId && (
                <option value={revisionVideoId}>{revision?.titleSnapshot} — {copy.selectedVideoNotOnPage}</option>
              )}
              {videoOptions.map((option) => {
                const supportedVisibility = isDailyContentVideoVisibility(option.visibility);
                const isCurrent = option.id === revisionVideoId;
                const selectable = (option.status === "ready" && supportedVisibility) || isCurrent;
                const suffix = !supportedVisibility ? copy.videoUnsupported : optionStatus(option, copy);
                return (
                  <option key={option.id} value={option.id} disabled={!selectable}>
                    {option.title}{suffix ? ` — ${suffix}` : ""}
                  </option>
                );
              })}
            </select>
          </label>
          {readyVideos.length === 0 && !revisionVideoId && (
            <div className="rounded-xl border border-border bg-background/60 p-3 text-sm">
              <p className="font-medium">{copy.noVideoTitle}</p>
              <p className="mt-1 text-muted">{copy.uploadHint}</p>
              <Link href={uploadHref} className="mt-2 inline-flex font-semibold text-link hover:underline">{copy.videoUpload}</Link>
            </div>
          )}
        </div>
      )}

      {kind === "quote" && (
        <>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">{copy.quoteText}</span>
            <textarea
              className="field-input min-h-28 resize-y py-3"
              name="quote_text"
              required
              maxLength={500}
              defaultValue={revision?.quoteText ?? ""}
              disabled={pending}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-semibold">{copy.quoteAttribution}</span>
            <input
              className="field-input min-h-11"
              name="quote_attribution"
              maxLength={120}
              defaultValue={revision?.quoteAttribution ?? ""}
              disabled={pending}
              autoComplete="off"
            />
          </label>
        </>
      )}

      {kind === "affirmation" && (
        <label className="block space-y-1.5">
          <span className="text-sm font-semibold">{copy.affirmationText}</span>
          <textarea
            className="field-input min-h-28 resize-y py-3"
            name="affirmation_text"
            required
            maxLength={500}
            defaultValue={revision?.affirmationText ?? ""}
            disabled={pending}
          />
        </label>
      )}
      <p className="text-xs text-muted">{copy.textLimitHint}</p>

      {state.status === "saved" && <p role="status" className="text-sm text-success">{copy.saved}</p>}
      {state.status === "error" && <p role="alert" className="text-sm text-danger">{copy.errors[state.reason]}</p>}
      <button
        type="submit"
        className="btn-primary min-h-11"
        disabled={pending || (kind === "video" && !canKeepVideo)}
      >
        {pending ? copy.saving : item ? copy.saveChanges : copy.saveDraft}
      </button>
    </form>
  );
}
