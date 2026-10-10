// Builds docs/Ramas-Debugging-Guide.docx — a plain-language guide to find and fix problems in the new Ramas app.
// The module map is read from the project itself (client/src/App.jsx, server/src/modules, client/public/flow-data.json),
// so run it again whenever modules are added:
//   NODE_PATH=<folder with the "docx" package> node docs/tools/make-debug-guide.cjs
// then convert to PDF (Word): see the bottom of this file.
const fs = require('fs');
const path = require('path');
const {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, LevelFormat, Packer, PageBreak, PageNumber, PageOrientation,
  Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} = require('docx');

const ROOT = path.resolve(__dirname, '..', '..');
const FONT = 'Calibri';
const MONO = 'Consolas';
const C = { blue: '1F4E79', lightBlue: 'DEEAF6', green: 'E2F0D9', greenDark: '385723', red: 'FBE4E4', redDark: 'C00000', yellow: 'FFF2CC', yellowDark: '7F6000', grey: 'F2F2F2', border: 'BFBFBF' };
const PORTRAIT = { width: 11906, height: 16838 };
const MARGIN = 1000;
const WIDE = PORTRAIT.width - 2 * MARGIN;          // content width, portrait
const WIDE_L = PORTRAIT.height - 2 * MARGIN;       // content width, landscape

// ------------------------------------------------------------------ helpers
/** "**bold** and `code`" → runs */
function runs(text, opts = {}) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(new TextRun({ text: text.slice(last, m.index), font: FONT, size: opts.size ?? 22, color: opts.color }));
    const t = m[0];
    if (t.startsWith('**')) out.push(new TextRun({ text: t.slice(2, -2), bold: true, font: FONT, size: opts.size ?? 22, color: opts.color }));
    else out.push(new TextRun({ text: t.slice(1, -1), font: MONO, size: (opts.size ?? 22) - 2, color: opts.color ?? '843C0C' }));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(new TextRun({ text: text.slice(last), font: FONT, size: opts.size ?? 22, color: opts.color }));
  return out;
}
const p = (text, opts = {}) => new Paragraph({ children: runs(text, opts), spacing: { after: opts.after ?? 120 }, alignment: opts.align });
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, spacing: { after: 200 }, children: [new TextRun({ text, font: FONT, size: 36, bold: true, color: C.blue })] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, font: FONT, size: 28, bold: true, color: C.blue })] });
const bullet = (text, level = 0) => new Paragraph({ numbering: { reference: 'bullets', level }, children: runs(text), spacing: { after: 60 } });
const num = (text, ref = 'steps') => new Paragraph({ numbering: { reference: ref, level: 0 }, children: runs(text), spacing: { after: 80 } });
const spacer = () => new Paragraph({ children: [], spacing: { after: 80 } });

function cell(content, width, opts = {}) {
  const items = (Array.isArray(content) ? content : [content]).flatMap((c) => (typeof c === 'string' ? c.split('\n') : [c]));
  const paras = items.map((c) => (typeof c === 'string' ? new Paragraph({ children: runs(c, { size: opts.size ?? 20, color: opts.color }), spacing: { after: 40 } }) : c));
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: opts.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: opts.fill } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: paras,
  });
}
function table(headers, rows, widths, opts = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  const border = { style: BorderStyle.SINGLE, size: 4, color: C.border };
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: total, type: WidthType.DXA },
    columnWidths: widths,
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(`**${h}**`, widths[i], { fill: C.lightBlue, size: opts.size ?? 20 })) }),
      ...rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, widths[i], { size: opts.size ?? 20, fill: opts.zebra && ri % 2 ? C.grey : undefined })) })),
    ],
  });
}
/** A coloured box: title + lines. */
function box(title, lines, fill, titleColor, width = WIDE) {
  const border = { style: BorderStyle.SINGLE, size: 6, color: titleColor };
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: width, type: WidthType.DXA }, columnWidths: [width],
    borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    rows: [new TableRow({ cantSplit: true, children: [new TableCell({
      width: { size: width, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: 'auto', fill },
      margins: { top: 100, bottom: 100, left: 160, right: 160 },
      children: [
        ...(title ? [new Paragraph({ children: [new TextRun({ text: title, bold: true, font: FONT, size: 24, color: titleColor })], spacing: { after: 80 } })] : []),
        ...lines.map((l) => (typeof l === 'string' ? new Paragraph({ children: runs(l), spacing: { after: 60 } }) : l)),
      ],
    })] })],
  });
}
const code = (lines, width = WIDE) => box(null, lines.map((l) => new Paragraph({ children: [new TextRun({ text: l, font: MONO, size: 18 })], spacing: { after: 20 } })), C.grey, '7F7F7F', width);

