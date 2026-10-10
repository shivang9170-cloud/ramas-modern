// Payment Entry - port of Accounts/Payment_Entry.aspx: pay money from a Cash / Bank account. The user picks the payment
// type and the account; the Dr/Cr voucher is built automatically (Mode 'Payment Note', VoucherNo = Payment_No).
//
//   EXPENSE     main ledger -> sub-ledger (e.g. OFFICE EXPENSES -> STATIONERY)   Dr the sub-ledger     Cr cash/bank
//   ADVANCE     driver / employee: his sub-ledger under DRIVER ADVANCE /         Dr his sub-ledger     Cr cash/bank
//               STAFF ADVANCE (created on first advance)
//   GENERAL     any other ledger (vendor, creditor ...)                          Dr that ledger        Cr cash/bank
//               optionally against its open bills (vendor invoice, challan truck hire, opening balance): one detail row
//               per bill (LineType 'BILL', BillType + BillNo); the rest stays "on account"
//   ADV_ADJUST  journal: an advance spent on an expense (no cash moves)          Dr expense sub-ledger Cr his advance
//
// Header tbl_payment (41-...sql) + one line per ledger in tbl_payment_detail (43-...sql). Main ledgers (44-...sql) take no
// new entries; sub-ledgers are created from Account Master or from this screen (POST /api/account-ledgers/:code/sub-ledgers).
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { finYr } from '../pickup/pickup.service.js';
import { s, n, iso, today, round2 } from '../../utils/values.js';
import { NOT_MAIN, assertPostable, hierarchyOf, makeMain, setParent } from '../accounts/ledgerTree.js';

const CASH_BANK = `(l.Ledger_Type in ('Cash', 'Bank') or g.GroupName like '%BANK%' or g.GroupName like '%CASH%')`;
// a balance expression (Dr-positive) reused in several queries; l = tblAccountLedger alias
const BAL = `((case when upper(l.DrCr) = 'CR' then -1 else 1 end) * isnull(l.OpeningBal, 0)
             + isnull((select sum(t.Dr) - sum(t.Cr) from tblAccountTrasaction t
                        where t.LedgerCode = l.LedgerCode and t.Financial_Year = l.Financial_Year and t.Division = l.Division
                          and isnull(t.IsCancelled, 0) = 0), 0))`;

// a credit balance is money we OWE only on liability-type ledgers (vendors, creditors, taxes, loans) — never on income
// ledgers like FREIGHT INCOME. gi = tblAccountGroupInfo, l = tblAccountLedger. Bill-wise payment uses the same rule.
const PAYABLE = `(case when gi.Section in ('CREDITORS', 'CURR_LIAB', 'LOANS', 'TAXES', 'BRANCH') or l.Ledger_Type = 'Vendor'
                  then 1 else 0 end)`;

export const KINDS = ['EXPENSE', 'ADVANCE', 'GENERAL'];
const ADVANCE_MAINS = ['DRIVER ADVANCE', 'STAFF ADVANCE'];

const sc = (user) => ({ fy: user.financialYear, div: s(user.divCode), b: user.currentBranch.code });
const optTx = (tx) => (tx ? { tx } : undefined);

async function ledgerBalance(user, code, tx) {
  const [r] = await query(
    `select ${BAL} as bal from tblAccountLedger l
      where l.LedgerCode = @code and l.Financial_Year = @fy and (@div = '' or l.Division = @div)`,
    { code, ...sc(user) }, optTx(tx));
  return r ? round2(n(r.bal)) : null;
}

// ------------------------------------------------------------------ advance sub-ledgers (made on first advance)

async function ensureGroup(tx, patterns, createName) {
  for (const p of patterns) {
    const [g] = await query('select top 1 GroupCode from tblAccountGroup where upper(GroupName) like @p order by GroupCode', { p }, { tx });
    if (g) return s(g.GroupCode);
  }
  const [m] = await query(
    `select isnull(max(try_cast(substring(GroupCode, 2, 20) as int)), 0) + 1 as n
       from tblAccountGroup with (updlock, holdlock) where GroupCode like 'G[0-9]%'`, {}, { tx });
  const code = `G${Number(m?.n) || 1}`;
  await query('insert into tblAccountGroup(GroupCode, GroupName) values (@c, @n)', { c: code, n: createName }, { tx });
  return code;
}

