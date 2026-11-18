import { describe, expect, it } from 'vitest';
import {
  DOCUMENTED_MONNIFY_WEBHOOK_IP,
  LIVE_BASE_URL,
  SANDBOX_BASE_URL,
  assertMonnifyUsable,
  getMonnifyConfig,
  getWebhookIpAllowlist,
  isLive,
  isSandbox,
  isWebhookSourceAllowed,
} from '../src/services/monnify/monnifyConfig.js';

// Synthetic-only fixtures. No test reads the real root .env: every case
// passes an explicit env object. process.env is only touched inside the
// single isolation test below (with save/restore).
const SYNTH = {
  MONNIFY_ENABLED: 'true',
  MONNIFY_MODE: 'sandbox',
  MONNIFY_BASE_URL: SANDBOX_BASE_URL,
  MONNIFY_API_KEY: 'SYNTH_API_KEY',
  MONNIFY_SECRET_KEY: 'SYNTH_SECRET_KEY',
  MONNIFY_CONTRACT_CODE: 'SYNTH_CONTRACT',
};

const LIVE_SYNTH = {
  MONNIFY_ENABLED: 'true',
  MONNIFY_MODE: 'live',
  MONNIFY_BASE_URL: LIVE_BASE_URL,
  MONNIFY_API_KEY: 'SYNTH_LIVE_KEY',
  MONNIFY_SECRET_KEY: 'SYNTH_LIVE_SECRET',
  MONNIFY_CONTRACT_CODE: 'SYNTH_LIVE_CONTRACT',
};

describe('monnifyConfig sandbox', () => {
  it('parses an enabled sandbox configuration from the supplied env object', () => {
    const cfg = getMonnifyConfig({ ...SYNTH });
    expect(cfg.enabled).toBe(true);
    expect(cfg.mode).toBe('sandbox');
    expect(cfg.baseUrl).toBe(SANDBOX_BASE_URL);
    expect(() => assertMonnifyUsable(cfg, { nodeEnv: 'test' })).not.toThrow();
  });

  it('recognises the correct sandbox base URL only', () => {
    expect(isSandbox(getMonnifyConfig({ ...SYNTH }))).toBe(true);
    const wrong = getMonnifyConfig({ ...SYNTH, MONNIFY_BASE_URL: 'https://example.invalid' });
    expect(isSandbox(wrong)).toBe(false);
    expect(() => assertMonnifyUsable(wrong, { nodeEnv: 'test' })).toThrow(/sandbox mode must use/i);
  });

  it('rejects sandbox credentials that are missing', () => {
    expect(() =>
      assertMonnifyUsable(getMonnifyConfig({ ...SYNTH, MONNIFY_API_KEY: '' }), { nodeEnv: 'test' }),
    ).toThrow(/credentials are incomplete/i);
    expect(() =>
      assertMonnifyUsable(getMonnifyConfig({ ...SYNTH, MONNIFY_SECRET_KEY: '   ' }), { nodeEnv: 'test' }),
    ).toThrow(/credentials are incomplete/i);
    expect(() =>
      assertMonnifyUsable(getMonnifyConfig({ ...SYNTH, MONNIFY_CONTRACT_CODE: '' }), { nodeEnv: 'test' }),
    ).toThrow(/credentials are incomplete/i);
  });

  it('refuses sandbox mode in production via injectable nodeEnv', () => {
    const cfg = getMonnifyConfig({ ...SYNTH });
    expect(() => assertMonnifyUsable(cfg, { nodeEnv: 'production' })).toThrow(
      /must not be enabled in production/i,
    );
    expect(() => assertMonnifyUsable(cfg, { nodeEnv: 'test' })).not.toThrow();
  });
});

describe('monnifyConfig explicit-env control (defect 1)', () => {
  it('lets the supplied environment object fully control configuration', () => {
    const cfg = getMonnifyConfig({ ...SYNTH });
    expect(cfg).toEqual({
      enabled: true,
      mode: 'sandbox',
      baseUrl: SANDBOX_BASE_URL,
      apiKey: 'SYNTH_API_KEY',
      secretKey: 'SYNTH_SECRET_KEY',
      contractCode: 'SYNTH_CONTRACT',
    });
    const disabled = getMonnifyConfig({ ...SYNTH, MONNIFY_ENABLED: 'false' });
    expect(disabled.enabled).toBe(false);
    expect(() => assertMonnifyUsable(disabled, { nodeEnv: 'test' })).toThrow(/disabled/i);
  });

  it('ignores process.env when an explicit env object is supplied', () => {
    const savedEnabled = process.env.MONNIFY_ENABLED;
    const savedMode = process.env.MONNIFY_MODE;
    const savedKey = process.env.MONNIFY_API_KEY;
    process.env.MONNIFY_ENABLED = 'false';
    process.env.MONNIFY_MODE = 'live';
    process.env.MONNIFY_API_KEY = 'REAL_ENV_SHOULD_BE_IGNORED';
    try {
      const cfg = getMonnifyConfig({ ...SYNTH });
      expect(cfg.enabled).toBe(true);
      expect(cfg.mode).toBe('sandbox');
      expect(cfg.apiKey).toBe('SYNTH_API_KEY');
    } finally {
      if (savedEnabled === undefined) delete process.env.MONNIFY_ENABLED;
      else process.env.MONNIFY_ENABLED = savedEnabled;
      if (savedMode === undefined) delete process.env.MONNIFY_MODE;
      else process.env.MONNIFY_MODE = savedMode;
      if (savedKey === undefined) delete process.env.MONNIFY_API_KEY;
      else process.env.MONNIFY_API_KEY = savedKey;
    }
  });

  it('reads MONNIFY_ENABLED from the supplied env, not process.env', () => {
    expect(getMonnifyConfig({ ...SYNTH, MONNIFY_ENABLED: 'true' }).enabled).toBe(true);
    expect(getMonnifyConfig({ ...SYNTH, MONNIFY_ENABLED: 'false' }).enabled).toBe(false);
    expect(getMonnifyConfig({ ...SYNTH, MONNIFY_ENABLED: '  TRUE  ' }).enabled).toBe(true);
    expect(getMonnifyConfig({ ...SYNTH, MONNIFY_ENABLED: '' }).enabled).toBe(false);
  });
});

