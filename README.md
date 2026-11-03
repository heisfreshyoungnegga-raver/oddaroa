# Oddaroa

Football odds & predictions site: live ESPN fixtures/scores/tables for 11 leagues, model odds and picks, live scores, results, upcoming fixtures, an accumulator of the day, a bet-slip builder, and a VIP tips tier.

Static frontend + a zero-dependency Node backend in the PrimeStake pattern: the same API handlers run on Railway (via `server.js`) and as Vercel functions (via `api/`).

## Run locally

```bash
node server.js   # serves the site on $PORT (default 8080)
```

Without env vars the site works fully as a static site and every `/api/*` call returns `503 backend_not_configured` naming the missing vars.

## Backend setup (hosting)

1. Create a Postgres database (Neon works) and run `backend/schema.sql` on it.
2. Set two env vars on the host (Railway or Vercel):
   - `DATABASE_URL` — the Neon connection string
   - `SESSION_SECRET` — any long random string
3. Create the first super admin: register a normal account at `/invite.html`, then promote it once in SQL:
   `update users set role = 'super_admin' where phone = '<your phone>';`
   After that, all admin/super-admin accounts are created from the Super Admin Portal's one-time invite links.

## Portals

- `/admin.html` — Admin Portal (admins + super admins): stats, tip manager (publish/settle tips — these feed the Predictions page), users, VIP grants, block/unblock, settings (read-only).
- `/super-admin.html` — Super Admin Portal (super admins only): everything above plus Platform Control — role changes, one-time admin/super-admin invite links (48h), platform settings (VIP prices, WhatsApp number, tips/VIP toggles, site notice), user deletion.
- `/invite.html` — registration page; with `?token=...` it creates the invited role.

## API

- `POST /api/auth/register` `{phone, password, display_name?, inviteToken?}`
- `POST /api/auth/login` `{phone, password}` → `{token, user}`
- `GET /api/auth/me`, `POST /api/auth/password`
- `GET /api/tips` — official tips; VIP tips locked unless the caller has active VIP or an admin role
- `/api/admin/*` — stats, tips, users, block, vip, promote (super), invite (super), settings, delete-user (super)

Roles are enforced server-side in `api/_lib.js` (`requireAdmin` / `requireSuperAdmin`), exactly like PrimeStake.
