import { existsSync } from 'node:fs';
import path from 'node:path';
import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import type { Pool } from './db';
import { HttpError } from './errors';
import * as loops from './loops';
import { NOTE_MAX, TITLE_MAX, type LoopMutationResponse } from '../shared/types';

export interface AppOptions {
  pool: Pool;
  clock?: () => number;
  production?: boolean;
  staticDir?: string;
}

// Collapse whitespace/control characters so titles stay single-line.
const cleanLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

const title = z
  .string()
  .transform(cleanLine)
  .pipe(z.string().min(1, 'Title is required').max(TITLE_MAX, `Title must be ${TITLE_MAX} characters or fewer`));
const note = z
  .string()
  .transform(cleanLine)
  .pipe(z.string().max(NOTE_MAX, `Note must be ${NOTE_MAX} characters or fewer`));

const createSchema = z.object({
  id: z.uuid(),
  title,
  note: note.optional().default(''),
  start: z.boolean().optional().default(false),
});
const patchSchema = z
  .object({ title: title.optional(), note: note.optional(), priority: z.boolean().optional() })
  .strict()
  .refine((v) => v.title !== undefined || v.note !== undefined || v.priority !== undefined, 'Nothing to update');
const settingsSchema = z
  .object({
    runSort: z.enum(['longest', 'shortest', 'alpha']).optional(),
    openSort: z.enum(['oldest', 'newest', 'alpha']).optional(),
    archiveOpen: z.boolean().optional(),
    archiveRange: z.enum(['7d', 'all']).optional(),
    theme: z.enum(['dark', 'light', 'system']).optional(),
  })
  .strict();
const idParam = z.uuid();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) {
    const msg = r.error.issues[0]?.message ?? 'Invalid request';
    throw new HttpError(400, 'invalid_request', msg);
  }
  return r.data;
}

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

export function createApp(opts: AppOptions) {
  const { pool } = opts;
  const clock = opts.clock ?? Date.now;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: opts.production ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use((_req, res, next) => {
    // Keep the workspace out of search engines.
    res.set('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
  app.use(compression());
  app.use(express.json({ limit: '32kb' }));

  // ── Public ──────────────────────────────────────────────────────────────
  app.get(
    '/api/health',
    wrap(async (_req, res) => {
      await pool.query('SELECT 1');
      res.set('Cache-Control', 'no-store').json({ ok: true });
    }),
  );

  const api = express.Router();
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  // State-changing requests must carry a custom header. Browsers can't attach one
  // cross-origin without a CORS preflight (never granted), which blocks CSRF.
  api.use((req, _res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (req.get('x-loop-client') !== '1') return next(new HttpError(403, 'forbidden', 'Missing client header'));
    next();
  });

  const send = (res: Response, result: loops.MutationResult, status = 200) => {
    const body: LoopMutationResponse = { serverNow: clock(), loop: result.loop, undo: result.undo };
    if (result.deletedId) body.deletedId = result.deletedId;
    res.status(status).json(body);
  };

  api.get(
    '/state',
    wrap(async (_req, res) => {
      const now = clock();
      const [list, settings, undo] = await Promise.all([loops.listLoops(pool), loops.getSettings(pool), loops.getUndoTop(pool, now)]);
      res.json({ serverNow: clock(), loops: list, settings, undo });
    }),
  );

  api.post(
    '/loops',
    wrap(async (req, res) => {
      const input = parse(createSchema, req.body);
      const result = await loops.createLoop(pool, input, clock());
      send(res, result, result.changed ? 201 : 200);
    }),
  );

  api.patch(
    '/loops/:id',
    wrap(async (req, res) => {
      const id = parse(idParam, req.params.id);
      send(res, await loops.updateLoop(pool, id, parse(patchSchema, req.body), clock()));
    }),
  );

  const transitions = {
    start: loops.startLoop,
    stop: loops.stopLoop,
    close: loops.closeLoop,
    reopen: loops.reopenLoop,
  } as const;
  for (const [name, fn] of Object.entries(transitions)) {
    api.post(
      `/loops/:id/${name}`,
      wrap(async (req, res) => {
        const id = parse(idParam, req.params.id);
        send(res, await fn(pool, id, clock()));
      }),
    );
  }

  api.delete(
    '/loops/:id',
    wrap(async (req, res) => {
      const id = parse(idParam, req.params.id);
      send(res, await loops.deleteLoop(pool, id, clock()));
    }),
  );

  api.get(
    '/loops/:id/sessions',
    wrap(async (req, res) => {
      const id = parse(idParam, req.params.id);
      const sessions = await loops.listSessions(pool, id);
      res.json({ serverNow: clock(), sessions });
    }),
  );

  api.post(
    '/undo',
    wrap(async (_req, res) => {
      send(res, await loops.undoLast(pool, clock()));
    }),
  );

  api.put(
    '/settings',
    wrap(async (req, res) => {
      const settings = await loops.saveSettings(pool, parse(settingsSchema, req.body));
      res.json({ settings });
    }),
  );

  api.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Unknown endpoint')));
  app.use('/api', api);

  // ── Static client ───────────────────────────────────────────────────────
  if (opts.staticDir && existsSync(opts.staticDir)) {
    const dir = opts.staticDir;
    app.use(
      '/assets',
      express.static(path.join(dir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }),
    );
    app.use(express.static(dir, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache').sendFile(path.join(dir, 'index.html'));
    });
  }

  // ── Errors ──────────────────────────────────────────────────────────────
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const e = err as { type?: string; status?: number; code?: string; message?: string };
    if (e?.type === 'entity.parse.failed' || e?.type === 'entity.too.large') {
      res.status(e.status ?? 400).json({ error: { code: 'invalid_request', message: 'Malformed request body' } });
      return;
    }
    if (e?.status === 404) {
      res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
      return;
    }
    console.error('[api] unhandled error', err);
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong' } });
  });

  return app;
}