/** Find a ledger of this year / division (by party code, else by name); create it when missing. Returns its code. */
async function ensureLedger(user, tx, { name, partyCode = null, type, drcr = 'DR', groupPatterns, groupName }) {
  const p = { ...sc(user), n: name, pc: partyCode };
  const [found] = partyCode
    ? await query(`select top 1 LedgerCode from tblAccountLedger where VendorOrClientCode = @pc and Ledger_Type = 'Advance'
                     and Financial_Year = @fy and Division = @div`, p, { tx })
    : await query('select top 1 LedgerCode from tblAccountLedger where upper(LedgerName) = upper(@n) and Financial_Year = @fy and Division = @div',
      p, { tx });
  if (found) return s(found.LedgerCode);
  const grp = await ensureGroup(tx, groupPatterns, groupName);
  const [m] = await query(
    `select isnull(max(try_cast(substring(LedgerCode, 3, 20) as int)), 0) + 1 as n
       from tblAccountLedger with (updlock, holdlock) where LedgerCode like 'LM[0-9]%'`, {}, { tx });
  const code = `LM${String(Number(m?.n) || 1).padStart(6, '0')}`;
  await query(
    `insert into tblAccountLedger(LedgerCode, LedgerName, GroupCode, Ledger_Type, OpeningBal, ClosingBal, VendorOrClientCode, DrCr,
       Financial_Year, Division, IsActive)
     values (@code, @n, @g, @t, 0, 0, @pc, @drcr, @fy, @div, 1)`,
    { ...p, code, g: grp, t: type, drcr }, { tx });
  return code;
}

const ADVANCE_GROUP = { groupPatterns: ['LOANS%ADVANCE%', '%ADVANCE%', 'CURRENT ASSETS'], groupName: 'LOANS & ADVANCES (ASSET)' };
const personCode = (person) => (person.type === 'DRIVER' ? `DRV${person.id}` : s(person.id));

/** The person's advance sub-ledger under DRIVER ADVANCE / STAFF ADVANCE (both made on first use). */
async function advanceLedger(user, tx, person) {
  const code = await ensureLedger(user, tx, {
    name: `ADVANCE : ${person.name} : ${personCode(person)}`, partyCode: personCode(person), type: 'Advance', ...ADVANCE_GROUP,
  });
  const h = await hierarchyOf(code, tx);
  if (!h.isMain && !h.parentCode) {
    const mainCode = await ensureLedger(user, tx, { name: person.type === 'DRIVER' ? 'DRIVER ADVANCE' : 'STAFF ADVANCE', type: 'Asset', ...ADVANCE_GROUP });
    await makeMain(user, mainCode, tx);
    await setParent(user, code, mainCode, tx);
  }
  return code;
}

// ------------------------------------------------------------------ people (drivers + employees)

/** Drivers (Driver_master) and employees (Employee_Master), each with the balance of his advance sub-ledger. */
export async function people(user) {
  const rows = await query(
    `select 'DRIVER' as type, cast(d.id as varchar(30)) as id, d.Drivername as name, d.mobile_no as mobile, 'DRV' + cast(d.id as varchar(30)) as pc
       from Driver_master d where isnull(d.IsActive, 1) = 1
     union all
     select 'EMPLOYEE', e.empcode, e.empname, e.mobileno, e.empcode
       from Employee_Master e where isnull(e.IsActive, 1) = 1 and (@div = '' or isnull(e.DivCode, '') = '' or ',' + e.DivCode + ',' like '%,' + @div + ',%')
     order by 1, 3`, sc(user));
  const adv = await query(
    `select l.VendorOrClientCode as pc, ${BAL} as bal from tblAccountLedger l
      where l.Ledger_Type = 'Advance' and l.Financial_Year = @fy and l.Division = @div`, sc(user));
  const balOf = new Map(adv.map((a) => [s(a.pc), round2(n(a.bal))]));
  return rows.map((r) => ({
    type: s(r.type), id: s(r.id), name: s(r.name), mobile: s(r.mobile), key: `${s(r.type)}:${s(r.id)}`,
    advance: balOf.get(s(r.pc)) ?? 0,
  }));
}

