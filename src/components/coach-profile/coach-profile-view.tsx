// The member-facing coach profile: hero, summary cards, section navigation, the 12 sections and a
// booking card. Coach Jasmine (sample data) uses it now; real coaches use it from the next PR.
import Link from "next/link";
import type { ReactNode } from "react";
import {
  type CoachProfileView,
  formatPrice,
  formatsLabel,
  loveLanguage,
  MATCH_CATEGORIES,
  startingMonthlyPrice,
} from "@/lib/coach-profile";
import {
  Card,
  CheckList,
  Chips,
  DetailList,
  PortraitPlaceholder,
  SampleTag,
  ScoreBar,
  Section,
  Stars,
  SummaryCard,
  VerificationBadge,
} from "./profile-parts";

const SECTIONS = [
  { id: "about", label: "About" },
  { id: "match", label: "Our match" },
  { id: "style", label: "Style" },
  { id: "specialties", label: "Specialties" },
  { id: "credentials", label: "Credentials" },
  { id: "coaching", label: "How it works" },
  { id: "results", label: "Experience" },
  { id: "nutrition", label: "Nutrition" },
  { id: "availability", label: "Availability" },
  { id: "pricing", label: "Pricing" },
  { id: "reviews", label: "Reviews" },
  { id: "video", label: "Video" },
  { id: "book", label: "Book" },
] as const;

const STATUS_STYLE = {
  verified: "border-success/40 text-success",
  pending: "border-border text-muted",
  unverified: "border-border text-muted",
} as const;
const STATUS_LABEL = {
  verified: "Verified",
  pending: "Pending verification",
  unverified: "Unverified",
} as const;

// On the sample profile, booking and saving are shown but switched off.
function ActionButtons({
  profile,
  layout,
}: {
  profile: CoachProfileView;
  layout: "hero" | "card" | "bar";
}) {
  const note = profile.sample
    ? "This is a sample profile, so booking and saving are off."
    : undefined;
  const noteId = `actions-note-${layout}`;
  return (
    <div className={layout === "bar" ? "flex gap-2" : "space-y-2"}>
      <div
        className={
          layout === "bar"
            ? "flex flex-1 gap-2"
            : "flex flex-col gap-2 sm:flex-row"
        }
      >
        <button
          type="button"
          aria-disabled={profile.sample || undefined}
          aria-describedby={note ? noteId : undefined}
          className={`btn-primary ${layout === "bar" ? "flex-1 px-3" : ""}`}
        >
          Book intro session
        </button>
        {layout !== "bar" && (
          <button
            type="button"
            aria-disabled={profile.sample || undefined}
            aria-describedby={note ? noteId : undefined}
            className="btn-secondary"
          >
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mr-2 size-4"
            >
              <path d="M6 3h12v18l-6-4-6 4V3Z" />
            </svg>
            Save coach
          </button>
        )}
      </div>
      {note && layout !== "bar" && (
        <p id={noteId} className="text-xs text-muted">
          {note}
        </p>
      )}
    </div>
  );
}

