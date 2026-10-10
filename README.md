# Ramas ERP — Node.js REST API + React

Replacement for the ASP.NET WebForms application (`Ramas_Project`: 614 `.aspx` pages,
ClassLibrary PAL/BAL/DAL, `OperationService`, 105 Crystal Reports) using:

| Layer    | Stack |
|----------|-------|
| API      | Node.js 20+ · Express 4 · `mssql` (same SQL Server DB and stored procedures) · JWT · zod |
| Web      | React 18 · Vite · Ant Design 5 · TanStack Query · React Router |
| Shared   | `shared/docketCalc.js` (docket freight/GST), `shared/challanCalc.js` (vehicle hire/TDS) — used by both API and UI |

The new app talks to the **existing database and stored procedures** — no data migration is
needed, and the old and new apps can run side by side during the transition.

```
ramas-modern/
├─ server/                  Express API
│  ├─ src/
│  │  ├─ config.js          all settings from environment variables
│  │  ├─ db/index.js        pool, parameterised query/exec, transactions, fleet-DB mirror
│  │  ├─ middleware/        JWT auth, errors, validation
│  │  └─ modules/
│  │     ├─ auth/           login (employee/franchisee/client/admin), branch switch, password
│  │     ├─ menu/           DB-driven sidebar menu, dashboard tiles, access-rights editor
│  │     ├─ masters/        declarative masters engine (State, Zone, City, …)
│  │     ├─ docket/         docket (GRN) booking: lookups, save/modify/cancel, tracking
│  │     └─ reports/        report definitions (Crystal Reports replacement pattern)
│  ├─ db/dev/               DEV-ONLY schema + stand-in procedures for local testing
│  ├─ scripts/setup-dev-db.js
│  └─ test/                 unit + integration tests (node:test + supertest)
├─ client/                  React app
│  └─ src/
│     ├─ routes/legacyRoutes.js   legacy .aspx URL → React route map
│     ├─ layout/AppLayout.jsx     sidebar (from DB menu), branch switcher, header
│     └─ pages/                   login, dashboard, masters, docket, reports, tracking, admin
├─ shared/docketCalc.js, challanCalc.js
└─ docs/                    migration guide, security findings, verification checklist, page inventory
```

## Run it locally

Requirements: Node.js 20+ and access to a SQL Server database.

### 1. API

```bash
cd server
npm install
copy .env.example .env      # then edit .env
npm run dev                 # http://localhost:4000/api/health
```

Point `DB_*` at a **copy/restore of the production database** (recommended) — the API calls the
real stored procedures. Use `DB_DRIVER=tedious` with a SQL login, or `DB_DRIVER=msnodesqlv8`
for Windows authentication (e.g. local SQL Express).

**Without the real database** you can use the dev database (inferred from the legacy code,
covers only the pilot modules):

```bash
# .env: NODE_ENV=development, DB_NAME must end with _dev
npm run db:dev -- --drop
```

Dev logins (division COURIER): `admin/admin123`, `EMP001/emp123`, `FRS1001/fran123` (Franchisee), `CL001/client123` (Client).

### 2. Web

```bash
cd client
npm install
npm run dev                 # http://localhost:5173  (proxies /api to :4000)
```

### 3. Tests

```bash
cd server
npm test        # calculation unit tests + API integration tests (integration needs the *_dev DB)
```

Full test of the whole project (API tests, production build check, and a UI test that opens every page in headless
Microsoft Edge and clicks every tab — as EMP001 and as admin). The dev servers must be running:

```bash
powershell -ExecutionPolicy Bypass -File scripts/test-all.ps1
```

Only the UI test, or only some pages: `node scripts/ui-test.mjs` / `node scripts/ui-test.mjs accounts`.
Reports go to `docs/test-reports/`.

## Production

1. `cd client && npm run build` → static files in `client/dist`.
2. Run the API with `NODE_ENV=production`, a strong `JWT_SECRET`, SQL credentials in the
   environment (never in files), and either:
   - `CLIENT_DIST=<path>/client/dist` to let Express serve the UI, or
   - serve `client/dist` from IIS/nginx and reverse-proxy `/api` to Node.
3. Put it behind HTTPS.

## What is migrated

See [docs/MIGRATION.md](docs/MIGRATION.md) for status, conventions and how to convert the
next page, [docs/page-inventory.csv](docs/page-inventory.csv) for all 614 pages,
[docs/SECURITY.md](docs/SECURITY.md) for issues found in the legacy app, and
[docs/SCHEMA-VERIFICATION.md](docs/SCHEMA-VERIFICATION.md) for what to check once the database
script is available.
