// Shared posting helpers: find-or-create a system ledger in the right section of the chart of accounts.
import { query } from '../../db/index.js';
import { s } from '../../utils/values.js';
import { DEFAULT_GROUP, SECTION } from './sections.js';

/** The group for a section: a group already marked with it (tblAccountGroupInfo), else its default group (created if missing). */
export async function groupForSection(section, tx) {
  if (!SECTION.has(section)) throw new Error(`Unknown section ${section}`);
  const [g] = await query(
    `select top 1 g.GroupCode from tblAccountGroup g join tblAccountGroupInfo i on i.GroupCode = g.GroupCode
      where i.Section = @s order by case when upper(g.GroupName) = @n then 0 else 1 end, g.GroupCode`,
    { s: section, n: DEFAULT_GROUP[section] }, { tx });
  if (g) return s(g.GroupCode);
  const [named] = await query('select top 1 GroupCode from tblAccountGroup where upper(GroupName) = @n', { n: DEFAULT_GROUP[section] }, { tx });
  let code = s(named?.GroupCode);
  if (!code) {
    const [m] = await query(
      `select isnull(max(try_cast(substring(GroupCode, 2, 20) as int)), 0) + 1 as n
         from tblAccountGroup with (updlock, holdlock) where GroupCode like 'G[0-9]%'`, {}, { tx });
    code = `G${Number(m?.n) || 1}`;
    await query('insert into tblAccountGroup(GroupCode, GroupName) values (@c, @n)', { c: code, n: DEFAULT_GROUP[section] }, { tx });
  }
  await query(
    `if not exists (select 1 from tblAccountGroupInfo where GroupCode = @c)
       insert into tblAccountGroupInfo(GroupCode, Section, UpdatedBy) values (@c, @s, 'system')`, { c: code, s: section }, { tx });
  return code;
}

/** Name of the group for a section — for legacy procedures (usp_AutoBindLedger) that take a group NAME and create it if missing. */
export async function groupNameForSection(section, tx) {
  const code = await groupForSection(section, tx);
  const [g] = await query('select GroupName from tblAccountGroup where GroupCode = @c', { c: code }, { tx });
  return s(g?.GroupName) || DEFAULT_GROUP[section];
}

/** A ledger of the login year + division by name; created in the section's group when missing. Returns its code. */
export async function ensureLedger(user, tx, { name, section, type, drcr = 'DR' }) {
  const p = { n: name, fy: user.financialYear, div: s(user.divCode) };
  const [found] = await query(
    `select top 1 LedgerCode from tblAccountLedger where upper(LedgerName) = upper(@n) and Financial_Year = @fy and Division = @div
      order by isnull(IsActive, 1) desc`, p, { tx });
  if (found) return s(found.LedgerCode);
  const grp = await groupForSection(section, tx);
  const [m] = await query(
    `select isnull(max(try_cast(substring(LedgerCode, 3, 20) as int)), 0) + 1 as n
       from tblAccountLedger with (updlock, holdlock) where LedgerCode like 'LM[0-9]%'`, {}, { tx });
  const code = `LM${String(Number(m?.n) || 1).padStart(6, '0')}`;
  await query(
    `insert into tblAccountLedger(LedgerCode, LedgerName, GroupCode, Ledger_Type, OpeningBal, ClosingBal, VendorOrClientCode, DrCr,
       Financial_Year, Division, IsActive)
     values (@code, @n, @g, @t, 0, 0, null, @drcr, @fy, @div, 1)`, { ...p, code, g: grp, t: type, drcr }, { tx });
  return code;
}
