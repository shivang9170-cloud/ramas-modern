// Generic engine for declarative masters (see definitions.js).
import { exec, mirrorToFleet, query, sql, withTransaction } from '../../db/index.js';
import { badRequest, conflict, forbidden, notFound, HttpError } from '../../middleware/errors.js';
import { definitions, definitionsByKey } from './definitions.js';

export function getDefinition(key, user) {
  const def = definitionsByKey.get(key);
  if (!def) throw notFound(`Unknown master "${key}"`);
  if (def.adminOnly && user?.role !== 'admin') throw forbidden();
  return def;
}

/** The master a select field's list comes from (for "+ New …" on the form): explicit `quick`, or options.master. */
function quickOf(field) {
  if (field.quick) return field.quick;
  const target = field.options?.master && definitionsByKey.get(field.options.master);
  return target ? { master: target.key, value: target.keyField } : null;
}

/** Public metadata for the React generic master screen (no SQL leaves the server). */
export function publicDefinition(def) {
  const identity = !def.fields.some((f) => f.name === def.keyField);
  return {
    key: def.key,
    title: def.title,
    legacyPage: def.legacyPage,
    keyField: def.keyField,
    statusValues: def.statusValues ?? null,
    autoCode: def.autoCode ? (def.autoCode.fromName ? 'name' : 'number') : null,
    adminOnly: Boolean(def.adminOnly),
    nameField: def.nameField ?? def.fields.find((f) => f.type === 'text' && (identity || f.name !== def.keyField))?.name ?? null,
    fields: def.fields.map(({ options, autofill, quick, ...f }) => {
      const q = quickOf({ options, quick });
      return { ...f, hasOptions: Boolean(options), hasAutofill: Boolean(autofill), quickAdd: q?.master ?? null, quickValue: q?.value ?? null };
    }),
  };
}

/**
 * The next free code for a new record:
 *   autoCode { prefix, width }   prefix + (highest number in use + 1), zero-padded           (D004, L005, CN004 …)
 *   autoCode { fromName: n }     the first n letters of the name, else n-1 letters + a digit  (NOIDA -> NOI / NO1 …)
 */
export async function nextCode(def, name) {
  if (!def.autoCode) throw notFound(`${def.title} has no automatic code`);
  if (def.autoCode.fromName) {
    const n = def.autoCode.fromName;
    const letters = String(name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!letters) return { code: '' };
    const taken = new Set((await query(
      `select upper(rtrim(${def.keyField})) as c from ${def.table} where ${def.keyField} like @p`, { p: `${letters[0]}%` },
    )).map((r) => r.c));
    const candidates = [letters.slice(0, n)];
    for (let i = 1; i <= 9; i++) candidates.push(letters.slice(0, n - 1) + i);
    for (let i = 1; i <= 99; i++) candidates.push(letters.slice(0, n) + i);
    return { code: candidates.find((c) => !taken.has(c)) ?? '' };
  }
  const { prefix, width = 3 } = def.autoCode;
  const [r] = await query(
    `select max(try_cast(substring(${def.keyField}, @len + 1, 30) as int)) as n
       from ${def.table} where ${def.keyField} like @like`,
    { len: prefix.length, like: `${prefix.replace(/[[%_]/g, '[$&]')}[0-9]%` },
  );
  return { code: prefix + String((Number(r?.n) || 0) + 1).padStart(width, '0') };
}

