import "server-only";
import { createClient } from "@/lib/supabase/server";

// Everything GYMX2 keeps about one person, read with their own permissions and always filtered
// to their own rows (admins can read more, so nothing relies on row security alone).
// Payment-provider IDs, device keys and other internal identifiers are left out.
const SECTIONS: {
  name: string;
  table: string;
  columns: string;
  owner: string;
  order?: string;
}[] = [
  {
    name: "coaches_joined",
    table: "coach_members",
    columns: "coach:profiles!coach_id(display_name), created_at",
    owner: "member_id",
  },
  {
    name: "members",
    table: "coach_members",
    columns: "member:profiles!member_id(display_name), created_at",
    owner: "coach_id",
  },
  {
    name: "memos",
    table: "memos",
    columns: "memo_date, body, shared_with_coaches, created_at, updated_at",
    owner: "user_id",
    order: "memo_date",
  },
  {
    name: "habits",
    table: "habits",
    columns: "name, pillar, active, created_at",
    owner: "user_id",
  },
  {
    name: "habit_check_ins",
    table: "habit_logs",
    columns: "day, habit:habits(name)",
    owner: "user_id",
    order: "day",
  },
  {
    name: "body_measurements",
    table: "body_logs",
    columns: "day, weight_lb, body_fat_pct, waist_in",
    owner: "user_id",
    order: "day",
  },
  {
    name: "nutrition",
    table: "nutrition_logs",
    columns: "day, protein_g, calories, water_glasses, notes",
    owner: "user_id",
    order: "day",
  },
  {
    name: "progress_photos",
    table: "progress_photos",
    columns: "day, pose, created_at",
    owner: "user_id",
    order: "day",
  },
  {
    name: "weekly_check_ins",
    table: "checkins",
    columns:
      "week_start, energy, sleep, stress, motivation, wins, struggles, question, created_at",
    owner: "member_id",
    order: "week_start",
  },
  {
    name: "tasks_assigned_to_you",
    table: "task_assignments",
    columns: "completed_at, created_at, task:tasks(title, instructions)",
    owner: "member_id",
    order: "created_at",
  },
  {
    name: "session_responses",
    table: "session_invites",
    columns:
      "response, responded_at, session:calendar_sessions(title, starts_at, ends_at)",
    owner: "member_id",
  },
  {
    name: "live_sessions_watched",
    table: "session_attendance",
    columns: "joined_at, session:calendar_sessions(title)",
    owner: "member_id",
  },
  {
    name: "messages_with_your_coaches",
    table: "messages",
    columns:
      "body, created_at, read_at, sender:profiles!sender_id(display_name)",
    owner: "member_id",
    order: "created_at",
  },
  {
    name: "messages_with_your_members",
    table: "messages",
    columns:
      "body, created_at, read_at, sender:profiles!sender_id(display_name)",
    owner: "coach_id",
    order: "created_at",
  },
  {
    name: "group_posts",
    table: "group_messages",
    columns: "body, created_at, coach:profiles!coach_id(display_name)",
    owner: "sender_id",
    order: "created_at",
  },
  {
    name: "live_chat_messages",
    table: "live_chat_messages",
    columns: "body, created_at",
    owner: "sender_id",
    order: "created_at",
  },
  {
    name: "community_posts",
    table: "posts",
    columns:
      "kind, body, audience, pillar, like_count, comment_count, created_at, edited_at, removed_at, removed_reason, post_media(path, position)",
    owner: "author_id",
    order: "created_at",
  },
  {
    name: "community_comments",
    table: "post_comments",
    columns: "post_id, body, created_at, edited_at, removed_at, removed_reason",
    owner: "author_id",
    order: "created_at",
  },
  {
    name: "community_likes",
    table: "post_likes",
    columns: "post_id, created_at",
    owner: "user_id",
    order: "created_at",
  },
  {
    name: "community_following",
    table: "follows",
    columns: "followed:profiles!followed_id(display_name), created_at",
    owner: "follower_id",
  },
  {
    name: "community_muted",
    table: "mutes",
    columns: "muted:profiles!muted_id(display_name), created_at",
    owner: "user_id",
  },
  {
    name: "community_feed_preferences",
    table: "feed_preferences",
    columns: "mode, sort, topic_weights, preferred_coaches, updated_at",
    owner: "user_id",
  },
  {
    name: "community_reports_you_sent",
    table: "content_reports",
    columns: "post_id, comment_id, reason, details, status, created_at",
    owner: "reporter_id",
    order: "created_at",
  },
  {
    name: "notification_settings",
    table: "notification_settings",
    columns: "type, in_app, push, email",
    owner: "user_id",
  },
  {
    name: "coach_profile_draft",
    table: "coach_profile_drafts",
    columns: "data, status, review_note, submitted_at, reviewed_at, updated_at",
    owner: "coach_id",
  },
  {
    name: "coach_credentials",
    table: "coach_credentials",
    columns:
      "kind, organization, title, credential_number, issued_on, expires_on, status, verification_source, verified_at, created_at",
    owner: "coach_id",
  },
  {
    name: "coach_match_answers",
    table: "member_match_preferences",
    columns: "answers, completed_at, updated_at",
    owner: "member_id",
  },
  {
    name: "coaches_saved",
    table: "coach_favorites",
    columns: "coach:profiles!coach_id(display_name), created_at",
    owner: "member_id",
  },
  {
    name: "coaches_passed",
    table: "coach_passes",
    columns: "coach:profiles!coach_id(display_name), created_at",
    owner: "member_id",
  },
  {
    name: "programs_started",
    table: "program_enrollments",
    columns:
      "started_on, completed_at, program:programs(title), program_day_completions(completed_at, day:program_days(day_number, title))",
    owner: "member_id",
  },
  {
    name: "purchases",
    table: "purchases",
    columns:
      "item_title, kind, amount_cents, currency, size, shipping_name, shipping_address, fulfillment_status, tracking_number, refunded_at, created_at",
    owner: "member_id",
    order: "created_at",
  },
  {
    name: "memberships",
    table: "subscriptions",
    columns:
      "plan_name, price_cents, status, current_period_end, trial_end, cancel_at_period_end, created_at",
    owner: "member_id",
  },
  {
    name: "reviews_written",
    table: "coach_reviews",
    columns:
      "rating, body, hidden, created_at, coach:profiles!coach_id(display_name)",
    owner: "member_id",
  },
  {
    name: "badges",
    table: "user_badges",
    columns: "badge, earned_at",
    owner: "user_id",
  },
  {
    name: "notification_devices",
    table: "push_subscriptions",
    columns: "device, created_at",
    owner: "user_id",
  },
  {
    name: "affiliate_account",
    table: "affiliates",
    columns:
      "code, status, application, sale_percent, signup_bonus_cents, created_at, decided_at",
    owner: "user_id",
  },
  {
    name: "affiliate_commissions",
    table: "commissions",
    columns:
      "kind, description, base_cents, rate, amount_cents, status, available_at, created_at",
    owner: "affiliate_id",
  },
  {
    name: "affiliate_payouts",
    table: "affiliate_payouts",
    columns: "amount_cents, created_at",
    owner: "affiliate_id",
  },
  // Coaches' own content.
  {
    name: "videos",
    table: "videos",
    columns: "title, description, status, duration_seconds, created_at",
    owner: "coach_id",
  },
  {
    name: "tasks_created",
    table: "tasks",
    columns: "title, instructions, created_at",
    owner: "coach_id",
  },
  {
    name: "sessions_created",
    table: "calendar_sessions",
    columns: "title, notes, location, meeting_url, starts_at, ends_at",
    owner: "coach_id",
  },
  {
    name: "armory_items",
    table: "armory_items",
    columns:
      "kind, category, title, description, price_cents, buy_url, created_at",
    owner: "coach_id",
  },
  {
    name: "sales",
    table: "purchases",
    columns:
      "item_title, kind, amount_cents, fee_cents, refunded_at, created_at",
    owner: "seller_id",
    order: "created_at",
  },
  {
    name: "programs_created",
    table: "programs",
    columns:
      "title, description, published, created_at, program_days(day_number, title, instructions, pillar)",
    owner: "coach_id",
  },
  {
    name: "membership_plans",
    table: "coach_plans",
    columns: "name, description, price_cents, trial_days, active, created_at",
    owner: "coach_id",
  },
];

export async function buildDataExport(user: { id: string; email: string }) {
  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, role, bio, instagram_url, tiktok_url, youtube_url, x_url, website_url, email_updates, share_tracking, protein_target_g, calorie_target, created_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  const results = await Promise.all(
    SECTIONS.map(async (section) => {
      let query = supabase
        .from(section.table)
        .select(section.columns)
        .eq(section.owner, user.id)
        .limit(20000);
      if (section.order) query = query.order(section.order);
      const { data, error } = await query;
      if (error)
        console.error(
          `Data export section ${section.name} failed`,
          error.message,
        );
      // A section that fails (or a feature that isn't set up) is left out rather than failing the export.
      return [section.name, error ? undefined : data] as const;
    }),
  );
  const sections = Object.fromEntries(
    results.filter(([, rows]) => Array.isArray(rows) && rows.length > 0),
  );

  return {
    exported_at: new Date().toISOString(),
    about:
      "Your GYMX2 data. Amounts are in cents. Your conversations are shared with the other person, so they keep their copy if you delete your account. Photos and uploaded files are listed but not included.",
    account: { email: user.email, ...profile },
    ...sections,
  };
}
