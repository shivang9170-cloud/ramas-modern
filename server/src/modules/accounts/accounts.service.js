// Account Master (ledgers + account groups) — modern take on Accounts/LedgerBind_Add.aspx(.cs).
//
// The legacy page "bound" a name from Ledger_Master into tblAccountLedger for a financial year and derived the
// ledger type from the name pattern (Client/Vendor/Employee/Bank/Franchisee). Here we manage tblAccountLedger
// directly for the current financial year + division: pick an account group, a type, an opening balance and its
// Dr/Cr side. Party-linked ledgers (a vendor / client / branch ledger, which carry a VendorOrClientCode and whose
// name is built from the party) are shown read-only so the chart of accounts is complete but those ledgers — used
// by booking, billing and receipts — cannot be renamed or deleted here.
//
// Tables (db/dev/06-challan.sql): tblAccountGroup(GroupCode, GroupName),
//   tblAccountLedger(LedgerCode pk, LedgerName, GroupCode, Ledger_Type, OpeningBal, ClosingBal, VendorOrClientCode,
//                    DrCr, Financial_Year, Division, IsActive),
//   tblAccountTrasaction(LedgerCode, Dr, Cr, ...) — a ledger with postings cannot be deleted.
//   tblLedgerHierarchy (44-...sql) — sub-ledgers, one level: a MAIN ledger shows only the total of its sub-ledgers.
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../middleware/errors.js';
import { s, round2 } from '../../utils/values.js';
import { makeMain, setParent, unmakeMain } from './ledgerTree.js';
import { NATURES, SECTION, sectionOptions } from '../books/sections.js';

// Types a user may pick for a hand-made ledger. Party ledgers (Client/Vendor/Employee/Franchisee/Branch) are made
// by their own screens, not here.
export const LEDGER_TYPES = [
  'Ledger', 'Cash', 'Bank', 'Asset', 'Liability', 'Expense', 'Income', 'Duties & Taxes',
].map((t) => ({ value: t, label: t }));

const MANUAL_TYPES = new Set(LEDGER_TYPES.map((t) => t.value.toLowerCase()));
const DRCR = ['DR', 'CR'];

// A ledger is "system" (read-only here) when it belongs to a party or was made by another module.
const isSystem = (r) => Boolean(s(r.VendorOrClientCode)) || !MANUAL_TYPES.has(s(r.Ledger_Type).toLowerCase());

// ------------------------------------------------------------------ options / groups

export async function options(user) {
  const [groups, mains] = await Promise.all([
    query(`select g.GroupCode, g.GroupName, i.Section from tblAccountGroup g left join tblAccountGroupInfo i on i.GroupCode = g.GroupCode
            order by g.GroupName`),
    query(`select l.LedgerCode, l.LedgerName from tblAccountLedger l join tblLedgerHierarchy h on h.LedgerCode = l.LedgerCode and h.IsMain = 1
            where l.Financial_Year = @fy and l.Division = @div order by l.LedgerName`, { fy: user.financialYear, div: user.divCode }),
  ]);
  return {
    groups: groups.map((g) => ({
      value: s(g.GroupCode), label: s(g.GroupName), section: s(g.Section), sectionLabel: SECTION.get(s(g.Section))?.label ?? '',
    })),
    sections: sectionOptions(),
    mains: mains.map((m) => ({ value: s(m.LedgerCode), label: s(m.LedgerName) })),
    ledgerTypes: LEDGER_TYPES,
    drcr: DRCR.map((v) => ({ value: v, label: v === 'DR' ? 'Dr (debit)' : 'Cr (credit)' })),
  };
}

// A group's section (tblAccountGroupInfo, 45-...sql) decides where its ledgers appear in Trial Balance / P&L / Balance Sheet.
export async function listGroups() {
  const rows = await query(
    `select g.GroupCode, g.GroupName, i.Section, count(l.LedgerCode) as ledgers
       from tblAccountGroup g
       left join tblAccountGroupInfo i on i.GroupCode = g.GroupCode
       left join tblAccountLedger l on l.GroupCode = g.GroupCode
      group by g.GroupCode, g.GroupName, i.Section
      order by g.GroupName`);
  return rows.map((g) => {
    const sec = SECTION.get(s(g.Section));
    return { code: s(g.GroupCode), name: s(g.GroupName), section: s(g.Section), sectionLabel: sec?.label ?? '', nature: NATURES[sec?.nature] ?? '',
      ledgers: Number(g.ledgers) || 0 };
  });
}

async function saveSection(tx, code, section, user) {
  await query(
    `if exists (select 1 from tblAccountGroupInfo where GroupCode = @c)
       update tblAccountGroupInfo set Section = @s, UpdatedBy = @u, UpdatedDate = getdate() where GroupCode = @c
     else insert into tblAccountGroupInfo(GroupCode, Section, UpdatedBy) values (@c, @s, @u)`,
    { c: code, s: section, u: s(user?.userId) || null }, { tx });
}

