# Free test hosting on Azure

Puts the new Ramas app on the internet for **testing from other computers**, at no cost, with its own **test database**
(never the real one). One web address serves both the React app and the API.

| Part | Azure service | Free limit |
|---|---|---|
| Database | Azure SQL Database — free offer | 100,000 vCore-seconds and 32 GB per month; pauses until next month when used up |
| App + API | App Service, Linux, **F1 (Free)** plan, Node 22 | 60 CPU-minutes a day, 1 GB RAM; sleeps after ~20 minutes idle (first open then takes ~30 s) |

Prepared in the code:

* `server` connects with a SQL login (`DB_DRIVER=tedious`, `DB_ENCRYPT=true`) and serves the built React app (`CLIENT_DIST`).
* `npm run db:cloud` fills an **empty** test database with the schema + seed (+ the DMO demo data with `--demo`) and **replaces
  every seed password** — it refuses to run without new passwords, on a database whose name does not end in `_test`, or on a
  database that already has the Ramas tables.
* `scripts\make-azure-package.ps1` builds the React app and makes `azure-package.zip` (no `.env`, no secrets, no tests).

Steps 1, 2, 4 and 5 are done by you in the Azure portal (they need your account); I can run steps 3 and 6 with you.

---

## 1. Azure account (you)

1. Open <https://azure.microsoft.com/free> and sign up. Azure asks for a card **only to check your identity**; the free offers
   below cost nothing. (A student can use *Azure for Students*, which needs no card.)
2. After signing in, open **Cost Management → Budgets** and add a budget of ₹100 with an e-mail alert, so you hear at once if
   anything ever starts to cost money.

## 2. Test database (you)

1. Portal → search **SQL databases** → **Create**. Click **Apply offer** on the blue *"Want to try Azure SQL Database for free?"* banner.
2. Basics:
   * Resource group: **Create new** → `ramas-test-rg`
   * Database name: **`ramas_test`** (must end in `_test`)
   * Server: **Create new** → name e.g. `ramas-test-sql-<yourname>`, location **Central India**, authentication
     **Use SQL authentication**, choose an admin login (e.g. `ramasadmin`) and a strong password — keep them safe.
   * Behaviour when the free limit is reached: **Auto-pause the database until next month**.
3. Networking: Connectivity **Public endpoint**; **Allow Azure services and resources to access this server = Yes**;
   **Add current client IP address = Yes** (so the setup can run from your PC).
4. **Review + create** → **Create**. Note the server name `…database.windows.net`.

## 3. Fill the test database (from your PC)

In a PowerShell window in `D:\rr\ramas-modern` (put your values in place of the `<…>`; the four new login passwords are for
the people who will test — 10+ characters each, not the old dev ones):

```powershell
$env:NODE_ENV = 'development'
$env:DB_DRIVER = 'tedious'; $env:DB_SERVER = '<server>.database.windows.net'; $env:DB_PORT = '1433'
$env:DB_NAME = 'ramas_test'; $env:DB_USER = '<admin login>'; $env:DB_PASSWORD = '<admin password>'
$env:DB_ENCRYPT = 'true'; $env:DB_TRUST_SERVER_CERT = 'false'
$env:CLOUD_ADMIN_PASSWORD = '<new password for admin>'
$env:CLOUD_STAFF_PASSWORD = '<new password for EMP001 / EMP002>'
$env:CLOUD_CLIENT_PASSWORD = '<new password for CL001>'
$env:CLOUD_FRAN_PASSWORD = '<new password for FRS1001>'
npm --prefix server run db:cloud -- --yes-test-db --demo
```

Leave out `--demo` for an empty system (only the seed masters). It ends with `ramas_test is ready.`

## 4. Web app (you)

1. Portal → **App Services** → **Create** → **Web App**.
2. Resource group `ramas-test-rg`; name e.g. `ramas-test-<yourname>` (this becomes `https://ramas-test-<yourname>.azurewebsites.net`);
   Publish **Code**; Runtime stack **Node 22 LTS**; Operating system **Linux**; Region **Central India**;
   Pricing plan → **Explore pricing plans** → **Free F1**. **Review + create** → **Create**.

## 5. Settings of the web app (you)

Web app → **Settings → Environment variables → App settings**, add (then **Apply**):

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | a long random value — make one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `DB_DRIVER` | `tedious` |
| `DB_SERVER` | `<server>.database.windows.net` |
| `DB_PORT` | `1433` |
| `DB_NAME` | `ramas_test` |
| `DB_USER` / `DB_PASSWORD` | the SQL admin login / password from step 2 |
| `DB_ENCRYPT` | `true` |
| `DB_TRUST_SERVER_CERT` | `false` |
| `CLIENT_DIST` | `/home/site/wwwroot/client-dist` |
| `CORS_ORIGINS` | `https://<your web app>.azurewebsites.net` |
| `POD_UPLOAD_DIR` | `/home/data/PODImage` |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `true` |

**Settings → Configuration → General settings → Startup Command**: `npm start` → **Save**.

## 6. Upload the app

1. Make the package: `powershell -ExecutionPolicy Bypass -File scripts\make-azure-package.ps1` → `azure-package.zip`.
2. Upload it — either way works:
   * **VS Code**: install the *Azure App Service* extension, sign in, right-click your web app → **Deploy to Web App…** →
     choose the `azure-package` folder.
   * **Azure CLI**: `winget install Microsoft.AzureCLI`, then `az login` (you sign in in the browser) and
     `az webapp deploy --resource-group ramas-test-rg --name <your web app> --src-path azure-package.zip --type zip`.
3. Azure installs the packages (a few minutes). Open `https://<your web app>.azurewebsites.net` and log in with the new
   passwords from step 3. Share the link and the passwords only with the people who test.

To update later: run the package script again and upload again (step 6). The database keeps its data.

## Checks and limits

* The first open after a quiet spell is slow (F1 sleeps); after that it is normal speed.
* If the site shows *"Application Error"*: web app → **Log stream** shows why (usually a wrong app setting).
* *Cannot connect to the database*: SQL server → **Networking** → the firewall must allow Azure services (and your IP for step 3);
  the database may be **paused** if the monthly free limit is used up.
* Test data only — never load the real database or real customer data here.
* When testing is over: portal → resource group `ramas-test-rg` → **Delete resource group** removes everything.
