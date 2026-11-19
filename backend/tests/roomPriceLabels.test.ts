import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const readPage = (name: string) =>
  fs.readFileSync(path.join(__dirname, '../../frontend/src/pages', name), 'utf8');

describe('manager room-price NGN labels', () => {
  const hostel = readPage('HostelFacilityPage.tsx');
  const rooms = readPage('RoomsInventoryPage.tsx');

  it('both pages use the NGN/session header', () => {
    for (const [label, src] of [['HostelFacilityPage', hostel], ['RoomsInventoryPage', rooms]] as const) {
      expect(src, label).toContain('Price / Resident / Session (NGN)');
      expect(src, label).not.toContain('Price / Student (DEMO)');
    }
  });

  it('no $ / year pricing label remains', () => {
    for (const [label, src] of [['HostelFacilityPage', hostel], ['RoomsInventoryPage', rooms]] as const) {
      expect(src, label).not.toContain('$ / year');
      expect(src, label).not.toContain('($ / year)');
    }
  });

  it('no DEMO price headers or buttons remain on these pages', () => {
    for (const [label, src] of [['HostelFacilityPage', hostel], ['RoomsInventoryPage', rooms]] as const) {
      expect(src, label).not.toContain('Save Price (DEMO)');
      expect(src, label).not.toContain('Update Price (DEMO)');
      expect(src, label).not.toContain('DEMO Label:');
    }
  });

  it('HostelFacility shows the official schedule notice and NGN modal label', () => {
    expect(hostel).toContain('Official accommodation charges are determined by the capacity-based pricing schedule');
    expect(hostel).toContain('does not override official booking charges');
    expect(hostel).toContain('Price Per Resident');
    expect(hostel).toContain('Academic Session');
  });

  it('historical USD formatting remains supported', async () => {
    const { formatPaymentAmount } = await import('../src/services/monnify/pricing.js');
    expect(formatPaymentAmount(1200, 'USD')).toMatch(/\$.*USD.*DEMO/);
    expect(formatPaymentAmount(2400000, 'NGN', 240000000)).toContain('₦');
  });
});