// ------------------------------------------------------------------ project facts (read from the code)
const flow = JSON.parse(fs.readFileSync(path.join(ROOT, 'client', 'public', 'flow-data.json'), 'utf8'));
const appJsx = fs.readFileSync(path.join(ROOT, 'client', 'src', 'App.jsx'), 'utf8');
const imports = new Map();   // component name → file
for (const m of appJsx.matchAll(/^import\s+(.+?)\s+from\s+'(\.\/pages\/[^']+)';/gm)) {
  const names = m[1].replace(/[{}]/g, ',').split(',').map((s) => s.trim()).filter(Boolean);
  for (const n of names) imports.set(n, `client/src/${m[2].slice(2)}`);
}
const routeFile = new Map(); // page address → file
for (const m of appJsx.matchAll(/<Route\s+path="([^"]+)"\s+element=\{(?:<RequireAuth>)?<(\w+)/g)) {
  routeFile.set(`/${m[1].replace(/^\//, '')}`, imports.get(m[2]) ?? '');
}
const indexRoute = /<Route\s+index\s+element=\{<(\w+)/.exec(appJsx);
if (indexRoute) routeFile.set('/', imports.get(indexRoute[1]) ?? '');
/** A route with parameters (e.g. /masters/:key) as a test for a concrete address (e.g. /masters/state). */
const routeMatches = (route, address) => new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+')}/?$`).test(address);
const modulesDir = path.join(ROOT, 'server', 'src', 'modules');
const serverFiles = (mod) => (fs.existsSync(path.join(modulesDir, mod)) ? fs.readdirSync(path.join(modulesDir, mod)).filter((f) => f.endsWith('.js')).map((f) => `server/src/modules/${mod}/${f}`) : []);
const apiPrefix = (mod) => {
  const e = flow.endpoints.find((x) => x.module === mod);
  if (!e) return '';
  const parts = e.path.split('?')[0].split('/').filter(Boolean);
  return `/${parts.slice(0, 2).join('/')}`;
};
const noScreen = [];
const moduleRows = flow.built.filter((b) => b.routes?.length).map((b) => {
  const pages = String(b.pages || '').split(/,\s*/).map((s) => s.trim()).filter((s) => s.startsWith('/'));
  // every page address mentioned in the text (some entries add notes, e.g. "/rates/oda; ODA location on the docket")
  const tokens = (String(b.pages || '').match(/\/[a-z0-9][a-z0-9/:_-]*|(?<=^|[\s,(])\/(?=[\s,(]|$)/gi) ?? []).map((t) => t.replace(/[.;]+$/, ''));
  const lookup = (pg) => routeFile.get(pg) || routeFile.get(pg.replace(/\/$/, ''))
    || [...routeFile.entries()].find(([r]) => r.includes(':') && routeMatches(r, pg))?.[1]
    || [...routeFile.entries()].find(([r]) => r.replace(/\/:[^/]+/g, '') === pg.replace(/\/:[^/]+/g, ''))?.[1]
    || [...routeFile.entries()].find(([r]) => r.startsWith(`${pg.replace(/\/$/, '')}/`) || r.split('/:')[0] === pg)?.[1] || '';
  const files = [...new Set(tokens.map(lookup).filter(Boolean))];
  if (!files.length) noScreen.push(b.name);
  return [
    `**${b.name}**`,
    pages.slice(0, 4).join('\n') || tokens.slice(0, 4).join('\n') || '—',
    files.slice(0, 3).map((f) => `\`${f.replace('client/src/pages/', 'pages/')}\``).join('\n') || '—',
    b.routes.map(apiPrefix).filter(Boolean).join('\n') || '—',
    b.routes.flatMap(serverFiles).map((f) => `\`${f.replace('server/src/modules/', '')}\``).join('\n') || '—',
    String(b.tables || '').split(/,\s*/).slice(0, 5).join(', '),
  ];
});
const stats = flow.stats;

// ------------------------------------------------------------------ content
const today = new Date().toLocaleDateString('en-GB');
const cover = [
  new Paragraph({ spacing: { before: 2400, after: 200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Ramas ERP', font: FONT, size: 64, bold: true, color: C.blue })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: 'Debugging Guide — how to find a problem and what to change', font: FONT, size: 36, color: C.blue })] }),
  p('This guide is written so that anyone can use it: you do not need to be a programmer to find **where** a problem is. A programmer (or Claude) then uses the same pages to fix it.', { align: AlignmentType.CENTER }),
  spacer(),
  box('How to use this guide (3 steps)', [
    '**1. See** — what is wrong on the screen? Find it in the table "What do you see?" (chapter 3).',
    '**2. Look** — press **F12** in the browser and read the error number (chapter 4 and 5).',
    '**3. Open** — the module map (chapter 7) tells you which file to open and change.',
  ], C.green, C.greenDark),
  spacer(),
  p(`Project: D:\\rr\\ramas-modern  •  ${stats.built} screens built  •  ${stats.modules} modules  •  ${stats.endpoints} API addresses  •  ${stats.tests} automatic tests  •  made ${today}`, { align: AlignmentType.CENTER, size: 18, color: '595959' }),
  new Paragraph({ pageBreakBefore: true, children: [new TextRun({ text: 'Contents', font: FONT, size: 36, bold: true, color: C.blue })], spacing: { after: 200 } }),
  ...[
    '1. The app in one picture', '2. Five-minute check: is everything running?', '3. What do you see? → where is the problem',
    '4. Using F12 (the browser\'s "doctor")', '5. Error numbers and messages — what they mean', '6. Reading the API log',
    '7. Module map — which screen uses which files', '8. What to change for what', '9. Checking the data in the database',
    '10. Common problems and their fixes', '11. How to ask Claude (or anyone) for help', '12. Command cheat sheet', '13. Where everything lives (folders)',
    '14. Words used in this guide',
  ].map((t) => p(t, { after: 60 })),
];

const ch1 = [
  h1('1. The app in one picture'),
  p('Ramas has **three parts**. Every problem lives in one of them. Finding the part is half of the fix.'),
  table(['', 'SCREEN (what you see)', 'API (the middle)', 'DATABASE (where data is kept)'], [
    ['What is it', 'Pages in the browser: forms, tables, buttons, the dashboard', 'A small server that checks every request and runs the business rules', 'SQL Server — tables with dockets, bills, users …'],
    ['Made with', 'React + Ant Design (JavaScript)', 'Node.js + Express (JavaScript)', 'Microsoft SQL Server (T-SQL)'],
    ['Lives in', '`client/src/pages/…`', '`server/src/modules/…`', 'dev database `ramas_modern_dev`; scripts in `server/db/dev/`'],
    ['Address on this PC', 'http://localhost:5173', 'http://localhost:4000/api/…', '`.\\SQLEXPRESS`'],
    ['When it breaks you see', 'white page, wrong layout, button does nothing', 'red message, error number (400, 422, 500 …)', 'error 500 with an SQL message, or wrong numbers'],
  ], [1500, 2800, 2800, 2806]),
  spacer(),
  h2('What happens when you click "Save"'),
  num('The **screen** collects what you typed and sends it to the API, e.g. `POST /api/dockets`.'),
  num('The **API** checks it (missing box? wrong date?). If something is wrong it answers with an error number and a message — the red popup you see.'),
  num('If all is fine the API runs SQL on the **database** (insert / update), usually inside one "transaction" (all or nothing).'),
  num('The API answers "OK" (number 200 / 201) and the screen shows the success message.'),
  box('Remember', [
    'Every screen talks to the API through an address that starts with `/api/` — that address tells you which module (folder) to open.',
    'Example: `/api/client-bills/…` → folder `server/src/modules/clientbill/`.',
  ], C.yellow, C.yellowDark),
];

const ch2 = [
  h1('2. Five-minute check: is everything running?'),
  p('Before looking for a "bug", check these four things. Most "the app is not working" problems are one of them.'),
  table(['Check', 'How', 'If it is not OK'], [
    ['**1. SQL Server is running**', 'Start menu → "Services" → **SQL Server (SQLEXPRESS)** shows "Running". Or PowerShell: `Get-Service MSSQL$SQLEXPRESS`', 'Right-click → Start. If it stops again: the PC is out of memory — close programs.'],
    ['**2. The API is running**', 'Open http://localhost:4000/api/health — it must show `{"ok":true}`', 'Start it: `npm --prefix D:\\rr\\ramas-modern\\server start` (see chapter 12)'],
    ['**3. The screen is running**', 'Open http://localhost:5173 — the login page appears', 'Start it: `npm --prefix D:\\rr\\ramas-modern\\client run dev`'],
    ['**4. You can log in**', 'Choose login type, **division** and **financial year**, user and password', 'Wrong year = you see no data; see "Invalid user id or password" in chapter 10'],
  ], [2400, 4200, 3306]),
  spacer(),
  box('Memory (RAM) matters on this PC', [
    'When free RAM is below ~1 GB, SQL Server becomes slow: pages keep loading, "Query timeout", "insufficient system memory (701)".',
    'Fix: close WhatsApp, Postman, extra browser tabs and old Claude sessions, then try again. Check: Task Manager → Performance → Memory.',
  ], C.red, C.redDark),
];

const ch3 = [
  h1('3. What do you see? → where is the problem'),
  p('Find the line that matches what you see. The middle column tells you the **part**; the right column tells you **where to look**.'),
  table(['What you see', 'Part', 'Where to look / what to do'], [
    ['The page is **white / blank**', 'SCREEN', 'F12 → **Console**: a red line names the file and line, e.g. `ClientBillPage.jsx:120`. Open that file in `client/src/pages/`.'],
    ['A **red message** pops up, e.g. "Select the client" or "Bill date must be in the login financial year"', 'API (a rule)', 'Not a crash — the API refused the input. Read the message and correct the entry. To change the rule: search the message text in the module\'s `*.routes.js` (box checks) or `*.service.js` (business rules).'],
    ['"**Invalid user id or password**"', 'API / DATABASE', 'User, password, division or year wrong. Users are in tables `users`, `ClientLogin_Users`, `Franchisee_Users`.'],
    ['Page keeps **loading** / "Network Error"', 'API not running or DATABASE slow', 'Chapter 2: check http://localhost:4000/api/health. Restart the API. Check free RAM.'],
    ['A **number looks wrong** (total, count, dashboard chart)', 'API (SQL in the service)', 'F12 → Network → the `/api/…` call → Response shows the number the API sent. If wrong there → the `*.service.js` of that module (its SQL). If right there but shown wrong → the page file.'],
    ['It **saved, but the data in the database is wrong**', 'API / DATABASE', 'The insert in `*.service.js`, or a stored procedure in `server/db/dev/NN-*.sql`. Check the row with SQL (chapter 9).'],
    ['Error **500** "Internal server error"', 'API or DATABASE', 'Look at the API window/log: a line `"Unhandled error"` shows the real message (chapter 6).'],
    ['A **menu item is missing**', 'DATABASE (menu rights) / SCREEN', 'Menu rows in `SubMenu` + `Employee_Permission` (`server/db/dev/99-seed.sql`); the page link in `client/src/routes/legacyRoutes.js` and `client/src/App.jsx`.'],
    ['"**Page not found**"', 'SCREEN', 'The address is not in `client/src/App.jsx` (Route list).'],
    ['A **print page** is empty', 'SCREEN / API', 'Print pages are in the same page file (e.g. `OctroiBillPrintRoute`); F12 → Network shows if the bill was not found (404).'],
    ['A **docket\'s journey** looks wrong (wrong branch, short packets, late, entered by …)', 'DATA entry', 'Open **Tracking** (`/tracking?docket=…`). The **Problems** box and the red cells in **Entries grid** show which entry is wrong and who entered it.'],
    ['Dashboard shows **no data**', 'API / DATABASE', 'Wrong period or "Only this branch" selected; or the database is empty (demo data: chapter 10).'],
  ], [3000, 1500, 5406], { zebra: true }),
];

const ch4 = [
  h1('4. Using F12 (the browser\'s "doctor")'),
  p('Chrome and Edge have a built-in tool that shows **exactly** what went wrong. It does not change anything — it only shows.'),
  h2('A. When a page is blank or a button does nothing → Console'),
  num('Press **F12** (or right-click → Inspect).', 'f12a'),
  num('Click the **Console** tab.', 'f12a'),
  num('Look for **red** lines. They name a file and line number, e.g. `DashboardPage.jsx:212`. Take a screenshot.', 'f12a'),
  h2('B. When you get an error message or wrong data → Network'),
  num('Press **F12** → click **Network**.', 'f12b'),
  num('Do the action again (click Save / Search).', 'f12b'),
  num('In the filter box type **api**. Rows in **red** failed.', 'f12b'),
  num('Click the row. **Headers** shows the address (e.g. `/api/challans`) and the **Status** number (e.g. 422).', 'f12b'),
  num('**Payload** shows what the screen sent. **Response** shows what the API answered — the error message is here.', 'f12b'),
  box('The address tells you the folder', [
    '`/api/dockets/…` → `server/src/modules/docket/`        `/api/client-bills/…` → `server/src/modules/clientbill/`',
    '`/api/dashboard/…` → `server/src/modules/dashboard/`   `/api/vendor-invoices/…` → `server/src/modules/vendorinvoice/`',
    'The full list is the module map in chapter 7.',
  ], C.yellow, C.yellowDark),
];

const ch5 = [
  h1('5. Error numbers and messages — what they mean'),
  p('Every answer from the API has a number. **200 / 201 = OK.** Anything from 400 up is a problem:'),
  table(['Number', 'Meaning in plain words', 'What to do'], [
    ['**400**', 'Something you typed is missing or in the wrong form (e.g. no date, letters in a number box).', 'Read the message and fix the entry. The checks are in the module\'s `*.routes.js` (zod).'],
    ['**401**', 'Not logged in, or the login expired (after ~10 hours).', 'Log in again.'],
    ['**403**', 'Logged in, but this user may not do this (e.g. a client opening a staff page).', 'Use the right user; rights are per role / menu.'],
    ['**404**', 'Not found: wrong number, or it belongs to another branch / financial year.', 'Check the number, the branch selected at the top, and the year you logged in with.'],
    ['**409**', 'Conflict: it is already done / already used / cancelled (e.g. "already billed").', 'Normal protection. Undo the earlier step first if it was a mistake.'],
    ['**422**', 'A business rule stopped it (e.g. "Ledgers missing", "advance more than freight").', 'Read the message; often a master is missing (ledger, rate, user right).'],
    ['**429**', 'Too many login tries (20 in 15 minutes).', 'Wait 15 minutes.'],
    ['**500**', 'The API crashed on this request — a real bug or a database problem.', 'Read the API log line "Unhandled error" (chapter 6).'],
    ['**502 / 504** or "Network Error"', 'The API is not running or did not answer.', 'Chapter 2: start the API; check memory.'],
  ], [1200, 4400, 4306], { zebra: true }),
  spacer(),
  h2('Database messages inside a 500 error'),
  table(['Message contains', 'Meaning', 'Fix'], [
    ['`Query timeout expired`, `insufficient system memory`, `701`', 'SQL Server is out of memory / too slow', 'Free RAM (close programs), try again. Do not change SQL Server memory settings.'],
    ['`Invalid column name` / `Invalid object name`', 'The database is missing a column/table the code needs', 'Apply the missing `server/db/dev/NN-*.sql` file (chapter 12).'],
    ['`Cannot insert duplicate key`', 'That number/code already exists', 'Use another number, or find why it was taken twice.'],
    ['`String or binary data would be truncated`', 'A value is longer than the column allows', 'Shorten the value or widen the column in a new dev SQL file.'],
    ['`Login failed for user`', 'The API cannot log in to SQL Server', 'Check `server/.env` (`DB_*` settings).'],
    ['`operation timed out for an unknown reason`', 'Waiting for a free database connection', 'The database is slow (memory) — free RAM and retry.'],
  ], [3300, 3000, 3606], { zebra: true }),
];

const ch6 = [
  h1('6. Reading the API log'),
  p('The window where the API runs (or `D:\\rr\\tunnel\\server-error.log` for the test link) prints one line per request:'),
  code(['POST /api/challans 422 15.8 ms - 67', 'GET /api/dashboard/overview?from=2026-07-04&to=2026-10-01 200 412.3 ms - 12677']),
  bullet('**POST / GET** = what kind of request, then the **address**, then the **number** (chapter 5), then how long it took.'),
  bullet('Slow lines (thousands of ms) = the database is slow — usually memory.'),
  p('When something crashes (500) there is also a line like this — the `err` part is the real reason:'),
  code(['{"t":"2026-10-02T03:41:56Z","level":"error","msg":"Unhandled error",', ' "path":"/api/pickups","err":"Arithmetic overflow error converting bigint to data type numeric."}']),
  box('Tip', ['Copy this line when you ask for help — it tells exactly which address failed and why.'], C.green, C.greenDark),
];

const ch7 = [
  h1('7. Module map — which screen uses which files'),
  p('One row per module. **Screen address** = what you type after `localhost:5173`. **Screen file** = the page to change for looks/labels. **API** = the address seen in F12 → Network. **Server files** = rules and SQL (`*.routes.js` checks the input, `*.service.js` does the work). **Main tables** = where the data is.'),
  table(['Module', 'Screen address', 'Screen file (client/src/…)', 'API', 'Server files (server/src/modules/…)', 'Main tables'], moduleRows,
    [1900, 2300, 2700, 1700, 3200, 3038], { size: 15, zebra: true }),
];

const ch8 = [
  h1('8. What to change for what'),
  table(['I want to change …', 'Open this file', 'Notes'], [
    ['A label, a box, a column, a button on a page', '`client/src/pages/<area>/<Page>.jsx` (module map, ch. 7)', 'Only looks — no rule changes.'],
    ['Which boxes are required / the message for a box', '`server/src/modules/<m>/<m>.routes.js` (zod) and the page\'s Form `rules`', 'Change both so the screen and the API agree.'],
    ['A calculation, a business rule, what gets saved', '`server/src/modules/<m>/<m>.service.js`', 'Most real logic lives here. Search for the message text.'],
    ['A new column / table in the database', 'A **new** file `server/db/dev/NN-name.sql`, then the service', 'Never edit old dev SQL that is already applied; add a new numbered file and apply it.'],
    ['A menu entry', '`server/db/dev/99-seed.sql` (SubMenu, Employee_Permission), `client/src/routes/legacyRoutes.js`, `client/src/App.jsx`', 'The menu comes from the database; the link maps to the new page.'],
    ['A new page', '`client/src/App.jsx` (Route) + new page file + `legacyRoutes.js`', 'Copy a similar page as a start.'],
    ['A dashboard chart / number', '`server/src/modules/dashboard/dashboard.service.js` + `client/src/pages/DashboardPage.jsx`', 'Charts: `client/src/components/charts/Charts.jsx`.'],
    ['Tracking problems (what counts as a "problem")', '`server/src/modules/docket/tracking.service.js` (findIssues)', 'Each check says which field and who entered it.'],
    ['Colours / look of all pages', '`client/src/theme/themes.js`', '20 ready-made looks; chosen with the palette button.'],
    ['Database name, ports, secret key', '`server/.env`', 'Never share this file. Example: `server/.env.example`.'],
  ], [3000, 4000, 2906], { zebra: true }),
  spacer(),
  box('After every change — 5 steps', [
    '**1.** Save the file.',
    '**2.** Server file changed? Restart the API (stop it, start it again). Screen file changed? The browser updates by itself (else Ctrl + F5).',
    '**3.** Try the screen again.',
    '**4.** Run the automatic tests: `npm --prefix D:\\rr\\ramas-modern\\server test` — all must pass.',
    '**5.** Note what you changed (docs/MIGRATION.md) so the next person knows.',
  ], C.green, C.greenDark),
];

const ch9 = [
  h1('9. Checking the data in the database'),
  p('Open PowerShell and run one of these (change the number in quotes). They only **read** — they change nothing.'),
  h2('A docket'),
  code(['sqlcmd -S .\\SQLEXPRESS -E -d ramas_modern_dev -Q "select * from grn_master where docket_no = \'100000001\'"',
    'sqlcmd -S .\\SQLEXPRESS -E -d ramas_modern_dev -Q "select * from grn_docket_charge where Docket_No = \'100000001\'"']),
  h2('Where a docket went (manifest, challan, arrival, delivery)'),
  code(['sqlcmd -S .\\SQLEXPRESS -E -d ramas_modern_dev -Q "select * from Manifest_grn where docket_no = \'100000001\'"',
    'sqlcmd -S .\\SQLEXPRESS -E -d ramas_modern_dev -Q "select * from delivery_status_entry_details where docket_no = \'100000001\'"']),
  box('Easier: the Tracking page', ['Type the docket number in **Track docket no.** at the top. The **Entries grid** shows every entry with its values, who entered it, and the wrong ones in red.'], C.green, C.greenDark),
  h2('A bill and its money'),
  code(['sqlcmd -S .\\SQLEXPRESS -E -d ramas_modern_dev -Q "select * from client_bill where bill_no = \'BLBOM2627000001\'"',
    'sqlcmd -S .\\SQLEXPRESS -E -d ramas_modern_dev -Q "select * from Bill_Receive_Details where Bill_no = \'BLBOM2627000001\'"',
    'sqlcmd -S .\\SQLEXPRESS -E -d ramas_modern_dev -Q "select * from tblAccountTrasaction where VoucherNo = \'BLBOM2627000001\'"']),
  h2('A user'),
  code(['sqlcmd -S .\\SQLEXPRESS -E -d ramas_modern_dev -Q "select user_id, user_type, user_branch, DivCode from users"']),
  box('Do not', ['Do not delete or update rows by hand unless you are sure — use the screens (cancel / modify). Never drop the database `ramas_modern_dev`.'], C.red, C.redDark),
];

const ch10 = [
  h1('10. Common problems and their fixes'),
  table(['Problem', 'Why', 'Fix'], [
    ['Everything is very slow; "Query timeout"', 'PC low on RAM (SQL Server starved)', 'Close programs (Task Manager → Memory). Retry.'],
    ['API keeps saying "Restarting …" and never answers', '`npm run dev` (watch mode) restarts in a loop when RAM is low', 'Use `npm --prefix D:\\rr\\ramas-modern\\server start` instead; restart it by hand after code changes.'],
    ['"Port 4000 / 5173 already in use"', 'An old copy is still running', 'Close the old window, or find it: `Get-NetTCPConnection -LocalPort 4000` → stop that process.'],
    ['PowerShell cannot open http://localhost:4000', 'Name "localhost" not resolving in PowerShell', 'Use http://127.0.0.1:4000 instead.'],
    ['"Invalid user id or password" but it is correct', 'Wrong division / login type, or user missing in that division', 'Pick the right login type + division; check the `users` table.'],
    ['Logged in but every list is empty', 'Logged in with a different financial year, or another branch selected', 'Log in with the current year; choose the branch at the top.'],
    ['"Ledgers missing" when finalizing / receiving', 'An account ledger is not created for this year/division', 'Create it in `tblAccountLedger` (same name, year, division) — see the message for the exact name.'],
    ['Too many login attempts (429)', 'Login protection (20 / 15 min)', 'Wait 15 minutes.'],
    ['Changes not visible on the screen', 'Old page cached, or API not restarted', 'Ctrl + F5 in the browser; restart the API.'],
    ['Tests fail with "Query timeout" or "insufficient memory"', 'Low RAM', 'Free RAM, run the tests again.'],
    ['Dashboard has no / too much demo data', 'Demo rows are tagged DMO…', 'Remove: `sqlcmd -S .\\SQLEXPRESS -E -d ramas_modern_dev -i server\\db\\dev\\demo\\demo-remove.sql`'],
    ['Test link (trycloudflare) does not open', 'PC slept, internet dropped, or tunnel stopped', 'Run `D:\\rr\\tunnel\\start-tunnel.ps1`; it prints the NEW link. Keep the PC awake.'],
    ['Built site shows a blank page', '`CLIENT_DIST` not set or the build is old', 'Run `scripts\\make-azure-package.ps1` again; check `CLIENT_DIST`.'],
  ], [3100, 3000, 3806], { zebra: true }),
];

const ch11 = [
  h1('11. How to ask Claude (or anyone) for help'),
  p('Give these 6 things — then the problem can usually be found in minutes:'),
  table(['#', 'What to give', 'Example'], [
    ['1', 'Which page (the address in the browser)', '`localhost:5173/invoice/client-bill/new`'],
    ['2', 'What you did, step by step', 'Chose client ACME, dates 1–30 Sept, clicked Search, ticked 3 dockets, clicked Generate'],
    ['3', 'What you expected', 'A bill for 3 dockets'],
    ['4', 'What happened', 'Red message "Docket TB003 has a GST mismatch"'],
    ['5', 'F12 → Network → the red `/api/…` row: number + Response text, or the API log line', '`POST /api/client-bills 422 {"error":"…"}`'],
    ['6', 'The number of the docket / bill / challan, and a screenshot', 'Docket TB003'],
  ], [600, 4400, 4906], { zebra: true }),
  spacer(),
  box('Message you can copy', [
    '"Page: <address>. I did: <steps>. Expected: <…>. Got: <message / number>. F12 Response: <text>. Docket/Bill: <no>. Screenshot attached."',
  ], C.lightBlue, C.blue),
];

const ch12 = [
  h1('12. Command cheat sheet'),
  p('Open **PowerShell** and paste. `D:\\rr\\ramas-modern` is the project folder.'),
  table(['To …', 'Command'], [
    ['Start the API (normal)', '`npm --prefix D:\\rr\\ramas-modern\\server start`'],
    ['Start the API (auto-restart on save; needs free RAM)', '`npm --prefix D:\\rr\\ramas-modern\\server run dev`'],
    ['Start the screens', '`npm --prefix D:\\rr\\ramas-modern\\client run dev`'],
    ['Check the API', 'open http://localhost:4000/api/health → `{"ok":true}`'],
    ['Run all automatic tests', '`npm --prefix D:\\rr\\ramas-modern\\server test`'],
    ['Apply a new dev SQL file', '`sqlcmd -S .\\SQLEXPRESS -E -l 60 -d ramas_modern_dev -i D:\\rr\\ramas-modern\\server\\db\\dev\\39-name.sql`'],
    ['Load / remove demo data', '`sqlcmd -S .\\SQLEXPRESS -E -d ramas_modern_dev -i …\\server\\db\\dev\\demo\\demo-data.sql` (or `demo-remove.sql`)'],
    ['Build the app for hosting', '`powershell -ExecutionPolicy Bypass -File D:\\rr\\ramas-modern\\scripts\\make-azure-package.ps1`'],
    ['Start / stop the public test link', '`powershell -ExecutionPolicy Bypass -File D:\\rr\\tunnel\\start-tunnel.ps1` (`stop-tunnel.ps1`)'],
    ['Update the project document (flow.docx)', '`node docs\\tools\\make-flow-doc.cjs` (needs the `docx` package)'],
    ['Make this guide again', '`node docs\\tools\\make-debug-guide.cjs`, then save as PDF in Word'],
    ['Is SQL Server running?', '`Get-Service MSSQL$SQLEXPRESS`'],
    ['How much RAM is free?', '`(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB` (GB)'],
  ], [3600, 6306], { zebra: true }),
];

const ch13 = [
  h1('13. Where everything lives (folders)'),
  code([
    'D:\\rr\\ramas-modern',
    '├─ client\\                     the SCREENS (React)',
    '│  └─ src\\',
    '│     ├─ App.jsx               list of all page addresses (Routes)',
    '│     ├─ pages\\               one file per page  (invoice\\, operation\\, rates\\, settings\\ …)',
    '│     ├─ components\\charts\\   dashboard charts (ECharts) and the click-through drawer',
    '│     ├─ routes\\legacyRoutes.js  old .aspx page → new address',
    '│     ├─ theme\\themes.js      the 20 looks',
    '│     └─ api\\client.js        how the screens call the API',
    '├─ server\\                     the API (Node.js)',
    '│  ├─ .env                     settings + database connection (private)',
    '│  ├─ src\\app.js              all API addresses are connected here',
    '│  ├─ src\\modules\\<name>\\     one folder per module:',
    '│  │                          <name>.routes.js = checks, <name>.service.js = work + SQL',
    '│  ├─ src\\middleware\\         login check, error handling',
    '│  ├─ db\\dev\\NN-*.sql         tables + procedures, applied in number order',
    '│  │                          (99-seed.sql = sample masters, users, menu)',
    '│  ├─ db\\dev\\demo\\            demo data (DMO…) and its remover',
    '│  └─ test\\api.test.js        the automatic tests',
    '├─ docs\\                       MIGRATION.md (what was built), flow.docx,',
    '│                              SCHEMA-VERIFICATION.md, this guide',
    '└─ scripts\\make-azure-package.ps1   builds the app for hosting',
    '',
    'D:\\rr\\tunnel\\     public test link (start/stop scripts, TEST-LOGINS.txt — private)',
    'C:\\projects\\ramas-modern\\original\\   the OLD ASP.NET application (read only, for reference)',
  ]),
];

const ch14 = [
  h1('14. Words used in this guide'),
  table(['Word', 'Meaning'], [
    ['API', 'The middle part of the app (server). Screens ask it to read or save data.'],
    ['Endpoint / address', 'One "door" of the API, e.g. `/api/dockets`.'],
    ['Module', 'One area of the app with its own folder, e.g. client bill, tracking, dashboard.'],
    ['Route (screen)', 'A page address like `/invoice/octroi-bill`, listed in `App.jsx`.'],
    ['routes.js', 'API file that lists the module\'s addresses and checks the input.'],
    ['service.js', 'API file that does the work: rules, calculations, SQL.'],
    ['Database / table', 'Where data is stored; a table is like an Excel sheet (rows and columns).'],
    ['Stored procedure', 'A saved SQL program in the database (from the old app); in `server/db/dev/*.sql`.'],
    ['Transaction', 'Several saves done as one: either all succeed or none.'],
    ['F12 / DevTools', 'The browser tool that shows errors (Console) and requests (Network).'],
    ['Status number', '200/201 = OK; 400–499 = the request was refused; 500 = the server failed.'],
    ['Dev database', '`ramas_modern_dev` — the practice database on this PC (not the real one).'],
    ['Test database', '`ramas_test` — used by the public test link; has its own passwords.'],
    ['Demo data', 'Made-up records tagged `DMO…` so the dashboard has something to show.'],
  ], [2400, 7506], { zebra: true }),
  spacer(),
  p('— End of guide —', { align: AlignmentType.CENTER, color: '7F7F7F' }),
];

// ------------------------------------------------------------------ document
const footer = new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
  new TextRun({ text: 'Ramas ERP — Debugging Guide   •   page ', font: FONT, size: 16, color: '7F7F7F' }),
  new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '7F7F7F' }),
] })] });
const portrait = { page: { size: { width: PORTRAIT.width, height: PORTRAIT.height }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } };
const landscape = { page: { size: { width: PORTRAIT.width, height: PORTRAIT.height, orientation: PageOrientation.LANDSCAPE }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } };

const doc = new Document({
  creator: 'Ramas modernisation', title: 'Ramas ERP — Debugging Guide',
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 260 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 900, hanging: 260 } } } }] },
      ...['steps', 'f12a', 'f12b'].map((reference) => ({ reference, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 320 } } } }] })),
    ],
  },
  sections: [
    { properties: portrait, footers: { default: footer }, children: [...cover, ...ch1, ...ch2, ...ch3, ...ch4, ...ch5, ...ch6] },
    { properties: landscape, footers: { default: footer }, children: ch7.map((x, i) => (i === 0 ? new Paragraph({ children: [new TextRun({ text: '7. Module map — which screen uses which files', font: FONT, size: 36, bold: true, color: C.blue })], spacing: { after: 200 } }) : x)) },
    { properties: portrait, footers: { default: footer }, children: [...ch8, ...ch9, ...ch10, ...ch11, ...ch12, ...ch13, ...ch14] },
  ],
});

const out = path.join(ROOT, 'docs', 'Ramas-Debugging-Guide.docx');
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log(`${out} (${Math.round(buf.length / 1024)} KB), ${moduleRows.length} modules in the map`);
  if (noScreen.length) console.log(`No screen file found for: ${noScreen.join('; ')}`);
});
// PDF: open the .docx in Word → File → Save as → PDF, or run docs/tools/docx-to-pdf.ps1
