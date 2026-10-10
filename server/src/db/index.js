// Data access helpers. Replaces ClassLibrary/SQLHelper.cs, grn_class/DAL/SQLHelper.cs
// and the hundreds of hand-rolled SqlConnection/SqlDataAdapter blocks.
//
// Rules for everything that uses this module:
//   * Values ALWAYS go through parameters (never string concatenation) — the legacy
//     code concatenated user input into SQL in many places (SQL injection).
//   * Identifiers (table/column names) may only come from server-side constants.

import { config } from '../config.js';
import { logger } from '../utils/logger.js';

let sqlLib; // the `mssql` module for the configured driver
const pools = new Map();

async function loadDriver(driver) {
  if (driver === 'msnodesqlv8') {
    const mod = await import('mssql/msnodesqlv8.js');
    return mod.default ?? mod;
  }
  const mod = await import('mssql');
  return mod.default ?? mod;
}

function toPoolConfig(c) {
  if (c.driver === 'msnodesqlv8') {
    const server = c.instance ? `${c.server}\\${c.instance}` : `${c.server},${c.port}`;
    const auth = c.user
      ? `Uid=${c.user};Pwd=${c.password};`
      : 'Trusted_Connection=Yes;';
    return {
      connectionString: `Driver={${c.odbcDriver}};Server=${server};Database=${c.database};${auth}TrustServerCertificate=Yes;`,
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      connectionTimeout: 60000,
      requestTimeout: c.requestTimeout ?? 120000,
    };
  }
  return {
    server: c.server,
    port: c.instance ? undefined : c.port,
    database: c.database,
    user: c.user,
    password: c.password,
    options: {
      encrypt: c.encrypt,
      trustServerCertificate: c.trustServerCertificate,
      instanceName: c.instance || undefined,
      enableArithAbort: true,
    },
    pool: { max: 20, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: c.requestTimeout ?? 120000,
  };
}

export async function initDb() {
  sqlLib = await loadDriver(config.db.driver);
  await getPool('main');
}

export function sql() {
  if (!sqlLib) throw new Error('Database driver not initialised; call initDb() first');
  return sqlLib;
}

export async function getPool(name = 'main') {
  if (pools.has(name)) return pools.get(name);
  const c = name === 'fleet' ? config.fleetDb : config.db;
  if (!c) return null;
  if (!sqlLib) sqlLib = await loadDriver(config.db.driver);
  const pool = new sqlLib.ConnectionPool(toPoolConfig(c));
  const connecting = pool.connect().then(() => pool);
  pools.set(name, connecting);
  connecting.catch(() => pools.delete(name));
  return connecting;
}

export async function closeDb() {
  for (const p of pools.values()) {
    try { (await p).close(); } catch { /* ignore */ }
  }
  pools.clear();
}

/**
 * Bind inputs to a request. `inputs` is { name: value } or { name: { type, value } }.
 * Names are given without the leading "@".
 */
function bindInputs(request, inputs = {}) {
  for (const [name, v] of Object.entries(inputs)) {
    if (v && typeof v === 'object' && 'type' in v && 'value' in v) {
      request.input(name, v.type, normalise(v.value));
    } else {
      request.input(name, normalise(v));
    }
  }
}

function normalise(v) {
  // The legacy code frequently sent '' where the SP expects NULL-able values; we
  // keep '' as-is to preserve behaviour, but undefined becomes NULL.
  return v === undefined ? null : v;
}

async function newRequest({ tx, db = 'main' } = {}) {
  if (tx) return new (sql().Request)(tx);
  const pool = await getPool(db);
  if (!pool) throw new Error(`Database "${db}" is not configured`);
  return pool.request();
}

/** Run parameterised SQL text. Returns the first recordset (array of rows). */
export async function query(text, inputs, opts) {
  const request = await newRequest(opts);
  bindInputs(request, inputs);
  const result = await request.query(text);
  return result.recordset ?? [];
}

/**
 * Execute a stored procedure.
 * @param {string} proc      procedure name (server-side constant only)
 * @param {object} inputs    { param: value }
 * @param {object} outputs   { param: sqlType | [sqlType, initialValue] }  e.g. { retval: sql().Int }
 * @returns {{ recordset, recordsets, output, returnValue, rowsAffected }}
 */
export async function exec(proc, inputs = {}, outputs = {}, opts = {}) {
  const request = await newRequest(opts);
  bindInputs(request, inputs);
  for (const [name, t] of Object.entries(outputs)) {
    if (Array.isArray(t)) request.output(name, t[0], t[1]);
    else request.output(name, typeof t === 'function' ? t() : t);
  }
  const result = await request.execute(proc);
  return {
    recordset: result.recordset ?? [],
    recordsets: result.recordsets ?? [],
    output: result.output ?? {},
    returnValue: result.returnValue,
    rowsAffected: result.rowsAffected,
  };
}

/** Run `fn(tx)` inside a transaction on the main database; commits or rolls back. */
export async function withTransaction(fn, { db = 'main' } = {}) {
  const pool = await getPool(db);
  const tx = new (sql().Transaction)(pool);
  await tx.begin();
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw err;
  }
}

/**
 * The legacy DALs repeated every master insert/update/delete against the fleet
 * (FMS) database and silently ignored failures. We keep that behaviour: it is
 * best-effort, logged, and skipped entirely when FLEET_DB_NAME is not set.
 */
export async function mirrorToFleet(proc, inputs, outputs) {
  if (!config.fleetDb) return;
  try {
    await exec(proc, inputs, outputs, { db: 'fleet' });
  } catch (err) {
    logger.warn(`Fleet DB mirror of ${proc} failed: ${err.message}`);
  }
}
