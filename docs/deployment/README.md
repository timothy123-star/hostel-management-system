# HostelOS staging deployment record

This directory records verified deployment decisions and the safe resume point
for staging work. It intentionally contains no credentials, connection URLs,
student data, or photographs.

## Approved target architecture

- React/Vite frontend on Vercel Hobby, restricted to personal,
  non-commercial staging use.
- Express API on a Render Free Web Service. It will have no persistent disk
  and may sleep while idle.
- A new, empty Neon Free PostgreSQL project named `HostelOS Staging`.
- Neon S3-compatible private object storage for student photographs, subject
  to adapter implementation and a dashboard capability check.

No provider resource has been created. The application is not deployable yet:
the runtime still uses synchronous SQLite services.

## Future one-time database initialization

Once the asynchronous runtime conversion and tests are complete, an operator
will set the staging `DATABASE_URL` locally and explicitly run:

```text
npm run migrate:postgres -w backend
```

The startup path must only verify that the expected migration set exists; it
must never apply migrations or seed demo data automatically.

## Operational limits

- Render Free has an ephemeral filesystem; it must never hold uploaded
  photographs or the active staging database.
- Vercel Hobby is not for commercial operation.
- This is a staging demonstration, not a production hostel deployment.
