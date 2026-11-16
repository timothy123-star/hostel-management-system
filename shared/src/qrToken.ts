/**
 * Opaque resident QR credential parsing.
 *
 * Issued QR codes encode the full resident-verification URL
 * (`<base>/resident-verification/<token>`), while the verification API
 * expects only the opaque 43-character base64url token. This helper
 * converts either form into the credential to send, so scanners never
 * transmit a full URL (or query string, fragment, or surrounding
 * whitespace) as the credential.
 *
 * Returns the extracted token, or null when the input is not a
 * recognizable resident pass value. Callers must render a visible
 * INVALID result for null instead of leaving a blank state, and must
 * never navigate to a URL obtained from a scanned QR payload.
 */
const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const VERIFICATION_PATH_PATTERN = /\/resident-verification\/([A-Za-z0-9_-]{43})$/;

export function extractQrToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (RAW_TOKEN_PATTERN.test(trimmed)) return trimmed;
  // Tolerate trailing slashes plus query strings, fragments, or pasted
  // whitespace around an otherwise valid verification URL.
  const withoutFragment = trimmed.split('#', 1)[0] ?? '';
  const withoutQuery = (withoutFragment.split('?', 1)[0] ?? '').replace(/\/+$/, '');
  const match = withoutQuery.match(VERIFICATION_PATH_PATTERN);
  return match ? match[1] : null;
}
