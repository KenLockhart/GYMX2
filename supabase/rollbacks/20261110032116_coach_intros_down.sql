drop trigger if exists calendar_sessions_cancel_intro on public.calendar_sessions;
drop function if exists private.cancel_intro_with_session();
drop function if exists public.cancel_intro(uuid);
drop function if exists public.book_intro(uuid, text);
drop function if exists public.open_intro_slots(uuid);
drop table if exists public.coach_intro_bookings;
drop table if exists public.coach_intro_slots;
