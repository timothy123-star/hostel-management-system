# HostelOS staging deployment progress

## 2026-11-09 — migration baseline

### Verified

- The current working tree contains pre-existing, uncommitted PostgreSQL
  foundation and production-bootstrap work. It has been preserved.
- The PostgreSQL migration runner and SQLite-to-PostgreSQL import utility are
  present, but the application runtime remains SQLite: services import
  `db/connection.ts` and use synchronous `better-sqlite3` calls.
- The backend and frontend cannot currently be validated in this checkout
  because the installed Windows Rollup optional binary is missing. This is the
  known cross-platform dependency issue described in the deployment brief.

### Consequence

PostgreSQL must **not** be configured as a staging runtime yet. Doing so before
the service and route conversion would either use SQLite in production or
produce an incomplete application. No deployment, database initialization, or
provider resource creation has been attempted.

### Next engineering work

1. Restore an isolated WSL/Linux dependency installation from the tracked
   lockfile without touching the current working tree's uncommitted lockfile.
2. Convert each runtime slice to async PostgreSQL, including its routes and
   tests, beginning with authentication and manager bootstrap.
3. Add the private object-storage adapter and its tests.
4. Run the complete PostgreSQL test suite and builds before preparing provider
   deployments.

### Provider decision (research only; no account resources created)

- **Database and photographs:** Neon Free is the preferred target. Neon
  documents 1 GB of PostgreSQL storage and 5 GB of S3-compatible object
  storage per free project. The storage adapter must still be implemented and
  verified with a private bucket before this is selected for a live staging
  deployment. Source: <https://neon.com/blog/neon-free-plan-1-gb-per-project>.
- **API:** Render Free web services remain suitable for a demonstration, with
  an ephemeral filesystem and an idle spin-down after 15 minutes. No uploaded
  image or SQLite database can reside there. Source:
  <https://render.com/docs/free>.
- **Frontend:** Vercel Hobby remains suitable only for the requested personal,
  non-commercial staging use. Source: <https://vercel.com/docs/plans/hobby>.

### Safety record

- No local SQLite database, PostgreSQL test database, test fixture, secrets,
  photographs, or Git branch has been changed.
- No paid resource, payment method, external account resource, or deployment
  has been created.

## 2026-11-09 — Linux verification and first PostgreSQL runtime unit

### Completed

- Confirmed WSL Node `v22.23.4`, npm `10.9.9`, and Linux platform.
- Restored dependencies from the existing lockfile in an isolated Linux
  filesystem copy. The Windows-mounted workspace could not safely clean its
  generated `node_modules` tree, so it was deliberately left alone.
- Confirmed that Rollup, esbuild, and better-sqlite3 load under Linux.
- Built all workspaces successfully and ran the complete current backend suite:
  **15 files passed, 55 tests passed, 2 PostgreSQL integration tests skipped**.
- Added a PostgreSQL initial-manager bootstrap function. It uses a transaction
  and transaction-scoped advisory lock to protect the empty-administrator-table
  race, hashes the supplied password with bcrypt, and never overwrites an
  existing manager.
- Added two regression tests for that PostgreSQL bootstrap; both pass.

### Remaining blocker for real PostgreSQL integration tests

PostgreSQL is listening locally, but this shell has no PostgreSQL role and
neither `DATABASE_URL` nor `PG_INTEGRATION_TEST_DATABASE_URL` is configured.
The local administrator account requires an interactive password. No database
was changed. Before the runtime conversion can be integration-tested, configure
a local-only URL for a dedicated `hostelos_runtime_test` database in the local
environment (never Neon, Render, `hostelos_test`, or
`hostelos_rollback_test`). Do not put that URL in this document or chat.

### Next engineering work

1. Convert authentication login and manager bootstrap startup to the async
   PostgreSQL path, retaining SQLite only for local legacy workflows.
2. Continue the remaining service slices with transaction-scoped PostgreSQL
   queries and route `await`s.
3. Add and run the isolated PostgreSQL integration and concurrency suite once
   the dedicated local test URL is configured.

## 2026-11-09 — Stage 4A preflight

- Confirmed that the local PostgreSQL server is listening.
- Confirmed that `PG_INTEGRATION_TEST_DATABASE_URL` is still not configured.
- No local PostgreSQL role is available to this shell, and elevated local
  PostgreSQL administration requires interactive authorization.
- Stage 4A explicitly requires real-server integration and concurrency checks
  before changing the runtime slice; the conversion has therefore not begun.

### Exact resume action

Configure a local-only `PG_INTEGRATION_TEST_DATABASE_URL` for a dedicated
`hostelos_runtime_test` database and role in the active WSL environment. The
role must be able to create and drop only its own temporary schemas. Do not
place the URL in Git, `.env`, documentation, or chat, and never point it to
Neon, Render, `hostelos_test`, or `hostelos_rollback_test`.
