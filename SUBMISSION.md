# University Project Submission Guide — API Sentinel

This document contains the three required university submission entries and the exact step-by-step commands to publish your repositories and NPM package.

---

## 1. University Submission Form Entries

> **Note:** Replace the `<YOUR_GITHUB_USERNAME>` placeholders below after pushing the two repositories to your GitHub account and running `npm publish`.

| # | Form Field | Deliverable URL / Value | Status |
| :- | :--- | :--- | :--- |
| **1** | **GitHub Repository (NPM Package Source)** | `https://github.com/aviiixbuilds/api-sentinel-express` | Published on GitHub |
| **2** | **Published NPM Package Link** | `https://www.npmjs.com/package/api-sentinel-express` | Published on NPM Registry |
| **3** | **Consumer Project Deployed Link** | `https://github-profile-checker-xzs3.onrender.com` (Dashboard: `https://api-sentinel-demo-seven.vercel.app`) | Live Deployed Consumer Application |

---

## 2. Step-by-Step Instructions to Publish Deliverable 1 (Package GitHub Repository)

1. Go to [https://github.com/new](https://github.com/new) and create a new **Public** repository named **`api-sentinel-express`** (do not initialize with a README).
2. In `api-sentinel/package.json`, replace `YOUR_GITHUB_USERNAME` with your actual GitHub username.
3. Open your terminal and run:

```bash
cd "/Users/aviral_dwivedi/Desktop/NPM PACKAGE/api-sentinel"

git init
git add .
git commit -m "feat: initial release of api-sentinel-express v1.0.0"
git branch -M main
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/api-sentinel-express.git
git push -u origin main
```

---

## 3. Step-by-Step Instructions to Publish Deliverable 2 (Public NPM Package)

1. Create or log into your account at [https://www.npmjs.com](https://www.npmjs.com).
2. In your terminal, inside `api-sentinel/`, run:

```bash
cd "/Users/aviral_dwivedi/Desktop/NPM PACKAGE/api-sentinel"

# Authenticate with NPM
npm login

# Verify lint, tests, and production build
npm run lint
npm test
npm run build

# Preview exact package contents
npm pack --dry-run

# Publish to public NPM registry
npm publish
```

3. Once completed, verify your live package page at:
   `https://www.npmjs.com/package/api-sentinel-express`

---

## 4. Step-by-Step Instructions to Publish Deliverable 3 (Consumer Demo GitHub Repository)

1. After publishing `api-sentinel-express` to NPM in Step 3, switch the demo backend from the local file path (`"file:../../api-sentinel"`) to the real published NPM package:

```bash
cd "/Users/aviral_dwivedi/Desktop/NPM PACKAGE/api-sentinel-demo/backend"
npm install api-sentinel-express@latest
npm test
```

2. Go to [https://github.com/new](https://github.com/new) and create a second **Public** repository named **`api-sentinel-demo`**.
3. Push the `api-sentinel-demo` directory to that repository:

```bash
cd "/Users/aviral_dwivedi/Desktop/NPM PACKAGE/api-sentinel-demo"

git init
git add .
git commit -m "feat: full-stack Express + React observability demo using api-sentinel-express"
git branch -M main
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/api-sentinel-demo.git
git push -u origin main
```

---

## 5. Testing a Fresh Installation Before Submitting the Form

To verify everything works identically to how your faculty evaluator will test it:

```bash
mkdir /tmp/sentinel-clean-check && cd /tmp/sentinel-clean-check
npm init -y
npm install express api-sentinel-express
node -e "import('api-sentinel-express').then(m => console.log('Loaded:', typeof m.createApiSentinel))"
```
