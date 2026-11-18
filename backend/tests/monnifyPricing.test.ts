import { describe, expect, it } from 'vitest';
import {
  OFFICIAL_NGN_KOBO,
  formatNgn,
  formatPaymentAmount,
  koboToNaira,
  nairaToKobo,
  officialAmountKobo,
} from '../src/services/monnify/pricing.js';

describe('monnify official session pricing', () => {
  it('charges capacity 1 at 240,000,000 kobo per resident per session', () => {
    expect(OFFICIAL_NGN_KOBO[1]).toBe(240000000);
    expect(officialAmountKobo(1)).toBe(240000000);
  });

  it('charges capacity 2 at 120,000,000 kobo per resident per session', () => {
    expect(OFFICIAL_NGN_KOBO[2]).toBe(120000000);
    expect(officialAmountKobo(2)).toBe(120000000);
  });

  it('charges capacity 3 at 80,000,000 kobo per resident per session', () => {
    expect(OFFICIAL_NGN_KOBO[3]).toBe(80000000);
    expect(officialAmountKobo(3)).toBe(80000000);
  });

  it('rejects an unsupported capacity', () => {
    expect(() => officialAmountKobo(4 as any)).toThrow(/unsupported room capacity/i);
  });
});

describe('monnify naira/kobo conversion', () => {
  it('converts whole naira to kobo', () => {
    expect(nairaToKobo(2400000)).toBe(240000000);
    expect(nairaToKobo(0)).toBe(0);
  });

  it('rejects negative and non-integer naira input', () => {
    expect(() => nairaToKobo(-1)).toThrow(/non-negative integer/i);
    expect(() => nairaToKobo(10.5)).toThrow(/non-negative integer/i);
    expect(() => nairaToKobo(NaN)).toThrow(/non-negative integer/i);
  });

  it('converts whole-naira kobo back to naira', () => {
    expect(koboToNaira(240000000)).toBe(2400000);
    expect(koboToNaira(120000000)).toBe(1200000);
    expect(koboToNaira(80000000)).toBe(800000);
  });

  it('rejects fractional, negative-unsafe and non-integer kobo', () => {
    expect(() => koboToNaira(100.5)).toThrow(/must be an integer/i);
    expect(() => koboToNaira(150)).toThrow(/whole naira/i);
    expect(() => koboToNaira(Number.NaN)).toThrow();
  });
});

describe('monnify NGN formatting', () => {
  it('formats official kobo amounts with the naira sign', () => {
    const text = formatNgn(240000000);
    expect(text).toContain('\u20A6');
    expect(text).toContain('2,400,000');
    expect(text).toMatch(/per academic session/i);
  });

  it('presents NGN payments in naira and never as demo USD', () => {
    const official = formatPaymentAmount(2400000, 'NGN', 240000000);
    expect(official).toContain('\u20A6');
    expect(official).not.toMatch(/DEMO/i);
  });

  it('never presents legacy USD demo amounts as NGN', () => {
    for (const amount of [500, 1200, 2400]) {
      const text = formatPaymentAmount(amount, 'USD');
      expect(text).toContain('$');
      expect(text).toMatch(/USD/);
      expect(text).toMatch(/DEMO/i);
      expect(text).not.toContain('\u20A6');
    }
  });

  it('falls back safely when NGN kobo metadata is missing or fractional', () => {
    const withoutKobo = formatPaymentAmount(2400000, 'NGN');
    expect(withoutKobo).toContain('\u20A6');
    const fractional = formatPaymentAmount(2400000, 'NGN', 150 as any);
    expect(fractional).toContain('\u20A6');
  });
});
