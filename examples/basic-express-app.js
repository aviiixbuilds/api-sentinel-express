import express from 'express';
import { createApiSentinel } from '../src/index.js';

const app = express();
app.use(express.json());

const sentinel = createApiSentinel({
  slowRequestThresholdMs: 300,
  maxRecentRequests: 200,
  maxRouteEntries: 100,
  ignorePaths: ['/internal/metrics'],
});

app.use(sentinel.middleware);

app.get('/api/users', (_req, res) => {
  res.json({
    users: [
      { id: 1, name: 'Aarav Sharma', role: 'Engineer' },
      { id: 2, name: 'Diya Nair', role: 'Architect' },
    ],
  });
});

app.get('/api/products/:id', (req, res) => {
  res.json({
    id: req.params.id,
    name: `Enterprise Sensor #${req.params.id}`,
    inStock: true,
  });
});

app.get('/api/reports/slow', async (_req, res) => {
  await new Promise((resolve) => setTimeout(resolve, 450));
  res.json({ report: 'quarterly-latency-audit', status: 'generated' });
});

app.get('/internal/metrics', (_req, res) => {
  res.json({
    summary: sentinel.getMetrics(),
    recentRequests: sentinel.getRecentRequests(20),
  });
});

app.use(sentinel.errorHandler);

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`Example Express server with API Sentinel listening on http://localhost:${PORT}`);
  console.log(`Inspect live metrics at http://localhost:${PORT}/internal/metrics`);
});
