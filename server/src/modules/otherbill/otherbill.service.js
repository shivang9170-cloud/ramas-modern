// Miscellaneous and warehouse bills — port of Invoice/Miscellaneous_Bill.aspx and Warehouse_bill.aspx (the same form on two
// tables) with MiscellaneousBillSubmission / WareHouseBillSubmission, MiscellaneousBillFinalise / WarehouseBillFinalise,
// MiscellaneousBillCancel / warehouseBillCancel, miscellaneousbill_ReportView / WareHouseBill_ReportView and the prints.
// Miscellaneous_Bill_dal / Warehouse_bill_dal (bin/ClassLibrary.dll).
//
// A one-line bill to a client of the branch: month / year, service (GTA / Courier), service for, SAC, GST slab, quantity ×
// rate = taxable; CGST + SGST (intrastate) or IGST (interstate). Life cycle: generated → submitted (receiver) → finalized →
// (cancel allowed until finalized). Finalize posts the voucher (voucher no. = bill no.):
//   Dr the client's BILLED ledger              total
//   Cr OUTPUT CGST / OUTPUT SGST / OUTPUT IGST  tax
//   Cr BOOKING INCOME MISCELLANEOUS / WAREHOUSE  taxable
//
// Changes from the pages (docs/MIGRATION.md "Miscellaneous and warehouse bills"):
//   * amounts are worked out on the server from quantity, rate and the slab (the page saved its text boxes);
//   * the bill no. (MIS / WHO + short code + FY + 6 digits) is taken inside the save (the page computed it on every load and
//     its increment dropped the FY part after the first bill);
//   * finalize checks every ledger first and posts one balanced voucher in one transaction (the page posted five separate
//     entries, looked the ledgers up by name without the year, and redirected to the octroi page afterwards);
//   * the finalize amounts are re-read (the page took them from its grid); a bill month after the current month is refused;
//   * cancel of a finalized bill is refused; "undo finalize" added (cancels the voucher lines).
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { finYr } from '../pickup/pickup.service.js';
import { s, n, iso, today, round2 } from '../../utils/values.js';

export const KINDS = {
  misc: { table: 'miscellaneous_bill', prefix: 'MIS', income: 'BOOKING INCOME MISCELLANEOUS', mode: 'Miscellaneous Bill Finalized', title: 'Miscellaneous' },
  warehouse: { table: 'warehouse_bill', prefix: 'WHO', income: 'BOOKING INCOME WAREHOUSE', mode: 'Warehouse Bill Finalized', title: 'Warehouse' },
};
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SERVICE_FOR = ['Freight Income – Road', 'Freight Income – Train', 'Freight Income – Air', 'Package', 'Others'];
const k = (kind) => { const v = KINDS[kind]; if (!v) throw notFound('Unknown bill type'); return v; };

const STATUS = `case when b.Cancel_status is not null then 'Cancelled' when b.Finalize_status = 'Finalized' then 'Finalized'
  when b.Summation_status = 'Active' then 'Submitted' else 'Generated' end`;

// ------------------------------------------------------------------ lookups

/** BindMode (SelectTax slabs), SACDetails, the service and month lists. */
export async function options() {
  const [slabs, sac] = await Promise.all([
    query('select SlNo, Slab, CGST, SGST, IGST from Misc_Tax_Slab order by SlNo'),
    query('select distinct Sac_Code from Sac_Master where isnull(Sac_Code, \'\') <> \'\' order by Sac_Code'),
  ]);
  return {
    slabs: slabs.map((r) => ({ value: Number(r.SlNo), label: s(r.Slab), cgst: n(r.CGST), sgst: n(r.SGST), igst: n(r.IGST) })),
    sacCodes: sac.map((r) => s(r.Sac_Code)),
    serviceTypes: ['GTA', 'Courier'], serviceFor: SERVICE_FOR, months: MONTHS, taxTypes: ['Intrastate', 'Interstate'],
  };
}

/** getVendor: the branch's clients; GST type from the client's state against the branch's. */
export async function clients(user, term) {
  const rows = await query(
    `select top 20 cm.client_Id, cm.client_code, cm.company_name, cm.credit_period, cs.state_code as client_state, bs.state_code as branch_state
       from client_Master cm
       left join city_master cs on cs.city_code = cm.city
       left join branch_master b on b.branch_code = @b left join city_master bs on bs.city_code = b.city_code
      where isnull(cm.is_Active, 1) = 1 and cm.Branch_Code = @b and (cm.company_name like @t or cm.client_code like @t)
        and (@div = '' or ',' + isnull(cm.DivCode, '') + ',' like '%,' + @div + ',%')
      order by cm.company_name`, { t: `%${term}%`, b: user.currentBranch.code, div: s(user.divCode) });
  return rows.map((r) => ({
    id: Number(r.client_Id), code: s(r.client_code), name: s(r.company_name), creditPeriod: n(r.credit_period),
    taxType: s(r.client_state) && s(r.client_state) === s(r.branch_state) ? 'Intrastate' : 'Interstate',
  }));
}

