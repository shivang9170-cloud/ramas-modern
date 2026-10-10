// Bill receipt — port of Invoice/Bill_Receive.aspx: money received against finalized bills — "To Be Billed" client bills
// (kind 'client') or Paid / To Pay bills (kind 'paidtopay', rdoBillType Paid / To Pay).
// Account_Bill_Receive_Bal.insert_Bill_Receive (bin/ClassLibrary.dll).
//
// A client's finalized bills collected at this branch with an outstanding amount are listed; for each bill the amount
// received, TDS, deduction and a small round-off are entered, plus any other income (extra money) for the whole receipt.
// Saving writes Bill_Receive (header) + Bill_Receive_Details (one row per bill) and the voucher (voucher no. = BR no.,
// mode 'BILL RECEIVE'):
//   Dr Cash (CASH <branch>) or the bank ledger   received + other income
//   Dr TDS Receivable                             TDS
//   Dr Freight Income Deduction                   deduction (Paid / To Pay: Booking Income Deduction)
//   Dr / Cr ROUND OFF                             round-off (written off: Dr; received in excess: Cr)
//   Cr the bill's receivable ledger               per bill: received + TDS + deduction + round-off (settled) — the client's
//                                                 BILLED ledger, or PAID / TOPAY BOOKING PENDING COLLECTION (the ledger finalize debited)
//   Cr Other Income                               other income
// A bill settled in full gets Payment_Status = 1 (Paid); cancelling the receipt cancels its voucher and opens the bills again.
//
// Changes from the page (docs/MIGRATION.md "Bill receipt"):
//   * the bills and their outstanding are re-read on the server (the page posted client ledger, bill amount and outstanding
//     from its grid) and a bill cannot be settled for more than it owes;
//   * the voucher balances: the page credited the client with received + TDS + deduction − round-off but posted the round-off
//     as a credit too, and credited delivery / hamali charges that nothing debited (those belong to Paid / To Pay bills);
//   * the BR no. is taken inside the save's transaction (Generate_Autocode ran on page load and again on save);
//   * every ledger is checked before anything is saved (the page checked the Hamali ledger with the Delivery ledger's result);
//   * a receipt can be cancelled (the page only had edit) — the voucher lines are cancelled, the bills reopen.
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { finYr } from '../pickup/pickup.service.js';
import { s, n, iso, today, round2 } from '../../utils/values.js';
import { billLedgers } from '../clientbill/billstages.service.js';

const PAY_MODES = ['Cheque', 'NEFT', 'RTGS', 'IMPS', 'UPI', 'DD'];

const ledgerByName = async (user, name, tx) => (await query(
  `select top 1 LedgerCode, LedgerName from tblAccountLedger where LedgerName = @n and Financial_Year = @fy and (@div = '' or Division = @div)
      and isnull(IsActive, 1) = 1`, { n: name, fy: user.financialYear, div: s(user.divCode) }, { tx }))[0];

// ------------------------------------------------------------------ lookups

/** Bind_CashLedger ("CASH <branch name>") + fillBankMaster (bank ledgers of the year). */
export async function options(user) {
  const [b] = await query('select branch_name from branch_master where branch_code = @b', { b: user.currentBranch.code });
  const cashName = `CASH ${s(b?.branch_name)}`;
  const cash = await ledgerByName(user, cashName);
  const banks = await query(
    `select l.LedgerCode, l.LedgerName from tblAccountLedger l left join tblAccountGroup g on g.GroupCode = l.GroupCode
      where l.Financial_Year = @fy and (@div = '' or l.Division = @div) and isnull(l.IsActive, 1) = 1
        and (l.Ledger_Type = 'Bank' or g.GroupName like '%BANK%') order by l.LedgerName`,
    { fy: user.financialYear, div: s(user.divCode) });
  return {
    cash: { name: cashName, code: s(cash?.LedgerCode), exists: Boolean(cash) },
    banks: banks.map((r) => ({ value: s(r.LedgerCode), label: s(r.LedgerName) })),
    payModes: PAY_MODES,
  };
}

const OUTSTANDING = `cb.totalamount - isnull((select sum(d.Settled) from Bill_Receive_Details d where d.Bill_no = cb.bill_no and d.IsCancelled = 0), 0)`;