async function resolvePerson(p) {
  if (!p || !s(p.type) || !s(p.id)) throw badRequest('Select the driver / employee');
  const type = s(p.type).toUpperCase();
  const [r] = type === 'DRIVER'
    ? await query('select cast(id as varchar(30)) as id, Drivername as name from Driver_master where id = try_cast(@id as int)', { id: s(p.id) })
    : type === 'EMPLOYEE'
      ? await query('select empcode as id, empname as name from Employee_Master where empcode = @id', { id: s(p.id) })
      : [];
  if (!r) throw badRequest('The driver / employee was not found');
  return { type, id: s(r.id), name: s(r.name).toUpperCase() };
}

// ------------------------------------------------------------------ lookups

/** Main ledgers for expenses (not the advance mains, not cash/bank), each with its active sub-ledgers. */
export async function expenseMains(user) {
  const rows = await query(
    `select l.LedgerCode, l.LedgerName, h.IsMain, h.ParentLedgerCode, ${BAL} as bal
       from tblAccountLedger l
       join tblLedgerHierarchy h on h.LedgerCode = l.LedgerCode
       left join tblAccountGroup g on g.GroupCode = l.GroupCode
      where l.Financial_Year = @fy and (@div = '' or l.Division = @div) and isnull(l.IsActive, 1) = 1 and not ${CASH_BANK}
      order by l.LedgerName`, sc(user));
  const mains = rows.filter((r) => r.IsMain && !ADVANCE_MAINS.includes(s(r.LedgerName).toUpperCase()));
  return mains.map((m) => ({
    value: s(m.LedgerCode), label: s(m.LedgerName),
    subs: rows.filter((r) => s(r.ParentLedgerCode) === s(m.LedgerCode))
      .map((r) => ({ value: s(r.LedgerCode), label: s(r.LedgerName), balance: round2(n(r.bal)) })),
  }));
}

/** Every payable ledger with its balance - those we owe (credit balance) first: the main grid. Main ledgers excluded. */
export async function payables(user, { q = '' } = {}) {
  const rows = await query(
    `select l.LedgerCode, l.LedgerName, l.Ledger_Type, g.GroupName, pl.LedgerName as main_name, ${BAL} as bal, ${PAYABLE} as payable
       from tblAccountLedger l left join tblAccountGroup g on g.GroupCode = l.GroupCode
       left join tblAccountGroupInfo gi on gi.GroupCode = l.GroupCode
       left join tblLedgerHierarchy h on h.LedgerCode = l.LedgerCode left join tblAccountLedger pl on pl.LedgerCode = h.ParentLedgerCode
      where l.Financial_Year = @fy and (@div = '' or l.Division = @div) and isnull(l.IsActive, 1) = 1
        and not ${CASH_BANK} and ${NOT_MAIN('l')} and (@q = '' or l.LedgerName like '%' + @q + '%')
      order by l.LedgerName`,
    { ...sc(user), q });
  return rows
    .map((r) => ({
      code: s(r.LedgerCode), name: s(r.LedgerName), mainLedger: s(r.main_name), group: s(r.GroupName), type: s(r.Ledger_Type),
      balance: round2(n(r.bal)), owed: r.payable ? Math.max(round2(-n(r.bal)), 0) : 0,
    }))
    .sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name));   // who we owe on top
}

/** Any postable ledger (not cash/bank, not a main ledger) - for "Other Ledger" payments. */
export async function payToLedgers(user, { q = '' } = {}) {
  const rows = await query(
    `select l.LedgerCode, l.LedgerName, g.GroupName, ${BAL} as bal, ${PAYABLE} as payable
       from tblAccountLedger l left join tblAccountGroup g on g.GroupCode = l.GroupCode
       left join tblAccountGroupInfo gi on gi.GroupCode = l.GroupCode
      where l.Financial_Year = @fy and (@div = '' or l.Division = @div) and isnull(l.IsActive, 1) = 1
        and not ${CASH_BANK} and ${NOT_MAIN('l')} and (@q = '' or l.LedgerName like '%' + @q + '%')
      order by l.LedgerName`,
    { ...sc(user), q });
  return rows.map((r) => ({ value: s(r.LedgerCode), label: s(r.LedgerName), group: s(r.GroupName), owed: r.payable ? round2(-n(r.bal)) : 0 }));
}