export async function createGroup(body, user) {
  const name = s(body.name).trim().toUpperCase();
  if (name.length < 2) throw badRequest('Enter the group name');
  if (!SECTION.has(s(body.section))) throw badRequest('Select what the group is (its type)');
  const [dup] = await query('select GroupCode from tblAccountGroup where upper(GroupName) = @n', { n: name });
  if (dup) throw conflict(`Account group "${name}" already exists (${s(dup.GroupCode)})`);
  const code = await withTransaction(async (tx) => {
    const [m] = await query(
      `select isnull(max(try_cast(substring(GroupCode, 2, 20) as int)), 0) + 1 as n
         from tblAccountGroup with (updlock, holdlock) where GroupCode like 'G[0-9]%'`, {}, { tx });
    const next = `G${Math.max(Number(m?.n) || 1, 1)}`;
    await query('insert into tblAccountGroup(GroupCode, GroupName) values (@c, @n)', { c: next, n: name }, { tx });
    await saveSection(tx, next, s(body.section), user);
    return next;
  });
  return { code, message: `Account group "${name}" (${code}) created` };
}

export async function setGroupSection(user, code, section) {
  if (!SECTION.has(s(section))) throw badRequest('Select what the group is (its type)');
  const [g] = await query('select GroupName from tblAccountGroup where GroupCode = @c', { c: code });
  if (!g) throw notFound('Account group not found');
  await withTransaction((tx) => saveSection(tx, code, s(section), user));
  return { code, message: `${s(g.GroupName)} is now under ${SECTION.get(s(section)).label}` };
}

// ------------------------------------------------------------------ ledgers: list / get

const mapRow = (r) => ({
  code: s(r.LedgerCode),
  name: s(r.LedgerName),
  groupCode: s(r.GroupCode),
  group: s(r.GroupName),
  ledgerType: s(r.Ledger_Type),
  openingBal: round2(Number(r.OpeningBal) || 0),
  closingBal: round2(Number(r.ClosingBal) || 0),
  // current running balance (Dr-positive): opening by side + posted Dr − Cr; undefined on getLedger (not selected there)
  balance: r.bal === undefined || r.bal === null ? null : round2(Number(r.bal) || 0),
  drCr: s(r.DrCr).toUpperCase() || 'DR',
  active: r.IsActive === true || r.IsActive === 1,
  system: isSystem(r),
  isMain: r.IsMain === true || r.IsMain === 1,
  parentCode: s(r.ParentLedgerCode),
  parentName: s(r.ParentName),
});

export async function listLedgers(user, { q = '', status = 'all', group = '', type = '' } = {}) {
  const rows = await query(
    `select l.*, g.GroupName, h.IsMain, h.ParentLedgerCode, pl.LedgerName as ParentName,
            (case when upper(l.DrCr) = 'CR' then -1 else 1 end) * isnull(l.OpeningBal, 0)
            + isnull((select sum(t.Dr) - sum(t.Cr) from tblAccountTrasaction t
                       where t.LedgerCode = l.LedgerCode and t.Financial_Year = l.Financial_Year and t.Division = l.Division
                         and isnull(t.IsCancelled, 0) = 0), 0) as bal
       from tblAccountLedger l
       left join tblAccountGroup g on g.GroupCode = l.GroupCode
       left join tblLedgerHierarchy h on h.LedgerCode = l.LedgerCode
       left join tblAccountLedger pl on pl.LedgerCode = h.ParentLedgerCode
      where l.Financial_Year = @fy and l.Division = @div
      order by l.LedgerName`,
    { fy: user.financialYear, div: user.divCode });
  const all = rows.map(mapRow);
  // a main ledger's balance = its own (normally 0) + all of its sub-ledgers; count its subs (before any filter)
  const kids = new Map();
  for (const l of all) if (l.parentCode) kids.set(l.parentCode, [...(kids.get(l.parentCode) ?? []), l]);
  for (const l of all) {
    if (!l.isMain) continue;
    const subs = kids.get(l.code) ?? [];
    l.subCount = subs.length;
    l.balance = round2((l.balance ?? 0) + subs.reduce((a, x) => a + (x.balance ?? 0), 0));
  }
  const term = q.toUpperCase();
  return all
    .filter((l) => !term || [l.name, l.code, l.group, l.parentName].some((x) => x.toUpperCase().includes(term)))
    .filter((l) => !group || l.groupCode === group)
    .filter((l) => !type || l.ledgerType.toLowerCase() === type.toLowerCase())
    .filter((l) => status === 'all' || (status === 'active' ? l.active : !l.active));
}