// ------------------------------------------------------------------ create

/** TaxCalculat: taxable = quantity × rate; CGST / SGST (intrastate) or IGST (interstate) of the slab. */
export function amounts(slab, taxType, quantity, rate) {
  const taxable = round2(quantity * rate);
  const intra = taxType === 'Intrastate';
  const cgst = intra ? slab.cgst : 0; const sgst = intra ? slab.sgst : 0; const igst = intra ? 0 : slab.igst;
  const cgstAmt = round2(taxable * cgst / 100); const sgstAmt = round2(taxable * sgst / 100); const igstAmt = round2(taxable * igst / 100);
  return { taxable, cgst, sgst, igst, cgstAmt, sgstAmt, igstAmt, total: round2(taxable + cgstAmt + sgstAmt + igstAmt) };
}

export async function createBill(user, kind, body) {
  const K = k(kind);
  const now = today();
  const fy = financialYearRange(user.financialYear);
  if (body.billDate > now) throw badRequest('Bill date should not be greater than current date');
  if (fy && (body.billDate < fy.from || body.billDate > fy.to)) throw badRequest('Bill date must be in the login financial year');
  if (body.dueDate && body.dueDate < body.billDate) throw badRequest('Due date should not be before the bill date');
  // ddlMonth_SelectedIndexChanged: "Bill should not be generated for greater then current month."
  const monthKey = `${body.year}-${String(MONTHS.indexOf(body.month) + 1).padStart(2, '0')}`;
  if (monthKey > now.slice(0, 7)) throw badRequest('Bill should not be generated for a month after the current month');
  const client = (await clients(user, body.clientCode)).find((c) => c.code === body.clientCode);
  if (!client) throw badRequest('Please Select Vendor for Invoice (a client of this branch)');
  const [slabRow] = await query('select SlNo, Slab, CGST, SGST, IGST from Misc_Tax_Slab where SlNo = @id', { id: body.slab });
  if (!slabRow) throw badRequest('Select the GST slab');
  const slab = { label: s(slabRow.Slab), cgst: n(slabRow.CGST), sgst: n(slabRow.SGST), igst: n(slabRow.IGST) };
  const a = amounts(slab, body.taxType, body.quantity, body.rate);
  if (a.taxable <= 0) throw badRequest('Please Enter Rate or Qty first');
  const dueDate = body.dueDate || body.billDate;
  const [br] = await query('select short_code from branch_master where branch_code = @b', { b: user.currentBranch.code });
  const shortCode = s(br?.short_code); const fyShort = finYr(user.financialYear);

  return withTransaction(async (tx) => {
    const prefix = `${K.prefix}${shortCode}${fyShort}`;
    const [last] = await query(
      `select top 1 Bill_No from ${K.table} with (updlock, holdlock) where Bill_No like @p + '%' and len(Bill_No) = len(@p) + 6 order by Bill_No desc`,
      { p: prefix }, { tx });
    const billNo = `${prefix}${String((last ? Number(s(last.Bill_No).slice(-6)) : 0) + 1).padStart(6, '0')}`;
    await query(
      `insert into ${K.table}(Bill_No, BillDate, DueDate, MonthName, YearName, client_Id, client_Code, cust_name, ServiceType, ServiceFor, SAC,
         TaxModeFor, TaxType, Quantity, Rate, TaxableAmt, CGST, CGSTAmt, SGST, SGSTAmt, IGST, IGSTAmt, TotalAmount, remarks, UserId,
         CreatBranch, Financial_Year, Division, ShortCode, FinYr)
       values (@no, @bd, @due, @m, @y, @cid, @cc, @cn, @st, @sf, @sac, @slab, @tt, @q, @rate, @taxable, @cgst, @cgsta, @sgst, @sgsta, @igst, @igsta,
         @total, @rem, @u, @b, @fy, @div, @sc, @fys)`,
      {
        no: billNo, bd: body.billDate, due: dueDate, m: body.month, y: body.year, cid: client.id, cc: client.code, cn: client.name,
        st: body.serviceType, sf: body.serviceFor, sac: body.sac, slab: slab.label, tt: body.taxType, q: body.quantity, rate: body.rate,
        taxable: a.taxable, cgst: a.cgst, cgsta: a.cgstAmt, sgst: a.sgst, sgsta: a.sgstAmt, igst: a.igst, igsta: a.igstAmt, total: a.total,
        rem: body.remarks, u: user.userId, b: user.currentBranch.code, fy: user.financialYear, div: s(user.divCode), sc: shortCode, fys: fyShort,
      }, { tx });
    return { billNo, totalAmount: a.total, message: `${K.title} bill ${billNo} generated` };
  });
}