/** Cash / bank accounts you can pay from, with current balance. */
export async function payFromAccounts(user, tx) {
  const rows = await query(
    `select l.LedgerCode, l.LedgerName, l.Ledger_Type, g.GroupName, ${BAL} as bal
       from tblAccountLedger l left join tblAccountGroup g on g.GroupCode = l.GroupCode
      where l.Financial_Year = @fy and (@div = '' or l.Division = @div) and isnull(l.IsActive, 1) = 1 and ${CASH_BANK} and ${NOT_MAIN('l')}
      order by l.LedgerName`,
    sc(user), optTx(tx));
  return rows.map((r) => ({ value: s(r.LedgerCode), label: s(r.LedgerName), balance: round2(n(r.bal)), od: /OD |OCC/i.test(s(r.GroupName)) }));
}

export async function options(user) {
  const [mains, persons] = await Promise.all([expenseMains(user), people(user)]);
  return {
    kinds: [{ value: 'EXPENSE', label: 'Expense' }, { value: 'ADVANCE', label: 'Advance' }, { value: 'GENERAL', label: 'Vendor / Party' }],
    mains,
    people: persons,
  };
}

const payPrefix = async (user, tx) => {
  const [br] = await query('select short_code from branch_master where branch_code = @b', { b: user.currentBranch.code }, optTx(tx));
  return `PAY${s(br?.short_code)}${finYr(user.financialYear)}`;
};

export async function nextNo(user) {
  const prefix = await payPrefix(user);
  const [last] = await query(
    `select top 1 Payment_No from tbl_payment where Payment_No like @p + '%' and len(Payment_No) = len(@p) + 6 order by Payment_No desc`,
    { p: prefix });
  return { paymentNo: `${prefix}${String((last ? Number(s(last.Payment_No).slice(-6)) : 0) + 1).padStart(6, '0')}` };
}

// ------------------------------------------------------------------ create

function checkDate(user, d) {
  const fy = financialYearRange(user.financialYear);
  if (d > today()) throw badRequest('Payment date cannot be later than today');
  if (fy && (d < fy.from || d > fy.to)) throw badRequest('The payment date is outside the financial year');
}

const positive = (v) => {
  const amount = round2(n(v));
  if (amount <= 0) throw badRequest('Enter an amount greater than 0');
  return amount;
};

/** The sub-ledger picked under a main ledger: must really be one of its sub-ledgers, active, not cash/bank. */
async function subLedgerOf(user, tx, mainCode, subCode) {
  if (!s(mainCode) || !s(subCode)) throw badRequest('Select the main ledger and its sub-ledger');
  const h = await hierarchyOf(s(subCode), tx);
  if (h.parentCode !== s(mainCode)) throw badRequest('The selected sub-ledger does not belong to this main ledger');
  const [r] = await query(
    `select l.LedgerName from tblAccountLedger l left join tblAccountGroup g on g.GroupCode = l.GroupCode
      where l.LedgerCode = @c and l.Financial_Year = @fy and (@div = '' or l.Division = @div) and isnull(l.IsActive, 1) = 1 and not ${CASH_BANK}`,
    { c: s(subCode), ...sc(user) }, { tx });
  if (!r) throw badRequest('The sub-ledger is inactive or not valid for a payment');
  return { code: s(subCode), name: s(r.LedgerName) };
}

// ------------------------------------------------------------------ bill-wise settlement (vendor / party bills)

// tbl_payment_detail.BillType is varchar(10): the voucher mode that raised the bill, shortened
const BILL_TYPE = { 'PURCHASE/PAYBILL': 'VINV', CHALLAN: 'CHALLAN', OPENING: 'OPENING' };
const billTypeOf = (mode) => BILL_TYPE[mode] ?? s(mode).slice(0, 10);
const BILL_LABEL = { VINV: 'Vendor invoice', CHALLAN: 'Challan (truck hire)', OPENING: 'Opening balance' };

/**
 * Open bills of a party ledger: every voucher (other than payments / contra) that credited it — vendor invoice, challan
 * truck hire … — plus a credit opening balance, less what earlier payments settled against each (tbl_payment_detail
 * LineType 'BILL'). Oldest first. Payments made "on account" (not against a bill) are reported separately.
 */
