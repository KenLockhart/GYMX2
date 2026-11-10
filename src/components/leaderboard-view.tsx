import {
  ArrowRight,
  CreditCard,
  Crown,
  Layers,
  type LucideIcon,
  MessageSquareHeart,
  ShoppingBag,
  ShoppingCart,
  Star,
  Trophy,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { RangeSelect } from "@/components/range-select";
import { TrophyArt } from "@/components/trophy-art";
import { sparklinePoints } from "@/lib/admin-console";
import { formatMoney } from "@/lib/armory";
import type { buildEngagement, buildLeaderboards } from "@/lib/leaderboard";

export type LeaderboardTab =
  "overview" | "members" | "coaches" | "sales" | "engagement";
type Boards = ReturnType<typeof buildLeaderboards>;
type Engagement = ReturnType<typeof buildEngagement>;

export type LeaderboardKpi = {
  label: string;
  value: string;
  icon: LucideIcon;
  changePct: number | null;
  series: number[] | null;
  stars?: number | null;
};

const TABS: { key: LeaderboardTab; label: string; icon: LucideIcon }[] = [
  { key: "overview", label: "Overview", icon: Trophy },
  { key: "members", label: "Members", icon: Users },
  { key: "coaches", label: "Coaches", icon: UserRound },
  { key: "sales", label: "Sales", icon: ShoppingCart },
  { key: "engagement", label: "Engagement", icon: Star },
];

// Avatar colours picked from a fixed set by name, so a person keeps the same colour everywhere.
const AVATAR_TONES = [
  "#2f7d32",
  "#6d4fd8",
  "#2563c9",
  "#0f8a86",
  "#b4532a",
  "#8a5a12",
  "#9d2f63",
];
function Avatar({
  name,
  photo,
  size = "size-9",
}: {
  name: string;
  photo?: string | null;
  size?: string;
}) {
  const letters =
    name
      .replace(/^Coach\s+/i, "")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  const tone =
    AVATAR_TONES[
      [...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) %
        AVATAR_TONES.length
    ];
  if (photo)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived storage link
      <img
        src={photo}
        alt=""
        className={`${size} shrink-0 rounded-full object-cover object-top`}
      />
    );
  return (
    <span
      aria-hidden
      className={`${size} grid shrink-0 place-items-center rounded-full text-xs font-bold text-white`}
      style={{ background: tone }}
    >
      {letters}
    </span>
  );
}

const MEDALS = [
  { fill: "#f5c542", text: "#3b2a00", label: "First" },
  { fill: "#c9ced6", text: "#22262c", label: "Second" },
  { fill: "#c98a4b", text: "#2c1606", label: "Third" },
];
function Rank({ rank }: { rank: number }) {
  const medal = MEDALS[rank - 1];
  if (!medal)
    return (
      <span className="grid w-8 place-items-center font-semibold text-muted tabular-nums">
        {rank}
      </span>
    );
  return (
    <span
      role="img"
      aria-label={`${medal.label} place`}
      className="relative grid w-8 place-items-center"
    >
      <Crown
        aria-hidden
        className="absolute -top-2 size-3.5"
        style={{ color: medal.fill }}
        fill={medal.fill}
        strokeWidth={1.5}
      />
      <span
        className="grid size-7 place-items-center rounded-full text-xs font-extrabold"
        style={{ background: medal.fill, color: medal.text }}
      >
        {rank}
      </span>
    </span>
  );
}

