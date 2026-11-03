# GYMX2

GYMX2 connects people who train with the coaches and fitness creators they want to follow.

This repository currently contains Phase 1: accounts, member, coach and admin roles, profiles with social links, and an admin area.

## Built with

- [Next.js](https://nextjs.org) and TypeScript
- [Supabase](https://supabase.com) for the database and logins
- [Vercel](https://vercel.com) for hosting

## Run it on your computer

You need Node.js 24, the Supabase CLI and Docker Desktop.

```bash
npm install
```

```bash
supabase start
```

Copy `.env.example` to `.env.local`. Fill it in with the local API URL and publishable key that `supabase start` prints, then run:

```bash
npm run dev
```

The site opens at <http://localhost:3000>. Test emails appear in the local inbox at <http://localhost:55424>.

## Run the tests

```bash
npm test
```

```bash
npm run test:db
```

`npm run test:db` checks the database security rules and needs `supabase start` running.

## Make someone the first admin

New accounts are always members, and only an admin can change a role. To create the first admin, sign up on the site, then run this in the Supabase dashboard's SQL Editor with your own email:

```sql
update public.profiles
set role = 'admin', coach_requested = false
where id = (select id from auth.users where email = 'you@example.com');
```

After that, use the Admin page to manage roles.

## Keep the repository safe

This repository is public, so anyone can read what is committed.

- Keep keys and passwords in `.env.local` or the hosting provider's settings.
- Never commit member data, paid ebooks or private videos.
- Never put the Supabase secret or service role key in a `NEXT_PUBLIC_` setting.