export async function openBills(user, ledgerCode, tx) {
  const p = { l: s(ledgerCode), ...sc(user) };
  const [led] = await query(
    `select l.LedgerName, (case when upper(l.DrCr) = 'CR' then 1 else -1 end) * isnull(l.OpeningBal, 0) as openCr, ${BAL} as bal,
            ${PAYABLE} as payable
       from tblAccountLedger l left join tblAccountGroupInfo gi on gi.GroupCode = l.GroupCode
      where l.LedgerCode = @l and l.Financial_Year = @fy and (@div = '' or l.Division = @div)`, p, optTx(tx));
  if (!led) throw notFound('Ledger not found in this financial year');
  // bills exist only for parties we owe (vendors / creditors); an income or expense ledger has none
  if (!led.payable) {
    return { ledger: { code: s(ledgerCode), name: s(led.LedgerName), owed: 0 }, billWise: false, bills: [], totalDue: 0, onAccount: 0 };
  }
  const raised = await query(
    `select t.VoucherNo, t.Mode, min(t.CreatedDate) as d, sum(t.Cr) - sum(t.Dr) as amt, max(v.Narration) as narration, max(v.Source) as source
       from tblAccountTrasaction t
       outer apply (select top 1 Narration, Source from vw_AccountVoucher v where v.VoucherNo = t.VoucherNo and v.Mode = t.Mode) v
      where t.LedgerCode = @l and isnull(t.IsCancelled, 0) = 0 and t.Mode not in ('Payment Note', 'Contra Note')
      group by t.VoucherNo, t.Mode having sum(t.Cr) - sum(t.Dr) > 0`, p, optTx(tx));
  const settled = await query(
    `select d.BillType, d.BillNo, sum(d.Amount) as paid from tbl_payment_detail d join tbl_payment pm on pm.Payment_No = d.Payment_No
      where d.LedgerCode = @l and d.LineType = 'BILL' and d.IsCancelled = 0 and pm.Financial_Year = @fy
      group by d.BillType, d.BillNo`, p, optTx(tx));
  const [onAcc] = await query(
    `select isnull(sum(d.Amount), 0) as amt from tbl_payment_detail d join tbl_payment pm on pm.Payment_No = d.Payment_No
      where d.LedgerCode = @l and d.LineType = 'GENERAL' and d.IsCancelled = 0 and pm.Financial_Year = @fy`, p, optTx(tx));
  const paidOf = new Map(settled.map((r) => [`${s(r.BillType)}|${s(r.BillNo)}`, round2(n(r.paid))]));
  const docs = raised.map((r) => ({ billType: billTypeOf(s(r.Mode)), billNo: s(r.VoucherNo), date: iso(r.d), amount: round2(n(r.amt)),
    narration: s(r.narration), source: s(r.source) || BILL_LABEL[billTypeOf(s(r.Mode))] || s(r.Mode) }));
  const fyFrom = financialYearRange(user.financialYear)?.from ?? null;
  if (n(led.openCr) > 0) docs.unshift({ billType: 'OPENING', billNo: 'OPENING', date: fyFrom, amount: round2(n(led.openCr)), narration: 'Opening balance', source: BILL_LABEL.OPENING });
  const bills = docs
    .map((b) => { const paid = paidOf.get(`${b.billType}|${b.billNo}`) ?? 0; return { ...b, paid, due: round2(b.amount - paid) }; })
    .filter((b) => b.due > 0.004)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.billNo.localeCompare(b.billNo));
  return {
    ledger: { code: s(ledgerCode), name: s(led.LedgerName), owed: Math.max(round2(-n(led.bal)), 0) },
    billWise: true, bills, totalDue: round2(bills.reduce((a, b) => a + b.due, 0)), onAccount: round2(n(onAcc?.amt)),
  };
}

/** Allocation of a payment to bills: each bill must be open for this ledger with enough due; total ≤ payment. */
async function allocate(user, tx, ledgerCode, list, amount) {
  const wanted = (list ?? []).map((b) => ({ billType: s(b.billType), billNo: s(b.billNo), amount: round2(n(b.amount)) })).filter((b) => b.amount > 0);
  if (!wanted.length) return [];
  if (new Set(wanted.map((b) => `${b.billType}|${b.billNo}`)).size !== wanted.length) throw badRequest('The same bill is listed twice');
  const open = new Map((await openBills(user, ledgerCode, tx)).bills.map((b) => [`${b.billType}|${b.billNo}`, b]));
  const problems = [];
  for (const w of wanted) {
    const b = open.get(`${w.billType}|${w.billNo}`);
    if (!b) problems.push(`${w.billNo}: not an open bill of this party`);
    else if (w.amount > b.due + 0.005) problems.push(`${w.billNo}: only ${b.due} is due, cannot settle ${w.amount}`);
  }
  if (problems.length) throw new HttpError(422, 'Some bills cannot be settled', problems.map((message) => ({ path: 'bills', message })));
  const total = round2(wanted.reduce((a, b) => a + b.amount, 0));
  if (total > amount + 0.005) throw badRequest(`Bills selected (${total}) are more than the payment amount (${amount})`);
  return wanted;
}

