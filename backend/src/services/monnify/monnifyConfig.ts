export const SANDBOX_BASE_URL = 'https://sandbox.monnify.com';
export const LIVE_BASE_URL = 'https://api.monnify.com';
export const MAX_TIMEOUT_SECONDS = 2400;

/**
 * Monnify-documented webhook source IP (see Monnify Webhooks documentation,
 * best-practice section). Use only as an optional allowlist entry via
 * MONNIFY_WEBHOOK_IP_ALLOWLIST, e.g. `35.242.133.146`.
 *
 * Proxy limitation: applications running behind a reverse proxy, CDN, or
 * managed platform (including Railway) observe the edge/proxy connection IP,
 * not necessarily Monnify's origin IP. Only enforce IP allowlisting against
 * a remote IP you trust (direct connection or a platform-guaranteed header);
 * the webhook HMAC signature remains the primary authentication mechanism
 * and must always be verified.
 */
export const DOCUMENTED_MONNIFY_WEBHOOK_IP = '35.242.133.146';

export interface MonnifyConfig {
  enabled: boolean;
  mode: 'sandbox' | 'live' | 'disabled';
  baseUrl: string;
  apiKey: string;
  secretKey: string;
  contractCode: string;
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string {
  return (env[name] || '').trim();
}

export function getMonnifyConfig(env: NodeJS.ProcessEnv = process.env): MonnifyConfig {
  const enabled = readEnv(env, 'MONNIFY_ENABLED').toLowerCase() === 'true';
  const rawMode = readEnv(env, 'MONNIFY_MODE').toLowerCase();
  const mode: MonnifyConfig['mode'] = rawMode === 'live' ? 'live' : rawMode === 'sandbox' ? 'sandbox' : 'disabled';
  const baseUrl = readEnv(env, 'MONNIFY_BASE_URL');
  const apiKey = readEnv(env, 'MONNIFY_API_KEY');
  const secretKey = readEnv(env, 'MONNIFY_SECRET_KEY');
  const contractCode = readEnv(env, 'MONNIFY_CONTRACT_CODE');
  return { enabled, mode, baseUrl, apiKey, secretKey, contractCode };
}

export function isSandbox(cfg: MonnifyConfig = getMonnifyConfig()): boolean {
  return cfg.mode === 'sandbox' && cfg.baseUrl === SANDBOX_BASE_URL;
}

export function isLive(cfg: MonnifyConfig = getMonnifyConfig()): boolean {
  return cfg.mode === 'live' && cfg.baseUrl === LIVE_BASE_URL;
}

/** Fail closed: throws when integration is enabled but misconfigured. */
export function assertMonnifyUsable(
  cfg: MonnifyConfig = getMonnifyConfig(),
  opts: { nodeEnv?: string } = {},
): MonnifyConfig {
  if (!cfg.enabled) throw new Error('Monnify integration is disabled. Set MONNIFY_ENABLED=true to use it.');
  if (cfg.mode === 'sandbox') {
    if (cfg.baseUrl !== SANDBOX_BASE_URL) throw new Error('Sandbox mode must use https://sandbox.monnify.com.');
    if (!cfg.apiKey || !cfg.secretKey || !cfg.contractCode) throw new Error('Sandbox Monnify credentials are incomplete.');
    const nodeEnv = opts.nodeEnv ?? process.env.NODE_ENV;
    if (nodeEnv === 'production') throw new Error('Sandbox mode must not be enabled in production.');
    return cfg;
  }
  if (cfg.mode === 'live') {
    if (cfg.baseUrl !== LIVE_BASE_URL) throw new Error('Live mode must use the approved Monnify live base URL.');
    if (!cfg.apiKey || !cfg.secretKey || !cfg.contractCode) throw new Error('Live Monnify credentials are incomplete.');
    return cfg;
  }
  throw new Error('Set MONNIFY_MODE to sandbox or live.');
}

/** Optional webhook source-IP allowlist (comma separated). Empty = no IP check. */
export function getWebhookIpAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = (env.MONNIFY_WEBHOOK_IP_ALLOWLIST || '').trim();
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Exact-match check of the observed connection remote IP against the
 * allowlist. An empty allowlist disables the IP check (signature
 * verification still applies). Never trust a client-controlled
 * `X-Forwarded-For` value unless the hosting platform guarantees it.
 */
export function isWebhookSourceAllowed(remoteIp: string | undefined, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true;
  if (!remoteIp) return false;
  return allowlist.includes(remoteIp.trim());
}
