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

/** Currency-aware display for manager/resident surfaces. Never labels demo USD as official. */
export function formatPaymentAmount(amount: number, currency: string, amountKobo?: number | null): string {
  if (currency === 'NGN' && amountKobo !== null && amountKobo !== undefined) {
    try { return formatNgn(amountKobo); } catch { /* fall through */ }
  }
  if (currency === 'NGN') return `\u20A6${Number(amount).toLocaleString('en-NG')} per academic session`;
  return `$${amount} ${currency} (DEMO price)`;
}
