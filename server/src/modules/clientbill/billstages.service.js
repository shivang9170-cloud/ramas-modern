// Client bill submission and finalize — port of Invoice/Client_Bill_Summation.aspx (submission), Bill_Finalized.aspx
// (finalize), Bill_Finalized_Cancel.aspx and Client_billFinalise_view.aspx (finalized list, cancel finalize).
// ClientBill_dal / Bill_Finalized_Dal (bin/ClassLibrary.dll).
//
//   generated → submitted: the bill is handed to the client at its submission branch (client_Master.SubmissionLocation);
//     ClientBill_Summation_status = 'Active', Summation_date, receiver name / phone, remarks.
//   submitted → finalized: at the billing branch (or the client's collection branch) — the voucher books the sale
//     (voucher = bill no.): Dr the client's BILLED ledger (total) / Cr OUTPUT CGST, SGST, IGST / Cr FREIGHT INCOME (taxable),
//     ClientBill_Finalize_status = 'Finalized'. The bill is then due for receipt. (The legacy voucher was Dr BILLED /
//     Cr UNBILLED, which assumed docket booking had already credited income; nothing does that, so income never showed.)
//
// Changes from the pages (docs/MIGRATION.md "Bill submission and finalize"):
//   * every bill is re-read on the server; the page posted the client name, billing branch and amount from its grid and
//     finalized only the grid's first row;
//   * both ledgers must exist in the login year before anything is saved (as on the page), and voucher + status are one
//     transaction (insert_Bill_Finalized);
//   * the submission branch is checked for every bill (the page checked the first row only) and a submission date may not be
//     before the bill date or after today;
//   * undoing a submission (usp_Summation_Cancel) is refused once finalized; cancelling a finalize is refused once money is
//     received against the bill, and cancels its voucher lines instead of deleting them.
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError } from '../../middleware/errors.js';
import { s, n, iso, today, round2 } from '../../utils/values.js';
import { ensureLedger } from '../books/posting.js';

const ACTIVE = 'cb.client_bill_status is null';

const TBB = "isnull(cb.Bill_Type, 'To Be Billed') = 'To Be Billed'";
const PAID_TOPAY = "cb.Bill_Type in ('Paid', 'To Pay')";

const row = (r) => ({
  billNo: s(r.bill_no), billDate: iso(r.bill_date), dueDate: iso(r.DueDate), clientCode: s(r.client_code), clientName: s(r.company_name),
  billType: s(r.Bill_Type) || 'To Be Billed',
  totalAmount: n(r.totalamount), dockets: n(r.dockets), billingBranch: s(r.origin_branch), submissionBranch: s(r.submission_branch),
  collectionBranch: s(r.collection_branch), submittedOn: iso(r.Summation_date), receiverName: s(r.RcvName), receiverPhone: s(r.RcvPhNo),
  submissionRemarks: s(r.Summation_remarks), finalizedOn: iso(r.ClientBill_Finalize_date),
  paid: n(r.Payment_Status) === 1 || Boolean(s(r.mr_status)) || n(r.receipts) > 0,   // any money received (Bill receipt)
});

const SELECT = `select cb.bill_no, cb.bill_date, cb.DueDate, cb.client_code, coalesce(cm.company_name, pm.company_name) as company_name, cb.totalamount,
    cb.origin_branch, cb.Bill_Type,
    coalesce(nullif(cm.SubmissionLocation, ''), cb.origin_branch) as submission_branch,
    coalesce(nullif(cm.CollectionLocation, ''), cb.origin_branch) as collection_branch,
    cb.Summation_date, cb.RcvName, cb.RcvPhNo, cb.Summation_remarks, cb.ClientBill_Finalize_date, cb.Payment_Status, cb.mr_status,
    (select count(*) from client_bill_charge_details d where d.bill_no = cb.bill_no) as dockets,
    (select count(*) from Bill_Receive_Details r where r.Bill_no = cb.bill_no and r.IsCancelled = 0) as receipts
  from client_bill cb left join client_Master cm on cm.client_Id = cb.client_Id
  left join consigner_master pm on pm.consigner_code = cb.client_code and cb.client_Id is null`;

