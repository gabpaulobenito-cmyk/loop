import { freshDatabase } from '../helpers/db';

export default async function globalSetup() {
  const pool = await freshDatabase();
  await pool.end();
}
