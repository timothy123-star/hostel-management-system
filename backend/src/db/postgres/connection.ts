import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg';

export type PostgresEnvironment = Partial<Pick<NodeJS.ProcessEnv, 'DATABASE_URL' | 'POSTGRES_SSL' | 'PGPOOL_MAX'>>;

export interface PostgresConnectionOptions {
  connectionString: string;
  max: number;
  ssl: false | { rejectUnauthorized: boolean };
}

/**
 * Builds PostgreSQL options without loading dotenv or opening a connection.
 * SQLite remains the application runtime until a later migration stage.
 */
export function getPostgresConnectionOptions(env: PostgresEnvironment = process.env): PostgresConnectionOptions {
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL operations.');

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL must use the postgres:// or postgresql:// protocol.');
  }

  const requestedSsl = env.POSTGRES_SSL?.trim().toLowerCase();
  if (requestedSsl && !['true', 'false', 'require'].includes(requestedSsl)) {
    throw new Error('POSTGRES_SSL must be true, false, or require when provided.');
  }
  const sslRequired = requestedSsl === 'true' || requestedSsl === 'require' || url.searchParams.get('sslmode') === 'require';
  const max = env.PGPOOL_MAX ? Number(env.PGPOOL_MAX) : 5;
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new Error('PGPOOL_MAX must be an integer between 1 and 20.');

  return { connectionString, max, ssl: sslRequired ? { rejectUnauthorized: true } : false };
}

export function createPostgresPool(env: PostgresEnvironment = process.env): Pool {
  const options = getPostgresConnectionOptions(env);
  const poolConfig: PoolConfig = {
    connectionString: options.connectionString,
    max: options.max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: options.ssl
  };
  return new Pool(poolConfig);
}

export async function query<T extends QueryResultRow = QueryResultRow>(pool: Pool, text: string, values: readonly unknown[] = []) {
  return pool.query<T>(text, [...values]);
}

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original error; a failed rollback cannot make the work succeed.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePostgresPool(pool: Pool): Promise<void> {
  await pool.end();
}

/** Registers graceful cleanup without changing process exit behavior. */
export function registerPostgresPoolShutdown(pool: Pool): () => void {
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= closePostgresPool(pool).catch(() => undefined);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  return () => {
    process.off('SIGINT', close);
    process.off('SIGTERM', close);
  };
}
