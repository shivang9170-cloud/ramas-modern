# Security findings in the legacy application

Found while reading the code. Items marked **URGENT** affect the system running today and
should be fixed there regardless of the migration.

| # | Severity | Finding | Where | Status in new app |
|---|----------|---------|-------|-------------------|
| 1 | **URGENT** | `Change_Password.aspx?dsr=<anything>` writes the full database connection string (server, user, **password**) into the page — before any login check. | `wwwroot/User/Change_Password.aspx.cs` `Page_Load` | Not present. **Remove that block from the live site and change the SQL password.** |
| 2 | **URGENT** | Production SQL credentials are committed in source: `wwwroot/web.config` (public IP `103.25.128.81`) and `ClassLibrary/Class1.cs` (including an `sa` login). Anyone with the zip/repo has database access. | `web.config`, `Class1.cs` | Credentials only from environment variables (`.env` is git-ignored). **Rotate the passwords.** |
| 3 | High | SQL injection: user input is concatenated into SQL in many places (e.g. `ClientLogin_dal.Client_Login`, `login_dal.menu_allowed`, `users_dal.change_users_password`, menu queries in `IOS.master.cs`, master "in use" checks, `Dashboard_Dal.Docket_List`). | ClassLibrary DAL, pages | All values are parameters; identifiers come only from server constants. Tested with an injection payload. |
| 4 | High | Passwords stored and compared in plain text (`users`, `Franchisee_Users`, `ClientLogin_Users`). | login SPs, tables | Still plain text, because the login stored procedures compare in SQL. Comparison in Node is constant-time. **Next step:** add a hashed column + migrate on next login. |
| 5 | High | Docket totals (freight, tax, grand total) were computed in the browser and trusted by the server (server-side check commented out in `ValidateGrnEntry`). A user could post any amount. | `OperationScript.js`, `OperationDAL.ValidateGrnEntry` | Server recomputes all totals (`shared/docketCalc.js`); posted totals are ignored (tested). |
| 6 | Medium | Change password did not ask for the old password. | `Change_Password.aspx` | Old password required. |
| 7 | Medium | No brute-force protection on login. | `login.aspx` | 20 attempts / 15 min per IP. |
| 8 | Medium | Raw exception text shown to users (`alert(ex.Message)`), error log written under the web root. | many pages, `CommonHelper.ErrorLog` | Generic 500 message in production; structured logs to stdout. |
| 9 | Medium | Session state only — no CSRF protection on postbacks; `debug="true"` in `web.config`. | `web.config` | Stateless JWT bearer tokens (no cookies → no CSRF); helmet security headers. |
| 10 | Low | Mail account password in `web.config` `appSettings`. | `web.config` | Not used yet; when added, from environment. |
| 11 | High | **POD upload path traversal:** `Pod_Dispatch.aspx` saved uploads as `Server.MapPath("~/PODImage/" + "(docket)--(iom)--" + file.FileName)` using the name sent by the browser, so a crafted name (`..\..\x.aspx`) could write outside `PODImage` — including executable pages into the web root. The type check looked only at the extension. | `wwwroot/Operation/Pod_Dispatch.aspx.cs` `Button_add_Click` | Names generated on the server (`<docket>-<uuid>.jpg/.pdf`), type checked from the file content, 2 MB limit, files served only through an authenticated endpoint (tested). **Fix the live page too.** |
| 12 | Medium | POD images are served as static files from the web root (`~/PODImage/...`) to anyone who knows or guesses the name — customer signatures and names. | IIS static content | Served only to the dispatching / receiving branch and admin via `GET /api/pod/images/:id`. |
| 13 | High | **SQL injection through the URL:** `Vechile_Master.aspx?x=<vehicle no>` builds its SELECT from the query string (`where VEHICLE_NO='" + vehicleNo + "'"`), reachable by any logged-in user; the list page's autocomplete and status change also concatenate input into SQL. | `wwwroot/Master/Vechile_Master.aspx.cs` `VehicleEdit`, `View_Vechile_Master.aspx.cs` | Parameters everywhere; the vehicle number is validated (tested). **Fix the live page too.** |
| 14 | High | **Employee photo / document upload:** saved as `Server.MapPath("~/EmployeeImage/(code)-" + FileName)` with the name sent by the browser (path traversal — a crafted name can write outside the folder, including `.aspx` into the web root), no type or size check, and the name is then concatenated into `update Employee_Master set vc_Emp_Photo='…'` (SQL injection). | `wwwroot/Master/Employee_Master.aspx.cs` `btnsubmit_Click` / `btnImgUpdate_Click`, Employee_Master_Dal | Upload not accepted in the new app until it is ported the POD way (server-generated names, content check, size limit). **Fix the live page too.** |