describe('monnifyConfig disabled and invalid mode', () => {
  it('treats a missing mode as disabled and fails closed', () => {
    const cfg = getMonnifyConfig({
      MONNIFY_ENABLED: 'true',
      MONNIFY_BASE_URL: SANDBOX_BASE_URL,
      MONNIFY_API_KEY: 'SYNTH_API_KEY',
      MONNIFY_SECRET_KEY: 'SYNTH_SECRET_KEY',
      MONNIFY_CONTRACT_CODE: 'SYNTH_CONTRACT',
    });
    expect(cfg.mode).toBe('disabled');
    expect(() => assertMonnifyUsable(cfg, { nodeEnv: 'test' })).toThrow(/sandbox or live/i);
  });

  it('rejects an unrecognised mode value', () => {
    const cfg = getMonnifyConfig({ ...SYNTH, MONNIFY_MODE: 'staging' });
    expect(cfg.mode).toBe('disabled');
    expect(() => assertMonnifyUsable(cfg, { nodeEnv: 'test' })).toThrow(/sandbox or live/i);
  });

  it('fails closed when the integration is not enabled', () => {
    const cfg = getMonnifyConfig({ ...SYNTH, MONNIFY_ENABLED: 'false' });
    expect(cfg.enabled).toBe(false);
    expect(() => assertMonnifyUsable(cfg, { nodeEnv: 'test' })).toThrow(/disabled/i);
  });

  it('parses the webhook IP allowlist', () => {
    expect(getWebhookIpAllowlist({})).toEqual([]);
    expect(getWebhookIpAllowlist({ MONNIFY_WEBHOOK_IP_ALLOWLIST: '  ' })).toEqual([]);
    expect(getWebhookIpAllowlist({ MONNIFY_WEBHOOK_IP_ALLOWLIST: ' 10.0.0.1,10.0.0.2 ,, ' })).toEqual([
      '10.0.0.1',
      '10.0.0.2',
    ]);
  });
});

describe('monnifyConfig live guards', () => {
  it('accepts a well-formed live configuration outside production', () => {
    const cfg = getMonnifyConfig({ ...LIVE_SYNTH });
    expect(cfg.mode).toBe('live');
    expect(isLive(cfg)).toBe(true);
    expect(isSandbox(cfg)).toBe(false);
    expect(() => assertMonnifyUsable(cfg, { nodeEnv: 'test' })).not.toThrow();
  });

  it('rejects a live mode with the wrong base URL', () => {
    const cfg = getMonnifyConfig({ ...LIVE_SYNTH, MONNIFY_BASE_URL: SANDBOX_BASE_URL });
    expect(isLive(cfg)).toBe(false);
    expect(() => assertMonnifyUsable(cfg, { nodeEnv: 'test' })).toThrow(/approved monnify live base url/i);
  });

  it('fails closed when live credentials are missing', () => {
    expect(() =>
      assertMonnifyUsable(getMonnifyConfig({ ...LIVE_SYNTH, MONNIFY_SECRET_KEY: '' }), { nodeEnv: 'test' }),
    ).toThrow(/credentials are incomplete/i);
  });
});

describe('monnifyConfig webhook source', () => {
  it('documents the Monnify webhook IP', () => {
    expect(DOCUMENTED_MONNIFY_WEBHOOK_IP).toBe('35.242.133.146');
  });

  it('allows everything when no allowlist is configured', () => {
    expect(isWebhookSourceAllowed('35.242.133.146', [])).toBe(true);
    expect(isWebhookSourceAllowed(undefined, [])).toBe(true);
  });

  it('enforces the allowlist with exact matching', () => {
    expect(isWebhookSourceAllowed('35.242.133.146', ['35.242.133.146'])).toBe(true);
    expect(isWebhookSourceAllowed(' 35.242.133.146 ', ['35.242.133.146'])).toBe(true);
    expect(isWebhookSourceAllowed('1.2.3.4', ['35.242.133.146'])).toBe(false);
    expect(isWebhookSourceAllowed(undefined, ['35.242.133.146'])).toBe(false);
  });
});
