import express from 'express';
import { createApiSentinel } from '../../src/index.js';

/**
 * Creates a configured Express test application integrated with API Sentinel.
 *
 * @param {object} [sentinelOptions={}] - Options passed to `createApiSentinel()`.
 * @returns {{ app: import('express').Express, sentinel: ReturnType<typeof createApiSentinel> }}
 */
export function createTestExpressApp(sentinelOptions = {}) {
  const app = express();
  app.use(express.json());

  const sentinel = createApiSentinel({
    logging: false,
    ...sentinelOptions,
  });

  app.use(sentinel.middleware);

  app.get('/api/health', (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'test-service' });
  });

  app.get('/api/users', (_req, res) => {
    res.status(200).json({
      users: [
        { id: 1, name: 'Aarav Sharma' },
        { id: 2, name: 'Priya Patel' },
      ],
    });
  });

  app.post('/api/users', (req, res) => {
    res.status(201).json({
      created: true,
      username: req.body?.username ?? 'anonymous',
    });
  });

  const productsRouter = express.Router();
  productsRouter.get('/:id', (req, res) => {
    res.status(200).json({
      id: req.params.id,
      name: `Product ${req.params.id}`,
    });
  });
  app.use('/api/products', productsRouter);

  app.get('/api/slow', async (req, res) => {
    const delayMs = Number(req.query.delay ?? 80);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    res.status(200).json({ delayed: true, delayMs });
  });

  app.get('/api/bad-request', (_req, res) => {
    res.status(400).json({ error: 'Invalid input parameter' });
  });

  app.get('/api/redirect-permanent', (_req, res) => {
    res.redirect(301, '/api/users');
  });

  app.get('/api/redirect-temporary', (_req, res) => {
    res.redirect(302, '/api/users');
  });

  app.get('/api/cache-check', (_req, res) => {
    res.status(304).end();
  });

  app.get('/api/direct-server-error', (_req, res) => {
    res.status(503).json({ error: 'Upstream unavailable' });
  });

  app.get('/api/throw-error', (_req, _res, next) => {
    const error = new TypeError(
      'Sensitive database connection string: mysql://root:secret123@db/prod'
    );
    error.code = 'ECONNREFUSED';
    next(error);
  });

  app.get('/__sentinel/metrics', (_req, res) => {
    res.status(200).json(sentinel.getMetrics());
  });

  app.use(sentinel.errorHandler);

  app.use((err, _req, res, _next) => {
    res.status(500).json({
      error: 'Internal Server Error',
      type: err?.name ?? 'Error',
    });
  });

  return { app, sentinel };
}