/** Values to fill in other fields when the user sets `fieldName` to `value` (the field's autofill query). */
export async function autofill(def, fieldName, value) {
  const field = def.fields.find((f) => f.name === fieldName);
  if (!field?.autofill) throw notFound(`Field "${fieldName}" has no autofill`);
  if (value === undefined || value === null || String(value).trim() === '') return {};
  const [row] = await query(field.autofill, { v: String(value).trim().slice(0, 200) });
  const names = new Set(def.fields.map((f) => f.name));
  const out = {};
  for (const [k, v] of Object.entries(row ?? {})) {
    if (names.has(k) && v !== null && v !== undefined && String(v).trim() !== '') out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

/**
 * Legacy page URLs (SubMenuUrl, lower case) of the menu items this employee was given in User Access Rights
 * (Employee_Permission), in his division.
 */
async function permittedPages(user) {
  const rows = await query(
    `select distinct lower(ltrim(rtrim(s.SubMenuUrl))) as url
       from Employee_Permission p join SubMenu s on s.SubMenuid = p.Sub_Menuid
      where p.Employeeid = @u and isnull(p.ActiveStatus, 'Y') = 'Y' and s.ActiveStatus = 'Y' and s.division like @div`,
    { u: user.userId, div: `%${user.divCode ?? ''}%` },
  );
  return new Set(rows.map((r) => r.url));
}

/**
 * May this user add / change / delete records of the master (and use its add-form helpers)? Admin: every master.
 * Employee: only the masters whose menu item (def.legacyPage) he was given access to — so a "+ New …" quick add
 * never lets someone create records of a master he cannot open. Clients / franchisees: none.
 */
export async function canWrite(def, user, pages) {
  if (user?.role === 'admin') return true;
  if (user?.role !== 'employee' || def.adminOnly) return false;
  return (pages ?? await permittedPages(user)).has(def.legacyPage.toLowerCase());
}

export async function assertCanWrite(def, user) {
  if (!(await canWrite(def, user))) throw forbidden(`You do not have access to ${def.title}`);
}

/** Definitions this user may see, each with canAdd (quick add / Add button allowed). */
export async function listDefinitions(user) {
  const visible = definitions.filter((d) => !d.adminOnly || user.role === 'admin');
  const pages = user.role === 'employee' ? await permittedPages(user) : null;
  return Promise.all(visible.map(async (d) => ({ ...publicDefinition(d), canAdd: await canWrite(d, user, pages) })));
}

export function listRows(def) {
  return query(def.listSql);
}

export async function getRow(def, code) {
  // rowSql: a master whose record spans more than its table (e.g. Division + its business profile)
  const rows = await query(def.rowSql ?? `select * from ${def.table} where ${def.keyField} = @code`, { code });
  if (!rows[0]) throw notFound(`${def.title}: "${code}" not found`);
  return rows[0];
}

/** Options for a select field: [{ value, label }] */
export async function fieldOptions(def, fieldName) {
  const field = def.fields.find((f) => f.name === fieldName);
  if (!field?.options) throw notFound(`Field "${fieldName}" has no options`);
  if (field.options.sql) return query(field.options.sql);
  const target = definitionsByKey.get(field.options.master);
  const labelField = target.fields.find((f) => f.name !== target.keyField && f.type === 'text')?.name ?? target.keyField;
  const statusField = target.fields.find((f) => f.type === 'status')?.name;
  const where = statusField ? `where ${statusField} = @active` : '';
  return query(
    `select ${target.keyField} as value, ${labelField} as label from ${target.table} ${where} order by ${labelField}`,
    statusField ? { active: target.statusValues[0] } : {},
  );
}

/** Validate + normalise a request body against the field definitions. */
function normalise(def, body, mode) {
  const out = {};
  const errors = [];
  for (const f of def.fields) {
    let v = body[f.name];
    if (mode === 'update' && f.createOnly) continue; // key comes from the URL
    if (f.type === 'status') {
      v = v ?? def.statusValues[0];
      if (!def.statusValues.includes(v)) errors.push({ path: f.name, message: `Must be one of ${def.statusValues.join(', ')}` });
    } else if (f.type === 'checkbox') {
      const on = v === true || v === 1 || v === '1' || v === f.yes || v === 'true';
      v = on ? f.yes : f.no;
    } else if (f.type === 'number') {
      if (v === '' || v === null || v === undefined) v = 0;
      v = Number(v);
      if (Number.isNaN(v)) errors.push({ path: f.name, message: 'Must be a number' });
      else if (f.min !== undefined && v < f.min) errors.push({ path: f.name, message: `Must be at least ${f.min}` });
    } else {
      v = v === null || v === undefined ? '' : String(v).trim();
      if (f.upper) v = v.toUpperCase();
      if (f.max && v.length > f.max) errors.push({ path: f.name, message: `Max ${f.max} characters` });
    }
    if (f.required && (v === '' || v === null || v === undefined)) errors.push({ path: f.name, message: `${f.label} is required` });
    out[f.name] = v;
  }
  if (errors.length) throw badRequest('Validation failed', errors);
  return out;
}

async function exists(sqlText, params) {
  const rows = await query(sqlText, params);
  return rows.length > 0;
}

async function checkUnique(def, values, mode, code) {
  for (const u of def.unique ?? []) {
    if (mode === 'update' && u.createOnly) continue;
    if (u.skipEmpty && (values[u.field] === '' || values[u.field] === null || values[u.field] === undefined)) continue;
    const params = { v: values[u.field] };
    let where = `${u.field} = @v`;
    for (const s of u.scope ?? []) { where += ` and ${s} = @s_${s}`; params[`s_${s}`] = values[s]; }
    if (mode === 'update') { where += ` and ${def.keyField} <> @code`; params.code = code; }
    if (await exists(`select top 1 1 from ${def.table} where ${where}`, params)) throw conflict(u.message);
  }
}

async function checkRules(rules, code) {
  for (const r of rules ?? []) {
    if (await exists(r.sql, { code })) throw conflict(r.message);
  }
}

function resolveOutputs(outputs) {
  const res = {};
  for (const [name, type] of Object.entries(outputs ?? {})) res[name] = sql()[type];
  return res;
}

// A master keyed by an identity column (id / no / slno — not a form field): the new row's key comes from the insert.
const identityKeyed = (def) => !def.fields.some((f) => f.name === def.keyField);

async function runOp(def, op, inputs, verb, { returnIdentity = false, tx } = {}) {
  if (op.sql) {
    if (!returnIdentity) { await query(op.sql, inputs, { tx }); return undefined; }
    const [r] = await query(`${op.sql}; select cast(scope_identity() as int) as newId`, inputs, { tx });
    return r?.newId;
  }
  const outputs = resolveOutputs(op.outputs);
  const result = await exec(op.proc, inputs, outputs, { tx });
  // Legacy DALs treated @retval > 0 as success. NULL (SP never set it) is accepted.
  const rv = result.output?.retval;
  if (op.outputs?.retval && rv !== null && rv !== undefined && Number(rv) <= 0) {
    throw new HttpError(422, `${def.title}: record could not be ${verb}`);
  }
  if (def.mirrorFleet) await mirrorToFleet(op.proc, inputs, outputs);
  return undefined;
}

/** A master with afterSave (e.g. a ledger to bind) saves the record and that work in one transaction. */
const inTransaction = (def, fn) => (def.afterSave ? withTransaction((tx) => fn(tx)) : fn(undefined));

export async function createRow(def, body, user) {
  const values = normalise(def, body, 'create');
  await checkUnique(def, values, 'create');
  await inTransaction(def, async (tx) => {
    const newId = await runOp(def, def.create, def.create.inputs(values, user), 'added', { returnIdentity: identityKeyed(def), tx });
    if (identityKeyed(def)) values[def.keyField] = newId;
    if (def.create.followWithUpdate?.(values)) {
      await runOp(def, def.update, def.update.inputs(values, user), 'updated', { tx });
    }
    await def.afterSave?.(values, user, { tx, mode: 'create' });
  });
  return getRow(def, values[def.keyField]);
}

export async function updateRow(def, code, body, user) {
  await getRow(def, code); // 404 if missing
  const values = normalise(def, body, 'update');
  values[def.keyField] = code;
  await checkUnique(def, values, 'update', code);
  await checkRules(def.blockUpdateWhenInUse, code);
  await inTransaction(def, async (tx) => {
    await runOp(def, def.update, def.update.inputs(values, user), 'updated', { tx });
    await def.afterSave?.(values, user, { tx, mode: 'update' });
  });
  return getRow(def, code);
}

export async function deleteRow(def, code, user) {
  await getRow(def, code);
  await checkRules(def.inUse, code);
  await runOp(def, def.remove, def.remove.inputs(code, user), 'deleted');
}