## Data integrity bugs found (fixed in the new app)

* **City master:** ODA flag / km entered while creating a city were silently dropped (`usp_Insert_City_Master` has no ODA parameters). New app applies them via the update procedure.
* **Item master delete** deleted by `slno = @item_code` (compared the id to the code). New app deletes by `item_code`.
* **Docket save:** for some `Save_GrnEntry` result codes (e.g. `-2`), the legacy code still inserted charges and committed. New app rolls back on any failure code (tested).
* **Access rights save** deleted all permissions and re-inserted row by row without a transaction (a failure left the user with no menu). New app uses one transaction.
* **Docket booking** did not send the required freight type in the first port; the legacy page requires it and the pickup/manifest searches skip dockets without it. Now required (fixed during the pickup work).
* **Pickup entry** saved the header and its docket rows on separate connections (a failure left an empty pickup) — now one transaction (tested).
* **Pickup entry** stamped docket rows with the pickup no. typed on screen instead of the number returned by `usp_insert_PickUpEntry` (`@retval`) — dockets could be attached to the wrong pickup. Now uses the returned number (tested).
* **Pickup cancel:** the "manifest already generated" check (`Pickup_Entry_Cancel_Dal.ReadManifestStatus`) had `and and` in its SQL, threw, and the error was swallowed — so manifested pickups could be cancelled. Fixed (tested).
* **Pickup search** did not exclude cancelled dockets in the date-range search. Now excluded.
* **Manifest destination lookup** kept its branch/city mode in a `static` field shared by *all users* on the server (one user's choice changed another's search). Now per request.
* **Manifest entry**: the duplicate / pending check was commented out; the success message showed the typed number instead of `@retval`; unticked rows were silently marked cancelled on the loading sheet. All fixed; the API checks every docket is at the branch with enough pending packages (tested).
* **Manifest cancel** built its challan check from the raw postback argument (SQL injection) and the DAL's own check (`challan_no is null and challan_no=''`) could never match. Now parameterised (tested).
* **Manifest split**: splitting a docket's packages left weight/freight at the full value unless retyped, so the whole freight moved with the first part. The screen now prorates both (weight stays editable).
* **Challan number race:** the challan no. (`GET_AUTO_GENERATED_CODE_FOR_ENTRY`) was fetched when the page opened, so two users on the same branch could save the same number. Now generated inside the save transaction (tested).
* **Challan advance check was dead code:** "Advance amount not be greater than total freight" sat inside `if (txtadvance.Text == "")`, so it could never fire. Now enforced (tested).
* **Challan amounts from the browser:** freight, TDS, balance and the manifest weight / package totals were taken from screen fields. Now recomputed on the server from the charges, the vendor's TDS % and `Manifest_grn` (tested).
* **Challan lookups** (vendor rate, route, truck, running-truck, manifest search) concatenated values into SQL — now parameters. The second driver's DL no. was saved as the first driver's — fixed.
* **Arrival entry ran ~10 statements per docket on separate connections**, errors swallowed (a failure half-way left a partial arrival: header without dockets, dockets without the "lies at this branch" row, etc.). Now one transaction around `sp_insert_Arrival_Entry` (tested).
* **Arrival duplicates** were silently skipped yet reported as "Record Successfully Added". Now refused. Received weight/freight came from the browser; now prorated on the server from `Manifest_grn` (weight may be corrected, freight not) (tested).
* **Arrival cancel DRS check** looked at every branch's arrival of the challan, so a DRS at one stop blocked cancelling at another. Now this branch only (tested).
* **Fleet updates on arrival:** `update_TripCreationVoucher` used `@truckno/@TPNO` without adding the parameters (always failed silently); `update_veh_status` concatenated SQL. Both parameterised.
* **DRS number race:** the DRS no. was worked out when the page opened (`maxid` + 1, inline SQL built from the short code) and passed to `usp_insert_DRS`, so two users could save the same number. Now generated inside the save transaction under a lock (tested).
* **DRS search ignored the docket filter** (both branches of `Display()` ran the same query); dockets already out for delivery were silently skipped yet reported as saved; a DRS could be saved with no dockets; the header docket list was always empty. All fixed; split-packet weight/freight and total weight are computed on the server; the DRS date must be on or after each docket's arrival (tested).
* **Delivery status: a DRS vanished after the first save.** `select_all_drs_no` excluded any DRS with at least one status row, so dockets not ticked the first time could never get a status. Now a DRS is listed until every docket has one (tested).
* **Delivery status ran ~6 statements per docket on separate connections** with errors swallowed; duplicates were skipped yet reported as saved; dates were not checked; UNDELIVERED reset `grn_docket_charge.drs_statusC` and `arrival_packg` for every branch the docket had been at; docket numbers were concatenated into the duplicate / bill SQL. Now one transaction, refused duplicates, date ≥ DRS/arrival date and not future, this branch only, parameters (tested).
* **To Pay auto bill** ran for every status (undelivered and lost included) and its failure was swallowed. Now only on delivery, after the save, and failures are reported back (tested).
* **POD dispatch saved the wrong images:** one ViewState table held the images of the *last* docket added and was passed for every docket in the IOM, so all dockets got the same (last) POD. Now each docket keeps its own files (tested). PDFs were rejected by the extension check although the rest of the code handled them; images had no size limit. The IOM no. was generated at page load (race); inserts ran on separate connections with docket numbers concatenated into the update. Cancel hard-deleted the rows and was blocked only while the courier to HO was *not* yet received. All fixed: JPEG + PDF ≤ 2 MB, number and inserts in one transaction, soft cancel blocked once the POD is on any courier document (tested).
* **POD courier to HO:** the document no. was generated at page load (race); header, "IOM sent" flags and detail rows were written separately with IOM numbers concatenated into SQL; a back-dated date was silently replaced with today. Now one transaction (number from `usp_insert_Pod_Dispatch_H` inside it), parameters, and the date must be today (tested).
* **POD receive:** grn_master / grn_docket_charge / POD_Dispatch_D were updated *before* the duplicate check, so skipped dockets were still marked received, and the whole IOM was marked received at HO when only some of its dockets were ticked; no transaction; receive date not checked against today; cancel hard-deleted rows. Now only received dockets are flagged, an IOM / document closes when all its dockets are in, one transaction, date ≤ today, soft cancel (tested).
* **Branch master:** the unique short-code check (the short code is part of every document number) was never reached, so two
  branches could share one and generate clashing numbers; the edit screen overwrote the company with the first in the list; the
  first branch in the controlling-branch list could not be selected; delete removed the row even while dockets, employees or
  routes referred to it; the branch code (`get_id`) was read outside any transaction. Now: short code (and location link)
  checked, company kept, delete refused while in use, code + insert + ledger binding in one transaction (tested).
