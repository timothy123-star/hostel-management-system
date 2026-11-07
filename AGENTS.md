# HostelOS Project Instructions

## Project

HostelOS is a digital hostel booking, management and security system.

The current implementation serves one hostel operator with two separate facilities:

- Male hostel
- Female hostel

One overall manager currently controls both facilities.

## Development principles

- Understand the existing code before changing it.
- Prefer small, controlled changes.
- Follow existing TypeScript, Express, database and frontend patterns.
- Never rewrite functioning modules unnecessarily.
- Never weaken backend validation to make a frontend feature work.
- Do not introduce unnecessary dependencies.

## Business rules that must remain enforced

1. Male and female facility data and allocation must remain separate.
2. Students have individual records, payments, accommodation dates and credentials.
3. Room capacity must match the required booking group occupancy.
4. Maintenance rooms cannot be allocated.
5. Rooms held by another group cannot be allocated.
6. Temporary room holds are not final allocations.
7. Final allocation requires every group member's payment to be verified.
8. Shared roommate groups must be relocated together by default.
9. Manager relocation requires a reason and an audit record.
10. Pair-to-third random matching requires the existing consent rules.
11. Matching must preserve FIFO and facility eligibility.

## Payments

- The existing demo bank transfer workflow is simulated.
- Never represent simulated payments as real bank transactions.
- Do not connect real payment services without explicit approval.

## Resident identity

- Every resident must have an individual credential.
- QR tokens must be opaque, unique and revocable.
- A QR credential must not expose personal information directly.
- Resident photographs must be stored securely and reviewed by management.
- QR issuance must follow photograph approval.

## Database and testing safety

- Never reset, delete, reseed or overwrite the development database.
- Preserve existing data.
- Follow the repository's test-isolation approach.
- Use temporary test databases for tests.
- Prefer additive database migrations.
- Never use production student data in tests.

## External integrations

- Keep the current WhatsApp simulator functional.
- Do not replace it with an unofficial WhatsApp automation library.
- Do not activate live Meta WhatsApp integration without explicit approval.
- Never expose API keys, access tokens or secrets in code, logs or responses.

## Completion requirements

For every implementation task:

1. Explain the root cause or implementation approach.
2. Make the smallest safe changes.
3. Add relevant regression tests.
4. Run relevant tests and the complete test suite.
5. Run the project's build and typecheck commands where available.
6. Report files changed and test results.
7. Identify anything that still requires manual testing.
