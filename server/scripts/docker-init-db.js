// Database set-up inside the Docker container (docker/entrypoint.sh runs it after SQL Server starts, before the API).
//
//   1. waits until SQL Server (same container) accepts the "sa" login — the very first start can take a minute
//   2. if the database DB_NAME does not exist: restores RAMAS_RESTORE_BAK when it is given (a .bak under /backup),
//      otherwise creates it empty
//   3. on a database without the Ramas tables: applies db/dev/*.sql (schema, procedures, menus, seed logins) and,
//      with RAMAS_DEMO=1, the demo data (db/dev/demo/demo-data.sql + demo-accounts.sql)
//   4. creates / updates the application's SQL login DB_USER (password DB_PASSWORD) as db_owner of DB_NAME —
//      the API never uses "sa"
//
// It never drops or empties anything: a database that already has the Ramas tables is used as it is.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';

const here = path.dirname(fileURLToPath(import.meta.url));
const devDir = path.join(here, '..', 'db', 'dev');
const demoFiles = ['demo-data.sql', 'demo-accounts.sql'].map((f) => path.join(devDir, 'demo', f));

const env = (name, fallback) => (process.env[name] === undefined || process.env[name] === '' ? fallback : process.env[name]);
const dbName = env('DB_NAME', '');
const appUser = env('DB_USER', '');
const appPassword = env('DB_PASSWORD', '');
const saPassword = env('MSSQL_SA_PASSWORD', '');
const restoreBak = env('RAMAS_RESTORE_BAK', '');
const demo = ['1', 'true', 'yes'].includes(String(env('RAMAS_DEMO', '0')).toLowerCase());
const server = env('DB_SERVER', '127.0.0.1');
const port = Number(env('DB_PORT', 1433));

// T-SQL string literal (for statements that cannot take parameters: CREATE LOGIN, RESTORE … MOVE)
const lit = (s) => `N'${String(s).replace(/'/g, "''")}'`;
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/;

function checkSettings() {
  const problems = [];
  if (!NAME.test(dbName)) problems.push('DB_NAME must be set (letters, digits and _ only)');
  if (!NAME.test(appUser) || appUser.toLowerCase() === 'sa') problems.push('DB_USER must be set to the application login name (letters, digits, _; not sa)');
  if (appPassword.length < 10) problems.push('DB_PASSWORD must be set (10+ characters, upper + lower case and digits)');
  if (!saPassword) problems.push('MSSQL_SA_PASSWORD must be set');
  if (restoreBak && !restoreBak.toLowerCase().endsWith('.bak')) problems.push('RAMAS_RESTORE_BAK must be the path of a .bak file, e.g. /backup/ramas.bak');
  if (problems.length) throw new Error(`Docker settings missing:\n - ${problems.join('\n - ')}`);
}

const poolConfig = (database) => ({
  server,
  port,
  database,
  user: 'sa',
  password: saPassword,
  options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
  pool: { max: 2, min: 0 },
  connectionTimeout: 15000,
  // the big schema batches and a restore can take minutes on a small machine
  requestTimeout: 900000,
});

async function waitForServer() {
  for (let i = 1; ; i += 1) {
    try {
      return await new sql.ConnectionPool(poolConfig('master')).connect();
    } catch (err) {
      if (i >= 90) throw new Error(`SQL Server did not accept the sa login after 3 minutes: ${err.message}`);
      if (i % 10 === 1) console.log(`Waiting for SQL Server … (${err.message})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function restore(master) {
  if (!fs.existsSync(restoreBak)) throw new Error(`RAMAS_RESTORE_BAK: ${restoreBak} not found — put the .bak in docker/backup/ (mounted at /backup)`);
  const files = (await master.request().query(`restore filelistonly from disk = ${lit(restoreBak)}`)).recordset;
  const moves = files.map((f, i) => {
    const ext = f.Type === 'L' ? 'ldf' : i === 0 ? 'mdf' : 'ndf';
    return `move ${lit(f.LogicalName)} to ${lit(`/var/opt/mssql/data/${dbName}_${i}.${ext}`)}`;
  });
  console.log(`Restoring ${dbName} from ${restoreBak} …`);
  await master.request().query(`restore database [${dbName}] from disk = ${lit(restoreBak)} with ${moves.join(', ')}, recovery`);
  console.log(`Restored ${dbName}`);
}

async function applyFiles(pool, files) {
  for (const file of files) {
    const batches = fs.readFileSync(file, 'utf8').split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean);
    for (const b of batches) await pool.request().batch(b);
    console.log(`Applied ${path.relative(devDir, file)} (${batches.length} batch${batches.length === 1 ? '' : 'es'})`);
  }
}

async function main() {
  checkSettings();
  const master = await waitForServer();
  try {
    const [{ id }] = (await master.request().input('n', sql.NVarChar, dbName).query('select db_id(@n) as id')).recordset;
    if (!id) {
      if (restoreBak) await restore(master);
      else {
        await master.request().query(`create database [${dbName}]`);
        console.log(`Created ${dbName}`);
      }
      // Express creates databases with AUTO_CLOSE on: every new connection would reopen the database
      await master.request().query(`alter database [${dbName}] set auto_close off`);
    }

    // application login: created once, password kept in step with DB_PASSWORD on every start
    await master.request().input('u', sql.NVarChar, appUser).input('p', sql.NVarChar, appPassword).query(`
      declare @s nvarchar(max) = case when suser_id(@u) is null then N'create login ' else N'alter login ' end
        + quotename(@u) + N' with password = N''' + replace(@p, N'''', N'''''') + N'''';
      exec (@s);
      if exists (select 1 from sys.server_principals where name = @u and is_disabled = 1)
        exec (N'alter login ' + quotename(@u) + N' enable');`);
  } finally {
    await master.close();
  }

  const db = await new sql.ConnectionPool(poolConfig(dbName)).connect();
  try {
    const [{ used }] = (await db.request().query("select case when object_id('grn_master') is null then 0 else 1 end as used")).recordset;
    if (used) console.log(`${dbName} already has the Ramas tables — nothing applied.`);
    else {
      const files = fs.readdirSync(devDir).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(devDir, f));
      await applyFiles(db, files);
      if (demo) await applyFiles(db, demoFiles);
      console.log(`${dbName} is ready (seed logins: see server/db/dev/99-seed.sql — production mode asks for a new password at the first login).`);
    }
    // a restored database may carry a user of that name from another server: map it to this server's login
    await db.request().input('u', sql.NVarChar, appUser).query(`
      declare @s nvarchar(max);
      if user_id(@u) is null set @s = N'create user ' + quotename(@u) + N' for login ' + quotename(@u);
      else set @s = N'alter user ' + quotename(@u) + N' with login = ' + quotename(@u);
      exec (@s);
      if is_rolemember('db_owner', @u) = 0 exec (N'alter role db_owner add member ' + quotename(@u));`);
    console.log(`Login ${appUser} can use ${dbName}.`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(`Database set-up failed: ${err.message}`);
  process.exit(1);
});