* **Vendor master:** the vendor code was generated when the page opened (race); the duplicate-name checks concatenated the
  typed name into SQL; the insert and the ledger bindings ran separately with ledger failures ignored; saving an edit with no
  mode ticked threw inside a swallowed try/catch (nothing saved, no message); the edit popup listed every city of every state,
  could not change PIN / PAN / e-mail / fax / remarks and overwrote the first "approved by" item's text; delete removed vendors
  still used by challans, vehicles or ledger entries. All fixed (tested); codes of deleted vendors are not reused (their
  ledgers remain).
* **Vehicle master:** the vehicle ledger was created before the vehicle and stayed behind when the insert failed; the update
  swallowed every error (`catch {}`) and never checked the result; "vehicle route cannot be the same" compared only the first
  two routes on a text change and was never enforced on save; capacity came from a disabled textbox posted by the browser;
  switching the vendor type listed vendors of every division; the list page's status change updated the vehicle held in a
  session value rather than the row clicked; inactive vehicles were still offered on challans. All fixed (tested).
* **Client master:** the client code was generated when the page opened (race); the insert and the two ledger bindings ran
  separately with failures ignored; the "Contract by" list was only filled in the edit popup, so every new client was saved
  without it; the create page's "duplicate" check refused a client whose address / place / e-mail / phone *equalled* an
  existing client's, while the GSTIN checks were commented out; the edit popup found the branch by name with concatenated SQL,
  overwrote the text of the selected submission / collection item, and dropped the PO date; delete removed clients still used
  by dockets, rates, logins or ledger entries. All fixed (tested).
* **Employee master:** the employee code came from two generators at page load (a count, then a gap-filler), so codes
  could collide and a deleted employee's code was reissued; insert, photo-path update and ledger bindings ran separately
  with failures ignored; "effective from ≥ joining date" parsed the dates with the server culture while saving them as
  dd/MM/yyyy; an edit without a new document replaced the document path with the photo path; delete removed employees still
  used by logins, permissions, pickups, DRS, clients, vendors, reports-to links or ledger entries; pickup and DRS offered
  inactive staff, and DRS lost staff belonging to more than one division. All fixed (tested).
