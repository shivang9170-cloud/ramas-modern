// Sub-ledgers (one level) - shared by Account Master, Payment and Contra. Table tblLedgerHierarchy (44-...sql):
//   a MAIN ledger shows its own past balance + the total of its sub-ledgers and takes no NEW entries; entries go to
//   its sub-ledgers. An existing ledger with entries (e.g. OFFICE EXPENSES) can become a main ledger.
import { query } from '../../db/index.js';
import { badRequest, conflict } from '../../middleware/errors.js';
import { s } from '../../utils/values.js';

const opt = (tx) => (tx ? { tx } : undefined);

/** SQL condition "ledger <alias> is not a main ledger" - main ledgers never appear in posting pickers. */
export const NOT_MAIN = (alias = 'l') =>
  `not exists (select 1 from tblLedgerHierarchy lh where lh.LedgerCode = ${alias}.LedgerCode and lh.IsMain = 1)`;

export async function hierarchyOf(code, tx) {
  const [r] = await query('select ParentLedgerCode, IsMain from tblLedgerHierarchy where LedgerCode = @c', { c: code }, opt(tx));
  return { isMain: Boolean(r?.IsMain), parentCode: s(r?.ParentLedgerCode) };
}

/** Refuse a voucher line on a main ledger ("entries only on sub-ledgers"). */
export async function assertPostable(codes, tx) {
  const list = [...new Set(codes.map(s).filter(Boolean))];
  if (!list.length) return;
  const p = {}; const inList = list.map((c, i) => { p[`c${i}`] = c; return `@c${i}`; }).join(',');
  const mains = await query(
    `select h.LedgerCode, l.LedgerName from tblLedgerHierarchy h left join tblAccountLedger l on l.LedgerCode = h.LedgerCode
      where h.IsMain = 1 and h.LedgerCode in (${inList})`, p, opt(tx));
  if (mains.length) {
    throw conflict(`${mains.map((m) => s(m.LedgerName) || s(m.LedgerCode)).join(', ')} is a main ledger (total only). Post to one of its sub-ledgers.`);
  }
}

async function upsert(code, { parent, isMain }, user, tx) {
  await query(
    `if exists (select 1 from tblLedgerHierarchy where LedgerCode = @c)
       update tblLedgerHierarchy set ParentLedgerCode = @p, IsMain = @m, UpdatedBy = @u, UpdatedDate = getdate() where LedgerCode = @c
     else
       insert into tblLedgerHierarchy(LedgerCode, ParentLedgerCode, IsMain, UpdatedBy) values (@c, @p, @m, @u)`,
    { c: code, p: parent || null, m: isMain ? 1 : 0, u: s(user?.userId) || null }, opt(tx));
}

/** Make a ledger a main ledger (not if it is itself a sub-ledger - one level only). Past entries stay in its balance. */
export async function makeMain(user, code, tx) {
  const h = await hierarchyOf(code, tx);
  if (h.isMain) return;
  if (h.parentCode) throw badRequest('This ledger is a sub-ledger; only one level is allowed, so it cannot be a main ledger.');
  await upsert(code, { parent: null, isMain: true }, user, tx);
}

/** A ledger stops being main (only when it has no sub-ledgers left). */
export async function unmakeMain(user, code, tx) {
  const h = await hierarchyOf(code, tx);
  if (!h.isMain) return;
  const [kid] = await query('select top 1 1 as x from tblLedgerHierarchy where ParentLedgerCode = @c', { c: code }, opt(tx));
  if (kid) throw conflict('This main ledger still has sub-ledgers. Move or remove them first.');
  await query('delete from tblLedgerHierarchy where LedgerCode = @c', { c: code }, opt(tx));
}

/** Put a ledger under a main ledger (parent '' / null = take it out). One level: the child may not be a main. */
export async function setParent(user, code, parentCode, tx) {
  const parent = s(parentCode);
  const h = await hierarchyOf(code, tx);
  if (!parent) {
    if (h.parentCode) await query('delete from tblLedgerHierarchy where LedgerCode = @c and IsMain = 0', { c: code }, opt(tx));
    return;
  }
  if (parent === code) throw badRequest('A ledger cannot be its own sub-ledger.');
  if (h.isMain) throw badRequest('A main ledger cannot be placed under another ledger (one level only).');
  const p = await hierarchyOf(parent, tx);
  if (!p.isMain) throw badRequest('The selected ledger is not a main ledger.');
  await upsert(code, { parent, isMain: false }, user, tx);
}
