import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import { SANDBOX_BASE_URL } from '../src/services/monnify/monnifyConfig.js';
import { MonnifyClient, MonnifyError, clearMonnifyTokenCache } from '../src/services/monnify/monnifyClient.js';

const SYNTH_SECRET = 'SYNTH_WEBHOOK_SECRET_KEY';
const SYNTH_CFG = {
  enabled: true as const,
  mode: 'sandbox' as const,
  baseUrl: SANDBOX_BASE_URL,
  apiKey: 'SYNTH_API_KEY',
  secretKey: 'SYNTH_SECRET_KEY',
  contractCode: 'SYNTH_CONTRACT',
};

function sign(payload: string | Buffer): string {
  const buf = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  return crypto.createHmac('sha512', SYNTH_SECRET).update(buf).digest('hex');
}

function authSuccess(token: string, expiresIn = 3600) {
  return { ok: true, status: 200, json: async () => ({ responseBody: { accessToken: token, expiresIn } }) };
}

function errRes(status: number, message = 'boom') {
  return { ok: false, status, json: async () => ({ responseMessage: message }) };
}

function okInitTx(transactionReference = 'SYNTH-TX-1') {
  return { ok: true, status: 200, json: async () => ({ responseBody: { transactionReference } }) };
}

function okDynamic() {
  return {
    ok: true, status: 200,
    json: async () => ({
      responseBody: {
        accountNumber: '5123456789', accountName: 'SYNTH ACCOUNT', bankName: 'SYNTH BANK',
        bankCode: '035', expiryDate: '2030-01-01 00:00:00', amount: 2400000,
      },
    }),
  };
}

function okQuery() {
  return {
    ok: true, status: 200,
    json: async () => ({
      responseBody: {
        paymentReference: 'SYNTH-REF-1', transactionReference: 'SYNTH-TX-1',
        paymentStatus: 'PAID', amountPaid: 2400000, totalPayable: 2400000, currencyCode: 'NGN',
      },
    }),
  };
}

describe('monnify webhook signature', () => {
  const payload = JSON.stringify({ paymentReference: 'SYNTH-REF-001', amountPaid: 2400000 });

  it('accepts a valid HMAC-SHA512 signature', () => {
    expect(MonnifyClient.verifyWebhookSignature(payload, sign(payload), SYNTH_SECRET)).toBe(true);
  });

  it('accepts a valid signature for a Buffer payload', () => {
    const buf = Buffer.from(payload, 'utf8');
    expect(MonnifyClient.verifyWebhookSignature(buf, sign(buf), SYNTH_SECRET)).toBe(true);
  });

  it('rejects an invalid signature', () => {
    const bad = sign(payload).slice(0, -1) + (sign(payload).endsWith('0') ? '1' : '0');
    expect(MonnifyClient.verifyWebhookSignature(payload, bad, SYNTH_SECRET)).toBe(false);
  });

  it('rejects a missing signature', () => {
    expect(MonnifyClient.verifyWebhookSignature(payload, undefined, SYNTH_SECRET)).toBe(false);
    expect(MonnifyClient.verifyWebhookSignature(payload, '', SYNTH_SECRET)).toBe(false);
  });

  it('rejects a malformed signature', () => {
    expect(MonnifyClient.verifyWebhookSignature(payload, 'not-hex!!', SYNTH_SECRET)).toBe(false);
    expect(MonnifyClient.verifyWebhookSignature(payload, 'abc', SYNTH_SECRET)).toBe(false);
  });

  it('rejects an empty payload signed with a different body', () => {
    const otherSignature = sign('different-body');
    expect(MonnifyClient.verifyWebhookSignature('', otherSignature, SYNTH_SECRET)).toBe(false);
    expect(MonnifyClient.verifyWebhookSignature(payload, sign(''), SYNTH_SECRET)).toBe(false);
  });

  it('rejects a valid signature applied to a different payload', () => {
    const original = JSON.stringify({ paymentReference: 'SYNTH-REF-001', amountPaid: 2400000 });
    const tampered = JSON.stringify({ paymentReference: 'SYNTH-REF-001', amountPaid: 1 });
    expect(MonnifyClient.verifyWebhookSignature(tampered, sign(original), SYNTH_SECRET)).toBe(false);
  });
});