* **User master (logins):** choosing an employee with a login wrote the current password into the page's HTML (the input's
  `value` attribute — visible in "view source" and the browser cache); the status popup chose the user by employee *name*
  and its UPDATE also wrote `user_password` from an empty field; the access-branch read concatenated the employee code into
  SQL; every error showed "Sorry Duplicate!"; inactive logins could still sign in. Passwords are never sent to the browser
  now, changes go to the chosen user id only, parameters everywhere, inactive logins are refused (tested).
* **Client contract (City To City):** the "rate already added" check compared the destination with the array's type name
  (`ToCityCode.ToString()`) and the load type of list row 1 instead of the current row, so duplicate rates went through (or the
  page crashed with a single row); the halting charge was saved from the OCR box; rows were inserted one by one on separate
  connections, so a failure left half a contract; the RMEC number was read as max+1 outside a transaction; the client
  autocomplete concatenated the division into SQL. Fixed: duplicates refused in the list and per effective date in the
  database, each charge saved from its own field, one transaction with the number under a lock, parameters (tested).
* **Master insert `@retval`** was passed as an *input* value (`AddWithValue("@retval", ParameterDirection.Output)`), so inserts were always reported as successful. New app declares it as an output.

## Security hardening of the new app (2026-10-09) — tested in `server/test/security.test.js`

| Item | State |
|---|---|
| SQL injection | Audited every query: values always go as `@parameters`; `${…}` in SQL is only a table / column name from a fixed list in code (masters, other bills, shippers, contracts, dashboard drill keys are whitelisted). No dynamic SQL in the dev stored procedures. Probe test: `' OR 1=1 --`, `; drop table`, `union select` return nothing and change nothing. |
| Cross-site scripting | React escapes all text. The dashboard chart tooltips (ECharts renders them as HTML) now escape every data value (`esc()` in `components/charts/Charts.jsx`). Helmet sets CSP / nosniff; the API only returns JSON. ECharts upgraded to 6.1 (its own XSS advisory). |
| CSRF | The login token is sent in the `Authorization` header (sessionStorage), never as a cookie, so a browser never attaches it by itself. In addition `middleware/security.js#csrfGuard` refuses POST / PUT / DELETE from another site's Origin / Referer (403) and any non-JSON body such as an HTML form post (415). |
| File uploads (POD) | Login checked *before* the 40 MB body is read; strict base64; type from the first bytes (JPEG / PDF only, names ignored); a JPEG must end like one; a PDF with JavaScript / Launch / embedded files / XFA is refused; 2 MB and 5 files per docket; random file names written with `wx`; served with `Content-Security-Policy: sandbox` + `nosniff`, only to the branches of that POD. |
| Rate limiting | Whole API per client address: `API_RATE_LIMIT` (default 3000 / 5 min) and writes `API_WRITE_RATE_LIMIT` (600 / 5 min); login 20 / 15 min; password change 10 / 15 min. 429 with a plain message. |
| Secrets | DB password and JWT secret only in `server/.env` (git-ignored, never served: static files deny dot-files); the client holds only the API address. Login / session responses never contain a password. JWTs are verified as HS256 only. Production refuses a missing, default or shorter-than-32-character `JWT_SECRET`. |
| CORS | Only `CORS_ORIGINS` (no `*` — refused at start-up); production default: none (the app is served by the API itself); methods GET / POST / PUT / DELETE; headers Content-Type / Authorization; no credentials. |
| Source maps | `build.sourcemap: false` in `client/vite.config.js`; the server returns 404 for any `*.map` next to the built app. |
| Default credentials | A login with a default / weak password (emp123, admin123, short, no digit, equal to the user id …) gets a session that can only change the password (`pwc` claim → `PASSWORD_CHANGE_REQUIRED` everywhere else; the app shows `/password-change`). New passwords: 8+ characters with letters and digits, not a default, not the old one. On by default in production (`FORCE_PASSWORD_CHANGE`). |
| Sensitive data in logs | Request bodies are never logged; query-string values of password / token / secret / key parameters are logged as `***` (morgan `safe-url` and the error log); `utils/logger.js` redacts the same keys in log fields. |
| Vulnerable dependencies | Client: jspdf 4.2.1 (critical), jspdf-autotable 5.0.8 (high), source-map-js (high), echarts 6.1.0, react-router-dom 7.18.4 (open redirect) → `npm audit`: 0. Server: 3 moderate in `sprintf-js` (inside mssql → tedious) — no fixed version exists; the app uses the msnodesqlv8 driver and no user input reaches that formatter. |

**Still open (needs a decision):** passwords are stored in plain text in `users` / `Franchisee_Users` / `ClientLogin_Users`
because the legacy login stored procedures compare them in SQL. Hashing them (bcrypt) needs those procedures changed and
means the old ASP.NET site can no longer log in those users.