function Hero({
  profile,
  actions,
}: {
  profile: CoachProfileView;
  actions?: ReactNode;
}) {
  const price = startingMonthlyPrice(profile.packages);
  return (
    <header className="space-y-4">
      {/* Phones: a small portrait beside the name, like a profile card. Wider screens: a large
          portrait beside everything. */}
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-4 gap-y-4 sm:grid-cols-[15rem_minmax(0,1fr)] sm:gap-y-3 md:grid-cols-[18rem_minmax(0,1fr)] md:gap-x-8">
        <div className="aspect-[4/5] overflow-hidden rounded-2xl border border-border sm:row-span-2 sm:rounded-3xl">
          {profile.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- coach photos come from storage
            <img
              src={profile.photoUrl}
              alt={`Portrait of ${profile.name}`}
              className="size-full object-cover object-top"
            />
          ) : (
            <PortraitPlaceholder name={profile.name} />
          )}
        </div>
        <div className="min-w-0 space-y-2 self-center sm:self-end">
          <h1 className="text-4xl leading-none sm:text-5xl md:text-6xl">
            <span className="block text-sm tracking-widest text-accent sm:text-base">
              Meet
            </span>
            {profile.name}
          </h1>
          <VerificationBadge
            status={profile.verification}
            sample={profile.sample}
          />
          <p className="font-semibold sm:text-lg">
            {profile.specialties.join(" • ")}
          </p>
        </div>
        <div className="col-span-2 min-w-0 space-y-3 sm:col-span-1 sm:col-start-2 sm:self-start">
          <p className="text-muted">
            {profile.location} • {formatsLabel(profile.formats)}
          </p>
          <blockquote className="border-l-2 border-accent pl-4 text-lg leading-snug">
            &ldquo;{profile.headline}&rdquo;
          </blockquote>
          {profile.rating ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Stars
                value={profile.rating.average}
                label={`Rated ${profile.rating.average} out of 5`}
              />
              <span className="font-semibold">{profile.rating.average}/5</span>
              <a href="#reviews" className="text-sm text-muted hover:underline">
                {profile.rating.count}{" "}
                {profile.sample ? "sample reviews" : "verified reviews"}
              </a>
            </p>
          ) : (
            <p className="text-sm text-muted">No reviews yet</p>
          )}
          <div className="hidden pt-1 md:block">
            {actions ?? <ActionButtons profile={profile} layout="hero" />}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <SummaryCard
          value={`${profile.experienceYears} ${profile.experienceYears === 1 ? "year" : "years"}`}
          label="Experience"
          sample={profile.sample}
        />
        <SummaryCard
          value={price === null ? "Ask" : `${formatPrice(price)}/mo`}
          label="Starting price"
          sample={profile.sample}
        />
        <SummaryCard
          value={profile.match ? `${profile.match.total}%` : "—"}
          label={profile.match ? "Match score" : "Match score soon"}
          sample={profile.sample}
        />
      </div>
      <div className="md:hidden">
        {actions ?? <ActionButtons profile={profile} layout="hero" />}
      </div>
    </header>
  );
}