// ------------------------------------------------------------------ submission

/**
 * Get_BillNO_FORSummation: active bills not yet submitted whose client is submitted at this branch ("bill available in
 * Branch … for Summision" otherwise); stage 'done': this branch's submitted, not finalized bills (undo possible).
 */
export async function submissionList(user, { stage = 'pending', clientCode = '', search = '' } = {}) {
  const rows = await query(
    `${SELECT}
      where ${ACTIVE} and ${TBB} and (@div = '' or cb.division = @div)
        and coalesce(nullif(cm.SubmissionLocation, ''), cb.origin_branch) = @b
        and ((@st = 'pending' and cb.ClientBill_Summation_status is null)
          or (@st = 'done' and cb.ClientBill_Summation_status = 'Active' and cb.ClientBill_Finalize_status is null))
        and (@c = '' or cb.client_code = @c) and (@q = '' or cb.bill_no like '%' + @q + '%' or coalesce(cm.company_name, pm.company_name) like '%' + @q + '%')
      order by cb.bill_date, cb.bill_no`,
    { b: user.currentBranch.code, div: s(user.divCode), st: stage, c: clientCode, q: search });
  return rows.map(row);
}

/** btnsubmit_Click → update_Summationstatas for each ticked bill. */
export async function submitBills(user, body) {
  if (body.date > today()) throw badRequest('Submission date should not be greater than current date');
  const pending = new Map((await submissionList(user, { stage: 'pending' })).map((b) => [b.billNo, b]));
  const problems = [];
  for (const no of body.bills) {
    const b = pending.get(no);
    if (!b) problems.push(`${no}: not a bill waiting for submission at this branch`);
    else if (body.date < b.billDate) problems.push(`${no}: submission date is before the bill date`);
  }
  if (problems.length) throw new HttpError(422, 'Some bills cannot be submitted', problems.map((message) => ({ path: 'bills', message })));
  await withTransaction(async (tx) => {
    for (const no of body.bills) {
      await query(
        `update client_bill set ClientBill_Summation_status = 'Active', Summation_date = @d, RcvName = @rn, RcvPhNo = @rp, Summation_remarks = @rem
          where bill_no = @no and client_bill_status is null and ClientBill_Summation_status is null`,
        { d: body.date, rn: body.receiverName, rp: body.receiverPhone, rem: body.remarks, no }, { tx });
    }
  });
  return { bills: body.bills.length, message: `${body.bills.length} bill(s) submitted` };
}

/** usp_Summation_Cancel: back to generated while not finalized. */
export async function unsubmitBill(user, billNo) {
  const [b] = (await submissionList(user, { stage: 'done' })).filter((x) => x.billNo === billNo);
  if (!b) throw conflict(`Bill ${billNo} is not a submitted, unfinalized bill of this branch`);
  await query(
    `update client_bill set ClientBill_Summation_status = null, Summation_date = null, RcvName = null, RcvPhNo = null, Summation_remarks = null
      where bill_no = @no and ClientBill_Finalize_status is null`, { no: billNo });
  return { billNo, message: 'Submission cancelled' };
}

// ------------------------------------------------------------------ finalize

/**
 * Fill_BillNo: bills not yet finalized —
 *   'billing'    submitted "To Be Billed" bills of this billing branch ("Billing Branch Wise"),
 *   'collection' submitted "To Be Billed" bills whose client is collected at this branch ("Collection Branch Wise"),
 *   'paidtopay'  Paid / To Pay bills of this branch (PaidAndTopayBill_Finalized — finalized without a submission);
 * stage 'done': this branch's finalized bills (Client_billFinalise_view).
 */
