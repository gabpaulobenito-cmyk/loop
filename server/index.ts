import path from 'node:path';
import { createPool } from './db';
import { createApp } from './app';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function required(name: string): string {
  const v = env[name];
  if (!v) {
    console.error(`[loop] ${name} is required. See .env.example.`);
    process.exit(1);
  }
  return v;
}

const databaseUrl = required('DATABASE_URL');

const pool = createPool(databaseUrl);
const app = createApp({
  pool,
  production: isProd,
  staticDir: path.resolve(process.cwd(), 'dist/client'),
});

const port = Number(env.PORT) || 3000;
const server = app.listen(port, () => {
  console.log(`[loop] listening on :${port} (${isProd ? 'production' : 'development'})`);
});

function shutdown(signal: string) {
  console.log(`[loop] ${signal} received, shutting down`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
