// Fills an EMPTY test database in the cloud (e.g. the free Azure SQL Database) with the dev schema + seed, optionally the
// DMO demo data, and replaces every seed password before the site is reachable from the internet.
//
//   npm run db:cloud -- --yes-test-db            # schema + seed
//   npm run db:cloud -- --yes-test-db --demo     # + a year of DMO demo data for the dashboard
//
// Uses DB_* from the environment (DB_DRIVER=tedious, DB_SERVER=<name>.database.windows.net, DB_ENCRYPT=true, DB_USER / DB_PASSWORD).
// The new passwords come from the environment too — the run stops before anything is written if one is missing or weak:
//   CLOUD_ADMIN_PASSWORD   for "admin"
//   CLOUD_STAFF_PASSWORD   for EMP001 / EMP002
//   CLOUD_CLIENT_PASSWORD  for CL001
//   CLOUD_FRAN_PASSWORD    for FRS1001
// Safety: the database must already exist (create it in the portal), its name must end in "_test" or "_dev", it must be empty
// (no grn_master table), and --yes-test-db must be given. It never creates or drops a database and never touches a real one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { getPool, closeDb, query } from '../src/db/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const devDir = path.join(here, '..', 'db', 'dev');
const demoFile = path.join(devDir, 'demo', 'demo-data.sql');
const PASSWORDS = {
  CLOUD_ADMIN_PASSWORD: [['users', 'admin']],
  CLOUD_STAFF_PASSWORD: [['users', 'EMP001'], ['users', 'EMP002']],
  CLOUD_CLIENT_PASSWORD: [['ClientLogin_Users', 'CL001']],
  CLOUD_FRAN_PASSWORD: [['Franchisee_Users', 'FRS1001']],
};
const DEV_PASSWORDS = ['admin123', 'emp123', 'client123', 'fran123'];

function batches(file) {
  return fs.readFileSync(file, 'utf8').split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  const name = config.db?.database ?? '';
  if (!args.includes('--yes-test-db')) throw new Error('Refusing: add --yes-test-db to confirm this is an empty TEST database.');
  if (!/_(test|dev)$/i.test(name)) throw new Error(`Refusing: the database name must end in "_test" or "_dev" (got "${name}").`);

  // every new password must be set, long enough and not one of the dev passwords
  const problems = [];
  for (const key of Object.keys(PASSWORDS)) {
    const v = process.env[key] ?? '';
    if (v.length < 10) problems.push(`${key} must be set (10+ characters)`);
    else if (DEV_PASSWORDS.includes(v)) problems.push(`${key} must not be a dev password`);
  }
  if (problems.length) throw new Error(`Set the new login passwords first:\n - ${problems.join('\n - ')}`);

  config.db.requestTimeout = Math.max(config.db.requestTimeout ?? 0, 600000);
  const pool = await getPool('main');
  const [{ used }] = await query("select case when object_id('grn_master') is null then 0 else 1 end as used");
  if (used) throw new Error(`Refusing: ${name} already has the Ramas tables. Use an empty database.`);

  const files = fs.readdirSync(devDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const list = batches(path.join(devDir, f));
    for (const b of list) await pool.request().batch(b);
    console.log(`Applied ${f} (${list.length} batch${list.length === 1 ? '' : 'es'})`);
  }
  if (args.includes('--demo')) {
    for (const b of batches(demoFile)) await pool.request().batch(b);
    console.log('Loaded the DMO demo data');
  }

  for (const [key, targets] of Object.entries(PASSWORDS)) {
    for (const [table, user] of targets) {
      await query(`update ${table} set user_password = @p where user_id = @u`, { p: process.env[key], u: user });
    }
  }
  const left = await query(
    `select user_id from users where user_password in (select value from string_split(@d, ','))
     union all select user_id from ClientLogin_Users where user_password in (select value from string_split(@d, ','))
     union all select user_id from Franchisee_Users where user_password in (select value from string_split(@d, ','))`,
    { d: DEV_PASSWORDS.join(',') });
  if (left.length) throw new Error(`Dev passwords still set for: ${left.map((r) => r.user_id).join(', ')}`);
  console.log('Seed passwords replaced (admin, EMP001, EMP002, CL001, FRS1001).');
  await closeDb();
  console.log(`${name} is ready.`);
}

main().catch(async (err) => {
  console.error(err.message);
  await closeDb();
  process.exit(1);
});
