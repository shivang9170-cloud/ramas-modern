// Creates (or recreates) the local DEV database from db/dev/*.sql.
//
//   npm run db:dev                 # uses DB_* from .env
//   npm run db:dev -- --drop       # drop and recreate
//
// Refuses to run unless NODE_ENV=development and DB_NAME ends with "_dev",
// so it can never touch a real database.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { getPool, closeDb, query } from '../src/db/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, '..', 'db', 'dev');

async function main() {
  if (config.env !== 'development' || !config.db?.database?.endsWith('_dev')) {
    throw new Error('Refusing: set NODE_ENV=development and use a DB_NAME ending in "_dev".');
  }
  const dbName = config.db.database;
  const drop = process.argv.includes('--drop');
  // CREATE DATABASE and the big batches can take minutes on a machine short of memory.
  config.db.requestTimeout = Math.max(config.db.requestTimeout ?? 0, 600000);

  // Connect to "master" to create the database.
  const target = config.db.database;
  config.db.database = 'master';
  const masterRows = await query('select db_id(@n) as id', { n: target });
  if (masterRows[0].id && !drop) {
    console.log(`Database ${target} already exists (use --drop to recreate).`);
    await closeDb();
    return;
  }
  if (masterRows[0].id) {
    await query(`alter database [${target}] set single_user with rollback immediate; drop database [${target}];`);
    console.log(`Dropped ${target}`);
  }
  await query(`create database [${target}]`);
  // SQL Server Express creates databases with AUTO_CLOSE on, which makes every
  // new connection reopen the database (very slow on a machine short of memory).
  await query(`alter database [${target}] set auto_close off`);
  console.log(`Created ${target}`);
  await closeDb();

  config.db.database = dbName;
  const pool = await getPool('main');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const batches = fs.readFileSync(path.join(dir, f), 'utf8').split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
    for (const b of batches) await pool.request().batch(b);
    console.log(`Applied ${f} (${batches.length} batch${batches.length === 1 ? '' : 'es'})`);
  }
  await closeDb();
  console.log('Dev database ready.');
}

main().catch(async (err) => {
  console.error(err.message);
  await closeDb();
  process.exit(1);
});