export async function getLedger(user, code) {
  const [r] = await query(
    `select l.*, g.GroupName, h.IsMain, h.ParentLedgerCode, pl.LedgerName as ParentName
       from tblAccountLedger l
       left join tblAccountGroup g on g.GroupCode = l.GroupCode
       left join tblLedgerHierarchy h on h.LedgerCode = l.LedgerCode
       left join tblAccountLedger pl on pl.LedgerCode = h.ParentLedgerCode
      where l.LedgerCode = @code and l.Financial_Year = @fy and l.Division = @div`,
    { code, fy: user.financialYear, div: user.divCode });
  if (!r) throw notFound(`Ledger ${code} not found in this financial year`);
  return mapRow(r);
}

// ------------------------------------------------------------------ validation shared by create / update

async function validate(body) {
  const [grp] = await query('select GroupCode from tblAccountGroup where GroupCode = @g', { g: body.groupCode });
  if (!grp) throw badRequest('Select an account group');
  if (!MANUAL_TYPES.has(s(body.ledgerType).toLowerCase())) throw badRequest('Select a valid ledger type');
  if (!DRCR.includes(s(body.drCr).toUpperCase())) throw badRequest('Opening balance side must be Dr or Cr');
  return { groupCode: s(body.groupCode), ledgerType: s(body.ledgerType), drCr: s(body.drCr).toUpperCase() };
}

// ------------------------------------------------------------------ create / update / delete

export async function createLedger(user, body) {
  const v = await validate(body);
  const name = s(body.name).trim().toUpperCase();
  if (name.length < 2) throw badRequest('Enter the ledger name');
  const code = await withTransaction(async (tx) => {
    const [dup] = await query(
      'select LedgerCode from tblAccountLedger with (updlock, holdlock) where upper(LedgerName) = @n and Financial_Year = @fy and Division = @div',
      { n: name, fy: user.financialYear, div: user.divCode }, { tx });
    if (dup) throw conflict(`Ledger "${name}" already exists in this financial year (${s(dup.LedgerCode)})`);
    // LM + 6 digits — next after the highest LM code (a row count would collide once ledgers are deleted).
    const [m] = await query(
      `select isnull(max(try_cast(substring(LedgerCode, 3, 20) as int)), 0) + 1 as n
         from tblAccountLedger with (updlock, holdlock) where LedgerCode like 'LM[0-9]%'`, {}, { tx });
    const next = `LM${String(Math.max(Number(m?.n) || 1, 1)).padStart(6, '0')}`;
    await query(
      `insert into tblAccountLedger(LedgerCode, LedgerName, GroupCode, Ledger_Type, OpeningBal, ClosingBal, VendorOrClientCode, DrCr, Financial_Year, Division, IsActive)
       values (@code, @name, @grp, @type, @open, @open, null, @drcr, @fy, @div, @active)`,
      { code: next, name, grp: v.groupCode, type: v.ledgerType, open: round2(Number(body.openingBal) || 0),
        drcr: v.drCr, fy: user.financialYear, div: user.divCode, active: body.active ? 1 : 0 }, { tx });
    await applyTree(user, tx, next, body);
    return next;
  });
  return { code, message: `Ledger "${name}" (${code}) created` };
}

/** isMain / parentCode from the form: a main ledger or a sub-ledger of a main - never both (one level). */
async function applyTree(user, tx, code, body) {
  const parent = s(body.parentCode);
  if (body.isMain && parent) throw badRequest('A main ledger cannot be placed under another ledger (one level only).');
  if (parent) {
    const [p] = await query('select LedgerCode from tblAccountLedger where LedgerCode = @p and Financial_Year = @fy and Division = @div',
      { p: parent, fy: user.financialYear, div: user.divCode }, { tx });
    if (!p) throw badRequest('The main ledger was not found in this financial year.');
  }
  if (body.isMain) await makeMain(user, code, tx); else await unmakeMain(user, code, tx);
  await setParent(user, code, body.isMain ? '' : parent, tx);
}

/** Put ANY ledger (party / system ledgers too - it changes no name and no entry) under a main ledger, or take it out. */
export async function setLedgerParent(user, code, parentCode) {
  const current = await getLedger(user, code);
  await withTransaction(async (tx) => {
    if (s(parentCode)) {
      const [p] = await query('select LedgerCode from tblAccountLedger where LedgerCode = @p and Financial_Year = @fy and Division = @div',
        { p: s(parentCode), fy: user.financialYear, div: user.divCode }, { tx });
      if (!p) throw badRequest('The main ledger was not found in this financial year.');
    }
    await setParent(user, code, parentCode, tx);
  });
  return { code, message: s(parentCode) ? `${current.name} is now a sub-ledger` : `${current.name} removed from its main ledger` };
}

