import { createPool, type Pool } from '../../server/db';
import { migrate } from '../../server/migrator';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/loop_test';

/** Fresh, fully migrated schema for a test file. */
export async function freshDatabase(): Promise<Pool> {
  const pool = createPool(TEST_DATABASE_URL);
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await migrate(pool, () => {});
  return pool;
}

/** Manually advanced clock so timer math is deterministic. */
export function fakeClock(start = Date.UTC(2026, 8, 17, 9, 0, 0)) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
