# Ramas ERP in Docker — one container

The whole project runs in **one container**:

| Inside the container | What it does |
|---|---|
| SQL Server 2022 (Linux, Express edition by default) | the database, files kept in the `ramas-sql` volume |
| `server/scripts/docker-init-db.js` | runs on every start: creates the database on the first start (or restores a `.bak`), applies `server/db/dev/*.sql`, creates the app's SQL login |
| Node.js API (`server/src/server.js`, production mode) | `/api/...` and the built React app on port 4000 |

Files: `Dockerfile`, `docker-compose.yml`, `docker/entrypoint.sh`, `docker/.env.example`, `.dockerignore`.

## Needs

* Docker Desktop (Windows: WSL 2 backend) — **at least 2 GB of memory for Docker**: SQL Server does not start with less.
* Internet for the first build (Node and SQL Server images, npm packages).

## Start

1. Copy `docker/.env.example` to `.env` in the project folder (next to `docker-compose.yml`) and fill in:
   * `MSSQL_SA_PASSWORD` — strong (upper + lower case, digits, symbol)
   * `DB_PASSWORD` — password of the app's own login `ramas_app`
   * `JWT_SECRET` — 32+ random characters
2. Build and start:

```bash
docker compose up -d --build
```

3. Watch the first start (SQL Server start + schema ≈ 1–3 minutes):

```bash
docker compose logs -f
```

4. Open **http://localhost:8080** and log in with a seed login from `server/db/dev/99-seed.sql` (e.g. `admin`, Division COURIER).
   The container runs in production mode, so a default password must be changed right after the first login.

Other PCs on the network: `http://<this PC's IP>:8080`.

## Use the existing data instead of a new database

On the **first start only** (the database `DB_NAME` does not exist yet in the volume):

1. Put the backup in `docker/backup/` (e.g. `docker/backup/ramas.bak`).
2. In `.env`: `RAMAS_RESTORE_BAK=/backup/ramas.bak`
3. `docker compose up -d --build` — the backup is restored, nothing else is applied.

`RAMAS_DEMO=1` instead loads the dashboard demo data into a new database.

## Day to day

| Task | Command |
|---|---|
| stop / start | `docker compose stop` · `docker compose start` |
| after code changes | `docker compose up -d --build` (the database volume is kept) |
| logs | `docker compose logs -f` |
| status / health | `docker compose ps` |
| SSMS | server `localhost,14330`, SQL login `sa` or `ramas_app` (only from this PC) |
| backup to `docker/backup/` | see below |

Backup (the folder is mounted read-only, so the backup is written inside the volume and copied out):

```bash
docker exec ramas /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "<sa password>" -Q "backup database [ramas] to disk = N'/var/opt/mssql/data/ramas.bak' with init"
```

```bash
docker cp ramas:/var/opt/mssql/data/ramas.bak docker/backup/ramas.bak
```

## Good to know

* The database lives in the Docker volume `ramas-sql`, POD images in `ramas-uploads`. `docker compose down` keeps them;
  `docker compose down -v` **deletes them** (the whole database).
* The set-up never drops or empties a database. A database that already has the Ramas tables is used as it is.
* The API connects with its own login (`DB_USER`), not `sa`. Its password follows `DB_PASSWORD` on every start.
* All users reach the container from the same Docker address, so the per-IP rate limits are raised in
  `docker-compose.yml` (`API_RATE_LIMIT`, `API_WRITE_RATE_LIMIT`).
* SQL Server Express limits: 10 GB per database, 1.4 GB buffer memory. For more, `MSSQL_PID` needs a licensed edition.
* The Windows-only driver `msnodesqlv8` is not installed in the image; the container uses `tedious` (SQL login).
