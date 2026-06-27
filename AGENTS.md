# AGENTS.md

## Project
This repository is `fantasy-pingisligan`, a Next.js app for a fantasy game based on Pingisligan, the highest Swedish table tennis division.

## Tech stack
- Next.js with App Router
- TypeScript
- Tailwind CSS
- Supabase for database and authentication
- Vercel for hosting
- GitHub Actions may later be used for scheduled Profixio scraping/imports

## Important architecture
- Frontend/app code lives in this repo.
- Supabase is used for auth, users, players, clubs, matches, fantasy teams, leagues and points.
- Do not put scraping logic in browser/client components.
- Scraping/importing Profixio data must run server-side, for example via GitHub Actions, Supabase Edge Functions, or a server-only script.
- Do not expose or commit secret keys.

## Environment variables
Local development uses `.env.local`.

Expected public variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Never expose or commit:
- Supabase service role key
- Vercel tokens
- Any private API keys

## Workflow
Before making changes:
- Inspect existing files first.
- Explain the plan briefly.
- Prefer small, focused changes.
- Show diffs before large changes.

After making code changes:
- Run `npm run lint` if relevant.
- Run `npm run dev` only when needed to verify behavior.
- Mention any Supabase SQL changes that the user must run manually.
- Mention any Vercel environment variables that the user must add manually.

## Coding style
- Use TypeScript.
- Keep components simple.
- Prefer server components for database reads when possible.
- Use client components only when interactivity is needed.
- Keep UI clean and mobile-friendly.