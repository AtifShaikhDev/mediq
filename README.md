# MediQ 🏥

<div align="center">

### Hospital Queue Management System

A web application for managing hospital queues, staff workflows, and public queue displays.

[![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?style=flat-square&logo=javascript&logoColor=222)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Vite](https://img.shields.io/badge/Built%20with-Vite-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Supabase](https://img.shields.io/badge/Backend-Supabase-3FCF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)

**Created by [Atif Shaikh](https://github.com/AtifShaikhDev)**

</div>

---

## 📌 Overview

MediQ is a Vite application backed by Supabase Auth, Postgres, Row Level Security (RLS), and Realtime. It is designed to support staff-managed patient registration and queue workflows, alongside a limited public display of queue tokens.

Application records are not stored in `localStorage`; Supabase Auth persists the staff session using its supported browser session handling.

## ✨ Key capabilities

- Staff authentication and role-based workflows.
- Patient registration and profile management for authorized roles.
- Department-based daily queue tokens using the `Asia/Kolkata` timezone.
- Queue calling follows first-in, first-out (FIFO) order within each department.
- Realtime queue updates for authenticated clients.
- A separate public display that exposes queue tokens and department names, not patient identity details.
- Optional public patient registration through a separately deployed Edge Function; it is disabled unless explicitly configured.

## 🧰 Technology

| Layer | Technology |
|---|---|
| Frontend tooling | Vite |
| Language | JavaScript (ES modules) |
| Backend services | Supabase |
| Authentication | Supabase Auth |
| Database | PostgreSQL |
| Access control | Row Level Security (RLS) |
| Live updates | Supabase Realtime |
| Server-side functions | Supabase Edge Functions |

## 🚀 Setup

### 1. Prepare Supabase

Create or select a Supabase project and configure email/password authentication. Disable public sign-ups; staff accounts should be invited by a trusted administrator.

### 2. Apply database migrations

Apply the migrations in order:

1. [`202611190001_mediq_core.sql`](./supabase/migrations/202611190001_mediq_core.sql)
2. [`202611190002_revoke_trigger_function_execute.sql`](./supabase/migrations/202611190002_revoke_trigger_function_execute.sql)
3. [`202611190003_india_queue_timezone.sql`](./supabase/migrations/202611190003_india_queue_timezone.sql)

The core migration expects the standard `supabase_realtime` publication. It creates departments and the default hospital name, enables RLS, defines the queue RPCs, and adds the queue tables to Realtime.

Apply [`202611190004_public_registration.sql`](./supabase/migrations/202611190004_public_registration.sql) only after its SQL has been reviewed and approved.

### 3. Provision the first administrator

In Supabase Auth, invite the first administrator. In the SQL editor, provision that Auth user as MediQ's first staff profile (replace the email and name):

```sql
insert into public.staff_profiles (user_id, email, full_name, role)
select id, email, 'MediQ Administrator', 'Admin'
from auth.users
where email = 'admin@your-hospital.example'
on conflict (user_id) do nothing;
```

Provision subsequent staff Auth accounts using Supabase Auth invitations, then create each `staff_profiles` row from the SQL editor or as an administrator using an approved server-side provisioning workflow. The browser intentionally does not create Auth users or hold a service-role key.

### 4. Configure environment variables

Copy `.env.example` to `.env` (or `.env.local`) and set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Use values from the project's API settings. Vite requires the `VITE_` prefix; a legacy `VITE_SUPABASE_ANON_KEY` is accepted, but a secret/service-role key is never used by this app.

### 5. Run locally

Restart Vite after changing environment variables:

```sh
npm install
npm run dev
```

Available scripts:

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Vite development server |
| `npm run build` | Build the production bundle |
| `npm run preview` | Preview the production build |

The app stays on a setup screen when Supabase environment variables are missing. It does not seed fallback patient/staff data.

## 🔐 Roles and data access

- Admin and Receptionist can register patients and edit patient profiles.
- Admin, Doctor, and Nurse can complete a serving visit.
- All active staff can call the next patient; PostgreSQL serializes calls per department/day and selects the earliest waiting arrival.
- The database assigns daily department tokens using `Asia/Kolkata` and enforces uniqueness. The patient identifier is generated by Postgres.
- Only Admin can update staff roles and hospital settings or read audit logs.
- Patient profile, visit, queue, and staff data require an authenticated active staff profile and are protected by RLS. Sensitive writes use role-checked database policies or RPC functions.
- Queue changes are synchronized to authenticated clients via Supabase Realtime.
- The anonymous `/display` route reads only `public_queue_display`, which contains department names and queue tokens, not patient IDs, names, or phone numbers.

## 🌐 Public patient registration

The public `/register` route remains non-submitting unless `VITE_PUBLIC_REGISTRATION_ENABLED=true`. Only enable it after the public Edge Function and its database migration have both been deployed and tested.

The public form calls the `public-register` Edge Function; it never calls the authenticated staff `register_patient` RPC. The function is configured for anonymous HTTP requests, validates and normalizes every field, checks an exact-origin CORS allowlist, limits the request body, applies a database-backed limit of 30 HTTP attempts per client fingerprint in a rolling 10-minute window (including invalid submissions; CORS preflight is exempt), and uses a retained idempotency key to replay a prior result instead of creating a duplicate. It returns only the generated Patient ID and token. It does not expose a patient-record read route.

Before enabling `VITE_PUBLIC_REGISTRATION_ENABLED`:

1. Apply the reviewed public-registration migration.
2. Deploy `supabase/functions/public-register`.
3. Configure `PUBLIC_REGISTRATION_ORIGINS` and a random `PUBLIC_REGISTRATION_HASH_SECRET` of at least 32 characters as Edge Function secrets.
4. Verify the deployed gateway's client-IP header behavior before enabling public traffic.

Supabase's `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are consumed server-side only; never put the service-role key in Vite environment variables or browser code. The function trusts the platform-provided client-IP headers for rate-limit fingerprinting.

**Deployment note:** The database migration and Edge Function are staged locally and have not been applied or deployed.

## ✉️ Staff invitations

The admin-only `invite-staff` Edge Function verifies the caller's Supabase access token and active `Admin` profile before inviting a user through Supabase Auth and creating their `staff_profiles` row. The service-role key is used only inside the Edge Function. The browser cannot assign Admin through the invitation form.

Before sending invitations, add this exact URL to Supabase Auth > URL Configuration > Redirect URLs:

```
https://atif-shaikh1908.github.io/mediq/
```

Confirm the Supabase project's Site URL and email provider are configured for the intended hospital workflow. Invitation delivery depends on Supabase Auth email configuration and provider limits. Test with a controlled staff email before inviting real staff.

## 🛡️ Security notes

- The browser publishable/anon key is public by design; RLS is the security boundary.
- Do not put database passwords, Supabase secret keys, or service-role keys in `.env`, Vite variables, or browser code.
- Review and test policies in a non-production project before using any real patient information.
- This application does not provide clinical decision support.

The linked project's Security Advisor no longer reports anonymous access to trigger-only `SECURITY DEFINER` functions. It still reports authenticated access to the role-checked queue RPCs and role helper; test those permissions with each staff role before production use.

## ⚠️ Known gaps and production-readiness notes

- Staff invitation email delivery and the invited user's first sign-in/password setup still need an end-to-end test.
- No organization/tenant isolation, backup/retention policy, or penetration/security test is configured here.
- UI reporting loads records from the current Supabase dataset and is intended for a single hospital project. For a large deployment, add server-side pagination and date-filtered reporting queries.
- Authenticated role flows still need testing with each staff role before real patient information is used.
- The linked database already reports `Asia/Kolkata` for queue-date calculations, but its migration history does not show the local timezone migration. Reconcile that history before applying later migrations; public-registration migration 004 is a local draft only.

---

<div align="center">

**MediQ — organized queues, clearer workflows.**

Made with care by [Atif Shaikh](https://github.com/AtifShaikhDev).

</div>
