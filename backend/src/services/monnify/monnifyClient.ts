import crypto from 'crypto';
import { assertMonnifyUsable, getMonnifyConfig, type MonnifyConfig } from './monnifyConfig.js';
import { koboToNaira } from './pricing.js';

export class MonnifyError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.name = 'MonnifyError';
    this.status = status;
    this.body = body ? body.slice(0, 500) : undefined;
  }
}

type FetchFn = (url: string, init?: any) => Promise<any>;

interface TokenCache { token: string; expiresAtMs: number; }
interface CacheHolder { current: TokenCache | null; inFlight: Promise<string> | null; }

export interface InitTransactionResult { transactionReference: string; paymentReference: string; raw: any; }
export interface DynamicAccountResult {
  transactionReference: string; accountNumber: string; accountName: string;
  bankName: string; bankCode?: string; expiresOn?: string; amount: number; raw: any;
}
export interface QueryResult {
  paymentReference: string; transactionReference?: string;
  paymentStatus: string; amountPaid: number; totalPayable: number;
  currency: string; paymentMethod?: string; paymentSourceInformation?: any; paidOn?: string; raw: any;
}

const globalTokenCache: CacheHolder = { current: null, inFlight: null };

export function clearMonnifyTokenCache() { globalTokenCache.current = null; globalTokenCache.inFlight = null; }

function pick<T = any>(obj: any, ...keys: string[]): T | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k] as T;
    const lower = Object.keys(obj).find((x) => x.toLowerCase() === k.toLowerCase());
    if (lower && obj[lower] !== undefined && obj[lower] !== null) return obj[lower] as T;
  }
  return undefined;
}

async function readJsonSafe(res: any): Promise<any> {
  try { return await res.json(); } catch { return {}; }
}

function errorMessage(body: any, fallback: string): string {
  const m = pick<string>(body, 'responseMessage', 'message', 'error', 'errorMessage')
    ?? pick<any>(body, 'responseBody');
  if (typeof m === 'string' && m.trim()) return m.trim().slice(0, 300);
  return fallback;
}

export class MonnifyClient {
  private fetchFn: FetchFn;
  private nowFn: () => number;
  private cache: CacheHolder;

  constructor(opts: { fetchFn?: FetchFn; nowFn?: () => number; sharedCache?: boolean } = {}) {
    const g: any = globalThis;
    this.fetchFn = opts.fetchFn ?? g.fetch?.bind(g) ?? ((() => { throw new Error('No fetch implementation available.'); }) as FetchFn);
    this.nowFn = opts.nowFn ?? (() => Date.now());
    this.cache = opts.sharedCache === false ? { current: null, inFlight: null } : globalTokenCache;
  }

  private cfg(override?: MonnifyConfig): MonnifyConfig { return assertMonnifyUsable(override ?? getMonnifyConfig()); }