function SectionNav({
  sections,
}: {
  sections: readonly { id: string; label: string }[];
}) {
  return (
    <nav
      aria-label="Profile sections"
      className="sticky top-0 z-20 -mx-4 border-b border-border bg-background/95 px-4 backdrop-blur sm:-mx-6 sm:px-6"
    >
      <ul className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
        {sections.map((section) => (
          <li key={section.id} className="shrink-0">
            <a
              href={`#${section.id}`}
              className="block rounded-full px-3 py-1.5 text-sm text-muted transition hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function BookingCard({ profile }: { profile: CoachProfileView }) {
  const intro = profile.intro!;
  return (
    <Card className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">
          Discovery session
        </p>
        <p className="mt-1 font-display text-2xl font-bold uppercase leading-tight">
          {intro.title}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted">Price</dt>
          <dd className="font-semibold">{formatPrice(intro.priceCents)}</dd>
        </div>
        <div>
          <dt className="text-muted">Length</dt>
          <dd className="font-semibold">{intro.minutes} minutes</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-muted">Format</dt>
          <dd>{intro.formats.join(" or ")}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted">
        {intro.cancellation} Booking an intro never starts a membership.
      </p>
      <ActionButtons profile={profile} layout="card" />
    </Card>
  );
}

export function CoachProfile({
  profile,
  actions,
  pricingExtra,
  reviewsExtra,
}: {
  profile: CoachProfileView;
  // Real coaches: Join, Message or See plans, shown in the hero, the side card and the phone bar.
  actions?: ReactNode;
  // Real coaches: the membership checkout and the review form.
  pricingExtra?: ReactNode;
  reviewsExtra?: ReactNode;
}) {
  const loves = [
    { tag: "Primary", value: profile.loveLanguages.primary },
    { tag: "Secondary", value: profile.loveLanguages.secondary },
  ].flatMap(({ tag, value }) =>
    value ? [{ tag, item: loveLanguage(value) }] : [],
  );
  const price = startingMonthlyPrice(profile.packages);
  const s = profile.sample;
  const has: Record<(typeof SECTIONS)[number]["id"], boolean> = {
    about:
      profile.about.intro.length > 0 ||
      profile.about.prompts.length > 0 ||
      !!profile.idealClient,
    match: s || profile.match !== null,
    style:
      profile.style.attributes.length > 0 ||
      profile.style.traits.length > 0 ||
      loves.length > 0,
    specialties: profile.populations.length > 0 || !!profile.betterServedBy,
    credentials: profile.credentials.length > 0,
    coaching:
      profile.coaching.included.length > 0 ||
      profile.coaching.details.length > 0,
    results:
      profile.results.expertise.length > 0 ||
      !!profile.results.methodology ||
      profile.results.stories.length > 0,
    nutrition:
      profile.nutrition.offers.length > 0 || !!profile.nutrition.qualifications,
    availability: true,
    pricing:
      profile.packages.length > 0 ||
      profile.policies.length > 0 ||
      !!pricingExtra,
    reviews:
      profile.rating !== null ||
      profile.reviews.items.length > 0 ||
      !!reviewsExtra,
    video: profile.video !== null,
    book: profile.intro !== null,
  };
  const sections = SECTIONS.filter((section) => has[section.id]);
  const showBar = profile.intro !== null || !!actions;

  return (
    <div className={`space-y-8 md:pb-0 ${showBar ? "pb-24" : ""}`}>
      {s && (
        <div
          role="note"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-dashed border-accent/60 bg-accent/5 px-4 py-3 text-sm"
        >
          <span className="font-semibold text-accent">
            Sample profile, not a real coach.
          </span>
          <span className="text-muted">
            Coach Jasmine shows what GYMX2 coach profiles look like. Her
            ratings, reviews, prices, credentials and match score are made up.
          </span>
        </div>
      )}

      <Hero profile={profile} actions={actions} />
      <SectionNav sections={sections} />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-12">
          {has.about && (
            <Section id="about" title="About me">
              <Card className="space-y-4">
                {profile.about.intro.map((paragraph) => (
                  <p key={paragraph} className="leading-relaxed">
                    {paragraph}
                  </p>
                ))}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-sm text-muted">In three words:</span>
                  {profile.about.threeWords.map((word) => (
                    <span
                      key={word}
                      className="rounded-full bg-accent px-3 py-1 text-sm font-semibold text-accent-foreground"
                    >
                      {word}
                    </span>
                  ))}
                </div>
              </Card>
              <div className="grid gap-3 sm:grid-cols-2">
                {profile.about.prompts.map((item) => (
                  <Card key={item.prompt} className="space-y-2">
                    <p className="text-sm font-semibold text-accent">
                      {item.prompt}
                    </p>
                    <p>{item.answer}</p>
                  </Card>
                ))}
              </div>
              <Card className="space-y-3">
                <p className="text-sm font-semibold text-accent">
                  My ideal client is someone who…
                </p>
                <p>{profile.idealClient}</p>
              </Card>
              <div className="grid gap-3 sm:grid-cols-2">
                <Card className="space-y-3">
                  <p className="text-sm text-muted">Outside the gym</p>
                  <Chips items={profile.about.interests} />
                </Card>
                <Card className="space-y-2">
                  <p className="text-sm text-muted">Favorite quote</p>
                  <p className="font-display text-xl font-semibold uppercase leading-snug">
                    &ldquo;{profile.about.quote}&rdquo;
                  </p>
                </Card>
              </div>
            </Section>
          )}

          {has.match && (
            <Section id="match" title="Our compatibility" sample={s}>
              {profile.match ? (
                <Card className="space-y-5">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <p>
                      <span className="font-display text-5xl font-bold text-accent">
                        {profile.match.total}%
                      </span>{" "}
                      <span className="text-muted">match</span>
                    </p>
                    <p className="text-xs text-muted">
                      A guide from your answers and {profile.firstName}&apos;s
                      profile, not a prediction of results.
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {MATCH_CATEGORIES.map((category) => (
                      <ScoreBar
                        key={category.key}
                        label={category.label}
                        value={profile.match!.categories[category.key]}
                      />
                    ))}
                  </div>
                  <div className="grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <h3 className="font-semibold">
                        Why {profile.firstName} may be a great match for you
                      </h3>
                      <ul className="list-disc space-y-1.5 pl-5 text-sm">
                        {profile.match.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="space-y-2">
                      <h3 className="font-semibold">
                        Things to discuss before committing
                      </h3>
                      <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
                        {profile.match.discuss.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </Card>
              ) : (
                <Card>
                  <p className="text-muted">
                    Answer a few questions about how you like to train to see
                    how well you and {profile.firstName} fit.
                  </p>
                </Card>
              )}
            </Section>
          )}

          {has.style && (
            <Section id="style" title="Coaching style">
              <Chips items={profile.style.traits} />
              <Card>
                <DetailList
                  items={profile.style.attributes.map((attribute) => ({
                    label: attribute.label,
                    value: attribute.secondary
                      ? `${attribute.primary}, with some ${attribute.secondary.toLowerCase()}`
                      : attribute.primary,
                  }))}
                />
              </Card>
              {loves.length > 0 && (
                <Card className="space-y-4">
                  <div>
                    <h3 className="font-semibold">My coaching love language</h3>
                    <p className="text-sm text-muted">
                      How {profile.firstName} motivates people best. It&apos;s
                      about coaching style, not a personality test.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {loves.map(({ tag, item }) => (
                      <div
                        key={tag}
                        className={`rounded-xl border p-4 ${tag === "Primary" ? "border-accent" : "border-border"}`}
                      >
                        <p className="text-xs uppercase tracking-widest text-muted">
                          {tag}
                        </p>
                        <p className="mt-1 font-semibold">{item.label}</p>
                        <p className="mt-1 text-sm text-muted">
                          {item.description}
                        </p>
                      </div>
                    ))}
                  </div>
                  {profile.style.note && (
                    <p className="text-sm italic text-muted">
                      {profile.style.note}
                    </p>
                  )}
                </Card>
              )}
            </Section>
          )}

          {has.specialties && (
            <Section id="specialties" title="Who I work best with">
              <ul className="grid gap-3 sm:grid-cols-2">
                {profile.populations.map((item) => (
                  <li
                    key={item.label}
                    className="rounded-2xl border border-border bg-surface p-4"
                  >
                    <p className="font-semibold">{item.label}</p>
                    <p className="mt-1 text-sm text-muted">{item.note}</p>
                  </li>
                ))}
              </ul>
              <Card className="space-y-1">
                <h3 className="font-semibold">
                  Who might be better served by another specialist
                </h3>
                <p className="text-sm text-muted">{profile.betterServedBy}</p>
              </Card>
              <p className="text-xs text-muted">
                Specialties are the coach&apos;s own description, not a
                qualification. Check Credentials for what GYMX2 has verified.
              </p>
            </Section>
          )}

          {has.credentials && (
            <Section id="credentials" title="Credentials" sample={s}>
              <ul className="space-y-3">
                {profile.credentials.map((credential) => (
                  <li
                    key={credential.title}
                    className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-semibold">{credential.title}</p>
                      <p className="text-sm text-muted">
                        {credential.organization} · {credential.detail}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 self-start rounded-full border px-3 py-1 text-xs font-semibold sm:self-auto ${STATUS_STYLE[credential.status]} ${s ? "border-dashed" : ""}`}
                    >
                      {s ? "Sample: " : ""}
                      {STATUS_LABEL[credential.status]}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">
                Verified means a GYMX2 admin checked the certificate with the
                organization that issued it. Expired certificates never show as
                verified.
              </p>
            </Section>
          )}

          {has.coaching && (
            <Section id="coaching" title="How online coaching works">
              <Card className="space-y-5">
                <CheckList items={profile.coaching.included} />
                <div className="border-t border-border pt-5">
                  <DetailList items={profile.coaching.details} />
                </div>
              </Card>
            </Section>
          )}

          {has.results && (
            <Section id="results" title="Experience & results" sample={s}>
              <Card className="space-y-4">
                <div className="flex flex-wrap gap-6">
                  <div>
                    <p className="font-display text-4xl font-bold text-accent">
                      {profile.experienceYears}
                    </p>
                    <p className="text-sm text-muted">years coaching</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-muted">Areas of expertise</p>
                    <div className="mt-2">
                      <Chips items={profile.results.expertise} />
                    </div>
                  </div>
                </div>
                <p className="leading-relaxed">{profile.results.methodology}</p>
              </Card>
              <div className="grid gap-3 sm:grid-cols-2">
                {profile.results.stories.map((story) => (
                  <Card key={story.title} className="space-y-2">
                    <p className="text-xs uppercase tracking-widest text-muted">
                      {s ? "Sample story" : "Self-reported"}
                    </p>
                    <p className="font-semibold">{story.title}</p>
                    <p className="text-sm text-muted">{story.summary}</p>
                  </Card>
                ))}
              </div>
              <p className="text-xs text-muted">
                Results differ from person to person. A past client&apos;s
                progress isn&apos;t a promise of yours.
              </p>
            </Section>
          )}

          {has.nutrition && (
            <Section id="nutrition" title="Nutrition & lifestyle">
              <Card className="space-y-4">
                <CheckList items={profile.nutrition.offers} />
                <p className="text-sm">
                  <span className="text-muted">Qualifications: </span>
                  {profile.nutrition.qualifications}
                </p>
                <p className="rounded-xl bg-surface-raised p-3 text-sm text-muted">
                  {profile.nutrition.scope}
                </p>
              </Card>
            </Section>
          )}

          <Section id="availability" title="Availability">
            <Card className="space-y-5">
              <p className="flex flex-wrap items-center gap-2">
                <span
                  className={`size-2.5 rounded-full ${profile.availability.acceptingClients ? "bg-success" : "bg-muted"}`}
                  aria-hidden
                />
                <span className="font-semibold">
                  {profile.availability.acceptingClients
                    ? "Accepting new clients"
                    : "Waitlist only"}
                </span>
                <span className="text-sm text-muted">
                  · Times in {profile.availability.timeZone}
                </span>
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {profile.availability.schedule.map((slot) => (
                  <li
                    key={slot.days}
                    className="rounded-xl bg-surface-raised p-3"
                  >
                    <p className="font-semibold">{slot.days}</p>
                    <p className="text-sm text-muted">{slot.hours}</p>
                  </li>
                ))}
              </ul>
              <DetailList items={profile.availability.details} />
            </Card>
          </Section>

          {has.pricing && (
            <Section id="pricing" title="Pricing & packages" sample={s}>
              <ul className="grid gap-3 sm:grid-cols-2">
                {profile.packages.map((item) => (
                  <li
                    key={item.name}
                    className={`relative flex flex-col rounded-2xl border bg-surface p-5 ${item.featured ? "border-accent" : "border-border"}`}
                  >
                    {item.featured && (
                      <span className="absolute -top-3 left-5 rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold uppercase text-accent-foreground">
                        Coach&apos;s pick
                      </span>
                    )}
                    <p className="font-semibold">{item.name}</p>
                    <p className="mt-2">
                      <span className="font-display text-4xl font-bold">
                        {formatPrice(item.priceCents)}
                      </span>
                      {item.priceCents > 0 && (
                        <span className="text-muted">
                          {" "}
                          / {item.billing === "Monthly" ? "month" : "one time"}
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {item.sessions} · {item.duration}
                    </p>
                    <ul className="mt-4 space-y-1.5 text-sm">
                      {item.includes.map((line) => (
                        <li key={line} className="flex gap-2">
                          <span aria-hidden className="text-accent">
                            +
                          </span>
                          {line}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <Card>
                <h3 className="mb-3 font-semibold">Commitment and policies</h3>
                <DetailList items={profile.policies} />
              </Card>
              {pricingExtra}
              <p className="text-xs text-muted">
                The starting price is the lowest monthly plan
                {price !== null ? ` (${formatPrice(price)}/month)` : ""}, not
                the intro call or a single session. Monthly plans are paid
                through GYMX2 and{" "}
                <Link href="/refunds" className="text-link">
                  our refund policy
                </Link>{" "}
                applies.
              </p>
            </Section>
          )}

          {has.reviews && (
            <Section id="reviews" title="Reviews" sample={s}>
              {profile.rating ? (
                <Card className="grid gap-6 sm:grid-cols-[10rem_1fr]">
                  <div>
                    <p className="font-display text-6xl font-bold leading-none">
                      {profile.rating.average}
                    </p>
                    <Stars
                      value={profile.rating.average}
                      label={`Rated ${profile.rating.average} out of 5`}
                    />
                    <p className="mt-1 text-sm text-muted">
                      {profile.rating.count} {s ? "sample" : "verified"} reviews
                    </p>
                  </div>
                  <dl className="grid gap-2 sm:grid-cols-2">
                    {profile.reviews.categories.map((category) => (
                      <div
                        key={category.label}
                        className="flex items-center justify-between gap-3 rounded-lg bg-surface-raised px-3 py-2 text-sm"
                      >
                        <dt>{category.label}</dt>
                        <dd className="font-semibold tabular-nums">
                          {category.score.toFixed(1)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              ) : null}
              <ul className="space-y-3">
                {profile.reviews.items.map((review) => (
                  <li
                    key={review.author + review.date}
                    className="space-y-3 rounded-2xl border border-border bg-surface p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">{review.author}</p>
                      <Stars
                        value={review.rating}
                        label={`${review.rating} out of 5`}
                      />
                    </div>
                    <p className="text-xs text-muted">
                      {review.date} · {review.format}
                      {review.goal && ` · Goal: ${review.goal}`}
                    </p>
                    <p>{review.body}</p>
                    {review.reply && (
                      <p className="rounded-xl border-l-2 border-accent bg-surface-raised p-3 text-sm">
                        <span className="font-semibold">
                          Reply from {profile.firstName}:
                        </span>{" "}
                        {review.reply}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              {reviewsExtra}
              <p className="text-xs text-muted">
                Only members who joined {profile.firstName} can review her, once
                each. Coaches can reply but can&apos;t edit or remove reviews.
              </p>
            </Section>
          )}

          {has.video && (
            <Section id="video" title="Introduction video">
              <Card className="space-y-4">
                <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl bg-surface-raised text-center">
                  <span
                    aria-hidden
                    className="grid size-14 place-items-center rounded-full border-2 border-accent text-accent"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="ml-1 size-6 fill-current"
                    >
                      <path d="M7 5v14l11-7L7 5Z" />
                    </svg>
                  </span>
                  <p className="px-4 text-sm text-muted">
                    {s
                      ? "Sample: coaches add a 60 to 90 second video here."
                      : "Video coming soon."}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted">
                    In the video, {profile.firstName} answers:
                  </p>
                  <ul className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
                    {profile.video!.prompts.map((prompt) => (
                      <li key={prompt} className="flex gap-2">
                        <span aria-hidden className="text-accent">
                          ›
                        </span>
                        {prompt}
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            </Section>
          )}

          {has.book && (
            <Section id="book" title="Book a session">
              <div className="lg:hidden">
                <BookingCard profile={profile} />
              </div>
              <Card className="space-y-2">
                <h3 className="font-semibold">
                  Before your call, {profile.firstName} will ask
                </h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                  {profile.intro!.questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </Card>
            </Section>
          )}
        </div>

        <aside
          className="hidden lg:block"
          aria-label={
            profile.intro ? "Book an intro" : `Join ${profile.firstName}`
          }
        >
          <div className="sticky top-16 space-y-4">
            {profile.intro ? (
              <BookingCard profile={profile} />
            ) : (
              actions && <Card className="space-y-3">{actions}</Card>
            )}
            <Card className="space-y-2 text-sm">
              <p className="flex items-center justify-between">
                <span className="text-muted">Plans from</span>
                <span className="font-semibold">
                  {price === null ? "Ask" : `${formatPrice(price)}/month`}
                </span>
              </p>
              <p className="flex items-center justify-between">
                <span className="text-muted">New clients</span>
                <span className="font-semibold">
                  {profile.availability.acceptingClients
                    ? "Accepting"
                    : "Waitlist"}
                </span>
              </p>
              {s && <SampleTag className="mt-1" />}
            </Card>
          </div>
        </aside>
      </div>

      {/* Phones: the booking action stays in reach. */}
      {showBar && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 pt-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
          <div className="mx-auto flex max-w-5xl items-center gap-3">
            <div className="shrink-0">
              {profile.intro ? (
                <>
                  <p className="text-xs text-muted">Intro call</p>
                  <p className="font-semibold">
                    {formatPrice(profile.intro.priceCents)} ·{" "}
                    {profile.intro.minutes} min
                  </p>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted">Plans from</p>
                  <p className="font-semibold">
                    {price === null
                      ? "Free to join"
                      : `${formatPrice(price)}/mo`}
                  </p>
                </>
              )}
            </div>
            <div className="min-w-0 flex-1 [&_.btn-primary]:w-full [&_.btn-secondary]:hidden [&_p]:hidden">
              {profile.intro ? (
                <ActionButtons profile={profile} layout="bar" />
              ) : (
                actions
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
