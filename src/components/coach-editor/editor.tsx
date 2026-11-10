"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  prepareCoachPhoto,
  saveCoachDraft,
  setCoachPhoto,
  submitCoachProfile,
  unpublishMyProfile,
} from "@/app/(app)/profile/coach/actions";
import { CoachProfile } from "@/components/coach-profile/coach-profile-view";
import {
  type CoachDraft,
  PROFILE_CHECKS,
  profileCompletion,
  profileWarnings,
  toCoachView,
} from "@/lib/coach-draft";
import {
  BIO_PROMPTS,
  COACH_STYLE,
  COACHING_DETAIL_FIELDS,
  NUTRITION_SUPPORT,
  PACKAGE_KINDS,
  POLICY_FIELDS,
  POPULATIONS,
  SERVICES,
  STYLE_KEYS,
  TIME_ZONES,
} from "@/lib/coach-options";
import { formatPrice, LOVE_LANGUAGES } from "@/lib/coach-profile";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { kindLabel, overallVerification } from "@/lib/credentials";
import type { OwnCredential } from "@/lib/credentials-server";
import { CredentialsStep } from "./credentials-step";
import {
  CheckboxGroup,
  ChipInput,
  Note,
  RadioCards,
  SelectInput,
  TextArea,
  TextInput,
} from "./fields";

