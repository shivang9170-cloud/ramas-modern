import { fileURLToPath } from 'node:url';

// Central configuration. Everything that used to be hard-coded in web.config or
// ClassLibrary/Class1.cs is read from environment variables here.

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function bool(name, fallback) {
  const v = env(name);
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function dbConfig(prefix) {
  const name = env(`${prefix}_NAME`);
  if (!name) return null;
  return {
    driver: env(`${prefix}_DRIVER`, env('DB_DRIVER', 'tedious')),
    server: env(`${prefix}_SERVER`, 'localhost'),
    port: Number(env(`${prefix}_PORT`, 1433)),
    instance: env(`${prefix}_INSTANCE`),
    database: name,
    user: env(`${prefix}_USER`),
    password: env(`${prefix}_PASSWORD`),
    encrypt: bool(`${prefix}_ENCRYPT`, bool('DB_ENCRYPT', false)),
    trustServerCertificate: bool(`${prefix}_TRUST_SERVER_CERT`, bool('DB_TRUST_SERVER_CERT', true)),
    odbcDriver: env(`${prefix}_ODBC_DRIVER`, env('DB_ODBC_DRIVER', 'ODBC Driver 17 for SQL Server')),
    requestTimeout: Number(env(`${prefix}_REQUEST_TIMEOUT`, 120000)),
  };
}

const nodeEnv = env('NODE_ENV', 'development');

export const config = {
  env: nodeEnv,
  isProd: nodeEnv === 'production',
  port: Number(env('PORT', 4000)),
  // other sites allowed to call the API from a browser; production default: none (the app is served by this server)
  corsOrigins: env('CORS_ORIGINS', nodeEnv === 'production' ? '' : 'http://localhost:5173')
    .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
  // API rate limits per client IP (window in minutes); RATE_LIMIT_OFF=1 only for the automated tests
  rateLimit: {
    windowMs: Number(env('RATE_LIMIT_WINDOW_MIN', 5)) * 60 * 1000,
    max: Number(env('API_RATE_LIMIT', 3000)),
    writeMax: Number(env('API_WRITE_RATE_LIMIT', 600)),
    off: bool('RATE_LIMIT_OFF', false),
  },
  // a login with a default / weak password must change it before using the app (on by default in production)
  forcePasswordChange: bool('FORCE_PASSWORD_CHANGE', nodeEnv === 'production'),
  jwt: {
    secret: env('JWT_SECRET'),
    expiresIn: env('JWT_EXPIRES_IN', '10h'),
  },
  db: dbConfig('DB'),
  fleetDb: dbConfig('FLEET_DB'),
  companyCode: env('COMPANY_CODE', 'RELL'),
  clientDist: env('CLIENT_DIST'),
  // SQL user-defined table types used as table-valued parameters by legacy
  // procedures. The C# code only passed a DataTable, so the type names must be
  // confirmed from the schema script (docs/SCHEMA-VERIFICATION.md).
  tvp: {
    manifestGrn: env('TVP_MANIFEST_GRN', 'dbo.udt_Manifest_grn'),
    // sp_insert_Dispatch_Master @dtMainfest_no (mainfest_no) and
    // @ud_Transaction_Details (Ledger_code, Amount_Dr, Amount_Cr, Balance, TransId, Entry, Mode)
    challanManifest: env('TVP_CHALLAN_MANIFEST', 'dbo.udt_Mainfest_no'),
    transaction: env('TVP_TRANSACTION', 'dbo.ud_Transaction_Details'),
    // sp_insert_Arrival_Entry @dtArrival_Entry (see db/dev/07-arrival.sql for the columns sent)
    arrivalEntry: env('TVP_ARRIVAL_ENTRY', 'dbo.udt_Arrival_Entry'),
    // usp_insert_DRS @dtDrs_entry_details_grn (docket_no, freight, weight, packg, Location,
    // pending_Package, pending_freight, pending_weight, challan_no) — columns from Drs_Entry.aspx.cs
    drsGrn: env('TVP_DRS_GRN', 'dbo.udt_Drs_entry_details_grn'),
    // usp_insert_Pod_Dispatch @dtPod_Dispatch_image (ImagePath)
    podImage: env('TVP_POD_IMAGE', 'dbo.udt_Pod_Dispatch_image'),
  },
  // Where POD images are written. Point it at the legacy site's wwwroot/PODImage folder to keep
  // both applications showing the same files (paths are stored as "~/PODImage/<file>").
  podUploadDir: env('POD_UPLOAD_DIR', fileURLToPath(new URL('../uploads/PODImage/', import.meta.url))),
  podMaxBytes: Number(env('POD_MAX_BYTES', 2 * 1024 * 1024)),
  // POD receive is done only at head office (podreceive.aspx hard-coded B1001).
  headOfficeBranch: env('HEAD_OFFICE_BRANCH', 'B1001'),
};

export function assertConfig() {
  const problems = [];
  if (!config.jwt.secret || config.jwt.secret === 'change-me') {
    if (config.isProd) problems.push('JWT_SECRET must be set to a long random value in production');
    else if (!config.jwt.secret) config.jwt.secret = 'dev-only-insecure-secret';
  }
  if (config.isProd && config.jwt.secret && config.jwt.secret.length < 32) problems.push('JWT_SECRET must be at least 32 characters in production');
  if (config.corsOrigins.includes('*')) problems.push('CORS_ORIGINS must list the allowed sites — "*" is not allowed');
  if (!config.db) problems.push('DB_NAME is not set');
  if (problems.length) {
    throw new Error(`Invalid configuration:\n - ${problems.join('\n - ')}`);
  }
}
