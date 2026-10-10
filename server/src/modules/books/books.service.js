// Books & Reports — one place to see every rupee: where money is (cash / bank / receivable / payable / advances),
// every voucher of every module with its source (Day Book), any ledger's statement, and the final accounts
// (Trial Balance, Profit & Loss, Balance Sheet) plus an expense analysis by group -> main ledger -> sub-ledger.
//
// Everything is read from tblAccountTrasaction (all modules post there) for the login year + division; voucher details
// (date, type, narration, party, user) come from vw_AccountVoucher; what a group is comes from tblAccountGroupInfo
// (45-accounts-books.sql). Main / sub-ledgers (tblLedgerHierarchy) roll up: a main ledger shows its own + its subs.
import { query } from '../../db/index.js';
import { notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { s, n, iso, round2, today } from '../../utils/values.js';
import { SECTION, SECTIONS } from './sections.js';

const sc = (user) => ({ fy: user.financialYear, div: s(user.divCode) });

/** Period inside the login year (defaults: whole year up to today). */
export function period(user, { from, to } = {}) {
  const fy = financialYearRange(user.financialYear) ?? { from: '2000-01-01', to: today() };
  const end = fy.to < today() ? fy.to : today();
  const f = from && from >= fy.from && from <= fy.to ? from : fy.from;
  const t = to && to >= fy.from && to <= fy.to ? to : end;
  return { from: f, to: t < f ? f : t, fyFrom: fy.from, fyTo: fy.to };
}

// a group with no section yet: guess from the ledger type so nothing falls off the reports
const TYPE_SECTION = {
  cash: 'CASH', bank: 'BANK', client: 'DEBTORS', vendor: 'CREDITORS', advance: 'ADVANCES', expense: 'INDIRECT_EXP',
  income: 'INDIRECT_INC', asset: 'CURR_ASSET', liability: 'CURR_LIAB', 'duties & taxes': 'TAXES', branch: 'BRANCH', employee: 'CURR_LIAB',
};

const VOUCHER_TYPE = {
  'Payment Note': 'Payment', 'Contra Note': 'Contra', 'BILL RECEIVE': 'Receipt', 'Bill Finalized': 'Sales',
  'Miscellaneous Bill Finalized': 'Sales', 'Warehouse Bill Finalized': 'Sales', 'PURCHASE/PAYBILL': 'Purchase', CHALLAN: 'Purchase',
};

/**
 * Every ledger of the year with: opening (start of year, Dr-positive), movement before `from`, Dr / Cr in [from, to],
 * balance at `from` and at `to`. Section / nature / group / main-sub info attached.
 */
async function ledgerTotals(user, { from, to }) {
  const rows = await query(
    `select l.LedgerCode, l.LedgerName, l.Ledger_Type, l.GroupCode, g.GroupName, i.Section, isnull(l.IsActive, 1) as IsActive,
            h.IsMain, h.ParentLedgerCode, l.VendorOrClientCode,
            (case when upper(l.DrCr) = 'CR' then -1 else 1 end) * isnull(l.OpeningBal, 0) as opening,
            isnull(sum(case when t.CreatedDate < @from then t.Dr - t.Cr end), 0) as prior,
            isnull(sum(case when t.CreatedDate >= @from then t.Dr end), 0) as dr,
            isnull(sum(case when t.CreatedDate >= @from then t.Cr end), 0) as cr
       from tblAccountLedger l
       left join tblAccountGroup g on g.GroupCode = l.GroupCode
       left join tblAccountGroupInfo i on i.GroupCode = l.GroupCode
       left join tblLedgerHierarchy h on h.LedgerCode = l.LedgerCode
       left join tblAccountTrasaction t on t.LedgerCode = l.LedgerCode and isnull(t.IsCancelled, 0) = 0
             and t.CreatedDate < dateadd(day, 1, cast(@to as date))
      where l.Financial_Year = @fy and (@div = '' or l.Division = @div)
      group by l.LedgerCode, l.LedgerName, l.Ledger_Type, l.GroupCode, g.GroupName, i.Section, l.IsActive, h.IsMain, h.ParentLedgerCode,
               l.VendorOrClientCode, l.DrCr, l.OpeningBal`,
    { ...sc(user), from, to });
  return rows.map((r) => {
    const section = s(r.Section) || TYPE_SECTION[s(r.Ledger_Type).toLowerCase()] || '';
    const opening = round2(n(r.opening));
    const atFrom = round2(opening + n(r.prior));
    const dr = round2(n(r.dr)); const cr = round2(n(r.cr));
    return {
      code: s(r.LedgerCode), name: s(r.LedgerName), type: s(r.Ledger_Type), groupCode: s(r.GroupCode), group: s(r.GroupName) || 'No group',
      section, sectionLabel: SECTION.get(section)?.label ?? 'Unclassified', nature: SECTION.get(section)?.nature ?? '',
      classified: Boolean(s(r.Section)), active: Boolean(r.IsActive), isMain: Boolean(r.IsMain), parentCode: s(r.ParentLedgerCode),
      partyCode: s(r.VendorOrClientCode), opening, atFrom, dr, cr, closing: round2(atFrom + dr - cr),
    };
  });
}

/** Sub-ledgers folded into their main ledger: main.total* = own + subs, main.subs = [...]. Returns top-level ledgers. */
function rollUp(ledgers) {
  const byCode = new Map(ledgers.map((l) => [l.code, { ...l, subs: [] }]));
  const top = [];
  for (const l of byCode.values()) {
    const parent = l.parentCode && byCode.get(l.parentCode);
    if (parent) parent.subs.push(l); else top.push(l);
  }
  for (const l of top) {
    if (!l.subs.length) continue;
    l.subs.sort((a, b) => a.name.localeCompare(b.name));
    for (const k of ['opening', 'atFrom', 'dr', 'cr', 'closing']) l[k] = round2(l[k] + l.subs.reduce((a, x) => a + x[k], 0));
  }
  return top;
}

const signFor = (nature) => (nature === 'ASSET' || nature === 'EXPENSE' ? 1 : -1);   // show each side positive

/** section -> group -> ledgers (with subs), each level with `amount` = pick(ledger) on the section's natural side. */
function tree(ledgers, pick, { keepZero = false } = {}) {
  const sections = [];
  for (const sec of [...SECTIONS, { key: '', label: 'Unclassified', nature: '' }]) {
    const sign = sec.nature ? signFor(sec.nature) : 1;
    const inSec = ledgers.filter((l) => l.section === sec.key);
    const groups = new Map();
    for (const l of inSec) {
      const amount = round2(sign * pick(l));
      if (!keepZero && !amount && !l.subs?.some((x) => pick(x))) continue;
      const row = { code: l.code, name: l.name, amount, isMain: l.isMain || l.subs?.length > 0,
        subs: (l.subs ?? []).map((x) => ({ code: x.code, name: x.name, amount: round2(sign * pick(x)) })).filter((x) => keepZero || x.amount) };
      const g = groups.get(l.groupCode) ?? { code: l.groupCode, name: l.group, amount: 0, ledgers: [] };
      g.ledgers.push(row); g.amount = round2(g.amount + amount);
      groups.set(l.groupCode, g);
    }
    if (!groups.size) continue;
    const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const g of list) g.ledgers.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    sections.push({ key: sec.key, label: sec.label, nature: sec.nature, amount: round2(list.reduce((a, g) => a + g.amount, 0)), groups: list });
  }
  return sections;
}

