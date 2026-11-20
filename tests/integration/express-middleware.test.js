import { createRequire } from 'node:module';
import http from 'node:http';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApiSentinel } from '../../src/index.js';
import { createTestExpressApp } from '../fixtures/test-app.js';

describe('Express Integration & End-to-End Middleware Behavior', () => {
  it('1. tracks successful 2xx requests and preserves original response bodies', async () => {
    const { app, sentinel } = createTestExpressApp();

    const getRes = await request(app).get('/api/users').expect(200);
    expect(getRes.body).toEqual({
      users: [
        { id: 1, name: 'Aarav Sharma' },
        { id: 2, name: 'Priya Patel' },
      ],
    });

    const postRes = await request(app).post('/api/users').send({ username: 'aviral' }).expect(201);
    expect(postRes.body).toEqual({ created: true, username: 'aviral' });

    const metrics = sentinel.getMetrics();
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.successfulRequests).toBe(2);
    expect(metrics.statusDistribution['2xx']).toBe(2);
    expect(metrics.statusCodeCounts['200']).toBe(1);
    expect(metrics.statusCodeCounts['201']).toBe(1);
  });

  it('2 & 3 & 4. classifies HTTP 400, 404 unmatched routes, and 500 server errors accurately without double-counting 404', async () => {
    const { app, sentinel } = createTestExpressApp();

    await request(app).get('/api/bad-request').expect(400);
    await request(app).get('/api/non-existent-endpoint-12345').expect(404);
    await request(app).get('/api/direct-server-error').expect(503);

    const metrics = sentinel.getMetrics();
    expect(metrics.totalRequests).toBe(3);
    expect(metrics.clientErrorRequests).toBe(2); // 400 + 404
    expect(metrics.notFoundRequests).toBe(1);
    expect(metrics.unmatchedRouteRequests).toBe(1);
    expect(metrics.serverErrorRequests).toBe(1);
    expect(metrics.statusDistribution['4xx']).toBe(2);
    expect('404' in metrics.statusDistribution).toBe(false);
    expect(metrics.statusDistribution['5xx']).toBe(1);
    expect(metrics.errorRate).toBe(100);

    const statusFamilyTotal = Object.values(metrics.statusDistribution).reduce(
      (sum, count) => sum + count,
      0
    );
    expect(statusFamilyTotal).toBe(metrics.totalRequests);
  });

  it('classifies HTTP 304 as not_modified and 301/302 as redirect, and reconciles all endpoint counters with requestCount', async () => {
    const { app, sentinel } = createTestExpressApp();

    await request(app).get('/api/users').expect(200);
    await request(app).get('/api/cache-check').expect(304);
    await request(app).get('/api/cache-check').expect(304);
    await request(app).get('/api/redirect-permanent').expect(301);
    await request(app).get('/api/redirect-temporary').expect(302);
    await request(app).get('/api/bad-request').expect(400);
    await request(app).get('/api/unknown-404-route').expect(404);
    await request(app).get('/api/direct-server-error').expect(503);

    const metrics = sentinel.getMetrics();
    expect(metrics.totalRequests).toBe(8);
    expect(metrics.successfulRequests).toBe(1);
    expect(metrics.notModifiedRequests).toBe(2);
    expect(metrics.redirectRequests).toBe(2);
    expect(metrics.clientErrorRequests).toBe(2);
    expect(metrics.notFoundRequests).toBe(1);
    expect(metrics.serverErrorRequests).toBe(1);

    expect(metrics.statusDistribution).toEqual({
      '1xx': 0,
      '2xx': 1,
      '3xx': 4, // 2 redirects + 2 not_modified
      '4xx': 2, // 1 bad-request + 1 not-found
      '5xx': 1,
    });

    const totalFromFamilies = Object.values(metrics.statusDistribution).reduce(
      (sum, val) => sum + val,
      0
    );
    expect(totalFromFamilies).toBe(metrics.totalRequests);

    const recent = sentinel.getRecentRequests();
    const cacheRecords = recent.filter((r) => r.route === '/api/cache-check');
    expect(cacheRecords.length).toBe(2);
    expect(cacheRecords[0].outcome).toBe('not_modified');

    const redirect301 = recent.find((r) => r.route === '/api/redirect-permanent');
    const redirect302 = recent.find((r) => r.route === '/api/redirect-temporary');
    expect(redirect301.outcome).toBe('redirect');
    expect(redirect302.outcome).toBe('redirect');

    // Verify endpoint-level counters reconcile with requestCount for every single endpoint
    const endpoints = sentinel.getEndpointMetrics();
    const cacheEndpoint = endpoints.find((ep) => ep.key === 'GET /api/cache-check');
    expect(cacheEndpoint.requestCount).toBe(2);
    expect(cacheEndpoint.notModifiedCount).toBe(2);
    expect(cacheEndpoint.redirectCount).toBe(0);

    for (const ep of endpoints) {
      const sumByCategory =
        ep.informationalCount +
        ep.successCount +
        ep.redirectCount +
        ep.notModifiedCount +
        ep.clientErrorCount +
        ep.serverErrorCount;
      expect(sumByCategory).toBe(ep.requestCount);
      expect(ep.clientErrorCount + ep.serverErrorCount).toBe(ep.errorCount);
    }
  });

  it('5. detects slow requests exceeding slowRequestThresholdMs and emits slow-request log events', async () => {
    const events = [];
    const { app, sentinel } = createTestExpressApp({
      slowRequestThresholdMs: 40,
      logging: {
        enabled: true,
        logSlowRequests: true,
        writer: (event) => events.push(event),
      },
    });

    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/slow?delay=70').expect(200);

    const metrics = sentinel.getMetrics();
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.slowRequests).toBe(1);

    const recent = sentinel.getRecentRequests();
    expect(recent[0].route).toBe('/api/slow');
    expect(recent[0].isSlow).toBe(true);
    expect(recent[0].durationMs).toBeGreaterThan(40);

    const slowEvent = events.find((e) => e.type === 'slow-request');
    expect(slowEvent).toBeDefined();
    expect(slowEvent.requestId).toBe(recent[0].requestId);
    expect(slowEvent.route).toBe('/api/slow');
  });

  it('6, 7 & 8. attaches unique X-Request-ID headers and correlates them with records and logs', async () => {
    const loggedEvents = [];
    const { app, sentinel } = createTestExpressApp({
      logging: {
        enabled: true,
        logAllRequests: true,
        writer: (e) => loggedEvents.push(e),
      },
    });

    const res1 = await request(app).get('/api/users').expect(200);
    const res2 = await request(app).get('/api/users').expect(200);

    const id1 = res1.headers['x-request-id'];
    const id2 = res2.headers['x-request-id'];

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);

    const recent = sentinel.getRecentRequests();
    expect(recent[0].requestId).toBe(id2);
    expect(recent[1].requestId).toBe(id1);

    expect(loggedEvents[0].requestId).toBe(id1);
    expect(loggedEvents[1].requestId).toBe(id2);
  });

  it('9 & 10. normalizes mounted router templates (/api/products/:id) to prevent high cardinality', async () => {
    const { app, sentinel } = createTestExpressApp();

    await request(app).get('/api/products/101').expect(200);
    await request(app).get('/api/products/202').expect(200);
    await request(app).get('/api/products/550e8400-e29b-41d4-a716-446655440000').expect(200);

    const endpoints = sentinel.getEndpointMetrics();
    expect(endpoints.length).toBe(1);
    expect(endpoints[0].key).toBe('GET /api/products/:id');
    expect(endpoints[0].requestCount).toBe(3);
  });

  it('15 & 16. returns deeply detached snapshots that cannot mutate collector state and supports resetMetrics()', async () => {
    const { app, sentinel } = createTestExpressApp();

    await request(app).get('/api/users').expect(200);

    const snapshot = sentinel.getMetrics();
    snapshot.totalRequests = 99999;
    snapshot.latency.avgMs = 88888;
    snapshot.statusDistribution['2xx'] = 77777;
    snapshot.endpoints[0].requestCount = 66666;
    snapshot.endpoints.push({ key: 'FAKE /route' });

    const recent = sentinel.getRecentRequests();
    recent[0].statusCode = 599;
    recent.push({ requestId: 'fake' });

    const endpoints = sentinel.getEndpointMetrics();
    endpoints[0].requestCount = 55555;

    const freshSnapshot = sentinel.getMetrics();
    expect(freshSnapshot.totalRequests).toBe(1);
    expect(freshSnapshot.statusDistribution['2xx']).toBe(1);
    expect(freshSnapshot.endpoints.length).toBe(1);
    expect(freshSnapshot.endpoints[0].requestCount).toBe(1);
    expect(sentinel.getRecentRequests().length).toBe(1);
    expect(sentinel.getRecentRequests()[0].statusCode).toBe(200);

    sentinel.resetMetrics();
    expect(sentinel.getMetrics().totalRequests).toBe(0);
    expect(sentinel.getRecentRequests().length).toBe(0);
    expect(sentinel.getEndpointMetrics().length).toBe(0);
  });

  it('19 & 20. preserves Express error propagation via sentinel.errorHandler without leaking sensitive data', async () => {
    const capturedEvents = [];
    const { app, sentinel } = createTestExpressApp({
      logging: {
        enabled: true,
        logServerErrors: true,
        writer: (e) => capturedEvents.push(e),
      },
    });

    const res = await request(app)
      .get('/api/throw-error?apiKey=secret_query_token')
      .set('Authorization', 'Bearer secret_jwt_token')
      .set('Cookie', 'session_id=secret_cookie_val')
      .expect(500);

    expect(res.body).toEqual({
      error: 'Internal Server Error',
      type: 'TypeError',
    });

    const recent = sentinel.getRecentRequests();
    expect(recent.length).toBe(1);
    expect(recent[0].statusCode).toBe(500);
    expect(recent[0].errorName).toBe('TypeError');
    expect(recent[0].errorCode).toBe('ECONNREFUSED');
    expect(recent[0].route).toBe('/api/throw-error');

    const serializedHistory = JSON.stringify({
      metrics: sentinel.getMetrics(),
      recent,
      capturedEvents,
    });

    expect(serializedHistory).not.toContain('secret123');
    expect(serializedHistory).not.toContain('secret_query_token');
    expect(serializedHistory).not.toContain('secret_jwt_token');
    expect(serializedHistory).not.toContain('secret_cookie_val');
  });

  it('21. handles multiple concurrent requests accurately without race conditions', async () => {
    const { app, sentinel } = createTestExpressApp();

    const requests = [];
    for (let i = 0; i < 40; i += 1) {
      requests.push(request(app).get(`/api/products/${i}`).expect(200));
    }
    for (let i = 0; i < 10; i += 1) {
      requests.push(request(app).get('/api/bad-request').expect(400));
    }

    await Promise.all(requests);

    const metrics = sentinel.getMetrics();
    expect(metrics.totalRequests).toBe(50);
    expect(metrics.successfulRequests).toBe(40);
    expect(metrics.clientErrorRequests).toBe(10);
  });

  it('23. handles prematurely aborted client requests without double-counting', async () => {
    const app = express();
    const sentinel = createApiSentinel({ logging: false });
    app.use(sentinel.middleware);

    app.get('/api/hang', (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.write('partial');
      // Intentionally wait so the client can abort mid-stream
    });

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();

    await new Promise((resolve) => {
      const req = http.get(
        {
          host: '127.0.0.1',
          port: address.port,
          path: '/api/hang',
        },
        (res) => {
          res.once('data', () => {
            req.destroy();
          });
        }
      );
      req.on('close', () => {
        setTimeout(resolve, 40);
      });
      req.on('error', () => {});
    });

    await new Promise((resolve) => server.close(resolve));

    const metrics = sentinel.getMetrics();
    expect(metrics.totalRequests).toBe(1);
    expect(metrics.abortedRequests).toBe(1);
    const recent = sentinel.getRecentRequests();
    expect(recent[0].aborted).toBe(true);
  });

  it('supports ignorePaths configuration (array of strings/RegExps or predicate function)', async () => {
    const { app, sentinel } = createTestExpressApp({
      ignorePaths: ['/__sentinel/metrics', /^\/api\/health$/],
    });

    await request(app).get('/api/health').expect(200);
    await request(app).get('/__sentinel/metrics').expect(200);
    await request(app).get('/api/users').expect(200);

    expect(sentinel.getMetrics().totalRequests).toBe(1);
  });

  it('verifies built CommonJS (dist/index.cjs) and ESM (dist/index.js) bundles export identical API', async () => {
    const esmBundle = await import('../../dist/index.js');
    const require = createRequire(import.meta.url);
    const cjsBundle = require('../../dist/index.cjs');

    expect(typeof esmBundle.createApiSentinel).toBe('function');
    expect(typeof cjsBundle.createApiSentinel).toBe('function');

    const cjsInstance = cjsBundle.createApiSentinel({ logging: false });
    expect(typeof cjsInstance.middleware).toBe('function');
    expect(typeof cjsInstance.errorHandler).toBe('function');
    expect(typeof cjsInstance.getMetrics).toBe('function');
    expect(typeof cjsInstance.getRecentRequests).toBe('function');
    expect(typeof cjsInstance.getEndpointMetrics).toBe('function');
    expect(typeof cjsInstance.resetMetrics).toBe('function');
    expect(typeof cjsInstance.getConfig).toBe('function');
  });
});