/** usp_ClientBill_UnPaidAll: finalized, unpaid bills collected at this branch (client_Master.CollectionLocation, else the billing branch). */
async function outstandingBills(user, { kind = 'client', clientCode = '', search = '', billNos = [] } = {}) {
  const params = { b: user.currentBranch.code, div: s(user.divCode), c: clientCode, q: search, k: kind };
  let list = '';
  if (billNos.length) list = ` and cb.bill_no in (${billNos.map((x, i) => { params[`x${i}`] = x; return `@x${i}`; }).join(',')})`;
  const rows = await query(
    `select cb.bill_no, cb.bill_date, cb.DueDate, cb.client_code, cb.client_Id, coalesce(cm.company_name, pm.company_name) as company_name,
            cb.totalamount, ${OUTSTANDING} as outstanding, cb.origin_branch, cb.Bill_Type
       from client_bill cb left join client_Master cm on cm.client_Id = cb.client_Id
       left join consigner_master pm on pm.consigner_code = cb.client_code and cb.client_Id is null
      where cb.client_bill_status is null and cb.ClientBill_Finalize_status = 'Finalized' and isnull(cb.Payment_Status, 0) = 0
        and (@div = '' or cb.division = @div)
        and ((@k = 'client' and isnull(cb.Bill_Type, 'To Be Billed') = 'To Be Billed' and coalesce(nullif(cm.CollectionLocation, ''), cb.origin_branch) = @b)
          or (@k = 'paidtopay' and cb.Bill_Type in ('Paid', 'To Pay') and cb.origin_branch = @b))
        and (@c = '' or cb.client_code = @c)
        and (@q = '' or cb.bill_no like '%' + @q + '%' or coalesce(cm.company_name, pm.company_name) like '%' + @q + '%') ${list}
      order by 6, cb.bill_date, cb.bill_no`, params);
  return rows.map((r) => ({
    billNo: s(r.bill_no), billDate: iso(r.bill_date), dueDate: iso(r.DueDate), clientCode: s(r.client_code),
    clientId: r.client_Id === null ? null : Number(r.client_Id), billType: s(r.Bill_Type) || 'To Be Billed',
    clientName: s(r.company_name), billAmount: n(r.totalamount), outstanding: round2(n(r.outstanding)),
  })).filter((b) => b.outstanding > 0);
}

export const pendingBills = (user, q) => outstandingBills(user, q);

/** Clients with outstanding bills at this branch (txtClientName autocomplete). */
export async function clients(user, term, kind = 'client') {
  const bills = await outstandingBills(user, { kind, search: term });
  const by = new Map();
  for (const b of bills) {
    const c = by.get(b.clientCode) ?? { code: b.clientCode, name: b.clientName, bills: 0, outstanding: 0 };
    c.bills += 1; c.outstanding = round2(c.outstanding + b.outstanding);
    by.set(b.clientCode, c);
  }
  return [...by.values()];
}

// ------------------------------------------------------------------ create