const sumNature = (ledgers, nature, pick) => round2(ledgers.filter((l) => l.nature === nature).reduce((a, l) => a + pick(l), 0));

// ------------------------------------------------------------------ Trial Balance

export async function trialBalance(user, q) {
  const p = period(user, q);
  const all = await ledgerTotals(user, p);
  const top = rollUp(all);
  const rows = tree(top, (l) => l.closing);
  // Dr / Cr columns of the closing balance, ledger by ledger (no roll-up so subs and mains are not counted twice)
  const totalDr = round2(all.reduce((a, l) => a + Math.max(l.closing, 0), 0));
  const totalCr = round2(all.reduce((a, l) => a + Math.max(-l.closing, 0), 0));
  const openingDiff = round2(all.reduce((a, l) => a + l.opening, 0));
  const lines = all.filter((l) => l.closing || l.dr || l.cr || l.opening).map((l) => ({
    code: l.code, name: l.name, group: l.group, section: l.sectionLabel, nature: l.nature, parentCode: l.parentCode,
    opening: l.atFrom, dr: l.dr, cr: l.cr, closing: l.closing,
  })).sort((a, b) => a.section.localeCompare(b.section) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  // opening balances that do not balance (Dr-positive) are shown on the other side, as Tally does
  return {
    ...p, sections: rows, lines,
    totals: {
      dr: round2(totalDr + Math.max(-openingDiff, 0)), cr: round2(totalCr + Math.max(openingDiff, 0)),
      difference: round2(totalDr - totalCr - openingDiff), openingDifference: openingDiff,
    },
    unclassified: all.filter((l) => !l.classified && (l.closing || l.dr || l.cr)).map((l) => ({ code: l.code, name: l.name, group: l.group })),
  };
}

// ------------------------------------------------------------------ Profit & Loss

export async function profitLoss(user, q) {
  const p = period(user, q);
  const all = await ledgerTotals(user, p);
  const pl = rollUp(all.filter((l) => l.nature === 'INCOME' || l.nature === 'EXPENSE'));
  // income / expense of the period = movement in the period (+ opening when the period starts the year)
  const move = (l) => l.dr - l.cr + (p.from === p.fyFrom ? l.opening : 0);
  const sections = tree(pl, move);
  const get = (key) => sections.find((x) => x.key === key)?.amount ?? 0;
  const directIncome = get('DIRECT_INC'); const directExp = get('DIRECT_EXP');
  const indirectIncome = get('INDIRECT_INC'); const indirectExp = get('INDIRECT_EXP');
  const grossProfit = round2(directIncome - directExp);
  const netProfit = round2(grossProfit + indirectIncome - indirectExp);
  return {
    ...p, sections,
    summary: {
      directIncome, directExpenses: directExp, grossProfit, indirectIncome, indirectExpenses: indirectExp, netProfit,
      totalIncome: round2(directIncome + indirectIncome), totalExpenses: round2(directExp + indirectExp),
      margin: directIncome + indirectIncome ? round2((netProfit / (directIncome + indirectIncome)) * 100) : 0,
    },
  };
}

// ------------------------------------------------------------------ Balance Sheet

export async function balanceSheet(user, q) {
  const p = period(user, { from: undefined, to: q?.to ?? q?.asOn });
  const all = await ledgerTotals(user, { from: p.fyFrom, to: p.to });
  const top = rollUp(all.filter((l) => l.nature === 'ASSET' || l.nature === 'LIABILITY' || !l.nature));
  const profit = -sumNature(all, 'INCOME', (l) => l.closing) - sumNature(all, 'EXPENSE', (l) => l.closing);
  const sections = tree(top, (l) => l.closing);
  // unclassified: Dr balances count as assets, Cr balances as liabilities
  const unc = sections.find((x) => x.key === '');
  const assets = sections.filter((x) => x.nature === 'ASSET');
  const liabilities = sections.filter((x) => x.nature === 'LIABILITY');
  const uncDr = round2(unc ? all.filter((l) => !l.nature && !l.parentCode).reduce((a, l) => a + Math.max(l.closing, 0), 0) : 0);
  const uncCr = round2(unc ? all.filter((l) => !l.nature && !l.parentCode).reduce((a, l) => a + Math.max(-l.closing, 0), 0) : 0);
  // opening balances entered without a matching other side (Dr-positive): shown as its own line, as Tally does
  const openingDifference = round2(all.reduce((a, l) => a + l.opening, 0));
  const totalAssets = round2(assets.reduce((a, x) => a + x.amount, 0) + uncDr + Math.max(-openingDifference, 0));
  const totalLiabilities = round2(liabilities.reduce((a, x) => a + x.amount, 0) + uncCr + round2(profit) + Math.max(openingDifference, 0));
  return {
    asOn: p.to, fyFrom: p.fyFrom, assets, liabilities, unclassified: unc ?? null, openingDifference,
    profit: round2(profit), totals: { assets: totalAssets, liabilities: totalLiabilities, difference: round2(totalAssets - totalLiabilities) },
  };
}

// ------------------------------------------------------------------ Money position (overview)

async function monthly(user, p) {
  const rows = await query(
    `select format(t.CreatedDate, 'yyyy-MM') as m, i.Section, sum(t.Dr) as dr, sum(t.Cr) as cr
       from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
       left join tblAccountGroupInfo i on i.GroupCode = l.GroupCode
      where isnull(t.IsCancelled, 0) = 0 and l.Financial_Year = @fy and (@div = '' or l.Division = @div)
        and t.CreatedDate >= @from and t.CreatedDate < dateadd(day, 1, cast(@to as date))
        and i.Section in ('DIRECT_INC', 'INDIRECT_INC', 'DIRECT_EXP', 'INDIRECT_EXP')
      group by format(t.CreatedDate, 'yyyy-MM'), i.Section`, { ...sc(user), from: p.fyFrom, to: p.to });
  const months = [];
  for (let d = new Date(`${p.fyFrom}T00:00:00Z`); d.toISOString().slice(0, 7) <= p.to.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push(d.toISOString().slice(0, 7));
  }
  return months.map((m) => {
    const r = rows.filter((x) => x.m === m);
    const income = round2(r.filter((x) => s(x.Section).endsWith('_INC')).reduce((a, x) => a + n(x.cr) - n(x.dr), 0));
    const expense = round2(r.filter((x) => s(x.Section).endsWith('_EXP')).reduce((a, x) => a + n(x.dr) - n(x.cr), 0));
    return { month: m, income, expense, profit: round2(income - expense) };
  });
}

export async function overview(user, q) {
  const p = period(user, q);
  const all = await ledgerTotals(user, { from: p.fyFrom, to: p.to });
  const live = all.filter((l) => !l.isMain);
  const pick = (pred, sign = 1) => live.filter(pred).map((l) => ({ code: l.code, name: l.name, group: l.group, amount: round2(sign * l.closing) }))
    .filter((x) => x.amount).sort((a, b) => b.amount - a.amount);
  const total = (list) => round2(list.reduce((a, x) => a + x.amount, 0));

  const cash = pick((l) => l.section === 'CASH');
  const bank = pick((l) => l.section === 'BANK');
  const receivable = pick((l) => l.section === 'DEBTORS' || (l.section === 'CURR_ASSET' && /RECOVERY|PENDING COLLECTION/i.test(l.name)))
    .filter((x) => x.amount > 0);
  const payable = pick((l) => l.section === 'CREDITORS', -1).filter((x) => x.amount > 0);
  const advances = pick((l) => l.type.toLowerCase() === 'advance' || l.section === 'ADVANCES').filter((x) => x.amount > 0);
  const taxes = pick((l) => l.section === 'TAXES', -1);

  const income = -sumNature(all, 'INCOME', (l) => l.closing);
  const expense = sumNature(all, 'EXPENSE', (l) => l.closing);
  const trend = await monthly(user, p);
  const thisMonth = trend.find((x) => x.month === p.to.slice(0, 7)) ?? { income: 0, expense: 0, profit: 0 };

  // expenses by main ledger / group for the year
  const exp = rollUp(all.filter((l) => l.nature === 'EXPENSE'))
    .map((l) => ({ code: l.code, name: l.name, group: l.group, amount: round2(l.closing), subs: l.subs.length }))
    .filter((x) => x.amount).sort((a, b) => b.amount - a.amount);

  return {
    ...p,
    money: {
      cash: { total: total(cash), ledgers: cash }, bank: { total: total(bank), ledgers: bank },
      receivable: { total: total(receivable), ledgers: receivable.slice(0, 50), count: receivable.length },
      payable: { total: total(payable), ledgers: payable.slice(0, 50), count: payable.length },
      advances: { total: total(advances), ledgers: advances.slice(0, 50), count: advances.length },
      taxes: { total: total(taxes), ledgers: taxes },
    },
    profit: { income: round2(income), expense: round2(expense), net: round2(income - expense), thisMonth },
    trend, expenses: exp.slice(0, 15),
    unclassified: all.filter((l) => !l.classified && (l.closing || l.dr || l.cr)).length,
  };
}

// ------------------------------------------------------------------ Day Book

export async function dayBook(user, { from, to, type = '', q = '' } = {}) {
  const p = period(user, { from, to });
  const rows = await query(
    `select t.SlNo, t.VoucherNo, t.Mode, t.CreatedDate, t.LedgerCode, l.LedgerName, t.Dr, t.Cr,
            v.VoucherType, v.Narration, v.Party, v.Source, v.Branch, v.CreatedBy
       from tblAccountTrasaction t
       join tblAccountLedger l on l.LedgerCode = t.LedgerCode
       outer apply (select top 1 * from vw_AccountVoucher v where v.VoucherNo = t.VoucherNo and v.Mode = t.Mode) v
      where isnull(t.IsCancelled, 0) = 0 and l.Financial_Year = @fy and (@div = '' or l.Division = @div)
        and t.CreatedDate >= @from and t.CreatedDate < dateadd(day, 1, cast(@to as date))
      order by t.CreatedDate desc, t.VoucherNo desc, t.Dr desc, t.SlNo`, { ...sc(user), from: p.from, to: p.to });
  const vouchers = new Map();
  for (const r of rows) {
    const key = `${s(r.Mode)}|${s(r.VoucherNo)}`;
    let v = vouchers.get(key);
    if (!v) {
      v = {
        key, voucherNo: s(r.VoucherNo), mode: s(r.Mode), date: iso(r.CreatedDate), type: s(r.VoucherType) || VOUCHER_TYPE[s(r.Mode)] || 'Journal',
        narration: s(r.Narration), party: s(r.Party), source: s(r.Source) || s(r.Mode), branch: s(r.Branch), createdBy: s(r.CreatedBy),
        amount: 0, lines: [],
      };
      vouchers.set(key, v);
    }
    v.lines.push({ code: s(r.LedgerCode), ledger: s(r.LedgerName), dr: round2(n(r.Dr)), cr: round2(n(r.Cr)) });
    v.amount = round2(v.amount + n(r.Dr));
  }
  const term = q.trim().toUpperCase();
  const list = [...vouchers.values()]
    .filter((v) => !type || v.type === type)
    .filter((v) => !term || [v.voucherNo, v.narration, v.party, v.source, ...v.lines.map((l) => l.ledger)].some((x) => x.toUpperCase().includes(term)));
  const types = {};
  for (const v of vouchers.values()) types[v.type] = round2((types[v.type] ?? 0) + v.amount);
  return { ...p, vouchers: list.slice(0, 3000), count: list.length, total: round2(list.reduce((a, v) => a + v.amount, 0)), byType: types };
}

// ------------------------------------------------------------------ Ledger statement

export async function ledgerStatement(user, code, q) {
  const p = period(user, q);
  const all = await ledgerTotals(user, p);
  const led = all.find((l) => l.code === code);
  if (!led) throw notFound('Ledger not found in this financial year');
  const subs = all.filter((l) => l.parentCode === code);
  const codes = [code, ...subs.map((x) => x.code)];
  const params = { ...sc(user), from: p.from, to: p.to };
  const inList = codes.map((c, i) => { params[`c${i}`] = c; return `@c${i}`; }).join(',');
  const rows = await query(
    `select t.SlNo, t.VoucherNo, t.Mode, t.CreatedDate, t.LedgerCode, l.LedgerName, t.Dr, t.Cr, v.VoucherType, v.Narration, v.Party, v.Source,
            stuff((select distinct ', ' + ol.LedgerName from tblAccountTrasaction o join tblAccountLedger ol on ol.LedgerCode = o.LedgerCode
                    where o.VoucherNo = t.VoucherNo and o.Mode = t.Mode and isnull(o.IsCancelled, 0) = 0 and o.LedgerCode not in (${inList})
                      and ((t.Dr > 0 and o.Cr > 0) or (t.Cr > 0 and o.Dr > 0))
                    for xml path(''), type).value('.', 'nvarchar(max)'), 1, 2, '') as Against
       from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
       outer apply (select top 1 * from vw_AccountVoucher v where v.VoucherNo = t.VoucherNo and v.Mode = t.Mode) v
      where t.LedgerCode in (${inList}) and isnull(t.IsCancelled, 0) = 0
        and t.CreatedDate >= @from and t.CreatedDate < dateadd(day, 1, cast(@to as date))
      order by t.CreatedDate, t.SlNo`, params);
  const opening = round2(led.atFrom + subs.reduce((a, x) => a + x.atFrom, 0));
  let bal = opening;
  const entries = rows.map((r) => {
    bal = round2(bal + n(r.Dr) - n(r.Cr));
    return {
      date: iso(r.CreatedDate), voucherNo: s(r.VoucherNo), mode: s(r.Mode), type: s(r.VoucherType) || VOUCHER_TYPE[s(r.Mode)] || 'Journal',
      ledger: s(r.LedgerName), subLedger: s(r.LedgerCode) !== code ? s(r.LedgerName) : '', against: s(r.Against),
      narration: s(r.Narration), party: s(r.Party), source: s(r.Source) || s(r.Mode), dr: round2(n(r.Dr)), cr: round2(n(r.Cr)), balance: bal,
    };
  });
  const dr = round2(entries.reduce((a, e) => a + e.dr, 0)); const cr = round2(entries.reduce((a, e) => a + e.cr, 0));
  return {
    ...p,
    ledger: { code: led.code, name: led.name, group: led.group, section: led.sectionLabel, nature: led.nature, type: led.type, isMain: led.isMain,
      subs: subs.map((x) => ({ code: x.code, name: x.name })) },
    opening, dr, cr, closing: round2(opening + dr - cr), entries,
  };
}

/** Ledger picker for the statement: every ledger of the year with its balance (mains included). */
export async function ledgerList(user) {
  const p = period(user);
  const top = rollUp(await ledgerTotals(user, p));
  const out = [];
  for (const l of top.sort((a, b) => a.name.localeCompare(b.name))) {
    out.push({ value: l.code, label: l.name, group: l.group, balance: l.closing, isMain: l.subs.length > 0 || l.isMain });
    for (const x of l.subs) out.push({ value: x.code, label: `${x.name}  (${l.name})`, group: x.group, balance: x.closing, isMain: false });
  }
  return out;
}

// ------------------------------------------------------------------ Expense analysis

export async function expenseAnalysis(user, q) {
  const p = period(user, q);
  const all = await ledgerTotals(user, p);
  const move = (l) => l.dr - l.cr + (p.from === p.fyFrom ? l.opening : 0);
  const sections = tree(rollUp(all.filter((l) => l.nature === 'EXPENSE')), move);
  const total = round2(sections.reduce((a, x) => a + x.amount, 0));

  const expCodes = all.filter((l) => l.nature === 'EXPENSE').map((l) => l.code);
  let byMonth = []; let bySource = [];
  if (expCodes.length) {
    const params = { ...sc(user), from: p.from, to: p.to };
    // ledger codes are listed as a table-valued literal to stay below the parameter limit
    const values = expCodes.map((c, i) => { params[`e${i}`] = c; return `(@e${i})`; }).join(',');
    const rows = await query(
      `select format(t.CreatedDate, 'yyyy-MM') as m, t.Mode, t.LedgerCode, sum(t.Dr) - sum(t.Cr) as amt
         from tblAccountTrasaction t join (values ${values}) x(code) on x.code = t.LedgerCode
        where isnull(t.IsCancelled, 0) = 0 and t.CreatedDate >= @from and t.CreatedDate < dateadd(day, 1, cast(@to as date))
        group by format(t.CreatedDate, 'yyyy-MM'), t.Mode, t.LedgerCode`, params);
    // month x top-level head (main ledger or group)
    const headOf = new Map();
    const byCode = new Map(all.map((l) => [l.code, l]));
    for (const l of all) {
      const main = l.parentCode ? byCode.get(l.parentCode) : null;
      headOf.set(l.code, main ? main.name : l.group);
    }
    const months = new Map();
    for (const r of rows) {
      const m = months.get(r.m) ?? {};
      const head = headOf.get(s(r.LedgerCode)) ?? 'Other';
      m[head] = round2((m[head] ?? 0) + n(r.amt));
      months.set(r.m, m);
    }
    byMonth = [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, heads]) => ({ month, heads }));
    const src = new Map();
    for (const r of rows) src.set(VOUCHER_TYPE[s(r.Mode)] ?? s(r.Mode), round2((src.get(VOUCHER_TYPE[s(r.Mode)] ?? s(r.Mode)) ?? 0) + n(r.amt)));
    const label = { Payment: 'Payments (cash / bank)', Purchase: 'Purchases (vendor invoice / truck hire)', Receipt: 'Receipt deductions', Journal: 'Journal (advance adjusted)' };
    bySource = [...src.entries()].map(([k, v]) => ({ source: label[k] ?? k, amount: v })).filter((x) => x.amount).sort((a, b) => b.amount - a.amount);
  }
  return { ...p, total, sections, byMonth, bySource };
}