/** Writes header + detail lines + the two voucher sides. `details` (default: drLines) are the tbl_payment_detail rows. */
async function save(user, tx, { kind, date, body, crLedger, drLines, person, narration, details }) {
  await assertPostable([crLedger, ...drLines.map((l) => l.ledger)], tx);   // never on a main ledger
  const prefix = await payPrefix(user, tx);
  const [last] = await query(
    `select top 1 Payment_No from tbl_payment with (updlock, holdlock) where Payment_No like @p + '%' and len(Payment_No) = len(@p) + 6 order by Payment_No desc`,
    { p: prefix }, { tx });
  const paymentNo = `${prefix}${String((last ? Number(s(last.Payment_No).slice(-6)) : 0) + 1).padStart(6, '0')}`;
  const total = round2(drLines.reduce((a, l) => a + l.amount, 0));

  await query(
    `insert into tbl_payment(Payment_No, Payment_Date, Ref_No, ChequeNo, Narration, PayTo_Ledger, PayFrom_Ledger, Amount, Branch, Financial_Year,
       Division, User_id, PaymentType, PersonType, PersonId, PersonName)
     values (@no, @d, @ref, @chq, @nar, @to, @from, @amt, @b, @fy, @div, @u, @k, @pt, @pid, @pn)`,
    { no: paymentNo, d: date, ref: s(body.refNo), chq: s(body.chequeNo), nar: narration, to: drLines[0].ledger, from: crLedger, amt: total,
      ...sc(user), u: user.userId, k: kind, pt: person?.type ?? null, pid: person?.id ?? null, pn: person?.name ?? null }, { tx });
  for (const l of details ?? drLines) {
    await query(
      `insert into tbl_payment_detail(Payment_No, LineType, PersonType, PersonId, PersonName, BillType, BillNo, LedgerCode, Amount)
       values (@no, @lt, @pt, @pid, @pn, @bt, @bn, @lg, @amt)`,
      { no: paymentNo, lt: l.lineType, pt: person?.type ?? null, pid: person?.id ?? null, pn: person?.name ?? null,
        bt: l.billType ?? null, bn: l.billNo ?? null, lg: l.ledger, amt: l.amount },
      { tx });
  }
  for (const [code, dr, cr] of [...drLines.map((l) => [l.ledger, l.amount, 0]), [crLedger, 0, total]]) {
    await query(
      `insert into tblAccountTrasaction(LedgerCode, Dr, Cr, CreatedDate, VoucherNo, Mode, Entry, Financial_Year, Division)
       values (@l, @dr, @cr, @d, @no, 'Payment Note', 'Ledger', @fy, @div)`,
      { l: code, dr, cr, d: date, no: paymentNo, ...sc(user) }, { tx });
  }
  return { paymentNo, amount: total, message: `Payment ${paymentNo} saved` };
}

async function checkPayFrom(user, tx, code, amount) {
  const from = (await payFromAccounts(user, tx)).find((a) => a.value === s(code));
  if (!from) throw badRequest('Select the cash / bank account the payment is made from');
  if (!from.od && amount > from.balance + 0.005) {
    throw new HttpError(422, `Insufficient balance in ${from.label}: available ${from.balance}, payment ${amount}`);
  }
  return from;
}

