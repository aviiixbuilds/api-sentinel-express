# Product Strategy & Future Roadmap — API Sentinel

## Product Vision

**API Sentinel** is built as the foundational open-source SDK of a developer-first backend observability platform. It solves the "day-one observability gap" for Node.js teams: getting actionable endpoint latency, P95 metrics, error classification, and request correlation in under two minutes without deploying external collectors or risking PII leaks.

---

## Phase 1 — Current MVP (Implemented & Verified in `v1.0.0`)

All Phase 1 capabilities are complete, tested, and ship in `api-sentinel-express@1.0.0`:

- [x] Express.js request lifecycle monitoring middleware (`sentinel.middleware`).
- [x] Express error-capturing middleware (`sentinel.errorHandler`).
- [x] High-resolution monotonic duration measurement (`performance.now()`).
- [x] Bounded rolling-window P95 latency calculation (`Float64Array` ring buffer).
- [x] Configurable slow-request detection (`slowRequestThresholdMs`).
- [x] Cryptographic `X-Request-ID` generation and correlation (`node:crypto`).
- [x] Multi-tier route normalization and cardinality overflow protection (`maxRouteEntries`).
- [x] Privacy-first structured JSON event logging with custom writer support.
- [x] Programmatic metrics API (`getMetrics()`, `getRecentRequests()`, `getEndpointMetrics()`, `resetMetrics()`).
- [x] Separate full-stack Express + React/Vite live demonstration application (`api-sentinel-demo`).

---

## Phase 2 — Ecosystem Expansion & Distributed Storage (Planned)

- [ ] **Fastify & Koa Adapters**: Extract framework-agnostic core collector into `@api-sentinel/core` and provide native hooks for Fastify (`onRequest`, `onResponse`, `onError`).
- [ ] **Pluggable Storage Adapters (`RedisStorageAdapter`)**: Optional Redis time-series / hash persistence so horizontally scaled Node.js cluster instances can aggregate shared metrics across multiple workers.
- [ ] **WebSocket & Server-Sent Events (SSE) Streaming**: Real-time push stream for live dashboards instead of HTTP polling.
- [ ] **Threshold Alert Webhooks**: Configurable slack/webhook callbacks when rolling 5-minute error rate exceeds $X\%$ or P95 latency crosses an SLA threshold.
- [ ] **OpenTelemetry (OTel) Bridge**: Optional exporter translating API Sentinel records into standard OTel spans and metric instruments.

---

## Phase 3 — Commercial Cloud Platform (Long-Term Possibility)

- [ ] **API Sentinel Cloud Dashboard**: Hosted multi-service observability control plane with 30-day historical retention.
- [ ] **Team Workspaces & Role-Based Access Control (RBAC)**: Organization API keys, environment separation (`staging` vs. `production`), and audit logs.
- [ ] **Automated Anomaly & Regression Detection**: Deployment-over-deployment latency regression alerts per endpoint.
- [ ] **Usage-Based SaaS Tiers**: Free open-source core SDK forever, with optional paid cloud retention and alerting for growing engineering teams.