describe('monnify token cache and authentication (mocked network)', () => {
  it('caches the access token and avoids a second login call', async () => {
    clearMonnifyTokenCache();
    const fetchFn = vi.fn(async () => authSuccess('SYNTH_TOKEN_A'));
    const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
    await expect(client.getAccessToken(SYNTH_CFG)).resolves.toBe('SYNTH_TOKEN_A');
    await expect(client.getAccessToken(SYNTH_CFG)).resolves.toBe('SYNTH_TOKEN_A');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toContain('/api/v1/auth/login');
  });

  it('refetches after the cached token expires', async () => {
    let now = 1_000_000;
    const fetchFn = vi.fn(async () => authSuccess('SYNTH_TOKEN_B', 120));
    const client = new MonnifyClient({ fetchFn: fetchFn as any, nowFn: () => now, sharedCache: false });
    await expect(client.getAccessToken(SYNTH_CFG)).resolves.toBe('SYNTH_TOKEN_B');
    now += 121_000;
    (fetchFn as any).mockResolvedValueOnce(authSuccess('SYNTH_TOKEN_C', 120));
    await expect(client.getAccessToken(SYNTH_CFG)).resolves.toBe('SYNTH_TOKEN_C');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('fails closed without calling the network when the integration is disabled', async () => {
    const fetchFn = vi.fn(async () => authSuccess('SHOULD_NOT_BE_USED'));
    const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
    await expect(client.getAccessToken({ ...SYNTH_CFG, enabled: false })).rejects.toThrow(/disabled/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('dedupes concurrent login attempts into a single network call', async () => {
    let calls = 0;
    const fetchFn = vi.fn(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return authSuccess('SYNTH_TOKEN_CONCURRENT');
    });
    const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
    const results = await Promise.all([
      client.getAccessToken(SYNTH_CFG),
      client.getAccessToken(SYNTH_CFG),
      client.getAccessToken(SYNTH_CFG),
      client.getAccessToken(SYNTH_CFG),
    ]);
    expect(results).toEqual([
      'SYNTH_TOKEN_CONCURRENT', 'SYNTH_TOKEN_CONCURRENT',
      'SYNTH_TOKEN_CONCURRENT', 'SYNTH_TOKEN_CONCURRENT',
    ]);
    expect(calls).toBe(1);
  });

  it('does not cache anything when login returns 401 and recovers on the next login', async () => {
    let attempt = 0;
    const fetchFn = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) return errRes(401, 'Unauthorized');
      return authSuccess('SYNTH_TOKEN_RECOVERED');
    });
    const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
    await expect(client.getAccessToken(SYNTH_CFG)).rejects.toMatchObject({ status: 401 });
    await expect(client.getAccessToken(SYNTH_CFG)).resolves.toBe('SYNTH_TOKEN_RECOVERED');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('monnify init-transaction kobo boundary (mocked network)', () => {
  const baseArgs = {
    paymentReference: 'SYNTH-REF-KOBO-1',
    customerName: 'Synth User',
    customerEmail: 'synth@example.invalid',
    cfgOverride: SYNTH_CFG,
  };

  it.each([
    [240000000, 2400000],
    [120000000, 1200000],
    [80000000, 800000],
  ])('serializes %i kobo as %i NGN (never kobo-as-naira)', async (kobo, expectedNaira) => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/auth/login')) return authSuccess('SYNTH_TOKEN_X');
      return okInitTx('SYNTH-TX-KOBO');
    });
    const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
    const res = await client.initTransaction({ ...baseArgs, amountKobo: kobo });
    expect(res.transactionReference).toBe('SYNTH-TX-KOBO');
    const initCall = fetchFn.mock.calls.find(([u]) => String(u).includes('/init-transaction'));
    expect(initCall).toBeDefined();
    const sent = JSON.parse(initCall![1].body);
    expect(sent.amount).toBe(expectedNaira);
    expect(sent.currencyCode).toBe('NGN');
    expect(sent.amount).not.toBe(kobo);
    expect(sent.paymentReference).toBe(baseArgs.paymentReference);
    expect(sent.contractCode).toBe(SYNTH_CFG.contractCode);
  });

  it('rejects fractional, zero and negative kobo without network calls', async () => {
    const fetchFn = vi.fn(async () => authSuccess('UNUSED'));
    const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
    await expect(client.initTransaction({ ...baseArgs, amountKobo: 150 })).rejects.toThrow();
    await expect(client.initTransaction({ ...baseArgs, amountKobo: 0 })).rejects.toThrow();
    await expect(client.initTransaction({ ...baseArgs, amountKobo: -100 })).rejects.toThrow();
    await expect(client.initTransaction({ ...baseArgs, amountKobo: 100.5 as any })).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('uses POST with Bearer auth and the documented init-transaction URL', async () => {
    const fetchFn = vi.fn(async (url: string, init: any) => {
      if (url.includes('/api/v1/auth/login')) {
        expect(init.method).toBe('POST');
        expect(String(init.headers.Authorization)).toMatch(/^Basic /);
        return authSuccess('SYNTH_TOKEN_AUTHZ');
      }
      expect(url).toBe(`${SANDBOX_BASE_URL}/api/v1/merchant/transactions/init-transaction`);
      expect(init.method).toBe('POST');
      expect(init.headers.Authorization).toBe('Bearer SYNTH_TOKEN_AUTHZ');
      expect(init.headers['Content-Type']).toBe('application/json');
      return okInitTx('SYNTH-TX-AUTHZ');
    });
    const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
    await client.initTransaction({ ...baseArgs, amountKobo: 80000000 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('invalidates the token on init-transaction 401 and does not retry the POST', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/auth/login')) return authSuccess('SYNTH_TOKEN_T1');
      return errRes(401, 'Unauthorized');
    });
    const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
    await expect(client.initTransaction({ ...baseArgs, amountKobo: 80000000 })).rejects.toMatchObject({ status: 401 });
    // Exactly 1 login + 1 init; no automatic retry of the transaction-creation POST.
    expect(fetchFn).toHaveBeenCalledTimes(2);
    // Next operation must fetch a fresh token.
    (fetchFn as any).mockImplementation(async (url: string) => {
      if (url.includes('/api/v1/auth/login')) return authSuccess('SYNTH_TOKEN_T2');
      return okInitTx('SYNTH-TX-RETRY');
    });
    const res = await client.initTransaction({ ...baseArgs, paymentReference: 'SYNTH-REF-KOBO-2', amountKobo: 80000000 });
    expect(res.transactionReference).toBe('SYNTH-TX-RETRY');
    const logins = fetchFn.mock.calls.filter(([u]) => String(u).includes('/api/v1/auth/login'));
    expect(logins.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the cached token on init-transaction 400 validation errors', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/auth/login')) return authSuccess('SYNTH_TOKEN_KEEP');
      return errRes(400, 'Invalid payment reference');
    });
    const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
    await expect(client.initTransaction({ ...baseArgs, amountKobo: 80000000 })).rejects.toMatchObject({ status: 400 });
    await expect(client.getAccessToken(SYNTH_CFG)).resolves.toBe('SYNTH_TOKEN_KEEP');
    expect(fetchFn.mock.calls.filter(([u]) => String(u).includes('/api/v1/auth/login'))).toHaveLength(1);
  });

  it('keeps the cached token on init-transaction 500 responses', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/auth/login')) return authSuccess('SYNTH_TOKEN_KEEP500');
      return errRes(500, 'Server error');
    });
    const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
    await expect(client.initTransaction({ ...baseArgs, amountKobo: 80000000 })).rejects.toMatchObject({ status: 500 });
    await expect(client.getAccessToken(SYNTH_CFG)).resolves.toBe('SYNTH_TOKEN_KEEP500');
    expect(fetchFn.mock.calls.filter(([u]) => String(u).includes('/api/v1/auth/login'))).toHaveLength(1);
  });

  it('never leaks the bearer token into thrown errors', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/auth/login')) return authSuccess('SYNTH_SUPER_SECRET_TOKEN_XYZ');
      return errRes(401, 'Unauthorized');
    });
    const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
    const err = await client.initTransaction({ ...baseArgs, amountKobo: 80000000 }).catch((e) => e);
    expect(err).toBeInstanceOf(MonnifyError);
    expect(JSON.stringify(err)).not.toContain('SYNTH_SUPER_SECRET_TOKEN_XYZ');
    expect(String(err.body ?? '')).not.toContain('SYNTH_SUPER_SECRET_TOKEN_XYZ');
  });
});

