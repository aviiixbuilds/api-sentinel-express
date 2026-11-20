# NPM Publishing Guide — `api-sentinel-express`

## 1. Verified Package Name Availability

The package name **`api-sentinel-express`** was checked against the public NPM registry (`https://registry.npmjs.org/api-sentinel-express`):

```text
npm view api-sentinel-express
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/api-sentinel-express - Not found
npm error 404  'api-sentinel-express@*' is not in this registry.
```

The name `api-sentinel-express` is currently **available** for registration.

> **Fallback Option**: If `api-sentinel-express` is claimed before you run `npm publish`, you can publish under your personal NPM scope by setting `"name": "@<your-npm-username>/api-sentinel-express"` in `package.json` and running `npm publish --access public`.

---

## 2. Pre-Publication Checklist

Before publishing, update the placeholder metadata fields in `api-sentinel/package.json`:

1. `"author"`: Replace `<your-email@example.com>` with your actual email address.
2. `"homepage"`, `"bugs.url"`, `"repository.url"`: Replace `YOUR_GITHUB_USERNAME` with your actual GitHub username once you create the GitHub repository.

---

## 3. Step-by-Step Publishing Commands

Run the following commands inside the `api-sentinel/` directory:

```bash
# Step 1: Authenticate with your NPM account
npm login

# Step 2: Confirm your authenticated NPM username
npm whoami

# Step 3: Run ESLint and Prettier verification
npm run lint
npm run format:check

# Step 4: Run the complete test suite with V8 coverage
npm run test:coverage

# Step 5: Build the production ESM (dist/index.js) and CommonJS (dist/index.cjs) bundles
npm run build

# Step 6: Inspect the exact files that will be packaged (Dry Run)
npm pack --dry-run

# Step 7: Publish the package to the public NPM registry
npm publish
```

*(If publishing a scoped package such as `@username/api-sentinel-express`, use `npm publish --access public` in Step 7).*

---

## 4. What Gets Included in the Published Tarball

Because `package.json` defines:

```json
"files": [
  "dist",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "SECURITY.md"
]
```

Running `npm pack --dry-run` packages **only** the compiled distribution files (`dist/index.js`, `dist/index.cjs`, and their source maps) plus essential root documentation (`package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, `SECURITY.md`). Source tests (`tests/`), benchmarks (`benchmarks/`), examples (`examples/`), and development configurations are automatically excluded.

---

## 5. Verifying the Published Package

After `npm publish` succeeds:

1. Visit `https://www.npmjs.com/package/api-sentinel-express` in your browser.
2. Test installing it into the consumer demo application (`api-sentinel-demo/backend`):

```bash
cd ../api-sentinel-demo/backend
npm install api-sentinel-express@latest
npm test
```