export async function createPayment(user, body) {
  checkDate(user, body.paymentDate);
  const kind = s(body.kind || 'GENERAL').toUpperCase();
  if (!KINDS.includes(kind)) throw badRequest('Select the payment type');
  const amount = positive(body.amount);

  return withTransaction(async (tx) => {
    let drLine; let person = null; let narration; let details;
    if (kind === 'EXPENSE') {
      const sub = await subLedgerOf(user, tx, body.mainLedger, body.subLedger);
      drLine = { lineType: 'EXPENSE', ledger: sub.code, amount };
      narration = `Paid towards ${sub.name}`;
    } else if (kind === 'ADVANCE') {
      person = await resolvePerson(body.person);
      drLine = { lineType: 'ADVANCE', ledger: await advanceLedger(user, tx, person), amount };
      narration = `Advance to ${person.name}`;
    } else {
      const [to] = await query(
        `select l.LedgerName from tblAccountLedger l left join tblAccountGroup g on g.GroupCode = l.GroupCode
          where l.LedgerCode = @code and l.Financial_Year = @fy and (@div = '' or l.Division = @div) and isnull(l.IsActive, 1) = 1 and not ${CASH_BANK}`,
        { code: s(body.payTo), ...sc(user) }, { tx });
      if (!to) throw badRequest('Select the ledger to pay. Transfers between cash and bank go through Contra Entry.');
      drLine = { lineType: 'GENERAL', ledger: s(body.payTo), amount };
      narration = `Paid to ${s(to.LedgerName)}`;
      // against bills: one detail row per bill settled, the rest stays "on account"
      const bills = await allocate(user, tx, drLine.ledger, body.bills, amount);
      if (bills.length) {
        const settled = round2(bills.reduce((a, b) => a + b.amount, 0));
        details = [
          ...bills.map((b) => ({ lineType: 'BILL', ledger: drLine.ledger, amount: b.amount, billType: b.billType, billNo: b.billNo })),
          ...(amount - settled > 0.004 ? [{ lineType: 'GENERAL', ledger: drLine.ledger, amount: round2(amount - settled) }] : []),
        ];
        narration += ` against ${bills.map((b) => (b.billType === 'OPENING' ? 'opening balance' : b.billNo)).join(', ')}`;
      }
    }
    const from = await checkPayFrom(user, tx, body.payFrom, amount);
    if (drLine.ledger === from.value) throw badRequest('The account paid and the account paid from must be different');
    narration = s(body.narration) || `${narration} from ${from.label}${body.chequeNo ? `, Cheque/UTR ${s(body.chequeNo)}` : ''}`;
    return save(user, tx, { kind, date: body.paymentDate, body, crLedger: from.value, drLines: [drLine], person, narration, details });
  });
}

/** Journal: an advance spent on an expense - Dr the expense sub-ledger, Cr the person's advance sub-ledger. No cash moves. */
export async function adjustAdvance(user, body) {
  checkDate(user, body.paymentDate);
  const amount = positive(body.amount);
  const person = await resolvePerson(body.person);
  return withTransaction(async (tx) => {
    const sub = await subLedgerOf(user, tx, body.mainLedger, body.subLedger);
    const adv = await advanceLedger(user, tx, person);
    const bal = await ledgerBalance(user, adv, tx);
    if (amount > round2(bal) + 0.005) throw new HttpError(422, `${person.name}: advance balance is ${round2(bal)}, cannot adjust ${amount}`);
    const narration = s(body.narration) || `Advance of ${person.name} adjusted against ${sub.name}`;
    return save(user, tx, {
      kind: 'ADV_ADJUST', date: body.paymentDate, body, crLedger: adv, person, narration,
      drLines: [{ lineType: 'ADV_ADJUST', ledger: sub.code, amount }],
    });
  });
}

/** Advance register: per person advance given / adjusted (detail lines) and the balance (his advance sub-ledger). */
export async function advances(user) {
  const sums = await query(
    `select d.PersonType, d.PersonId, max(d.PersonName) as name,
            sum(case when d.LineType = 'ADVANCE' then d.Amount else 0 end) as given,
            sum(case when d.LineType = 'ADV_ADJUST' then d.Amount else 0 end) as adjusted
       from tbl_payment_detail d join tbl_payment p on p.Payment_No = d.Payment_No
      where d.IsCancelled = 0 and p.Financial_Year = @fy and p.Division = @div and d.LineType in ('ADVANCE', 'ADV_ADJUST')
      group by d.PersonType, d.PersonId`, sc(user));
  return sums.map((r) => ({
    key: `${s(r.PersonType)}:${s(r.PersonId)}`, given: round2(n(r.given)), adjusted: round2(n(r.adjusted)),
  }));
}

// ------------------------------------------------------------------ list / view / cancel