// ------------------------------------------------------------------ list / view

const toBill = (r) => ({
  billNo: s(r.Bill_No), billDate: iso(r.BillDate), dueDate: iso(r.DueDate), month: s(r.MonthName), year: s(r.YearName),
  clientCode: s(r.client_Code), clientName: s(r.cust_name), serviceType: s(r.ServiceType), serviceFor: s(r.ServiceFor), sac: s(r.SAC),
  slab: s(r.TaxModeFor), taxType: s(r.TaxType), quantity: n(r.Quantity), rate: n(r.Rate), taxable: n(r.TaxableAmt),
  cgst: n(r.CGST), cgstAmt: n(r.CGSTAmt), sgst: n(r.SGST), sgstAmt: n(r.SGSTAmt), igst: n(r.IGST), igstAmt: n(r.IGSTAmt), total: n(r.TotalAmount),
  remarks: s(r.remarks), status: s(r.status), submittedOn: iso(r.Summation_date), receiverName: s(r.RcvName), receiverPhone: s(r.RcvPhNo),
  finalizedOn: iso(r.Finalize_date), cancelledBy: s(r.Cancel_by), cancelRemarks: s(r.Cancel_remarks), createdBy: s(r.UserId),
});

/** MisBillDetails / WareHouseBillDetails + the report views: the branch's bills of the login year. */
export async function listBills(user, kind, { from, to, status = 'all', search = '' }) {
  const K = k(kind);
  const rows = await query(
    `select b.*, ${STATUS} as status from ${K.table} b
      where b.CreatBranch = @b and b.Financial_Year = @fy and b.BillDate between @from and @to
        and (@st = 'all' or (${STATUS}) = @st) and (@q = '' or b.Bill_No like '%' + @q + '%' or b.cust_name like '%' + @q + '%')
      order by b.Bill_No desc`,
    { b: user.currentBranch.code, fy: user.financialYear, from, to, st: status, q: search });
  return rows.map(toBill);
}

export async function getBill(user, kind, billNo) {
  const K = k(kind);
  const [r] = await query(
    `select b.*, ${STATUS} as status, br.branch_name, br.address as branch_address, br.Branch_Gstin_no, cm.Gstin_No as client_gstin,
            cm.address as client_address, cm.place as client_place
       from ${K.table} b left join branch_master br on br.branch_code = b.CreatBranch left join client_Master cm on cm.client_Id = b.client_Id
      where b.Bill_No = @no and b.CreatBranch = @b`, { no: billNo, b: user.currentBranch.code });
  if (!r) throw notFound(`Bill ${billNo} not found at this branch`);
  return {
    ...toBill(r), kind, title: K.title,
    branch: { code: s(r.CreatBranch), name: s(r.branch_name), address: s(r.branch_address), gstin: s(r.Branch_Gstin_no) },
    client: { code: s(r.client_Code), name: s(r.cust_name), address: [s(r.client_address), s(r.client_place)].filter(Boolean).join(', '), gstin: s(r.client_gstin) },
  };
}

// ------------------------------------------------------------------ submit / finalize / cancel

/** Insert_Miscellaneous_bill_Summation: handed to the client (receiver). */
export async function submitBill(user, kind, billNo, body) {
  const K = k(kind);
  const b = await getBill(user, kind, billNo);
  if (b.status !== 'Generated') throw conflict(`Bill ${billNo} is ${b.status.toLowerCase()}`);
  if (body.date > today() || body.date < b.billDate) throw badRequest('Submission date must be between the bill date and today');
  await query(`update ${K.table} set Summation_status = 'Active', Summation_date = @d, RcvName = @rn, RcvPhNo = @rp where Bill_No = @no`,
    { d: body.date, rn: body.receiverName, rp: body.receiverPhone, no: billNo });
  return { billNo, message: 'Bill submitted' };
}

async function ledger(user, name, tx) {
  const [l] = await query(
    `select top 1 LedgerCode from tblAccountLedger where LedgerName = @n and Financial_Year = @fy and (@div = '' or Division = @div)
        and isnull(IsActive, 1) = 1`, { n: name, fy: user.financialYear, div: s(user.divCode) }, { tx });
  return l ? s(l.LedgerCode) : null;
}

