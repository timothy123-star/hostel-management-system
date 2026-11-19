import type { RoomCapacity } from '@hostel/shared';

/** Official NGN charges PER RESIDENT, PER ACADEMIC SESSION (integer kobo). */
export const OFFICIAL_NGN_KOBO: Record<RoomCapacity, number> = {
  1: 240000000,
  3: 80000000,
  2: 120000000,
};

export function officialAmountKobo(capacity: RoomCapacity): number {
  const v = OFFICIAL_NGN_KOBO[capacity];
  if (v === undefined) throw new Error(`Unsupported room capacity: ${capacity}`);
  return v;
}

/** Kobo (integer) -> NGN major units (whole naira). Throws if fractional. */
export function koboToNaira(kobo: number): number {
  if (!Number.isInteger(kobo)) throw new Error('Kobo amount must be an integer.');
  if (kobo % 100 !== 0) throw new Error(`Kobo amount ${kobo} is not a whole naira value.`);
  return kobo / 100;
}

/** NGN major units -> kobo integer. */
export function nairaToKobo(naira: number): number {
  if (!Number.isInteger(naira) || naira < 0) throw new Error('Naira amount must be a non-negative integer.');
  return naira * 100;
}

export function formatNgn(kobo: number): string {
  const naira = koboToNaira(kobo);
  return `\u20A6${naira.toLocaleString('en-NG')} per academic session`;
}

/** Per-resident official display by capacity: "₦2,400,000 NGN per resident per academic session". */
export function formatOfficialPerResident(capacity: RoomCapacity): string {
  const kobo = officialAmountKobo(capacity);
  const naira = koboToNaira(kobo);
  return `\u20A6${naira.toLocaleString('en-NG')} NGN per resident per academic session`;
}

/**
 * Authoritative resolver for NEW booking obligations.
 * Reads official_session_prices when a DB row is supplied, otherwise uses
 * the canonical OFFICIAL_NGN_KOBO schedule. Fails closed on drift so a
 * misconfigured table can never silently create a wrong obligation.
 * Never trusts browser/WhatsApp-supplied amounts.
 */
export function resolveOfficialPricing(
  capacity: RoomCapacity,
  dbAmountKobo?: number | null,
): { amountKobo: number; amountNaira: number; currency: 'NGN' } {
  const canonical = officialAmountKobo(capacity);
  if (dbAmountKobo === null || dbAmountKobo === undefined) {
    return { amountKobo: canonical, amountNaira: koboToNaira(canonical), currency: 'NGN' };
  }
  if (!Number.isInteger(dbAmountKobo) || dbAmountKobo <= 0) {
    throw new Error(`Official price table holds an invalid amount for capacity ${capacity}.`);
  }
  if (dbAmountKobo !== canonical) {
    throw new Error(
      `Official price drift for capacity ${capacity}: table=${dbAmountKobo} canonical=${canonical}. Refusing to create obligation.`,
    );
  }
  return { amountKobo: canonical, amountNaira: koboToNaira(canonical), currency: 'NGN' };
}

/** Decimal-safe money comparison. Uses integer kobo when available; never uses float equality. */
export function amountsMatch(
  expected: { amount?: number; amountKobo?: number | null; currency: string },
  actual: { amount?: number; amountKobo?: number | null; currency: string },
): boolean {
  if (expected.currency !== actual.currency) return false;
  if (
    expected.amountKobo !== null &&
    expected.amountKobo !== undefined &&
    actual.amountKobo !== null &&
    actual.amountKobo !== undefined
  ) {
    return expected.amountKobo === actual.amountKobo;
  }
  if (expected.currency === 'NGN' && expected.amountKobo != null && actual.amount != null) {
    try {
      return koboToNaira(expected.amountKobo) === Number(actual.amount);
    } catch {
      return false;
    }
  }
  if (expected.currency === 'NGN' && actual.amountKobo != null && expected.amount != null) {
    try {
      return Number(expected.amount) === koboToNaira(actual.amountKobo);
    } catch {
      return false;
    }
  }
  return Number(expected.amount) === Number(actual.amount);
}

/** Currency-aware display for manager/resident surfaces. Never labels demo USD as official. */
export function formatPaymentAmount(amount: number, currency: string, amountKobo?: number | null): string {
  if (currency === 'NGN' && amountKobo !== null && amountKobo !== undefined) {
    try { return formatNgn(amountKobo); } catch { /* fall through */ }
  }
  if (currency === 'NGN') return `\u20A6${Number(amount).toLocaleString('en-NG')} per academic session`;
  return `$${amount} ${currency} (DEMO price)`;
}