export async function createReceipt(user, body) {
  const fy = financialYearRange(user.financialYear);
  if (body.receiveDate > today()) throw badRequest('Receive date should not be greater than current date');
  if (fy && (body.receiveDate < fy.from || body.receiveDate > fy.to)) throw badRequest('Invalid Financial Year Date');
  if (body.mode === 'Bank' && body.chequeDate && body.chequeDate > today()) throw badRequest('Cheque date should not be greater than current Date');
  if (new Set(body.bills.map((b) => b.billNo)).size !== body.bills.length) throw badRequest('Bill No already added');

  const kind = body.kind ?? 'client';
  const found = new Map((await outstandingBills(user, { kind, clientCode: body.clientCode, billNos: body.bills.map((b) => b.billNo) }))
    .map((b) => [b.billNo, b]));
  const problems = [];
  const rows = body.bills.map((x) => {
    const b = found.get(x.billNo);
    const settled = round2(x.received + x.tds + x.deduction + x.roundOff);
    if (!b) problems.push(`${x.billNo}: not a finalized, unpaid ${kind === 'client' ? 'bill of this client collected' : 'Paid / To Pay bill of this party'} at this branch`);
    else if (settled <= 0) problems.push(`${x.billNo}: Receive Against Bill Amount cannot be Zero`);
    else if (settled > b.outstanding + 0.005) problems.push(`${x.billNo}: settles ${settled}, but only ${b.outstanding} is outstanding`);
    if (b && b.billDate > body.receiveDate) problems.push(`${x.billNo}: receive date is before the bill date`);
    return { ...x, settled, bill: b };
  });
  if (problems.length) throw new HttpError(422, 'Some bills cannot be received', problems.map((message) => ({ path: 'bills', message })));

  const t = {
    received: round2(rows.reduce((a, r) => a + r.received, 0)), tds: round2(rows.reduce((a, r) => a + r.tds, 0)),
    deduction: round2(rows.reduce((a, r) => a + r.deduction, 0)), roundOff: round2(rows.reduce((a, r) => a + r.roundOff, 0)),
    other: round2(body.otherIncome),
  };
  if (t.received + t.other <= 0) throw badRequest('Receive Amount cannot be Zero');

  // every ledger the voucher needs ("Ledger … not found!")
  const missing = [];
  const opts = await options(user);
  let moneyLedger = '';
  if (body.mode === 'Cash') {
    if (!opts.cash.exists) missing.push(`Ledger ${opts.cash.name} not found`);
    moneyLedger = opts.cash.code;
  } else {
    if (!opts.banks.some((x) => x.value === body.bankLedger)) missing.push('Select the bank ledger');
    moneyLedger = body.bankLedger;
  }
  const fixed = {};
  for (const [k, name, need] of [['tds', 'TDS Receivable', t.tds], ['deduction', kind === 'client' ? 'Freight Income Deduction' : 'Booking Income Deduction', t.deduction],
    ['roundOff', 'ROUND OFF', t.roundOff], ['other', 'Other Income', t.other]]) {
    if (!need) continue;
    const l = await ledgerByName(user, name);
    if (!l) missing.push(`Ledger ${name} not found`); else fixed[k] = s(l.LedgerCode);
  }
  const billed = new Map();   // the bill's receivable ledger (debited when it was finalized)
  for (const r of rows) {
    const l = await billLedgers(user, r.billNo);
    if (!l.receivable) missing.push(`${l.receivableName} not found`); else billed.set(r.billNo, l.receivable);
  }
  if (missing.length) throw new HttpError(422, 'Ledgers missing', [...new Set(missing)].map((message) => ({ path: 'ledgers', message })));

  const client = rows[0].bill;
  const [br] = await query('select short_code from branch_master where branch_code = @b', { b: user.currentBranch.code });
  const shortCode = s(br?.short_code); const fyShort = finYr(user.financialYear);
  const narration = `Received from Client : ${client.clientName}, in ${body.mode}, Receive Amount : ${t.received}, TDS : ${t.tds}, `
    + `Deduction : ${t.deduction}, OtherIncome : ${t.other}, Round Off : ${t.roundOff}, BillNo : ${rows.map((r) => r.billNo).join(',')}`
    + `${body.remarks ? `, Remarks : ${body.remarks}` : ''}`;

  return withTransaction(async (tx) => {
    const prefix = `BR${shortCode}${fyShort}`;
    const [last] = await query(
      `select top 1 BR_No from Bill_Receive with (updlock, holdlock) where BR_No like @p + '%' and len(BR_No) = len(@p) + 6 order by BR_No desc`,
      { p: prefix }, { tx });
    const brNo = `${prefix}${String((last ? Number(s(last.BR_No).slice(-6)) : 0) + 1).padStart(6, '0')}`;
    // nobody may have received against these bills since they were read
    for (const r of rows) {
      const [o] = await query(`select ${OUTSTANDING} as outstanding from client_bill cb with (updlock, holdlock) where cb.bill_no = @b`, { b: r.billNo }, { tx });
      if (r.settled > round2(n(o?.outstanding)) + 0.005) throw conflict(`Bill ${r.billNo} was received meanwhile — search again`);
    }
    await query(
      `insert into Bill_Receive(BR_No, Receive_Date, Client_Code, client_Id, Receive_mode, CashLedger, BankLedger, Paymentmode, ChequeNo, ChequeDate,
         ClientBank, BRMANUALNo, Receive_Amount, TDS, Deduction, RoundedAmt, OtherIncome, Remarks, Narration, Branch, Financial_Year, Division,
         User_id, ShortCode, FinYr)
       values (@no, @d, @cc, @cid, @mode, @cash, @bank, @pm, @chq, @chqd, @cb, @manual, @recv, @tds, @ded, @ro, @oth, @rem, @nar, @b, @fy, @div,
         @u, @sc, @fys)`,
      {
        no: brNo, d: body.receiveDate, cc: client.clientCode, cid: client.clientId, mode: body.mode,
        cash: body.mode === 'Cash' ? moneyLedger : '', bank: body.mode === 'Bank' ? moneyLedger : '',
        pm: body.mode === 'Bank' ? body.payMode : '', chq: body.chequeNo, chqd: body.mode === 'Bank' && body.chequeDate ? body.chequeDate : null,
        cb: body.clientBank.toUpperCase(), manual: body.manualNo, recv: t.received, tds: t.tds, ded: t.deduction, ro: t.roundOff, oth: t.other,
        rem: body.remarks, nar: narration, b: user.currentBranch.code, fy: user.financialYear, div: s(user.divCode), u: user.userId,
        sc: shortCode, fys: fyShort,
      }, { tx });
    const lines = [];
    const line = (code, dr, cr) => { if (round2(dr) || round2(cr)) lines.push([code, round2(dr), round2(cr)]); };
    for (const r of rows) {
      await query(
        `insert into Bill_Receive_Details(BR_No, Bill_no, Bill_Amount, Received, TDS, Deduction, RoundedAmt, Settled)
         values (@no, @b, @amt, @recv, @tds, @ded, @ro, @set)`,
        { no: brNo, b: r.billNo, amt: r.bill.billAmount, recv: r.received, tds: r.tds, ded: r.deduction, ro: r.roundOff, set: r.settled }, { tx });
      if (r.settled >= r.bill.outstanding - 0.005) await query('update client_bill set Payment_Status = 1 where bill_no = @b', { b: r.billNo }, { tx });
      line(billed.get(r.billNo), 0, r.settled);
    }
    line(moneyLedger, t.received + t.other, 0);
    if (t.tds) line(fixed.tds, t.tds, 0);
    if (t.deduction) line(fixed.deduction, t.deduction, 0);
    if (t.roundOff) line(fixed.roundOff, Math.max(t.roundOff, 0), Math.max(-t.roundOff, 0));
    if (t.other) line(fixed.other, 0, t.other);
    const dr = round2(lines.reduce((a, l) => a + l[1], 0)); const cr = round2(lines.reduce((a, l) => a + l[2], 0));
    if (dr !== cr) throw new HttpError(500, `Voucher does not balance (Dr ${dr}, Cr ${cr})`);
    for (const [code, d, c] of lines) {
      await query(
        `insert into tblAccountTrasaction(LedgerCode, Dr, Cr, CreatedDate, VoucherNo, Mode, Entry, Financial_Year, Division)
         values (@l, @dr, @cr, @d, @no, 'BILL RECEIVE', 'Ledger', @fy, @div)`,
        { l: code, dr: d, cr: c, d: body.receiveDate, no: brNo, fy: user.financialYear, div: s(user.divCode) }, { tx });
    }
    return { brNo, bills: rows.length, received: t.received, message: `Record Successfully Saved! BR No : ${brNo}` };
  });
}

