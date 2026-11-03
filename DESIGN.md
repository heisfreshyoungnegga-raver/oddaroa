# Oddaroa — Architecture & Design Contract (v2, 2026-11-03)

## UI v3 (2026-11-03 evening) — betting-feed redesign
At Prince's direction the public UI was rebuilt in the layout language of
football.com's mobile app (structure inspiration only; all code and brand
are Oddaroa's own):
- Tokens: the layout first shipped with an indigo + lime scheme, but
  Prince asked the same evening to keep the ORIGINAL Oddaroa colours —
  so the palette is deep green-black (--bg #0b0f0c, panels
  #131a15/#182219) with the v2 gold accent (#f5c518) for odds, active
  states and CTAs; live red #ef4444, confidence green #22c55e. The
  accent token is still named --lime internally; its value is the gold.
- App bar: slim near-black bar, wordmark with lime dot, Go VIP pill +
  Slip button with count; below it a horizontally scrolling quick-link
  pill strip (replaces the wrapping nav).
- Match feed: matches render as dense rows inside league-group panels —
  league header bar + 1|X|2 column header, then rows of
  time rail | stacked teams with per-team scores | three 1X2 odds pills |
  "+6" expander revealing DC/O-U/BTTS markets and the model pick.
  No per-match cards, thin dividers only.
- Mobile: fixed bottom nav (Matches, Live, Tips, Acca, Slip with count),
  lime underline on the active tab; the slip FAB lifts above it.
- Admin portals keep their own headers; the shared CSS restyles them.

## What it is (product = first page)
Oddaroa is a football odds & predictions site: today's matches with 1X2,
Double Chance, Over/Under and BTTS odds, model predictions with confidence,
live scores, results, upcoming fixtures, league tables, an auto-built
accumulator of the day, and a working bet slip. Free daily; VIP is the paid
tier (WhatsApp join). First screen says exactly that.

## Pages & flow (13 pages)
- index.html — Matches: hero -> live strip -> league filter + search ->
  match cards (ESPN feed, model odds) -> top picks preview -> explore grid.
- live.html — Live Scores: in-play matches only, auto-refresh 60s.
- predictions.html — Predictions: best bet + free tips + VIP lock.
- accumulator.html — Accumulator of the Day: Safe (4 legs) / Value (6 legs)
  auto-built from top-confidence model picks, combined odds, stake maths,
  one-tap add-all-to-slip.
- leagues.html — Leagues: 11 league cards; each opens its table (ESPN
  standings) + today's matches for that league.
- results.html — Results: finished matches, Today / Yesterday toggle.
- upcoming.html — Upcoming: Tomorrow / Day-after fixtures with odds.
- guide.html — Betting Guide: how odds work, every market explained,
  confidence, accumulators, bankroll rules.
- faq.html — FAQ accordion.
- about.html — About, how the model works, responsible gambling, contact.
- slip.html — My Slip: selections, totals, stake, booking reference.
- vip.html — VIP plans (GH₵50/week, GH₵150/month) via WhatsApp.
- admin.html — Admin demo (unlinked in nav): feed stats, tip manager.
- 404.html, sitemap.xml, robots.txt for the platform layer.
Flow: any page -> tap odd -> slip drawer -> Slip -> bookmaker / VIP.

## Data
ESPN free APIs only, no key: scoreboard (11 leagues, optional ?dates=),
standings via apis/v2 (.../standings?season=2026). ESPN publishes no odds,
so all prices are deterministic per-match model odds — stated on-page.

## Backend (v3, 2026-11-03 — PrimeStake pattern)
Zero-dependency Node: server.js serves static + API on Railway; the same
api/ handlers run as Vercel functions. Postgres (Neon) via HTTP SQL.
Env: DATABASE_URL + SESSION_SECRET only (API returns 503 naming what's
missing until set). Schema: backend/schema.sql (users, tips, invites,
operator_settings). Roles user/admin/super_admin enforced server-side.
- /admin.html Admin Portal: stats, API tip manager (feeds Predictions),
  users, VIP grant/revoke, block/unblock, settings read-only.
- /super-admin.html Super Admin Portal: + Platform Control — role
  changes, one-time 48h invite links (admin/super_admin), settings
  writes, user deletion.
- /invite.html registration; invite token creates the invited role.
First super admin: register, then one SQL promote (see README).

## Files
- css/styles.css — tokens at :root only, shared components.
- js/app.js — feeds, model odds/picks, match cards, standings parser.
- js/slip.js — localStorage slip (toggle + add), drawer, badge.

## Design tokens
Dark stadium theme. Background #0b0f0c, surface #131a15, line #223028,
accent gold #f5c518, green #22c55e, text #eef4ef, muted #9db3a4.
Font: system stack. Radius 14px cards, 10px buttons.
Rules: no invented win-rates/records/testimonials; 18+ and bet-responsibly
on every footer; focus-visible kept; prefers-reduced-motion respected.