export async function finalizeList(user, { stage = 'pending', by = 'billing', search = '' } = {}) {
  const rows = await query(
    `${SELECT}
      where ${ACTIVE} and (@div = '' or cb.division = @div) and cb.Financial_Year = @fy
        and ((@by = 'billing' and cb.origin_branch = @b and (@st = 'done' or ${TBB}))
          or (@by = 'collection' and ${TBB} and coalesce(nullif(cm.CollectionLocation, ''), cb.origin_branch) = @b)
          or (@by = 'paidtopay' and ${PAID_TOPAY} and cb.origin_branch = @b))
        and ((@st = 'pending' and cb.ClientBill_Finalize_status is null and (${PAID_TOPAY} or cb.ClientBill_Summation_status = 'Active'))
          or (@st = 'done' and cb.ClientBill_Finalize_status = 'Finalized'))
        and (@q = '' or cb.bill_no like '%' + @q + '%' or coalesce(cm.company_name, pm.company_name) like '%' + @q + '%')
      order by cb.bill_date, cb.bill_no`,
    { b: user.currentBranch.code, div: s(user.divCode), fy: user.financialYear, by, st: stage, q: search });
  return rows.map(row);
}

const findLedger = async (user, name, tx) => (await query(
  `select top 1 LedgerCode from tblAccountLedger where LedgerName = @n and Financial_Year = @fy and (@div = '' or Division = @div)
      and isnull(IsActive, 1) = 1`, { n: name, fy: user.financialYear, div: s(user.divCode) }, { tx }))[0];

/**
 * The ledgers a bill moves between ("<ledger> not found!." otherwise):
 *   To Be Billed — receivable = the client's BILLED ledger, counter = its UNBILLED ledger (Bill_Finalized);
 *   Paid / To Pay — receivable = the client's BILLED ledger when the party is a client ("client wise"), else
 *     "PAID / TOPAY BOOKING PENDING COLLECTION"; counter = "PAID / TOPAY RECOVERY :<branch name> :<branch code>"
 *     (PaidAndTopayBill_Finalized). Finalize posts Dr receivable / Cr counter; a receipt credits the receivable.
 */
export async function billLedgers(user, billNo, tx) {
  const [c] = await query(
    `select cb.Bill_Type, cb.origin_branch, b.branch_name, cm.client_code, cm.company_name, cm.billed_ledger_name, cm.unbilled_ledger_name
       from client_bill cb left join client_Master cm on cm.client_Id = cb.client_Id left join branch_master b on b.branch_code = cb.origin_branch
      where cb.bill_no = @no`, { no: billNo }, { tx });
  const billType = s(c?.Bill_Type) || 'To Be Billed';
  // AutoBindLedger names: "<NAME> :<CODE>:<BRANCH NAME>:<BRANCH CODE> :BILLED"
  const base = `${s(c?.company_name)} :${s(c?.client_code)}:${s(c?.branch_name)}:${s(c?.origin_branch)}`.toUpperCase();
  const billedName = s(c?.billed_ledger_name) || `${base} :BILLED`;
  let receivableName; let counterName;
  if (billType === 'To Be Billed') {
    receivableName = billedName;
    counterName = s(c?.unbilled_ledger_name) || `${base} :UNBILLED`;
  } else {
    const kind = billType === 'Paid' ? 'PAID' : 'TOPAY';
    receivableName = c?.client_code && (await findLedger(user, billedName, tx)) ? billedName : `${kind} BOOKING PENDING COLLECTION`;
    counterName = `${kind} RECOVERY :${s(c?.branch_name)} :${s(c?.origin_branch)}`;
  }
  const [receivable, counter] = [await findLedger(user, receivableName, tx), await findLedger(user, counterName, tx)];
  const missing = [];
  if (!receivable) missing.push(`${receivableName} not found`);
  return { billType, receivable: s(receivable?.LedgerCode), counter: s(counter?.LedgerCode), receivableName, missing };
}

/**
 * The finalize voucher: Dr the receivable (bill total) / Cr OUTPUT CGST, SGST, IGST (tax) / Cr FREIGHT INCOME (the rest).
 * Income and tax ledgers are created in Direct Income / Duties & Taxes when the year has none.
 */