// ------------------------------------------------------------------ list / view / cancel

export async function listReceipts(user, { from, to, status = 'active', search = '' }) {
  const rows = await query(
    `select r.BR_No, r.Receive_Date, r.Client_Code, cm.company_name, r.Receive_mode, r.Paymentmode, r.ChequeNo, r.Receive_Amount, r.TDS,
            r.Deduction, r.RoundedAmt, r.OtherIncome, r.User_id, r.IsCancelled,
            (select count(*) from Bill_Receive_Details d where d.BR_No = r.BR_No) as bills
       from Bill_Receive r left join client_Master cm on cm.client_Id = r.client_Id
      where r.Branch = @b and (@div = '' or r.Division = @div) and r.Financial_Year = @fy and r.Receive_Date between @from and @to
        and r.IsCancelled = @c and (@q = '' or r.BR_No like '%' + @q + '%' or cm.company_name like '%' + @q + '%'
             or exists (select 1 from Bill_Receive_Details d where d.BR_No = r.BR_No and d.Bill_no like '%' + @q + '%'))
      order by r.BR_No desc`,
    { b: user.currentBranch.code, div: s(user.divCode), fy: user.financialYear, from, to, c: status === 'cancelled' ? 1 : 0, q: search });
  return rows.map((r) => ({
    brNo: s(r.BR_No), receiveDate: iso(r.Receive_Date), clientCode: s(r.Client_Code), clientName: s(r.company_name), mode: s(r.Receive_mode),
    payMode: s(r.Paymentmode), chequeNo: s(r.ChequeNo), received: n(r.Receive_Amount), tds: n(r.TDS), deduction: n(r.Deduction),
    roundOff: n(r.RoundedAmt), otherIncome: n(r.OtherIncome), bills: n(r.bills), createdBy: s(r.User_id), cancelled: Boolean(r.IsCancelled),
  }));
}