const STEPS = [
  { key: "basics", label: "Basics" },
  { key: "photo", label: "Photo" },
  { key: "bio", label: "About me" },
  { key: "credentials", label: "Qualifications" },
  { key: "clients", label: "Ideal clients" },
  { key: "style", label: "Coaching style" },
  { key: "services", label: "Online coaching" },
  { key: "results", label: "Experience" },
  { key: "nutrition", label: "Nutrition" },
  { key: "availability", label: "Availability" },
  { key: "pricing", label: "Pricing" },
  { key: "video", label: "Video" },
  { key: "preview", label: "Preview & submit" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

type Status = "draft" | "submitted" | "approved" | "changes_requested";

const STATUS_TEXT: Record<Status, string> = {
  draft: "Draft: not submitted",
  submitted: "Submitted: waiting for GYMX2 review",
  approved: "Approved and live",
  changes_requested: "Changes requested",
};

export function CoachProfileEditor({
  coachId,
  coachName,
  initial,
  initialPhotoUrl,
  initialStatus,
  reviewNote,
  published,
  initialCredentials,
}: {
  coachId: string;
  coachName: string;
  initial: CoachDraft;
  initialPhotoUrl: string | null;
  initialStatus: Status;
  reviewNote: string;
  published: boolean;
  initialCredentials: OwnCredential[];
}) {
  const [credentials, setCredentials] = useState(initialCredentials);
  const [draft, setDraft] = useState(initial);
  const [step, setStep] = useState<StepKey>("basics");
  const [status, setStatus] = useState<Status>(initialStatus);
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl);
  const [save, setSave] = useState<{
    state: "idle" | "saving" | "saved" | "error";
    message?: string;
  }>({
    state: "idle",
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(published);
  const [pending, start] = useTransition();
  // What's already saved, so autosave only runs after a real change.
  const lastSaved = useRef(JSON.stringify(initial));
  const topRef = useRef<HTMLDivElement>(null);

  // Autosave a moment after the coach stops typing.
  useEffect(() => {
    const snapshot = JSON.stringify(draft);
    if (snapshot === lastSaved.current) return;
    const timer = setTimeout(async () => {
      setSave({ state: "saving" });
      const result = await saveCoachDraft(draft);
      if (result.error) setSave({ state: "error", message: result.error });
      else {
        lastSaved.current = snapshot;
        setSave({ state: "saved" });
        setStatus((current) =>
          current === "submitted" || current === "approved" ? "draft" : current,
        );
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [draft]);

  function update<K extends keyof CoachDraft>(key: K, value: CoachDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  function updateIn<
    K extends
      "about" | "style" | "coaching" | "results" | "nutrition" | "availability",
  >(key: K, value: Partial<CoachDraft[K]>) {
    setDraft((current) => ({
      ...current,
      [key]: { ...current[key], ...value },
    }));
  }

  const completion = profileCompletion(draft, Boolean(photoUrl));
  const warnings = profileWarnings(draft);
  const index = STEPS.findIndex((s) => s.key === step);
  const stepDone = (key: StepKey) => {
    const checks = PROFILE_CHECKS.filter((c) => c.step === key);
    return (
      checks.length > 0 && checks.every((c) => c.done(draft, Boolean(photoUrl)))
    );
  };
  function go(key: StepKey) {
    setStep(key);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div ref={topRef} className="scroll-mt-4 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-5xl">Your coach profile</h1>
          <p className="mt-2 max-w-xl text-muted">
            This is what members see when they find you. It saves as you type;
            when it&apos;s ready, submit it and GYMX2 will review it before it
            goes live.
          </p>
        </div>
        <div className="text-sm sm:text-right">
          <p className="font-semibold">{STATUS_TEXT[status]}</p>
          <p role="status" className="text-muted" aria-live="polite">
            {save.state === "saving"
              ? "Saving..."
              : save.state === "saved"
                ? "All changes saved"
                : save.state === "error"
                  ? ""
                  : "Changes save automatically"}
          </p>
        </div>
      </div>
      {save.state === "error" && (
        <p
          role="alert"
          className="rounded-xl border border-danger bg-surface p-3 text-sm text-danger"
        >
          {save.message}
        </p>
      )}
      {status === "changes_requested" && reviewNote && (
        <div className="rounded-xl border border-accent bg-accent/5 p-4 text-sm">
          <p className="font-semibold text-accent">GYMX2 asked for changes</p>
          <p className="mt-1 whitespace-pre-line">{reviewNote}</p>
        </div>
      )}
      {isLive && status === "draft" && (
        <Note>
          Your approved profile is live. Changes you make here stay private
          until you submit them and GYMX2 approves them.
        </Note>
      )}

      <div>
        <div className="flex items-center justify-between text-sm">
          <span>Profile {completion.percent}% complete</span>
          <span className="text-muted">
            Step {index + 1} of {STEPS.length}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Profile completion"
          aria-valuenow={completion.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-raised"
        >
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${completion.percent}%` }}
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav
          aria-label="Profile steps"
          className="md:sticky md:top-4 md:self-start"
        >
          <label className="sr-only" htmlFor="step-select">
            Step
          </label>
          <select
            id="step-select"
            value={step}
            onChange={(event) => go(event.target.value as StepKey)}
            className="field-input md:hidden"
          >
            {STEPS.map((s, i) => (
              <option key={s.key} value={s.key}>
                {i + 1}. {s.label}
                {stepDone(s.key) ? " ✓" : ""}
              </option>
            ))}
          </select>
          <ol className="hidden space-y-1 md:block">
            {STEPS.map((s, i) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => go(s.key)}
                  aria-current={step === s.key ? "step" : undefined}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${step === s.key ? "bg-surface-raised font-semibold text-foreground" : "text-muted hover:text-foreground"}`}
                >
                  <span
                    aria-hidden
                    className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${stepDone(s.key) ? "bg-accent text-accent-foreground" : "border border-border"}`}
                  >
                    {stepDone(s.key) ? "✓" : i + 1}
                  </span>
                  {s.label}
                  {stepDone(s.key) && <span className="sr-only"> (done)</span>}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <section
          aria-label={STEPS[index].label}
          className="min-w-0 space-y-6 rounded-2xl border border-border bg-surface p-5 sm:p-6"
        >
          <h2 className="text-3xl">{STEPS[index].label}</h2>

          {step === "basics" && (
            <>
              <TextArea
                label="Your headline"
                value={draft.headline}
                onChange={(v) => update("headline", v)}
                max={160}
                rows={2}
                placeholder="I'm the coach who will celebrate your first push-up just as much as your first 100-pound deadlift."
                hint="One sentence that sounds like you. It sits right under your name."
              />
              <ChipInput
                label="Top specialties"
                values={draft.specialties}
                onChange={(v) => update("specialties", v)}
                max={3}
                maxLength={30}
                placeholder="Strength"
                hint="Up to three, shown under your name."
              />
              <TextInput
                label="Location"
                value={draft.location}
                onChange={(v) => update("location", v)}
                max={80}
                placeholder="Atlanta, GA"
                hint="City and state is plenty. Never your home address."
              />
              <CheckboxGroup<"online" | "in_person">
                legend="How you train clients"
                options={[
                  { value: "online", label: "Online" },
                  { value: "in_person", label: "In person" },
                ]}
                values={draft.formats}
                onChange={(v) => update("formats", v)}
              />
              <SelectInput
                label="How do you describe yourself? (optional)"
                value={draft.identity}
                options={[
                  { value: "woman", label: "Woman" },
                  { value: "man", label: "Man" },
                  { value: "nonbinary", label: "Non-binary" },
                ]}
                emptyLabel="Prefer not to say"
                onChange={(v) => update("identity", v)}
                hint="Never shown on your profile. Some members ask for a coach who is a woman or a man; this lets them find you."
              />
              <RadioCards
                legend="Taking new clients?"
                options={[
                  { value: "yes", label: "Yes, accepting new clients" },
                  { value: "no", label: "Waitlist only" },
                ]}
                value={draft.acceptingClients ? "yes" : "no"}
                onChange={(v) => update("acceptingClients", v === "yes")}
              />
            </>
          )}

          {step === "photo" && (
            <PhotoStep
              coachId={coachId}
              coachName={coachName}
              url={photoUrl}
              onChange={(url) => {
                setPhotoUrl(url);
                setStatus((current) =>
                  current === "submitted" || current === "approved"
                    ? "draft"
                    : current,
                );
              }}
            />
          )}

          {step === "bio" && (
            <>
              <TextArea
                label="About me"
                value={draft.about.intro}
                onChange={(v) => updateIn("about", { intro: v })}
                max={2000}
                rows={8}
                placeholder={
                  "Fitness should make you feel stronger, more confident and more capable, not intimidated.\n\nI love working with people who are ready to make a change but aren't sure where to begin."
                }
                hint="Your story, why you coach and your philosophy. Leave a blank line between paragraphs. At least 80 characters."
              />
              <ChipInput
                label="Three words that describe you"
                values={draft.about.threeWords}
                onChange={(v) => updateIn("about", { threeWords: v })}
                max={3}
                maxLength={20}
                placeholder="Encouraging"
              />
              <div className="space-y-4">
                <p className="text-sm font-semibold">
                  Answer any of these (optional)
                </p>
                {BIO_PROMPTS.map((prompt) => {
                  const answer =
                    draft.about.prompts.find((p) => p.prompt === prompt)
                      ?.answer ?? "";
                  return (
                    <TextArea
                      key={prompt}
                      label={prompt}
                      value={answer}
                      rows={2}
                      max={500}
                      onChange={(v) =>
                        updateIn("about", {
                          prompts: [
                            ...draft.about.prompts.filter(
                              (p) => p.prompt !== prompt,
                            ),
                            ...(v ? [{ prompt, answer: v }] : []),
                          ].sort(
                            (a, b) =>
                              BIO_PROMPTS.indexOf(a.prompt) -
                              BIO_PROMPTS.indexOf(b.prompt),
                          ),
                        })
                      }
                    />
                  );
                })}
              </div>
              <TextArea
                label="My ideal client is someone who…"
                value={draft.idealClient}
                onChange={(v) => update("idealClient", v)}
                max={500}
                rows={3}
              />
              <ChipInput
                label="Interests and hobbies"
                values={draft.about.interests}
                onChange={(v) => updateIn("about", { interests: v })}
                max={8}
                maxLength={40}
                placeholder="Trail walks"
              />
              <ChipInput
                label="Fun facts"
                values={draft.about.funFacts}
                onChange={(v) => updateIn("about", { funFacts: v })}
                max={4}
                maxLength={120}
              />
              <TextInput
                label="Favorite motivational quote"
                value={draft.about.quote}
                onChange={(v) => updateIn("about", { quote: v })}
                max={200}
              />
            </>
          )}

          {step === "credentials" && (
            <CredentialsStep
              credentials={credentials}
              onChange={setCredentials}
            />
          )}

          {step === "clients" && (
            <>
              <CheckboxGroup
                legend="Who you work best with"
                hint="Pick the groups you have real experience with, then add a line about each."
                options={POPULATIONS}
                values={draft.populations.map((p) => p.label)}
                onChange={(labels) =>
                  update(
                    "populations",
                    labels.map((label) => ({
                      label,
                      note:
                        draft.populations.find((p) => p.label === label)
                          ?.note ?? "",
                    })),
                  )
                }
              />
              {draft.populations.length > 0 && (
                <div className="space-y-3">
                  {draft.populations.map((item) => (
                    <TextInput
                      key={item.label}
                      label={`${item.label}: your experience`}
                      value={item.note}
                      max={200}
                      onChange={(v) =>
                        update(
                          "populations",
                          draft.populations.map((p) =>
                            p.label === item.label ? { ...p, note: v } : p,
                          ),
                        )
                      }
                    />
                  ))}
                </div>
              )}
              <TextArea
                label="Who might be better served by another specialist?"
                value={draft.betterServedBy}
                onChange={(v) => update("betterServedBy", v)}
                max={500}
                rows={3}
                hint="Being clear about this builds trust. You can mention who you'd refer people to."
              />
            </>
          )}

          {step === "style" && (
            <>
              {STYLE_KEYS.map((key) => (
                <div key={key} className="space-y-3">
                  <RadioCards
                    legend={COACH_STYLE[key].label}
                    options={COACH_STYLE[key].options}
                    value={draft.style[key].primary}
                    onChange={(v) =>
                      updateIn("style", {
                        [key]: { ...draft.style[key], primary: v },
                      })
                    }
                  />
                  <SelectInput
                    label="Sometimes also (optional)"
                    value={draft.style[key].secondary}
                    options={COACH_STYLE[key].options.filter(
                      (o) => o.value !== draft.style[key].primary,
                    )}
                    emptyLabel="Nothing else"
                    onChange={(v) =>
                      updateIn("style", {
                        [key]: { ...draft.style[key], secondary: v },
                      })
                    }
                  />
                </div>
              ))}
              <ChipInput
                label="Personality traits"
                values={draft.style.traits}
                onChange={(v) => updateIn("style", { traits: v })}
                max={8}
                maxLength={40}
                placeholder="Celebrates milestones"
              />
              <div className="space-y-3">
                <RadioCards
                  legend="Your coaching love language"
                  hint="How you naturally motivate people. Members pick theirs, and the two are compared."
                  options={LOVE_LANGUAGES}
                  value={draft.loveLanguages.primary}
                  onChange={(v) =>
                    update("loveLanguages", {
                      primary: v,
                      secondary:
                        draft.loveLanguages.secondary === v
                          ? null
                          : draft.loveLanguages.secondary,
                    })
                  }
                />
                <SelectInput
                  label="Second love language (optional)"
                  value={draft.loveLanguages.secondary}
                  options={LOVE_LANGUAGES.filter(
                    (l) => l.value !== draft.loveLanguages.primary,
                  )}
                  emptyLabel="None"
                  onChange={(v) =>
                    update("loveLanguages", {
                      ...draft.loveLanguages,
                      secondary: v,
                    })
                  }
                />
              </div>
              <TextArea
                label="Anything else about your style"
                value={draft.style.note}
                onChange={(v) => updateIn("style", { note: v })}
                max={300}
                rows={2}
              />
            </>
          )}

          {step === "services" && (
            <>
              <CheckboxGroup
                legend="What clients get"
                options={SERVICES}
                values={draft.coaching.included}
                onChange={(v) => updateIn("coaching", { included: v })}
              />
              <RadioCards
                legend="Programming"
                options={[
                  { value: "custom", label: "Built for each client" },
                  { value: "mixed", label: "Templates adjusted per client" },
                  { value: "template", label: "Proven templates" },
                ]}
                value={draft.coaching.customization}
                onChange={(v) => updateIn("coaching", { customization: v })}
                hint="Be exact: members should know what they're paying for."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                {COACHING_DETAIL_FIELDS.map((field) => (
                  <TextInput
                    key={field.key}
                    label={field.label}
                    value={draft.coaching.details[field.key] ?? ""}
                    max={120}
                    placeholder={field.example}
                    onChange={(v) =>
                      updateIn("coaching", {
                        details: { ...draft.coaching.details, [field.key]: v },
                      })
                    }
                  />
                ))}
              </div>
            </>
          )}

          {step === "results" && (
            <>
              <Field label="Years of coaching experience">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={60}
                  value={draft.experienceYears ?? ""}
                  onChange={(event) =>
                    update(
                      "experienceYears",
                      event.target.value === ""
                        ? null
                        : Math.max(
                            0,
                            Math.min(
                              60,
                              Math.round(Number(event.target.value)),
                            ),
                          ),
                    )
                  }
                  className="field-input w-32"
                />
              </Field>
              <ChipInput
                label="Areas of expertise"
                values={draft.results.expertise}
                onChange={(v) => updateIn("results", { expertise: v })}
                max={6}
                maxLength={40}
                placeholder="First-time lifters"
              />
              <TextArea
                label="How you coach"
                value={draft.results.methodology}
                onChange={(v) => updateIn("results", { methodology: v })}
                max={1000}
                rows={4}
                placeholder="Every client starts with a movement check and a four-week foundation block…"
              />
              <div className="space-y-3">
                <p className="text-sm font-semibold">
                  Client stories (optional, up to 3)
                </p>
                <p className="text-xs text-muted">
                  Shown as self-reported. Share only with your client&apos;s
                  permission, use no full names, and never promise results.
                </p>
                {draft.results.stories.map((story, i) => (
                  <div
                    key={i}
                    className="space-y-3 rounded-xl border border-border p-4"
                  >
                    <TextInput
                      label="Title"
                      value={story.title}
                      max={80}
                      onChange={(v) =>
                        updateIn("results", {
                          stories: draft.results.stories.map((s, j) =>
                            j === i ? { ...s, title: v } : s,
                          ),
                        })
                      }
                    />
                    <TextArea
                      label="What happened"
                      value={story.summary}
                      max={500}
                      rows={3}
                      onChange={(v) =>
                        updateIn("results", {
                          stories: draft.results.stories.map((s, j) =>
                            j === i ? { ...s, summary: v } : s,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateIn("results", {
                          stories: draft.results.stories.filter(
                            (_, j) => j !== i,
                          ),
                        })
                      }
                      className="cursor-pointer text-sm text-muted hover:text-danger"
                    >
                      Remove story
                    </button>
                  </div>
                ))}
                {draft.results.stories.length < 3 && (
                  <button
                    type="button"
                    onClick={() =>
                      updateIn("results", {
                        stories: [
                          ...draft.results.stories,
                          { title: "", summary: "" },
                        ],
                      })
                    }
                    className="btn-secondary px-4 py-2 text-sm"
                  >
                    Add a story
                  </button>
                )}
              </div>
            </>
          )}

          {step === "nutrition" && (
            <>
              <CheckboxGroup
                legend="Nutrition and lifestyle support you offer"
                options={NUTRITION_SUPPORT}
                values={draft.nutrition.offers}
                onChange={(v) => updateIn("nutrition", { offers: v })}
              />
              <TextInput
                label="Nutrition qualifications"
                value={draft.nutrition.qualifications}
                onChange={(v) => updateIn("nutrition", { qualifications: v })}
                max={200}
                placeholder="Precision Nutrition Level 1"
              />
              <Note>
                Your profile always notes that meal plans for medical
                conditions, diagnosis and medication are for doctors and
                registered dietitians. Only call yourself a dietitian if
                you&apos;re licensed as one.
              </Note>
            </>
          )}

          {step === "availability" && (
            <>
              <SelectInput
                label="Time zone"
                value={draft.availability.timeZone}
                options={TIME_ZONES}
                onChange={(v) => v && updateIn("availability", { timeZone: v })}
              />
              <div className="space-y-3">
                <p className="text-sm font-semibold">When you coach</p>
                {draft.availability.schedule.map((slot, i) => (
                  <div
                    key={i}
                    className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto] sm:items-end"
                  >
                    <TextInput
                      label="Days"
                      value={slot.days}
                      max={40}
                      placeholder="Mon to Thu"
                      onChange={(v) =>
                        updateIn("availability", {
                          schedule: draft.availability.schedule.map((s, j) =>
                            j === i ? { ...s, days: v } : s,
                          ),
                        })
                      }
                    />
                    <TextInput
                      label="Hours"
                      value={slot.hours}
                      max={80}
                      placeholder="6:00 to 9:00 AM, 5:00 to 8:00 PM"
                      onChange={(v) =>
                        updateIn("availability", {
                          schedule: draft.availability.schedule.map((s, j) =>
                            j === i ? { ...s, hours: v } : s,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateIn("availability", {
                          schedule: draft.availability.schedule.filter(
                            (_, j) => j !== i,
                          ),
                        })
                      }
                      aria-label={`Remove time ${i + 1}`}
                      className="btn-secondary px-3 py-2.5"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {draft.availability.schedule.length < 7 && (
                  <button
                    type="button"
                    onClick={() =>
                      updateIn("availability", {
                        schedule: [
                          ...draft.availability.schedule,
                          { days: "", hours: "" },
                        ],
                      })
                    }
                    className="btn-secondary px-4 py-2 text-sm"
                  >
                    Add times
                  </button>
                )}
              </div>
              <TextInput
                label="Training locations"
                value={draft.availability.locations}
                onChange={(v) => updateIn("availability", { locations: v })}
                max={200}
                placeholder="Online anywhere; in person in Midtown Atlanta"
              />
              <TextInput
                label="Languages"
                value={draft.availability.languages}
                onChange={(v) => updateIn("availability", { languages: v })}
                max={120}
                placeholder="English, Spanish"
              />
              <TextInput
                label="Accessibility"
                value={draft.availability.accessibility}
                onChange={(v) => updateIn("availability", { accessibility: v })}
                max={300}
                placeholder="Seated and low-impact options for every program"
              />
              <TextInput
                label="Capacity"
                value={draft.availability.capacity}
                onChange={(v) => updateIn("availability", { capacity: v })}
                max={120}
                placeholder="Taking 4 new clients this month"
              />
            </>
          )}

          {step === "pricing" && <PricingStep draft={draft} update={update} />}

          {step === "video" && (
            <Note>
              Intro video uploads arrive with a later update. Start thinking
              about 60 to 90 seconds on who you are, why you coach, who you love
              helping and what the first month looks like.
            </Note>
          )}

          {step === "preview" && (
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="font-semibold">
                  {completion.ready ? "Ready to submit" : "Before you submit"}
                </p>
                {completion.missingRequired.length > 0 && (
                  <ul className="space-y-1 text-sm">
                    {completion.missingRequired.map((check) => (
                      <li key={check.label}>
                        <button
                          type="button"
                          onClick={() => go(check.step as StepKey)}
                          className="text-link cursor-pointer"
                        >
                          {check.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {warnings.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-danger">
                    {warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={
                    pending ||
                    !completion.ready ||
                    warnings.length > 0 ||
                    status === "submitted" ||
                    save.state === "saving"
                  }
                  onClick={() => {
                    setSubmitError(null);
                    start(async () => {
                      const saved = await saveCoachDraft(draft);
                      if (saved.error) return setSubmitError(saved.error);
                      lastSaved.current = JSON.stringify(draft);
                      const result = await submitCoachProfile();
                      if (result.error) return setSubmitError(result.error);
                      setStatus("submitted");
                    });
                  }}
                  className="btn-primary"
                >
                  {status === "submitted"
                    ? "Submitted"
                    : pending
                      ? "Submitting..."
                      : "Submit for review"}
                </button>
                {isLive && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Take your profile down? Members will see your basic coach page until you're approved again.",
                        )
                      )
                        return;
                      start(async () => {
                        const result = await unpublishMyProfile();
                        if (result.error) return setSubmitError(result.error);
                        setIsLive(false);
                        setStatus("draft");
                      });
                    }}
                    className="btn-secondary"
                  >
                    Unpublish
                  </button>
                )}
                {isLive && (
                  <Link href={`/coaches/${coachId}`} className="btn-secondary">
                    See your live profile
                  </Link>
                )}
              </div>
              {submitError && (
                <p role="alert" className="text-sm text-danger">
                  {submitError}
                </p>
              )}
              <p className="text-xs text-muted">
                GYMX2 reviews every profile, usually within two business days.
                You&apos;ll see the result here.
              </p>
              <div className="rounded-2xl border border-dashed border-border p-3 sm:p-5">
                <p className="mb-4 text-xs uppercase tracking-widest text-muted">
                  Preview: what members will see
                </p>
                <CoachProfile
                  profile={toCoachView(draft, {
                    id: coachId,
                    name: coachName,
                    photoUrl,
                    rating: null,
                    reviews: [],
                    ...previewCredentials(credentials),
                  })}
                />
              </div>
            </div>
          )}

          <div className="flex justify-between gap-3 border-t border-border pt-5">
            <button
              type="button"
              onClick={() => go(STEPS[Math.max(0, index - 1)].key)}
              disabled={index === 0}
              className="btn-secondary"
            >
              Back
            </button>
            {index < STEPS.length - 1 && (
              <button
                type="button"
                onClick={() => go(STEPS[index + 1].key)}
                className="btn-primary"
              >
                Next: {STEPS[index + 1].label}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-semibold">{label}</span>
      {children}
    </label>
  );
}

function PhotoStep({
  coachId,
  coachName,
  url,
  onChange,
}: {
  coachId: string;
  coachName: string;
  url: string | null;
  onChange: (url: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    start(async () => {
      const prepared = await prepareCoachPhoto({
        name: file.name,
        size: file.size,
      });
      if (!prepared.path || !prepared.token)
        return setError(prepared.error ?? "Upload failed.");
      const { error: uploadError } = await createBrowserSupabase()
        .storage.from("coach-photos")
        .uploadToSignedUrl(prepared.path, prepared.token, file, {
          contentType: file.type,
        });
      if (uploadError)
        return setError("The photo didn't upload. Please try again.");
      const result = await setCoachPhoto(prepared.path);
      if (result.error) return setError(result.error);
      onChange(result.url ?? null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="aspect-[4/5] w-40 shrink-0 overflow-hidden rounded-2xl border border-border bg-surface-raised">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage link
            <img
              src={url}
              alt={`${coachName}'s profile photo`}
              className="size-full object-cover object-top"
            />
          ) : (
            <p className="grid size-full place-items-center p-4 text-center text-sm text-muted">
              No photo yet
            </p>
          )}
        </div>
        <div className="space-y-3 text-sm">
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>A clear, friendly photo of you, from the waist or chest up.</li>
            <li>
              Good light, a plain background, and athletic or professional
              clothing.
            </li>
            <li>
              Only photos you own or have permission to use. No logos of other
              brands.
            </li>
            <li>
              JPG, PNG or WebP, up to 5 MB. It&apos;s shown in a 4:5 frame.
            </li>
          </ul>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => {
              upload(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => input.current?.click()}
              disabled={pending}
              className="btn-primary"
            >
              {pending
                ? "Uploading..."
                : url
                  ? "Replace photo"
                  : "Upload photo"}
            </button>
            {url && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const result = await setCoachPhoto(null);
                    if (result.error) return setError(result.error);
                    onChange(null);
                  })
                }
                className="btn-secondary"
              >
                Remove
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
          <p className="text-xs text-muted" data-coach={coachId}>
            Your photo goes live with the rest of your profile after review.
          </p>
        </div>
      </div>
    </div>
  );
}

function PricingStep({
  draft,
  update,
}: {
  draft: CoachDraft;
  update: <K extends keyof CoachDraft>(key: K, value: CoachDraft[K]) => void;
}) {
  const packages = draft.packages;
  function change(i: number, value: Partial<CoachDraft["packages"][number]>) {
    update(
      "packages",
      packages.map((p, j) => (j === i ? { ...p, ...value } : p)),
    );
  }
  return (
    <div className="space-y-6">
      <Note>
        Show exactly what each option costs and includes. Monthly plans are paid
        through your GYMX2 Memberships (set them up in{" "}
        <Link href="/plans" className="text-link">
          Plans
        </Link>
        ); the other options here are shown to members as details to discuss.
        Your starting price is always your cheapest monthly option.
      </Note>
      {packages.map((item, i) => (
        <div key={i} className="space-y-3 rounded-xl border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput
              label="Name"
              value={item.name}
              max={60}
              onChange={(v) => change(i, { name: v })}
              placeholder="Online Coaching"
            />
            <SelectInput
              label="Type"
              value={item.kind}
              options={PACKAGE_KINDS}
              onChange={(v) => v && change(i, { kind: v })}
            />
            <Field label="Price (US dollars)">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={10000}
                step="1"
                value={item.priceCents / 100}
                onChange={(event) =>
                  change(i, {
                    priceCents: Math.max(
                      0,
                      Math.min(
                        1_000_000,
                        Math.round(Number(event.target.value || 0) * 100),
                      ),
                    ),
                  })
                }
                className="field-input"
              />
            </Field>
            <p className="self-end pb-2.5 text-sm text-muted">
              Shown as {formatPrice(item.priceCents)}
              {item.priceCents > 0 &&
                (["monthly", "premium", "group"].includes(item.kind)
                  ? " / month"
                  : " one time")}
            </p>
            <TextInput
              label="Sessions included"
              value={item.sessions}
              max={80}
              onChange={(v) => change(i, { sessions: v })}
              placeholder="4 live sessions a month"
            />
            <TextInput
              label="Length"
              value={item.duration}
              max={60}
              onChange={(v) => change(i, { duration: v })}
              placeholder="45 minutes each"
            />
          </div>
          <ChipInput
            label="What's included"
            values={item.includes}
            onChange={(v) => change(i, { includes: v })}
            max={6}
            maxLength={80}
            placeholder="Weekly check-ins"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.featured}
                onChange={(event) =>
                  update(
                    "packages",
                    packages.map((p, j) => ({
                      ...p,
                      featured: j === i ? event.target.checked : false,
                    })),
                  )
                }
                className="accent-[var(--accent)]"
              />
              Highlight as my pick
            </label>
            <button
              type="button"
              onClick={() =>
                update(
                  "packages",
                  packages.filter((_, j) => j !== i),
                )
              }
              className="cursor-pointer text-sm text-muted hover:text-danger"
            >
              Remove option
            </button>
          </div>
        </div>
      ))}
      {packages.length < 8 && (
        <button
          type="button"
          onClick={() =>
            update("packages", [
              ...packages,
              {
                name: "",
                kind: "monthly",
                priceCents: 0,
                sessions: "",
                duration: "",
                includes: [],
                featured: false,
              },
            ])
          }
          className="btn-secondary px-4 py-2 text-sm"
        >
          Add a pricing option
        </button>
      )}
      <div className="space-y-4 border-t border-border pt-5">
        <p className="text-sm font-semibold">Commitment and policies</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {POLICY_FIELDS.map((field) => (
            <TextInput
              key={field.key}
              label={
                field.label +
                (field.key === "cancellation" ? " (required)" : "")
              }
              value={draft.policies[field.key] ?? ""}
              max={200}
              placeholder={field.example}
              onChange={(v) =>
                update("policies", { ...draft.policies, [field.key]: v })
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// The editor preview shows credentials the way members will see them.
function previewCredentials(list: OwnCredential[]) {
  const shown = list.flatMap((c) =>
    c.shown ? [{ ...c, shown: c.shown }] : [],
  );
  return {
    credentials: shown.map((c) => ({
      title: c.title,
      organization: c.organization,
      status: c.shown,
      detail: kindLabel(c.kind),
    })),
    verification: overallVerification(
      shown.map((c) => ({ kind: c.kind, status: c.shown })),
    ),
  };
}
