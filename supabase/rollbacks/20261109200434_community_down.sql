-- Undo the GYMX2 Community migration. Run only on purpose: it deletes every post, comment,
-- like, report and notification. The `moderator` enum value stays (Postgres can't drop one);
-- set any moderators back to member first.
alter publication supabase_realtime drop table public.notifications, public.post_comments;
drop function if exists public.community_feed(integer, integer, uuid);
drop function if exists public.remove_post(uuid, text), public.remove_comment(uuid, text), public.dismiss_report(uuid);
drop table if exists public.message_attachments, public.content_reports, public.notification_settings, public.notifications,
  public.feed_preferences, public.hidden_posts, public.mutes, public.follows, public.post_comments, public.post_likes,
  public.post_media, public.posts cascade;
drop function if exists private.can_moderate(text, uuid), private.can_write_post(uuid, text, text, uuid),
  private.can_see_post(uuid, text, uuid, timestamptz), private.is_coach(), private.is_moderator(),
  private.check_post_media(), private.check_comment_parent(), private.count_post_likes(), private.count_post_comments(),
  private.check_message_attachments();
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check check (char_length(body) between 1 and 4000);
-- Empty the bucket in the Supabase dashboard first, then:
delete from storage.buckets where id = 'community-media';
