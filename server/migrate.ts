import { createPool } from './db';
import { migrate } from './migrator';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[migrate] DATABASE_URL is not set');
  process.exit(1);
}

const pool = createPool(url);
try {
  const applied = await migrate(pool);
  console.log(`[migrate] done (${applied.length} applied)`);
} catch (err) {
  console.error('[migrate]', (err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