export async function listPayments(user, { from, to, status = 'active', search = '' }) {
  const rows = await query(
    `select p.Payment_No, p.Payment_Date, p.Ref_No, p.ChequeNo, p.Narration, p.Amount, p.User_id, p.IsCancelled, p.PaymentType, p.PersonName,
            tl.LedgerName as pay_to, fl.LedgerName as pay_from, ml.LedgerName as main_name
       from tbl_payment p
       left join tblAccountLedger tl on tl.LedgerCode = p.PayTo_Ledger
       left join tblAccountLedger fl on fl.LedgerCode = p.PayFrom_Ledger
       left join tblLedgerHierarchy h on h.LedgerCode = p.PayTo_Ledger
       left join tblAccountLedger ml on ml.LedgerCode = h.ParentLedgerCode
      where p.Branch = @b and (@div = '' or p.Division = @div) and p.Financial_Year = @fy and p.Payment_Date between @from and @to
        and p.IsCancelled = @c and (@q = '' or p.Payment_No like '%' + @q + '%' or p.Narration like '%' + @q + '%'
             or tl.LedgerName like '%' + @q + '%' or fl.LedgerName like '%' + @q + '%' or p.PersonName like '%' + @q + '%'
             or ml.LedgerName like '%' + @q + '%')
      order by p.Payment_No desc`,
    { ...sc(user), from, to, c: status === 'cancelled' ? 1 : 0, q: search });
  return rows.map((r) => ({
    paymentNo: s(r.Payment_No), paymentDate: iso(r.Payment_Date), refNo: s(r.Ref_No), chequeNo: s(r.ChequeNo),
    narration: s(r.Narration), amount: round2(n(r.Amount)), payTo: s(r.pay_to), mainLedger: s(r.main_name), payFrom: s(r.pay_from),
    kind: s(r.PaymentType) || 'GENERAL', person: s(r.PersonName), createdBy: s(r.User_id), cancelled: Boolean(r.IsCancelled),
  }));
}

export async function getPayment(user, paymentNo) {
  const [p] = await query(
    `select p.*, tl.LedgerName as pay_to, fl.LedgerName as pay_from, ml.LedgerName as main_name from tbl_payment p
       left join tblAccountLedger tl on tl.LedgerCode = p.PayTo_Ledger
       left join tblAccountLedger fl on fl.LedgerCode = p.PayFrom_Ledger
       left join tblLedgerHierarchy h on h.LedgerCode = p.PayTo_Ledger
       left join tblAccountLedger ml on ml.LedgerCode = h.ParentLedgerCode
      where p.Payment_No = @no and p.Branch = @b`, { no: paymentNo, b: user.currentBranch.code });
  if (!p) throw notFound(`Payment ${paymentNo} not found at this branch`);
  const bills = await query(
    "select BillType, BillNo, Amount from tbl_payment_detail where Payment_No = @no and LineType = 'BILL' order by id", { no: paymentNo });
  return {
    bills: bills.map((b) => ({ billType: s(b.BillType), billNo: s(b.BillNo), label: BILL_LABEL[s(b.BillType)] ?? s(b.BillType), amount: round2(n(b.Amount)) })),
    paymentNo: s(p.Payment_No), paymentDate: iso(p.Payment_Date), refNo: s(p.Ref_No), chequeNo: s(p.ChequeNo),
    narration: s(p.Narration), amount: round2(n(p.Amount)), payTo: s(p.pay_to), mainLedger: s(p.main_name), payFrom: s(p.pay_from),
    kind: s(p.PaymentType) || 'GENERAL', person: s(p.PersonName),
    createdBy: s(p.User_id), cancelled: Boolean(p.IsCancelled), cancelledBy: s(p.Cancelled_By), cancelRemarks: s(p.Cancel_Remarks),
  };
}

export async function cancelPayment(user, paymentNo, remarks) {
  const p = await getPayment(user, paymentNo);
  if (p.cancelled) throw conflict('This payment is already cancelled');
  await withTransaction(async (tx) => {
    await query('update tbl_payment set IsCancelled = 1, Cancelled_By = @u, Cancelled_Date = getdate(), Cancel_Remarks = @rem where Payment_No = @no',
      { u: user.userId, rem: s(remarks), no: paymentNo }, { tx });
    await query('update tbl_payment_detail set IsCancelled = 1 where Payment_No = @no', { no: paymentNo }, { tx });
    await query("update tblAccountTrasaction set IsCancelled = 1 where VoucherNo = @no and Mode = 'Payment Note'", { no: paymentNo }, { tx });
  });
  return { paymentNo, message: `Payment ${paymentNo} cancelled` };
}
