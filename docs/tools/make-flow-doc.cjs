// Builds the project documentation from ONE source (docs/flow-data.mjs) plus what can be read automatically:
//   * every legacy page and its status        docs/page-inventory.csv
//   * every API endpoint                      header comments of server/src/modules/*/*.routes.js
//   * dev database scripts, number of tests   server/db/dev/*.sql, server/test/api.test.js
// Outputs:
//   docs/flow.docx                  the Word file
//   client/public/flow.docx         the same file, downloadable from the app
//   client/public/flow-data.json    the data the in-app Project Flow page (/project-flow) shows
//
// Run (needs the `docx` npm package somewhere on NODE_PATH):  node docs/tools/make-flow-doc.cjs
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, LevelFormat, Packer, PageBreak, PageNumber, Paragraph,
  ShadingType, Table, TableCell, TableOfContents, TableRow, TextRun, WidthType,
} = require('docx');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^\uFEFF/, '');

// ---------------------------------------------------------------- automatic facts
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const cells = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (ch === ',' && !q) { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** Endpoints documented in the routes files: `//   GET  /api/x   purpose` or `// GET /api/x -> purpose` (+ continuation lines). */
function readEndpoints() {
  const dir = path.join(ROOT, 'server', 'src', 'modules');
  const out = [];
  for (const mod of fs.readdirSync(dir)) {
    const modDir = path.join(dir, mod);
    if (!fs.statSync(modDir).isDirectory()) continue;
    for (const file of fs.readdirSync(modDir).filter((f) => f.endsWith('.routes.js'))) {
      let last = null;
      for (const line of fs.readFileSync(path.join(modDir, file), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\/\/\s*(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/\S+)\s*(?:->\s*)?(.*)$/);
        if (m) {
          last = { module: mod, method: m[1], path: m[2], purpose: m[3].trim() };
          out.push(last);
          continue;
        }
        const cont = line.match(/^\/\/\s{10,}(\S.*)$/);
        if (cont && last) { last.purpose = `${last.purpose} ${cont[1].trim()}`.trim(); continue; }
        last = null;
      }
    }
  }
  return out;
}

const testCount = fs.readdirSync(path.join(ROOT, 'server', 'test')).filter((f) => f.endsWith('.test.js'))
  .reduce((sum, f) => sum + (read(`server/test/${f}`).match(/^\s*test\(/gm) ?? []).length, 0);
const sqlFiles = fs.readdirSync(path.join(ROOT, 'server', 'db', 'dev')).filter((f) => f.endsWith('.sql')).sort();
const KIND = { 'entry/other': 'Entry', 'report/view': 'Report / view', edit: 'Edit', master: 'Master', cancel: 'Cancel' };

async function main() {
  const data = await import(pathToFileURL(path.join(ROOT, 'docs', 'flow-data.mjs')).href);
  const { BUILT, DOC_STANDARD, FLOW, PENDING, ROADMAP, TECH } = data;

  const areaOf = (mod, page) => {
    const name = page.replace(/^[^/]+\//, '').replace(/\.aspx$/i, '');
    return (PENDING[mod]?.areas ?? []).find(([, re]) => re.test(name))?.[0] ?? 'Other';
  };
  const inventory = parseCsv(read('docs/page-inventory.csv')).map((r, i) => {
    const module = r.Module || '(root)';
    const migrated = r.Status === 'Migrated';
    return {
      no: i + 1, module, page: r.Page, kind: KIND[r.Kind] ?? r.Kind, kb: Number(r.CodeBehindKB) || 0,
      status: migrated ? 'Built' : 'To do',
      newRoute: r.NewRoute, area: migrated ? 'Built' : areaOf(module, r.Page),
    };
  });
  const endpoints = readEndpoints();
  const built = BUILT.map((m) => ({ ...m, endpoints: endpoints.filter((e) => m.routes.includes(e.module)) }));
  const modules = [...new Set(inventory.map((p) => p.module))].map((m) => {
    const pages = inventory.filter((p) => p.module === m);
    const plan = PENDING[m] ?? {};
    const todo = pages.filter((p) => p.status !== 'Built');
    const areas = [...new Set(todo.map((p) => p.area))].map((a) => ({ name: a, count: todo.filter((p) => p.area === a).length }));
    return {
      module: m, title: plan.title ?? m, summary: plan.summary ?? '', from: plan.from ?? '', to: plan.to ?? '', plan: plan.plan ?? [],
      total: pages.length, built: pages.filter((p) => p.status === 'Built').length, todo: todo.length, areas,
    };
  }).sort((a, b) => b.total - a.total);
  const stats = {
    pages: inventory.length, built: inventory.filter((p) => p.status === 'Built').length,
    todo: inventory.filter((p) => p.status !== 'Built').length, modules: BUILT.length, endpoints: endpoints.length,
    tests: testCount, sqlFiles: sqlFiles.length,
  };
  const generatedAt = new Date().toISOString();

  // ---------------------------------------------------------------- JSON for the app page
  const json = {
    generatedAt, stats, flow: FLOW, built, modules, pages: inventory, endpoints, roadmap: ROADMAP,
    tech: { ...TECH, sqlFiles }, standard: DOC_STANDARD,
  };
  fs.mkdirSync(path.join(ROOT, 'client', 'public'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'client', 'public', 'flow-data.json'), JSON.stringify(json));

  // ---------------------------------------------------------------- Word file
  const FONT = 'Calibri'; const ACCENT = '1F5FA8';
  const PAGE_W = 11906; const MARGIN = 1134; const CONTENT_W = PAGE_W - 2 * MARGIN;
  const STATUS = { done: 'Done', progress: 'In progress', next: 'Next', later: 'Later' };
  const p = (text, run = {}) => new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text, font: FONT, size: 21, ...run })] });
  const rich = (runs) => new Paragraph({ spacing: { after: 100 }, children: runs.map((r) => new TextRun({ font: FONT, size: 21, ...(typeof r === 'string' ? { text: r } : r) })) });
  const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new TextRun({ text, font: FONT })] });
  const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, font: FONT })] });
  const step = (text) => new Paragraph({ numbering: { reference: 'steps', level: 0 }, spacing: { after: 60 }, children: [new TextRun({ text, font: FONT, size: 21 })] });
  const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'C9D3E0' };
  const cell = (text, width, { head = false, shade } = {}) => new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: { top: border, bottom: border, left: border, right: border },
    shading: head ? { type: ShadingType.CLEAR, color: 'auto', fill: ACCENT } : shade ? { type: ShadingType.CLEAR, color: 'auto', fill: shade } : undefined,
    margins: { top: 50, bottom: 50, left: 90, right: 90 },
    children: String(text ?? '').split('\n').map((l) => new Paragraph({ children: [new TextRun({ text: l, font: FONT, size: head ? 18 : 17, bold: head, color: head ? 'FFFFFF' : undefined })] })),
  });
  const table = (headers, rows, fractions) => {
    const widths = fractions.map((f) => Math.floor(CONTENT_W * f));
    widths[widths.length - 1] += CONTENT_W - widths.reduce((a, b) => a + b, 0);
    return new Table({
      width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: widths,
      rows: [
        new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, widths[i], { head: true })) }),
        ...rows.map((r, ri) => new TableRow({ children: r.map((c, i) => cell(c, widths[i], { shade: ri % 2 ? 'F3F6FA' : undefined })) })),
      ],
    });
  };

  const c = [];
  c.push(
    new Paragraph({ spacing: { before: 2400, after: 200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'RAMAS ERP', font: FONT, size: 56, bold: true, color: ACCENT })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: 'Project Flow and Documentation', font: FONT, size: 40, bold: true })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [new TextRun({ text: 'Legacy ASP.NET WebForms ERP → REST API (Node / Express) + React', font: FONT, size: 24, color: '555555' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: `${stats.built} of ${stats.pages} pages built  •  ${stats.todo} to do  •  ${stats.modules} modules  •  ${stats.endpoints} API endpoints  •  ${stats.tests} tests`, font: FONT, size: 22, bold: true })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Generated ${generatedAt.slice(0, 10)}`, font: FONT, size: 20, color: '777777' })] }),
    new Paragraph({ children: [new PageBreak()] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Contents', font: FONT })] }),
    new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
    p('When Word asks to update the fields, choose Yes to fill in the page numbers.', { color: '777777', size: 18 }),
  );

  c.push(h1('1. Overview'));
  c.push(table(['Item', 'Details'], [
    ['Legacy system', 'ASP.NET WebForms (wwwroot, 614 .aspx pages), SQL Server stored procedures, Crystal Reports'],
    ['New system', 'Server: Node.js + Express REST API (D:\\rr\\ramas-modern\\server)\nClient: React + Ant Design (D:\\rr\\ramas-modern\\client)\nDatabase: the same SQL Server (dev copy: ramas_modern_dev)'],
    ['Progress', `${stats.built} of ${stats.pages} pages built, ${stats.todo} to do (${Math.round((stats.built / stats.pages) * 100)}%)`],
    ['Built modules', `${stats.modules} (section 3)`],
    ['API', `${stats.endpoints} documented endpoints (section 5)`],
    ['Tests', `${stats.tests} API tests`],
    ['Dev database scripts', `${stats.sqlFiles} files in server/db/dev`],
  ], [0.25, 0.75]));
  c.push(gap(), h2('Pages by module'));
  c.push(table(['#', 'Module', 'Total', 'Built', 'To do', 'Progress'],
    modules.map((m, i) => [String(i + 1), m.title, String(m.total), String(m.built), String(m.todo), `${Math.round((m.built / m.total) * 100)}%`]),
    [0.06, 0.4, 0.12, 0.12, 0.12, 0.18]));
  c.push(gap(), h2('What every module\'s documentation contains'));
  c.push(table(['#', 'Section', 'What it holds'], DOC_STANDARD.map(([a, b], i) => [String(i + 1), a, b]), [0.06, 0.3, 0.64]));

  c.push(h1('2. Business flow — how the modules connect'));
  c.push(p('The journey of one consignment, from masters to the bill and the accounts. Each step takes the previous step\'s data and hands its own to the next.'));
  c.push(table(['#', 'Step', 'Pages', 'What happens', 'Feeds', 'Status'],
    FLOW.map((f, i) => [String(i + 1), f.step, f.pages, f.what, f.to, STATUS[f.status]]), [0.05, 0.15, 0.2, 0.33, 0.17, 0.1]));

  c.push(h1('3. Built modules'));
  built.forEach((m, i) => {
    c.push(h2(`3.${i + 1}  ${m.name}${m.status === 'progress' ? ' (in progress)' : ''}`));
    c.push(table(['', ''], [
      ['Legacy pages', m.legacy], ['New pages', m.pages], ['Database', m.tables], ['Connections', m.connects],
      ...(m.rules ? [['Rules', m.rules]] : []),
    ], [0.22, 0.78]));
    if (m.endpoints.length) {
      c.push(new Paragraph({ spacing: { before: 100, after: 60 }, children: [new TextRun({ text: 'API endpoints', font: FONT, size: 20, bold: true })] }));
      c.push(table(['Method', 'Address', 'Purpose'], m.endpoints.map((e) => [e.method, e.path, e.purpose]), [0.1, 0.42, 0.48]));
    }
    c.push(gap());
  });
  c.push(h2(`3.${built.length + 1}  All built legacy pages (${stats.built})`));
  c.push(table(['#', 'Legacy page', 'New address'], inventory.filter((x) => x.status === 'Built').map((r, i) => [String(i + 1), r.page, r.newRoute]), [0.07, 0.53, 0.4]));

  c.push(h1('4. Modules and pages still to do'));
  c.push(p(`${stats.todo} pages. For each module: what it will do, where its data comes from and goes to, the plan, and every page with its area.`));
  let n = 0;
  for (const m of modules.filter((x) => x.todo)) {
    n += 1;
    c.push(h2(`4.${n}  ${m.title} — ${m.todo} to do${m.built ? `, ${m.built} built` : ''}`));
    if (m.summary) c.push(p(m.summary));
    c.push(table(['', ''], [['Takes data from', m.from || '—'], ['Feeds', m.to || '—'], ['Areas', m.areas.map((a) => `${a.name} (${a.count})`).join(', ')]], [0.22, 0.78]));
    if (m.plan.length) {
      c.push(new Paragraph({ spacing: { before: 100, after: 60 }, children: [new TextRun({ text: 'Plan', font: FONT, size: 20, bold: true })] }));
      for (const s of m.plan) c.push(step(s));
    }
    const todo = inventory.filter((x) => x.module === m.module && x.status !== 'Built');
    c.push(table(['#', 'Page', 'Area', 'Type', 'KB'], todo.map((r, i) => [`${n}.${i + 1}`, r.page.replace(/^[^/]+\//, ''), r.area, r.kind, String(r.kb)]), [0.09, 0.44, 0.23, 0.14, 0.1]));
    c.push(gap());
  }

  c.push(h1('5. API reference'));
  c.push(p(`All ${stats.endpoints} documented endpoints, read from the routes files.`));
  const byMod = [...new Set(endpoints.map((e) => e.module))];
  byMod.forEach((mod, i) => {
    c.push(h2(`5.${i + 1}  ${mod}`));
    c.push(table(['Method', 'Address', 'Purpose'], endpoints.filter((e) => e.module === mod).map((e) => [e.method, e.path, e.purpose]), [0.1, 0.42, 0.48]));
  });

  c.push(h1('6. Technical structure'));
  c.push(h2('6.1  Folders'));
  c.push(table(['Folder', 'Contents'], TECH.folders, [0.35, 0.65]));
  c.push(h2('6.2  Running'));
  for (const s of TECH.run) c.push(step(s));
  c.push(h2('6.3  How a page is wired'));
  for (const s of TECH.inside) c.push(step(s));
  c.push(h2('6.4  Dev database scripts'));
  c.push(table(['#', 'File'], sqlFiles.map((f, i) => [String(i + 1), f]), [0.1, 0.9]));

  c.push(h1('7. Roadmap'));
  c.push(table(['#', 'Work', 'Status'], ROADMAP.map((r, i) => [String(i + 1), r.item, STATUS[r.status]]), [0.07, 0.75, 0.18]));

  const doc = new Document({
    creator: 'Ramas ERP migration', title: 'Ramas ERP — Project Flow and Documentation', features: { updateFields: true },
    styles: {
      default: { document: { run: { font: FONT, size: 21 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: ACCENT, font: FONT }, paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 25, bold: true, color: '1A3D66', font: FONT }, paragraph: { spacing: { before: 220, after: 100 }, outlineLevel: 1 } },
      ],
    },
    numbering: { config: [{ reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 360 } } } }] }] },
    sections: [{
      properties: { page: { size: { width: PAGE_W, height: 16838 }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ font: FONT, size: 16, color: '888888', children: ['Ramas ERP — Project Flow  •  Page ', PageNumber.CURRENT] })] })] }) },
      children: c,
    }],
  });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(ROOT, 'docs', 'flow.docx'), buf);
  fs.writeFileSync(path.join(ROOT, 'client', 'public', 'flow.docx'), buf);
  console.log(`flow.docx ${buf.length} bytes; flow-data.json; ${stats.built}/${stats.pages} pages, ${stats.modules} modules, ${stats.endpoints} endpoints, ${stats.tests} tests`);
}

main().catch((e) => { console.error(e); process.exit(1); });