/** update_finalizedate + the five insert_BCER_Trans lines, as one balanced voucher. */
export async function finalizeBill(user, kind, billNo, body) {
  const K = k(kind);
  const b = await getBill(user, kind, billNo);
  if (!['Generated', 'Submitted'].includes(b.status)) throw conflict(`Bill ${billNo} is ${b.status.toLowerCase()}`);
  if (body.date > today() || body.date < (b.submittedOn || b.billDate)) throw badRequest('Finalize date must be between the bill / submission date and today');
  // Find_BillingatBranch: "<NAME> :<CODE>:<BRANCH NAME>:<BRANCH CODE> :BILLED"
  const [c] = await query(
    `select cm.company_name, cm.client_code, cm.Branch_Code, cm.billed_ledger_name, br.branch_name from client_Master cm
       left join branch_master br on br.branch_code = cm.Branch_Code where cm.client_code = @c`, { c: b.clientCode });
  const billedName = s(c?.billed_ledger_name) || `${s(c?.company_name)} :${s(c?.client_code)}:${s(c?.branch_name)}:${s(c?.Branch_Code)} :BILLED`.toUpperCase();
  const lines = [[billedName, b.total, 0], ['OUTPUT CGST', 0, b.cgstAmt], ['OUTPUT SGST', 0, b.sgstAmt], ['OUTPUT IGST', 0, b.igstAmt], [K.income, 0, b.taxable]]
    .filter(([, dr, cr]) => dr || cr);
  const codes = []; const missing = [];
  for (const [name] of lines) { const code = await ledger(user, name); if (!code) missing.push(`${name} not found`); codes.push(code); }
  if (missing.length) throw new HttpError(422, 'Ledgers missing', missing.map((message) => ({ path: 'ledgers', message })));
  const dr = round2(lines.reduce((t, l) => t + l[1], 0)); const cr = round2(lines.reduce((t, l) => t + l[2], 0));
  if (dr !== cr) throw new HttpError(422, `The bill amounts do not balance (total ${dr}, taxable + tax ${cr})`);
  await withTransaction(async (tx) => {
    await query(`update ${K.table} set Finalize_status = 'Finalized', Finalize_date = @d where Bill_No = @no and Finalize_status is null and Cancel_status is null`,
      { d: body.date, no: billNo }, { tx });
    for (const [i, [, d, cAmt]] of lines.entries()) {
      await query(
        `insert into tblAccountTrasaction(LedgerCode, Dr, Cr, CreatedDate, VoucherNo, Mode, Entry, Financial_Year, Division)
         values (@l, @dr, @cr, @d, @no, @mode, 'Ledger', @fy, @div)`,
        { l: codes[i], dr: d, cr: cAmt, d: body.date, no: billNo, mode: K.mode, fy: user.financialYear, div: s(user.divCode) }, { tx });
    }
  });
  return { billNo, message: 'Bill finalized' };
}

export async function unfinalizeBill(user, kind, billNo) {
  const K = k(kind);
  const b = await getBill(user, kind, billNo);
  if (b.status !== 'Finalized') throw conflict(`Bill ${billNo} is not finalized`);
  await withTransaction(async (tx) => {
    await query(`update ${K.table} set Finalize_status = null, Finalize_date = null where Bill_No = @no`, { no: billNo }, { tx });
    await query('update tblAccountTrasaction set IsCancelled = 1 where VoucherNo = @no and Mode = @mode and isnull(IsCancelled, 0) = 0',
      { no: billNo, mode: K.mode }, { tx });
  });
  return { billNo, message: 'Finalize cancelled' };
}

/** Insert_For_Cancel: "Bill No. is Finalize It is Not Canceled" / "Alerady Canceled"; a submitted bill can be cancelled. */
export async function cancelBill(user, kind, billNo, remarks) {
  const K = k(kind);
  const b = await getBill(user, kind, billNo);
  if (b.status === 'Cancelled') throw conflict('Bill No. already cancelled');
  if (b.status === 'Finalized') throw conflict('Bill No. is finalized; it cannot be cancelled');
  await query(
    `update ${K.table} set Cancel_status = 'Cancelled', Cancel_date = cast(getdate() as date), Cancel_time = convert(varchar(5), getdate(), 108),
       Cancel_remarks = @rem, Cancel_by = @u where Bill_No = @no`, { rem: remarks, u: user.userId, no: billNo });
  return { billNo, message: 'Bill No Is Canceled Successfully' };
}
