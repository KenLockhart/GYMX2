begin;
select plan(24);

-- People: two coaches, a member of coach A, an outsider member, a moderator, an admin.
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-0000-0000-00000000000a', 'cm-coach-a@example.test', '{"display_name":"Coach A"}'),
  ('c0000000-0000-0000-0000-00000000000b', 'cm-coach-b@example.test', '{"display_name":"Coach B"}'),
  ('c0000000-0000-0000-0000-000000000001', 'cm-member@example.test', '{"display_name":"Member"}'),
  ('c0000000-0000-0000-0000-000000000002', 'cm-outsider@example.test', '{"display_name":"Outsider"}'),
  ('c0000000-0000-0000-0000-000000000003', 'cm-mod@example.test', '{"display_name":"Mod"}'),
  ('c0000000-0000-0000-0000-000000000004', 'cm-admin@example.test', '{"display_name":"Admin"}');
update public.profiles set role = 'coach' where id in ('c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-00000000000b');
update public.profiles set role = 'moderator' where id = 'c0000000-0000-0000-0000-000000000003';
update public.profiles set role = 'admin' where id = 'c0000000-0000-0000-0000-000000000004';
insert into public.coach_members (coach_id, member_id) values ('c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001');
insert into public.messages (coach_id, member_id, sender_id, body)
values ('c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'hi coach');

-- The member's posts: public, private progress, and in coach A's community. Fixed ids are set
-- by the database owner (people can't choose ids); the write rules are tested below.
insert into public.posts (id, author_id, kind, body, audience) values
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'workout', 'Leg day done', 'everyone'),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'progress', 'Down 10 lb', 'only_me');
insert into public.posts (id, author_id, kind, body, audience, coach_id) values
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'general', 'Hi team', 'coach_community', 'c0000000-0000-0000-0000-00000000000a');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}';
select throws_ok(
  $$insert into public.posts (author_id, kind, body, audience) values ('c0000000-0000-0000-0000-000000000001', 'announcement', 'Fake', 'everyone')$$,
  '42501', null, 'members cannot post announcements');
select throws_ok(
  $$insert into public.posts (author_id, body, audience, coach_id) values ('c0000000-0000-0000-0000-000000000001', 'x', 'coach_community', 'c0000000-0000-0000-0000-00000000000b')$$,
  '42501', null, 'members cannot post in a community they did not join');
select throws_ok(
  $$insert into public.posts (author_id, body, audience) values ('c0000000-0000-0000-0000-000000000002', 'impersonation', 'everyone')$$,
  '42501', null, 'nobody can post as someone else');
select throws_ok(
  $$insert into public.posts (author_id, body, audience, like_count) values ('c0000000-0000-0000-0000-000000000001', 'x', 'everyone', 999)$$,
  '42501', null, 'like counts cannot be set by people');
insert into public.post_likes (post_id, user_id) values ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001');
select is((select like_count from public.posts where id = 'd0000000-0000-0000-0000-000000000001'), 1, 'the database counts likes');
select throws_ok(
  $$insert into public.post_likes (post_id, user_id) values ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001')$$,
  '23505', null, 'a person can like a post only once');
reset role;

-- The outsider: sees the public post only.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*)::int from public.posts), 1, 'outsiders see only "everyone" posts');
select is((select count(*)::int from public.community_feed()), 1, 'the feed returns only what the rules allow');
insert into public.feed_preferences (user_id, mode, sort, preferred_coaches)
values ('c0000000-0000-0000-0000-000000000002', 'personalized', 'personalized', array['c0000000-0000-0000-0000-00000000000a']::uuid[]);
insert into public.follows (follower_id, followed_id) values ('c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.community_feed()), 1, 'following a coach and preferring them unlocks nothing');
select is((select count(*)::int from public.community_feed(0, 20, 'c0000000-0000-0000-0000-00000000000a')), 0, 'asking for a coach community directly unlocks nothing');
select throws_ok(
  $$insert into public.post_likes (post_id, user_id) values ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001')$$,
  '42501', null, 'nobody can like as someone else');
select throws_ok(
  $$insert into public.post_comments (post_id, author_id, body) values ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', 'sneaky')$$,
  '42501', null, 'outsiders cannot comment on a community post');
insert into public.hidden_posts (user_id, post_id) values ('c0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001');
select is((select count(*)::int from public.community_feed()), 0, 'hidden posts leave the feed');
select is((select count(*)::int from public.posts), 1, 'hiding a post does not delete it');
reset role;

-- Coach A sees the community post; coach B does not.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select is((select count(*)::int from public.posts where audience = 'coach_community'), 1, 'a coach sees their own community');
select is((select count(*)::int from public.posts where audience = 'only_me'), 0, 'a coach cannot see a member''s private progress post');
select lives_ok(
  $$insert into public.posts (author_id, kind, body, audience, coach_id) values ('c0000000-0000-0000-0000-00000000000a', 'announcement', 'New program!', 'coach_community', 'c0000000-0000-0000-0000-00000000000a')$$,
  'coaches post announcements in their community');
select is((select count(*)::int from public.follows), 0, 'nobody else can read your follows');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-00000000000b","role":"authenticated"}';
select is((select count(*)::int from public.posts where audience = 'coach_community'), 0, 'other coaches cannot see the community');
select throws_ok($$select public.remove_post('d0000000-0000-0000-0000-000000000003', 'x')$$, '42501', null, 'other coaches cannot remove community posts');
reset role;

-- Moderator: shared feed only, no messages.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}';
select is((select count(*)::int from public.messages), 0, 'moderators cannot read private messages');
select throws_ok($$select public.remove_post('d0000000-0000-0000-0000-000000000003', 'x')$$, '42501', null, 'moderators cannot remove community posts');
select lives_ok($$select public.remove_post('d0000000-0000-0000-0000-000000000001', 'Spam')$$, 'moderators remove shared-feed posts');
reset role;

-- Admin: never sees "only me" posts.
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::int from public.posts where audience = 'only_me'), 0, 'admins cannot see private progress posts');
reset role;

select * from finish();
rollback;