async function finalizeLines(user, tx, billNo, receivable, total) {
  const [b] = await query('select isnull(TotCGST, 0) as c, isnull(TotSGST, 0) as sg, isnull(TotIGST, 0) as i from client_bill where bill_no = @no',
    { no: billNo }, { tx });
  let tax = [['OUTPUT CGST', round2(n(b?.c))], ['OUTPUT SGST', round2(n(b?.sg))], ['OUTPUT IGST', round2(n(b?.i))]].filter(([, a]) => a > 0);
  if (tax.reduce((a, [, x]) => a + x, 0) > total) tax = [];   // bad tax figures: book it all as income rather than an unbalanced voucher
  const lines = [{ code: receivable, dr: total, cr: 0 }];
  for (const [name, amt] of tax) {
    lines.push({ code: await ensureLedger(user, tx, { name, section: 'TAXES', type: 'Liability', drcr: 'CR' }), dr: 0, cr: amt });
  }
  const income = round2(total - tax.reduce((a, [, x]) => a + x, 0));
  if (income > 0) lines.push({ code: await ensureLedger(user, tx, { name: 'FREIGHT INCOME', section: 'DIRECT_INC', type: 'Income', drcr: 'CR' }), dr: 0, cr: income });
  return lines;
}

/** btnsubmit_Click → insert_Bill_Finalized (voucher + status) for each ticked bill. */
export async function finalizeBills(user, body) {
  if (body.date > today()) throw badRequest('Finalize date should not be greater than current date');
  const pending = new Map((await finalizeList(user, { stage: 'pending', by: body.by })).map((b) => [b.billNo, b]));
  const problems = [];
  const ledgers = new Map();
  for (const no of body.bills) {
    const b = pending.get(no);
    if (!b) { problems.push(`${no}: not a bill waiting to be finalized at this branch`); continue; }
    if (body.date < (b.submittedOn || b.billDate)) problems.push(`${no}: finalize date is before the ${b.submittedOn ? 'submission' : 'bill'} date`);
    const l = await billLedgers(user, no);
    for (const m of l.missing) problems.push(`${no}: ${m}`);
    ledgers.set(no, l);
  }
  if (problems.length) throw new HttpError(422, 'Some bills cannot be finalized', problems.map((message) => ({ path: 'bills', message })));
  await withTransaction(async (tx) => {
    for (const no of body.bills) {
      const b = pending.get(no); const l = ledgers.get(no);
      const res = await query(
        `update client_bill set ClientBill_Finalize_status = 'Finalized', ClientBill_Finalize_date = @d
          where bill_no = @no and client_bill_status is null and ClientBill_Finalize_status is null
            and (Bill_Type in ('Paid', 'To Pay') or ClientBill_Summation_status = 'Active');
         select @@rowcount as n`, { d: body.date, no }, { tx });
      if (!n(res[0]?.n)) throw conflict(`Bill ${no} was changed by someone else — search again`);
      for (const line of await finalizeLines(user, tx, no, l.receivable, round2(b.totalAmount))) {
        await query(
          `insert into tblAccountTrasaction(LedgerCode, Dr, Cr, CreatedDate, VoucherNo, Mode, Entry, Financial_Year, Division)
           values (@l, @dr, @cr, @d, @no, 'Bill Finalized', 'Ledger', @fy, @div)`,
          { l: line.code, dr: line.dr, cr: line.cr, d: body.date, no, fy: user.financialYear, div: s(user.divCode) }, { tx });
      }
    }
  });
  return { bills: body.bills.length, message: `${body.bills.length} bill(s) finalized` };
}

/** Bill_Finalized_Cancel / Cancel_finalized_Bill (usp_BillFinalize_Cancel): back to submitted (Paid / To Pay: generated) while nothing is received. */
export async function unfinalizeBill(user, billNo) {
  const [b] = (await finalizeList(user, { stage: 'done', by: 'billing' })).filter((x) => x.billNo === billNo);
  if (!b) throw conflict(`Bill ${billNo} is not a finalized bill of this billing branch`);
  if (b.paid) throw conflict(`Money is received against bill ${billNo}; it cannot be unfinalized`);
  await withTransaction(async (tx) => {
    await query("update client_bill set ClientBill_Finalize_status = null, ClientBill_Finalize_date = null where bill_no = @no", { no: billNo }, { tx });
    await query("update tblAccountTrasaction set IsCancelled = 1 where VoucherNo = @no and Mode = 'Bill Finalized' and isnull(IsCancelled, 0) = 0",
      { no: billNo }, { tx });
  });
  return { billNo, message: 'Finalize cancelled' };
}