function Panel({
  icon: Icon,
  title,
  note,
  more,
  wide,
  children,
}: {
  wide?: boolean;
  icon: LucideIcon;
  title: string;
  note: string;
  more?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section
      className={`min-w-0 overflow-hidden rounded-2xl border border-border bg-surface ${wide ? "lg:col-span-2 2xl:col-span-1" : ""}`}
    >
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <Icon
          aria-hidden
          className="mt-0.5 size-7 shrink-0 text-accent"
          strokeWidth={1.6}
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-xl normal-case leading-tight">{title}</h2>
          <p className="text-xs text-muted">{note}</p>
        </div>
        {more && (
          <Link
            href={more.href}
            className="flex shrink-0 items-center gap-1 text-sm font-semibold text-accent hover:underline"
          >
            {more.label}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-5 py-8 text-center text-sm text-muted">{text}</p>;
}

type Column<Row> = {
  label: string;
  value: (row: Row) => React.ReactNode;
  hideBelow?: "sm" | "md";
};

function RankTable<Row extends { id: string; name: string; score: number }>({
  rows,
  columns,
  badge,
  photos,
  label,
}: {
  rows: Row[];
  columns: Column<Row>[];
  badge?: string;
  photos?: Map<string, string>;
  label: string;
}) {
  const hide = (c: Column<Row>) =>
    c.hideBelow === "sm"
      ? "hidden sm:table-cell"
      : c.hideBelow === "md"
        ? "hidden md:table-cell"
        : "";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr className="text-xs text-muted">
            <th
              scope="col"
              className="w-14 px-3 py-2.5 text-center font-semibold"
            >
              #
            </th>
            <th scope="col" className="px-2 py-2.5 text-left font-semibold">
              Name
            </th>
            {columns.map((c) => (
              <th
                key={c.label}
                scope="col"
                className={`px-2 py-2.5 text-right font-semibold ${hide(c)}`}
              >
                {c.label}
              </th>
            ))}
            <th scope="col" className="px-4 py-2.5 text-right font-semibold">
              Points
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id}
              className="border-t border-border/70 odd:bg-surface-raised/40"
            >
              <td className="px-3 py-2.5">
                <div className="flex justify-center">
                  <Rank rank={i + 1} />
                </div>
              </td>
              <td className="px-2 py-2.5">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={row.name} photo={photos?.get(row.id)} />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{row.name}</p>
                    {i === 0 && badge && (
                      <span className="mt-0.5 inline-block rounded-full bg-accent px-2 text-[10px] font-bold leading-4 text-accent-foreground">
                        {badge}
                      </span>
                    )}
                  </div>
                </div>
              </td>
              {columns.map((c) => (
                <td
                  key={c.label}
                  className={`px-2 py-2.5 text-right tabular-nums ${hide(c)}`}
                >
                  {c.value(row)}
                </td>
              ))}
              <td className="px-4 py-2.5 text-right font-display text-lg font-bold tabular-nums text-accent">
                {row.score.toLocaleString("en-US")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MoneyList<Row extends { id: string; name: string }>({
  rows,
  middle,
  amount,
  photos,
  label,
  middleLabel,
}: {
  rows: Row[];
  middle: (row: Row) => string;
  amount: (row: Row) => string;
  photos?: Map<string, string>;
  label: string;
  middleLabel: string;
}) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{label}</caption>
      <thead>
        <tr className="text-xs text-muted">
          <th
            scope="col"
            className="w-12 px-3 py-2.5 text-center font-semibold"
          >
            #
          </th>
          <th scope="col" className="px-2 py-2.5 text-left font-semibold">
            Name
          </th>
          <th scope="col" className="px-2 py-2.5 text-right font-semibold">
            {middleLabel}
          </th>
          <th scope="col" className="px-4 py-2.5 text-right font-semibold">
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={row.id} className="border-t border-border/70">
            <td
              className={`px-3 py-3 text-center font-bold tabular-nums ${i < 3 ? "text-accent" : "text-muted"}`}
            >
              {i + 1}
            </td>
            <td className="px-2 py-3">
              <div className="flex min-w-0 items-center gap-3">
                {row.id === "gymx2" ? (
                  <span
                    aria-hidden
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-black font-display text-[10px] font-bold"
                  >
                    GYM<span className="text-accent">X2</span>
                  </span>
                ) : (
                  <Avatar name={row.name} photo={photos?.get(row.id)} />
                )}
                <span className="truncate font-semibold">{row.name}</span>
              </div>
            </td>
            <td className="whitespace-nowrap px-2 py-3 text-right text-muted tabular-nums">
              {middle(row)}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-right font-bold tabular-nums">
              {amount(row)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LeaderboardView({
  tab,
  range,
  rangeOptions,
  rangeLabel,
  kpis,
  boards,
  engagement,
  coachPhotos,
  itemImages,
  points,
}: {
  tab: LeaderboardTab;
  range: string;
  rangeOptions: readonly { value: string; label: string }[];
  rangeLabel: string;
  kpis: LeaderboardKpi[];
  boards: Boards;
  engagement: Engagement;
  coachPhotos: Map<string, string>;
  itemImages: Map<string, { url: string | null; membership: boolean }>;
  points: { members: string; coaches: string; engagement: string };
}) {
  const href = (key: LeaderboardTab) =>
    `/admin/leaderboard?tab=${key}&range=${range}`;
  const empty = `Nothing in the ${rangeLabel.toLowerCase()} yet.`;
  const short = tab === "overview";
  const limit = short ? 5 : 10;

  const memberColumns: Column<Boards["members"][number]>[] = [
    { label: "Tasks", value: (r) => r.tasks },
    { label: "Sessions", value: (r) => r.sessions },
    { label: "Messages", value: (r) => r.messages, hideBelow: "sm" },
    ...(short
      ? []
      : [
          {
            label: "Memos",
            value: (r: Boards["members"][number]) => r.memos,
            hideBelow: "md" as const,
          },
          {
            label: "Habits",
            value: (r: Boards["members"][number]) => r.habits,
            hideBelow: "md" as const,
          },
        ]),
  ];
  const coachColumns: Column<Boards["coaches"][number]>[] = [
    { label: "Videos", value: (r) => r.videos },
    { label: "New members", value: (r) => r.newMembers, hideBelow: "sm" },
    { label: "Sessions", value: (r) => r.sessions },
    { label: "Tasks given", value: (r) => r.tasks, hideBelow: "sm" },
    ...(short
      ? []
      : [
          {
            label: "Messages",
            value: (r: Boards["coaches"][number]) => r.messages,
            hideBelow: "md" as const,
          },
        ]),
  ];

  const membersPanel = (
    <Panel
      icon={Users}
      title="Top members"
      note={short ? "Most active and engaged members." : points.members}
      more={short ? { href: href("members"), label: "View all" } : undefined}
    >
      {boards.members.length ? (
        <RankTable
          rows={boards.members.slice(0, limit)}
          columns={memberColumns}
          badge="Top member"
          label="Top members"
        />
      ) : (
        <Empty text={empty} />
      )}
    </Panel>
  );
  const coachesPanel = (
    <Panel
      icon={UserRound}
      title="Top coaches"
      note={
        short ? "Most active coaches and community impact." : points.coaches
      }
      more={short ? { href: href("coaches"), label: "View all" } : undefined}
    >
      {boards.coaches.length ? (
        <RankTable
          rows={boards.coaches.slice(0, limit)}
          columns={coachColumns}
          badge="Top coach"
          photos={coachPhotos}
          label="Top coaches"
        />
      ) : (
        <Empty text={empty} />
      )}
    </Panel>
  );
  const salesLimit = short ? 3 : 10;
  const buyersPanel = (
    <Panel
      icon={ShoppingCart}
      title="Top buyers"
      note="Members with the highest Armory spend."
      more={short ? { href: href("sales"), label: "View all" } : undefined}
    >
      {boards.buyers.length ? (
        <MoneyList
          rows={boards.buyers.slice(0, salesLimit)}
          label="Top buyers"
          middleLabel="Orders"
          middle={(r) => `${r.orders} ${r.orders === 1 ? "order" : "orders"}`}
          amount={(r) => formatMoney(r.cents)}
        />
      ) : (
        <Empty text={empty} />
      )}
    </Panel>
  );
  const sellersPanel = (
    <Panel
      icon={Layers}
      title="Top sellers"
      note="Highest product and program sales."
      more={short ? { href: href("sales"), label: "View all" } : undefined}
    >
      {boards.sellers.length ? (
        <MoneyList
          rows={boards.sellers.slice(0, salesLimit)}
          label="Top sellers"
          middleLabel="Sales"
          middle={(r) => String(r.sales)}
          amount={(r) => formatMoney(r.cents)}
          photos={coachPhotos}
        />
      ) : (
        <Empty text={empty} />
      )}
    </Panel>
  );
  const itemsPanel = (
    <Panel
      wide
      icon={ShoppingBag}
      title="Best-selling items"
      note={`Products and memberships, ${rangeLabel.toLowerCase()}.`}
      more={short ? { href: href("sales"), label: "View all" } : undefined}
    >
      {boards.items.length ? (
        <ul
          className={`grid gap-3 p-4 ${short ? "grid-cols-3 sm:grid-cols-5 2xl:grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"}`}
        >
          {boards.items.slice(0, short ? 5 : 10).map((item, i) => {
            const extra = item.id ? itemImages.get(item.id) : undefined;
            const membership = item.membership || extra?.membership;
            const body = (
              <>
                <div className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-black/40">
                  {extra?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- public product photo
                    <img
                      src={extra.url}
                      alt=""
                      className="size-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : membership ? (
                    <CreditCard
                      aria-hidden
                      className="size-10 text-accent/70"
                      strokeWidth={1.4}
                    />
                  ) : (
                    <ShoppingBag
                      aria-hidden
                      className="size-10 text-accent/70"
                      strokeWidth={1.4}
                    />
                  )}
                </div>
                <p className="mt-2 line-clamp-2 text-xs font-semibold leading-snug">
                  {item.title}
                </p>
                <p className="text-xs font-bold text-accent">
                  {item.sold} sold
                </p>
                {!short && (
                  <p className="text-xs text-muted">
                    {formatMoney(item.cents)}
                  </p>
                )}
              </>
            );
            return (
              <li
                key={item.id ?? item.title}
                className={`group min-w-0 rounded-xl border border-border bg-surface-raised/40 p-2 text-center ${short && i >= 3 ? "hidden sm:block 2xl:hidden" : ""}`}
              >
                {item.id ? (
                  <Link href={`/armory/${item.id}`}>{body}</Link>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty text={empty} />
      )}
    </Panel>
  );
  const engagementPanel = (
    <Panel
      icon={MessageSquareHeart}
      title="Community engagement"
      note={points.engagement}
    >
      {engagement.length ? (
        <RankTable
          rows={engagement}
          columns={[
            {
              label: "Role",
              value: (r) => (
                <span className="capitalize text-muted">{r.role}</span>
              ),
              hideBelow: "sm",
            },
            { label: "Posts", value: (r) => r.posts },
            { label: "Comments", value: (r) => r.comments },
            { label: "Likes given", value: (r) => r.likes, hideBelow: "sm" },
          ]}
          badge="Most engaged"
          photos={coachPhotos}
          label="Community engagement"
        />
      ) : (
        <Empty
          text={`No shared Community posts, comments or likes in the ${rangeLabel.toLowerCase()} yet.`}
        />
      )}
    </Panel>
  );

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden xl:min-h-36 2xl:min-h-44">
        <TrophyArt className="absolute top-0 right-0 hidden xl:block xl:h-36 xl:w-[15rem] 2xl:h-44 2xl:w-[18.25rem]" />
        <p className="text-xs font-bold uppercase tracking-widest text-accent">
          Admin / Insights
        </p>
        <h1 className="mt-1 text-4xl normal-case sm:text-5xl">Leaderboard</h1>
        <p className="mt-2 max-w-xl text-muted">
          Recognizing top members, coaches, sales and engagement across GYMX2.
          Scores count what people do, never what they write.
        </p>
      </div>

      <section
        aria-label="Key numbers"
        className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4"
      >
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
              <kpi.icon aria-hidden className="size-6" strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-3xl font-bold leading-none tabular-nums">
                {kpi.value}
              </p>
              <p className="mt-1 truncate text-sm text-muted">{kpi.label}</p>
              {kpi.stars != null && (
                <span
                  role="img"
                  aria-label={`${kpi.stars} out of 5`}
                  className="mt-1 flex gap-0.5 text-accent"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      aria-hidden
                      className="size-3.5"
                      fill={kpi.stars! >= n - 0.25 ? "currentColor" : "none"}
                      strokeWidth={1.8}
                    />
                  ))}
                </span>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {kpi.changePct !== null && (
                <span
                  className={`text-xs font-semibold ${kpi.changePct >= 0 ? "text-accent" : "text-danger"}`}
                >
                  {kpi.changePct >= 0 ? "▲" : "▼"}{" "}
                  {kpi.changePct >= 0 ? "+" : ""}
                  {kpi.changePct}%
                </span>
              )}
              {kpi.series && (
                <svg
                  aria-hidden
                  viewBox="0 0 96 32"
                  className="h-8 w-20 text-accent"
                >
                  <polyline
                    points={sparklinePoints(kpi.series)}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </div>
          </div>
        ))}
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav
          aria-label="Leaderboard sections"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
        >
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={href(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-sm font-semibold transition-colors ${
                tab === t.key
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border bg-surface hover:border-accent/60"
              }`}
            >
              <t.icon aria-hidden className="size-4" strokeWidth={2} />
              {t.label}
            </Link>
          ))}
        </nav>
        <RangeSelect value={range} options={rangeOptions} />
      </div>

      {tab === "overview" && (
        <>
          <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
            {membersPanel}
            {coachesPanel}
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3">
            {buyersPanel}
            {sellersPanel}
            {itemsPanel}
          </div>
        </>
      )}
      {tab === "members" && membersPanel}
      {tab === "coaches" && coachesPanel}
      {tab === "sales" && (
        <>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {buyersPanel}
            {sellersPanel}
          </div>
          {itemsPanel}
        </>
      )}
      {tab === "engagement" && engagementPanel}
    </div>
  );
}