/**
 * "+ Sub-Ledger" on a main ledger (Account Master and Payment Entry): a new ledger with the main's group, type and
 * Dr/Cr side, placed under it. A normal ledger becomes a main ledger on its first sub-ledger.
 */
export async function createSubLedger(user, mainCode, body) {
  const main = await getLedger(user, mainCode);
  if (main.parentCode) throw badRequest(`${main.name} is itself a sub-ledger; only one level is allowed.`);
  const name = s(body.name).trim().toUpperCase();
  if (name.length < 2) throw badRequest('Enter the sub-ledger name');
  const code = await withTransaction(async (tx) => {
    const [dup] = await query(
      'select LedgerCode from tblAccountLedger with (updlock, holdlock) where upper(LedgerName) = @n and Financial_Year = @fy and Division = @div',
      { n: name, fy: user.financialYear, div: user.divCode }, { tx });
    if (dup) throw conflict(`Ledger "${name}" already exists in this financial year (${s(dup.LedgerCode)})`);
    const [m] = await query(
      `select isnull(max(try_cast(substring(LedgerCode, 3, 20) as int)), 0) + 1 as n
         from tblAccountLedger with (updlock, holdlock) where LedgerCode like 'LM[0-9]%'`, {}, { tx });
    const next = `LM${String(Math.max(Number(m?.n) || 1, 1)).padStart(6, '0')}`;
    // a party / system main (e.g. a vendor) gives its group; the sub-ledger itself is a normal, editable ledger
    const type = MANUAL_TYPES.has(main.ledgerType.toLowerCase()) ? main.ledgerType : 'Ledger';
    await query(
      `insert into tblAccountLedger(LedgerCode, LedgerName, GroupCode, Ledger_Type, OpeningBal, ClosingBal, VendorOrClientCode, DrCr, Financial_Year, Division, IsActive)
       values (@code, @name, @grp, @type, @open, @open, null, @drcr, @fy, @div, 1)`,
      { code: next, name, grp: main.groupCode, type, open: round2(Number(body.openingBal) || 0), drcr: main.drCr,
        fy: user.financialYear, div: user.divCode }, { tx });
    await makeMain(user, mainCode, tx);
    await setParent(user, next, mainCode, tx);
    return next;
  });
  return { code, name, message: `Sub-ledger ${name} created under ${main.name}` };
}

export async function updateLedger(user, code, body) {
  const current = await getLedger(user, code);
  if (current.system) throw conflict('This is a party / system ledger (vendor, client, branch…). Edit it from its own master.');
  const v = await validate(body);
  const name = s(body.name).trim().toUpperCase();
  if (name.length < 2) throw badRequest('Enter the ledger name');
  if (name !== current.name) {
    const [dup] = await query(
      'select LedgerCode from tblAccountLedger where upper(LedgerName) = @n and Financial_Year = @fy and Division = @div and LedgerCode <> @code',
      { n: name, fy: user.financialYear, div: user.divCode, code });
    if (dup) throw conflict(`Another ledger already uses the name "${name}" (${s(dup.LedgerCode)})`);
  }
  await withTransaction(async (tx) => {
    await query(
      `update tblAccountLedger
          set LedgerName = @name, GroupCode = @grp, Ledger_Type = @type, OpeningBal = @open, DrCr = @drcr, IsActive = @active
        where LedgerCode = @code and Financial_Year = @fy and Division = @div`,
      { name, grp: v.groupCode, type: v.ledgerType, open: round2(Number(body.openingBal) || 0), drcr: v.drCr,
        active: body.active ? 1 : 0, code, fy: user.financialYear, div: user.divCode }, { tx });
    await applyTree(user, tx, code, body);
  });
  return { code, message: `Ledger "${name}" (${code}) updated` };
}

export async function deleteLedger(user, code) {
  const current = await getLedger(user, code);
  if (current.system) throw conflict('This is a party / system ledger — deactivate it instead of deleting.');
  const [posted] = await query(
    'select top 1 1 as x from tblAccountTrasaction where LedgerCode = @code', { code });
  if (posted) throw conflict('This ledger has account entries — deactivate it instead of deleting.');
  const [kid] = await query('select top 1 1 as x from tblLedgerHierarchy where ParentLedgerCode = @code', { code });
  if (kid) throw conflict('This main ledger still has sub-ledgers. Move or remove them first.');
  await withTransaction(async (tx) => {
    await query('delete from tblLedgerHierarchy where LedgerCode = @code', { code }, { tx });
    await query('delete from tblAccountLedger where LedgerCode = @code and Financial_Year = @fy and Division = @div',
      { code, fy: user.financialYear, div: user.divCode }, { tx });
  });
  return { code, message: `Ledger "${current.name}" (${code}) deleted` };
}