  private async fetchWithTimeout(url: string, init: any, timeoutMs = 15000): Promise<any> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchFn(url, { ...init, signal: controller.signal });
    } catch (err: any) {
      if (err?.name === 'AbortError') throw new MonnifyError('Monnify request timed out.');
      throw new MonnifyError(`Monnify request failed: ${err?.message || 'network error'}`);
    } finally { clearTimeout(t); }
  }

  private invalidateOnAuthFailure(status?: number): void {
    if (status === 401) this.cache.current = null;
  }

  private async login(cfg: MonnifyConfig): Promise<string> {
    const basic = Buffer.from(`${cfg.apiKey}:${cfg.secretKey}`).toString('base64');
    const res = await this.fetchWithTimeout(`${cfg.baseUrl}/api/v1/auth/login`, {
      method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' }, body: '{}',
    });
    const body = await readJsonSafe(res);
    if (!res.ok) {
      this.invalidateOnAuthFailure(res.status);
      throw new MonnifyError(errorMessage(body, 'Monnify authentication failed.'), res.status, JSON.stringify(body));
    }
    const data = pick<any>(body, 'responseBody', 'data') ?? body;
    const token = pick<string>(data, 'accessToken', 'access_token', 'token');
    const expiresIn = Number(pick<any>(data, 'expiresIn', 'expires_in') ?? 0);
    if (!token) throw new MonnifyError('Monnify authentication returned no access token.', res.status);
    this.cache.current = { token, expiresAtMs: this.nowFn() + (expiresIn > 0 ? expiresIn * 1000 : 3600 * 1000) };
    return token;
  }

  async getAccessToken(cfgOverride?: MonnifyConfig): Promise<string> {
    const cfg = this.cfg(cfgOverride);
    const cached = this.cache.current;
    if (cached && cached.expiresAtMs - 60000 > this.nowFn()) return cached.token;
    if (this.cache.inFlight) return this.cache.inFlight;
    const pending = this.login(cfg);
    this.cache.inFlight = pending;
    try {
      return await pending;
    } finally {
      if (this.cache.inFlight === pending) this.cache.inFlight = null;
    }
  }

  async initTransaction(args: {
    amountKobo: number; paymentReference: string; customerName: string; customerEmail: string;
    paymentDescription?: string; redirectUrl?: string; cfgOverride?: MonnifyConfig;
  }): Promise<InitTransactionResult> {
    const cfg = this.cfg(args.cfgOverride);
    const amountNaira = koboToNaira(args.amountKobo);
    if (!Number.isInteger(amountNaira) || amountNaira <= 0) throw new Error('Amount must be a positive whole naira value.');
    const token = await this.getAccessToken(cfg);
    const payload = {
      amount: amountNaira, currencyCode: 'NGN', paymentReference: args.paymentReference,
      contractCode: cfg.contractCode, customerName: args.customerName, customerEmail: args.customerEmail,
      paymentDescription: args.paymentDescription || `HostelOS accommodation charge per academic session (${args.paymentReference})`,
      paymentMethods: ['ACCOUNT_TRANSFER'],
      ...(args.redirectUrl ? { redirectUrl: args.redirectUrl } : {}),
    };
    const res = await this.fetchWithTimeout(`${cfg.baseUrl}/api/v1/merchant/transactions/init-transaction`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await readJsonSafe(res);
    if (!res.ok) {
      this.invalidateOnAuthFailure(res.status);
      throw new MonnifyError(errorMessage(body, 'Transaction initialization failed.'), res.status, JSON.stringify(body));
    }
    const data = pick<any>(body, 'responseBody', 'data') ?? body;
    const transactionReference = pick<string>(data, 'transactionReference', 'transaction_reference');
    if (!transactionReference) throw new MonnifyError('Init-transaction returned no transactionReference.', res.status);
    return { transactionReference, paymentReference: args.paymentReference, raw: body };
  }

  async initDynamicAccount(args: { transactionReference: string; bankCode?: string; cfgOverride?: MonnifyConfig }): Promise<DynamicAccountResult> {
    const cfg = this.cfg(args.cfgOverride);
    const token = await this.getAccessToken(cfg);
    const payload: any = { transactionReference: args.transactionReference };
    if (args.bankCode) payload.bankCode = args.bankCode;
    const res = await this.fetchWithTimeout(`${cfg.baseUrl}/api/v1/merchant/bank-transfer/init-payment`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const body = await readJsonSafe(res);
    if (!res.ok) {
      this.invalidateOnAuthFailure(res.status);
      throw new MonnifyError(errorMessage(body, 'Dynamic account initialization failed.'), res.status, JSON.stringify(body));
    }
    const data = pick<any>(body, 'responseBody', 'data') ?? body;
    const accountNumber = pick<string>(data, 'accountNumber', 'account_number');
    const accountName = pick<string>(data, 'accountName', 'account_name') || 'Monnify virtual account';
    const bankName = pick<string>(data, 'bankName', 'bank_name') || 'Monnify partner bank';
    if (!accountNumber) throw new MonnifyError('init-payment returned no accountNumber.', res.status);
    return {
      transactionReference: args.transactionReference, accountNumber, accountName, bankName,
      bankCode: pick<string>(data, 'bankCode', 'bank_code'),
      expiresOn: pick<string>(data, 'expiryDate', 'expiresOn', 'expiry_date', 'accountExpiration'),
      amount: Number(pick<any>(data, 'amount', 'totalPayable', 'total_payable') ?? 0) || 0,
      raw: body,
    };
  }

  async queryByPaymentReference(paymentReference: string, cfgOverride?: MonnifyConfig): Promise<QueryResult> {
    return this.query('paymentReference', paymentReference, cfgOverride);
  }

  async queryByTransactionReference(transactionReference: string, cfgOverride?: MonnifyConfig): Promise<QueryResult> {
    return this.query('transactionReference', transactionReference, cfgOverride);
  }

  private async query(kind: 'paymentReference' | 'transactionReference', value: string, cfgOverride?: MonnifyConfig): Promise<QueryResult> {
    const cfg = this.cfg(cfgOverride);
    const token = await this.getAccessToken(cfg);
    const url = `${cfg.baseUrl}/api/v2/merchant/transactions/query?${kind}=${encodeURIComponent(value)}`;
    const res = await this.fetchWithTimeout(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    const body = await readJsonSafe(res);
    if (!res.ok) {
      this.invalidateOnAuthFailure(res.status);
      throw new MonnifyError(errorMessage(body, 'Transaction query failed.'), res.status, JSON.stringify(body));
    }
    const data = pick<any>(body, 'responseBody', 'data') ?? body;
    const status = String(pick<any>(data, 'paymentStatus', 'payment_status', 'status') ?? 'UNKNOWN').toUpperCase();
    return {
      paymentReference: String(pick<any>(data, 'paymentReference', 'payment_reference') ?? value),
      transactionReference: pick<string>(data, 'transactionReference', 'transaction_reference'),
      paymentStatus: status,
      amountPaid: Number(pick<any>(data, 'amountPaid', 'amount_paid', 'settlementAmount', 'amount') ?? 0) || 0,
      totalPayable: Number(pick<any>(data, 'totalPayable', 'total_payable', 'amount') ?? 0) || 0,
      currency: String(pick<any>(data, 'currencyCode', 'currency_code', 'currency') ?? 'NGN').toUpperCase(),
      paymentMethod: pick<string>(data, 'paymentMethod', 'payment_method', 'paymentChannel', 'channel'),
      paymentSourceInformation: pick<any>(data, 'paymentSourceInformation', 'payment_source', 'source'),
      paidOn: pick<string>(data, 'paidOn', 'paid_on', 'completedOn'),
      raw: body,
    };
  }

  /** Live webhook signature: HMAC-SHA512(secretKey, rawBody), compared timing-safe. */
  static verifyWebhookSignature(rawBody: Buffer | string, signature: string | undefined, secretKey: string): boolean {
    if (!signature) return false;
    const buf = typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
    const expected = crypto.createHmac('sha512', secretKey).update(buf).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(signature).trim(), 'utf8');
    if (a.length !== b.length) return false;
    try { return crypto.timingSafeEqual(a, b); } catch { return false; }
  }
}
