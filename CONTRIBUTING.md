# Contributing to API Sentinel (`api-sentinel-express`)

Thank you for your interest in contributing to **API Sentinel**!

## Engineering Principles

1. **Plain Modern JavaScript (ES2024)**: This project is written entirely in clean, modular JavaScript (`.js`) with JSDoc comments. Do not introduce TypeScript (`.ts`) files or TypeScript build dependencies.
2. **Zero Runtime Dependencies**: Keep `dependencies` in `package.json` empty. Use built-in Node.js modules (`node:crypto`, `node:perf_hooks`) and treat `express` as a peer dependency.
3. **Privacy-First by Default**: Never log or store request bodies, query strings, authorization tokens, cookies, passwords, or raw exception stack traces.
4. **Bounded Memory**: All collections stored in memory must have configurable upper bounds (`maxRecentRequests`, `maxRouteEntries`, `windowSampleSize`).

---

## Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Run the test suite with V8 coverage
npm run test:coverage

# 3. Run ESLint
npm run lint

# 4. Check code formatting with Prettier
npm run format:check

# 5. Build ESM and CommonJS bundles
npm run build
```

---

## Pull Request Checklist

- [ ] All new features or bug fixes include comprehensive unit and/or integration tests in `tests/`.
- [ ] `npm run lint` passes with zero warnings or errors.
- [ ] `npm run format:check` passes.
- [ ] `npm run test:coverage` passes and maintains `>= 90%` statement/line/function coverage and `>= 85%` branch coverage.
- [ ] `npm run build` succeeds and `npm pack --dry-run` includes only distribution assets.
- [ ] Documentation (`README.md`, `docs/API_REFERENCE.md`, `CHANGELOG.md`) is updated to reflect any public API changes.
