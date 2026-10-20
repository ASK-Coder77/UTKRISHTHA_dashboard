# Utkrishta Dashboard

Initial project scaffold for the Epoch AIML Club event dashboard.

## Run locally

1. Install Node.js 20.9 or newer and pnpm.
2. Copy `.env.example` to `.env.local` and fill in the MongoDB, Auth.js, Google OAuth, allowed domain, super admin, and (for deployed environments) Upstash values.
3. Run `pnpm install` and then `pnpm dev`.
4. Open <http://localhost:3000>. The landing page should show “Utkrishta Dashboard”.

Use `pnpm typecheck` and `pnpm lint` to check TypeScript and ESLint. Auth.js v5 reads `AUTH_SECRET`, `AUTH_URL`, `AUTH_GOOGLE_ID`, and `AUTH_GOOGLE_SECRET`; the remaining environment variable names are listed in `.env.example`.

## Project layout

- `src/app/` contains the App Router pages and shared layout.
- `src/app/globals.css` is the Tailwind entry point and the only stylesheet.
- Root config files define Next.js, TypeScript, PostCSS/Tailwind, and ESLint settings.
