import http from 'node:http';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import express from 'express';
import { calculatePercentile, createApiSentinel } from '../src/index.js';

const TOTAL_REQUESTS = 1500;
const CONCURRENCY = 25;
const WARMUP_REQUESTS = 200;

function createBaselineServer() {
  const app = express();
  app.get('/api/items/:id', (req, res) => {
    res.status(200).json({ id: req.params.id, status: 'ok' });
  });
  return http.createServer(app);
}

function createSentinelServer() {
  const app = express();
  const sentinel = createApiSentinel({
    slowRequestThresholdMs: 500,
    maxRecentRequests: 200,
    maxRouteEntries: 100,
    logging: false, // Measure pure middleware & metrics aggregation overhead without stdout I/O
  });
  app.use(sentinel.middleware);
  app.get('/api/items/:id', (req, res) => {
    res.status(200).json({ id: req.params.id, status: 'ok' });
  });
  return http.createServer(app);
}

function sendHttpRequest(agent, port, path) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const req = http.get(
      {
        host: '127.0.0.1',
        port,
        path,
        agent,
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          resolve(performance.now() - start);
        });
      }
    );
    req.on('error', reject);
  });
}

async function runLoadScenario(name, serverFactory) {
  const server = serverFactory();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const agent = new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY });

  // Warmup phase
  for (let i = 0; i < WARMUP_REQUESTS; i += 1) {
    await sendHttpRequest(agent, port, `/api/items/${i % 20}`);
  }

  const latencies = [];
  let completed = 0;
  const suiteStart = performance.now();

  async function worker(workerId) {
    while (completed < TOTAL_REQUESTS) {
      const index = completed;
      completed += 1;
      if (index >= TOTAL_REQUESTS) {
        break;
      }
      const latency = await sendHttpRequest(agent, port, `/api/items/${(index + workerId) % 50}`);
      latencies.push(latency);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i));
  await Promise.all(workers);

  const totalElapsedMs = performance.now() - suiteStart;
  agent.destroy();
  await new Promise((resolve) => server.close(resolve));

  const sumLatency = latencies.reduce((acc, v) => acc + v, 0);
  const avgLatencyMs = Math.round((sumLatency / latencies.length) * 1000) / 1000;
  const p95LatencyMs = calculatePercentile(latencies, 95);
  const requestsPerSec = Math.round((TOTAL_REQUESTS / (totalElapsedMs / 1000)) * 100) / 100;

  return {
    name,
    totalRequests: TOTAL_REQUESTS,
    concurrency: CONCURRENCY,
    totalElapsedMs: Math.round(totalElapsedMs * 100) / 100,
    requestsPerSec,
    avgLatencyMs,
    p95LatencyMs,
  };
}

async function main() {
  const cpuModel = os.cpus()[0]?.model ?? 'Unknown CPU';
  console.log('====================================================================');
  console.log(' API SENTINEL — REPRODUCIBLE EXPRESS OVERHEAD BENCHMARK');
  console.log('====================================================================');
  console.log(`Node.js Version : ${process.version}`);
  console.log(`Platform / Arch : ${os.platform()} ${os.arch()} (${os.release()})`);
  console.log(`CPU Model       : ${cpuModel} (${os.cpus().length} logical cores)`);
  console.log(`Workload        : ${TOTAL_REQUESTS} HTTP GET requests, concurrency=${CONCURRENCY}`);
  console.log('--------------------------------------------------------------------');

  const baseline = await runLoadScenario('Baseline Express (No Middleware)', createBaselineServer);
  const withSentinel = await runLoadScenario(
    'Express + API Sentinel Middleware',
    createSentinelServer
  );

  const avgDeltaMs = Math.round((withSentinel.avgLatencyMs - baseline.avgLatencyMs) * 1000) / 1000;
  const rpsDiffPct =
    Math.round(
      ((withSentinel.requestsPerSec - baseline.requestsPerSec) / baseline.requestsPerSec) * 10000
    ) / 100;

  console.table([
    {
      Scenario: baseline.name,
      'Requests/sec': baseline.requestsPerSec,
      'Avg Latency (ms)': baseline.avgLatencyMs,
      'P95 Latency (ms)': baseline.p95LatencyMs,
      'Total Time (ms)': baseline.totalElapsedMs,
    },
    {
      Scenario: withSentinel.name,
      'Requests/sec': withSentinel.requestsPerSec,
      'Avg Latency (ms)': withSentinel.avgLatencyMs,
      'P95 Latency (ms)': withSentinel.p95LatencyMs,
      'Total Time (ms)': withSentinel.totalElapsedMs,
    },
  ]);

  console.log(`Per-Request Average Latency Delta : ${avgDeltaMs >= 0 ? '+' : ''}${avgDeltaMs} ms`);
  console.log(`Relative Throughput Difference    : ${rpsDiffPct >= 0 ? '+' : ''}${rpsDiffPct}%`);
  console.log('====================================================================');
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