export async function getReceipt(user, brNo) {
  const [r] = await query(
    `select r.*, cm.company_name, cl.LedgerName as cash_name, bl.LedgerName as bank_name
       from Bill_Receive r left join client_Master cm on cm.client_Id = r.client_Id
       left join tblAccountLedger cl on cl.LedgerCode = r.CashLedger left join tblAccountLedger bl on bl.LedgerCode = r.BankLedger
      where r.BR_No = @no and r.Branch = @b`, { no: brNo, b: user.currentBranch.code });
  if (!r) throw notFound(`Receipt ${brNo} not found at this branch`);
  const bills = await query(
    `select d.*, cb.bill_date from Bill_Receive_Details d left join client_bill cb on cb.bill_no = d.Bill_no where d.BR_No = @no order by d.Bill_no`,
    { no: brNo });
  const voucher = await query(
    `select l.LedgerName, t.Dr, t.Cr from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
      where t.VoucherNo = @no and t.Mode = 'BILL RECEIVE' and t.IsCancelled = @c order by t.Dr desc, t.SlNo`, { no: brNo, c: r.IsCancelled ? 1 : 0 });
  return {
    brNo: s(r.BR_No), receiveDate: iso(r.Receive_Date), clientCode: s(r.Client_Code), clientName: s(r.company_name), mode: s(r.Receive_mode),
    ledger: s(r.cash_name) || s(r.bank_name), payMode: s(r.Paymentmode), chequeNo: s(r.ChequeNo), chequeDate: iso(r.ChequeDate),
    clientBank: s(r.ClientBank), manualNo: s(r.BRMANUALNo), remarks: s(r.Remarks), narration: s(r.Narration),
    totals: { received: n(r.Receive_Amount), tds: n(r.TDS), deduction: n(r.Deduction), roundOff: n(r.RoundedAmt), otherIncome: n(r.OtherIncome) },
    cancelled: Boolean(r.IsCancelled), cancelledBy: s(r.Cancelled_By), cancelRemarks: s(r.Cancel_Remarks), createdBy: s(r.User_id),
    bills: bills.map((b) => ({
      billNo: s(b.Bill_no), billDate: iso(b.bill_date), billAmount: n(b.Bill_Amount), received: n(b.Received), tds: n(b.TDS),
      deduction: n(b.Deduction), roundOff: n(b.RoundedAmt), settled: n(b.Settled),
    })),
    voucher: voucher.map((v) => ({ ledger: s(v.LedgerName), dr: n(v.Dr), cr: n(v.Cr) })),
  };
}

export async function cancelReceipt(user, brNo, remarks) {
  const r = await getReceipt(user, brNo);
  if (r.cancelled) throw conflict('This receipt is already cancelled');
  await withTransaction(async (tx) => {
    await query('update Bill_Receive set IsCancelled = 1, Cancelled_By = @u, Cancelled_Date = getdate(), Cancel_Remarks = @rem where BR_No = @no',
      { u: user.userId, rem: remarks, no: brNo }, { tx });
    await query('update Bill_Receive_Details set IsCancelled = 1 where BR_No = @no', { no: brNo }, { tx });
    await query("update tblAccountTrasaction set IsCancelled = 1 where VoucherNo = @no and Mode = 'BILL RECEIVE'", { no: brNo }, { tx });
    await query(
      'update client_bill set Payment_Status = 0 where bill_no in (select Bill_no from Bill_Receive_Details where BR_No = @no)', { no: brNo }, { tx });
  });
  return { brNo, message: 'Receipt cancelled' };
}