describe('monnify dynamic account + query (mocked network)', () => {
  it('posts transactionReference to the documented init-payment URL', async () => {
    const fetchFn = vi.fn(async (url: string, init: any) => {
      if (url.includes('/api/v1/auth/login')) return authSuccess('SYNTH_TOKEN_D');
      expect(url).toBe(`${SANDBOX_BASE_URL}/api/v1/merchant/bank-transfer/init-payment`);
      expect(init.method).toBe('POST');
      const sent = JSON.parse(init.body);
      expect(sent.transactionReference).toBe('SYNTH-TX-9');
      return okDynamic();
    });
    const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
    const res = await client.initDynamicAccount({ transactionReference: 'SYNTH-TX-9', cfgOverride: SYNTH_CFG });
    expect(res.accountNumber).toBe('5123456789');
    expect(res.transactionReference).toBe('SYNTH-TX-9');
  });

  it('invalidates the token on dynamic-account 401 without retrying the POST', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/auth/login')) return authSuccess('SYNTH_TOKEN_D1');
      return errRes(401, 'Unauthorized');
    });
    const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
    await expect(
      client.initDynamicAccount({ transactionReference: 'SYNTH-TX-9', cfgOverride: SYNTH_CFG }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    (fetchFn as any).mockImplementation(async (url: string) => {
      if (url.includes('/api/v1/auth/login')) return authSuccess('SYNTH_TOKEN_D2');
      return okDynamic();
    });
    await expect(client.getAccessToken(SYNTH_CFG)).resolves.toBe('SYNTH_TOKEN_D2');
  });

  it('keeps the cached token on dynamic-account 400/500', async () => {
    for (const status of [400, 500]) {
      const fetchFn = vi.fn(async (url: string) => {
        if (url.includes('/api/v1/auth/login')) return authSuccess(`SYNTH_TOKEN_KEEP_${status}`);
        return errRes(status, 'transient');
      });
      const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
      await expect(
        client.initDynamicAccount({ transactionReference: 'SYNTH-TX-9', cfgOverride: SYNTH_CFG }),
      ).rejects.toMatchObject({ status });
      await expect(client.getAccessToken(SYNTH_CFG)).resolves.toBe(`SYNTH_TOKEN_KEEP_${status}`);
      expect(fetchFn.mock.calls.filter(([u]) => String(u).includes('/api/v1/auth/login'))).toHaveLength(1);
    }
  });

  it('queries by payment reference with GET, Bearer auth and encoded params', async () => {
    const fetchFn = vi.fn(async (url: string, init: any) => {
      if (url.includes('/api/v1/auth/login')) return authSuccess('SYNTH_TOKEN_Q');
      expect(init.method).toBe('GET');
      expect(init.headers.Authorization).toBe('Bearer SYNTH_TOKEN_Q');
      expect(url).toContain('/api/v2/merchant/transactions/query?paymentReference=');
      expect(url).toContain(encodeURIComponent('SYNTH REF/001'));
      return okQuery();
    });
    const client = new MonnifyClient({ fetchFn: fetchFn as any, sharedCache: false });
    const res = await client.queryByPaymentReference('SYNTH REF/001', SYNTH_CFG);
    expect(res.paymentStatus).toBe('PAID');
  });

  it('invalidates the token on query 401 and keeps it on 400/500', async () => {
    const mk = (token: string, status: number) =>
      vi.fn(async (url: string) => {
        if (url.includes('/api/v1/auth/login')) return authSuccess(token);
        return errRes(status, status === 401 ? 'Unauthorized' : 'other');
      });
    let loginCount = 0;
    const seqFetch = vi.fn(async (url: string) => {
      if (url.includes('/api/v1/auth/login')) {
        loginCount += 1;
        return authSuccess(loginCount === 1 ? 'T401_OLD' : 'T401_FRESH');
      }
      if (loginCount === 1) return errRes(401, 'Unauthorized');
      return okQuery();
    });
    const c401 = new MonnifyClient({ fetchFn: seqFetch as any, sharedCache: false });
    await expect(c401.queryByPaymentReference('R1', SYNTH_CFG)).rejects.toMatchObject({ status: 401 });
    await expect(c401.getAccessToken(SYNTH_CFG)).resolves.toBe('T401_FRESH');

    for (const status of [400, 500]) {
      const f = mk(`TKEEP${status}`, status);
      const c = new MonnifyClient({ fetchFn: f as any, sharedCache: false });
      await expect(c.queryByPaymentReference('R1', SYNTH_CFG)).rejects.toMatchObject({ status });
      await expect(c.getAccessToken(SYNTH_CFG)).resolves.toBe(`TKEEP${status}`);
      expect(f.mock.calls.filter(([u]: any) => String(u).includes('/api/v1/auth/login'))).toHaveLength(1);
    }
  });
});
