// Other vendor invoices — port of Invoice/VendorInvoice.aspx (+ OthVndInvoiceDetails.aspx, OtherVendorPrint.aspx).
// VendorInvoice_dal / VendorInvoice_bal (bin/ClassLibrary.dll: Sp_InsertOtherVendorInvoice, ItemDetails, VndDetail, SelectTax).
//
// A bill from an "other vendor" (stationery, repairs, services — Other_Vendor_Master, not a transport vendor): product lines
// (ProductMaster; goods for "Purchase", services for "Pay Bill") with quantity × rate, a GST slab and CGST + SGST or IGST;
// TDS at the vendor's rate on the taxable amount; an optional cost-centre split (branch, docket, customer, vendor, employee)
// that is required when the vendor is marked IsCostProfit. Saving posts one voucher (voucher no. = invoice no.):
//   Cr the vendor's ledger                       total − TDS
//   Dr INPUT CGST / INPUT SGST / INPUT IGST       tax
//   Dr the expense ledger picked on the page     taxable
//   Cr the TDS ledger (default "TDS PAYABLE")    TDS
//
// Changes from the page (docs/MIGRATION.md "Vendor invoices"):
//   * amounts, tax and TDS are worked out on the server (the page saved its labels; it also saved the CGST % as the SGST %
//     and the IGST % into IGSTAmt when a line was re-added);
//   * the invoice no. (OTH + short code + FY + 6 digits) is taken inside the save (the page dropped the FY after the first one);
//   * every ledger is checked before saving and the voucher is checked to balance; only the tax ledgers in use are required;
//   * the TDS ledger list uses the login year (the page was fixed to 2018 - 2019);
//   * the cost-centre total is checked against the invoice's taxable amount (the page compared it with the line being typed);
//   * the same vendor bill no. cannot be entered twice; cancel added (cancels the voucher lines).
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { finYr } from '../pickup/pickup.service.js';
import { s, n, iso, today, round2 } from '../../utils/values.js';

export const INVOICE_FOR = ['Direct Expenses Voucher', 'Expenses Provision Journal Voucher', 'Bill Entry(Other Vendors)'];
export const PART_TYPES = ['Purchase', 'Pay Bill'];
export const COST_TYPES = ['Branch/Hub', 'Docket/C Note', 'Customer', 'Vendor', 'Employee'];
const MODE = 'PURCHASE/PAYBILL';
const fyDiv = (user) => ({ fy: user.financialYear, div: s(user.divCode) });

// ------------------------------------------------------------------ lookups

/** BindMode (SelectTax slabs) and the radio / drop-down lists of the page. */
export async function options() {
  const slabs = await query('select SlNo, Slab, CGST, SGST, IGST from Misc_Tax_Slab order by SlNo');
  return {
    slabs: slabs.map((r) => ({ value: Number(r.SlNo), label: s(r.Slab), cgst: n(r.CGST), sgst: n(r.SGST), igst: n(r.IGST) })),
    invoiceFor: INVOICE_FOR, partTypes: PART_TYPES, costTypes: COST_TYPES, taxTypes: ['GST', 'IGST'],
  };
}

/** getVendor + VndDetail: ledgers of other vendors (login year), with the vendor's TDS % and cost-centre flag. */
export async function vendors(user, term) {
  const rows = await query(
    `select top 20 l.LedgerName, l.LedgerCode, v.vendor_code, v.name, v.TDS, v.IsCostProfit, v.Gstin_No, v.address
       from tblAccountLedger l join Other_Vendor_Master v on v.vendor_code = l.VendorOrClientCode
      where l.Financial_Year = @fy and (@div = '' or l.Division = @div) and isnull(l.IsActive, 1) = 1 and isnull(v.active_flag, 1) = 1
        and (l.LedgerName like @t or v.vendor_code like @t)
      order by l.LedgerName`, { ...fyDiv(user), t: `%${term}%` });
  return rows.map((r) => ({
    ledger: s(r.LedgerName), code: s(r.vendor_code), name: s(r.name), tds: n(r.TDS), costCentre: Boolean(r.IsCostProfit),
    gstin: s(r.Gstin_No), address: s(r.address),
  }));
}

/** getItem + ItemDetails: active products; goods (HSN) for "Purchase", services (SAC) for "Pay Bill". */
export async function products(term, partType) {
  const rows = await query(
    `select top 20 ProductCode, ProductName, UOM, SacHSN, IsSacHsn from ProductMaster
      where isnull(Status, 1) = 1 and IsSacHsn = @sac and (ProductName like @t or ProductCode like @t) order by ProductName`,
    { t: `%${term}%`, sac: partType === 'Pay Bill' ? 1 : 0 });
  return rows.map((r) => ({ code: s(r.ProductCode), name: s(r.ProductName), uom: s(r.UOM), sacHsn: s(r.SacHSN) }));
}

/** GetDestination (the expense ledger) and getTDS (ledgers with TDS in the name). */
export async function ledgers(user, term, kind) {
  const rows = await query(
    `select top 20 LedgerName from tblAccountLedger
      where Financial_Year = @fy and (@div = '' or Division = @div) and isnull(IsActive, 1) = 1 and LedgerName like @t
        and LedgerName not like '%:UNBILLED' and (@k <> 'tds' or LedgerName like '%TDS%')
        and (@k <> 'expense' or isnull(VendorOrClientCode, '') = '')
      order by LedgerName`, { ...fyDiv(user), t: `%${term}%`, k: kind });
  return rows.map((r) => s(r.LedgerName));
}

/** getCostCenter: what a cost-centre row can point at. */
export async function costTargets(user, type, term) {
  const t = `%${term}%`;
  const sql = {
    'Branch/Hub': `select top 20 branch_code as code, branch_name as name from branch_master
                    where isnull(Status, 'Active') = 'Active' and (branch_name like @t or branch_code like @t) order by branch_name`,
    'Docket/C Note': `select top 20 docket_no as code, docket_no as name from grn_master
                       where isnull(IsCancel, 0) = 0 and docket_no like @t and (@div = '' or Division = @div) order by docket_no`,
    Customer: `select top 20 client_code as code, company_name as name from client_Master
                where isnull(is_Active, 1) = 1 and (company_name like @t or client_code like @t) order by company_name`,
    Vendor: `select top 20 vendor_code as code, name from Other_Vendor_Master
              where isnull(active_flag, 1) = 1 and (name like @t or vendor_code like @t) order by name`,
    Employee: `select top 20 empcode as code, empname as name from Employee_Master
                where isnull(IsActive, 1) = 1 and (empname like @t or empcode like @t) order by empname`,
  }[type];
  if (!sql) throw badRequest('Select the cost centre type');
  const rows = await query(sql, { t, div: s(user.divCode) });
  return rows.map((r) => ({ code: s(r.code), name: s(r.name) }));
}

// ------------------------------------------------------------------ amounts

/** TaxCalculat: taxable = qty × rate; CGST + SGST (GST) or IGST of the slab; TDS on the taxable amount. */
export function lineAmounts(slab, taxType, quantity, rate, tdsPct) {
  const taxable = round2(quantity * rate);
  const gst = taxType === 'GST';
  const cgst = gst ? slab.cgst : 0; const sgst = gst ? slab.sgst : 0; const igst = gst ? 0 : slab.igst;
  const cgstAmt = round2(taxable * cgst / 100); const sgstAmt = round2(taxable * sgst / 100); const igstAmt = round2(taxable * igst / 100);
  const total = round2(taxable + cgstAmt + sgstAmt + igstAmt);
  const tdsAmt = round2(taxable * tdsPct / 100);
  return { taxable, cgst, sgst, igst, cgstAmt, sgstAmt, igstAmt, total, tdsPct, tdsAmt, afterTds: round2(taxable - tdsAmt), payable: round2(total - tdsAmt) };
}

async function ledgerCode(user, name, tx) {
  const [l] = await query(
    `select top 1 LedgerCode from tblAccountLedger where LedgerName = @n and Financial_Year = @fy and (@div = '' or Division = @div)
        and isnull(IsActive, 1) = 1`, { n: name, ...fyDiv(user) }, { tx });
  return l ? s(l.LedgerCode) : null;
}

// ------------------------------------------------------------------ create

export async function createInvoice(user, body) {
  const now = today();
  const fy = financialYearRange(user.financialYear);
  if (body.invoiceDate > now) throw badRequest('Invoice date should not be greater than current date');
  if (fy && (body.invoiceDate < fy.from || body.invoiceDate > fy.to)) throw badRequest('Invoice date must be in the login financial year');
  if (body.purchaseDate && body.purchaseDate > body.invoiceDate) throw badRequest('Vendor bill date should not be after the invoice date');

  const vendor = (await vendors(user, body.vendorLedger)).find((v) => v.ledger === body.vendorLedger);
  if (!vendor) throw badRequest('Please Select Vendor for Invoice');
  if (body.vendorInvNo) {
    const [dup] = await query(
      `select top 1 InvoiceNo from OtherVendorInvoice where VendorCode = @v and VendorInvNo = @no and IsCancelled = 0`,
      { v: vendor.code, no: body.vendorInvNo });
    if (dup) throw conflict(`Vendor bill ${body.vendorInvNo} is already entered in invoice ${s(dup.InvoiceNo)}`);
  }

  // lines: product of the right kind, slab, amounts
  const slabRows = await query('select SlNo, Slab, CGST, SGST, IGST from Misc_Tax_Slab');
  const slabs = new Map(slabRows.map((r) => [Number(r.SlNo), { label: s(r.Slab), cgst: n(r.CGST), sgst: n(r.SGST), igst: n(r.IGST) }]));
  const codes = [...new Set(body.lines.map((l) => l.itemCode))];
  const prodRows = await query(
    `select ProductCode, ProductName, UOM, SacHSN, IsSacHsn from ProductMaster
      where isnull(Status, 1) = 1 and ProductCode in (select value from string_split(@c, ','))`, { c: codes.join(',') });
  const prods = new Map(prodRows.map((r) => [s(r.ProductCode), r]));
  const lines = body.lines.map((l, i) => {
    const p = prods.get(l.itemCode);
    if (!p) throw badRequest(`Line ${i + 1}: Please Select Valide Product.`);
    if (Boolean(p.IsSacHsn) !== (body.partType === 'Pay Bill')) {
      throw badRequest(`Line ${i + 1}: ${s(p.ProductName)} is ${p.IsSacHsn ? 'a service (Pay Bill)' : 'goods (Purchase)'}`);
    }
    const slab = slabs.get(l.slab);
    if (!slab) throw badRequest(`Line ${i + 1}: select the GST slab`);
    const a = lineAmounts(slab, body.taxType, l.quantity, l.rate, vendor.tds);
    if (a.taxable <= 0) throw badRequest(`Line ${i + 1}: Please Enter Rate or Qty first`);
    return { ...l, ...a, slabId: l.slab, sacHsn: s(p.SacHSN) };
  });
  const sum = (k) => round2(lines.reduce((t, l) => t + l[k], 0));
  const tot = { qty: lines.reduce((t, l) => t + l.quantity, 0), taxable: sum('taxable'), cgst: sum('cgstAmt'), sgst: sum('sgstAmt'), igst: sum('igstAmt'), total: sum('total'), tds: sum('tdsAmt') };

  // cost centres (btnCostAdd_Click): required when the vendor is marked; no repeats; not more than the taxable amount
  const costs = body.costCentres || [];
  if (vendor.costCentre && !costs.length) throw badRequest('This vendor needs the cost centre split: add at least one cost centre');
  const seen = new Set();
  for (const c of costs) {
    const key = `${c.type}|${c.code}`;
    if (seen.has(key)) throw badRequest(`${c.name} is already in the cost centre list`);
    seen.add(key);
  }
  if (round2(costs.reduce((t, c) => t + c.amount, 0)) > tot.taxable) throw badRequest('Cost centre amounts should not be greater than the taxable amount');

  // the voucher; every ledger must exist first
  const tdsLedger = tot.tds > 0 ? (body.tdsLedger || 'TDS PAYABLE') : '';
  if (tdsLedger && !/TDS/i.test(tdsLedger)) throw badRequest('Select a TDS ledger');
  const voucher = [
    [body.vendorLedger, 0, round2(tot.total - tot.tds)], ['INPUT CGST', tot.cgst, 0], ['INPUT SGST', tot.sgst, 0], ['INPUT IGST', tot.igst, 0],
    [body.expenseLedger, tot.taxable, 0], [tdsLedger, 0, tot.tds],
  ].filter(([, dr, cr]) => dr || cr);
  const ledgerCodes = []; const missing = [];
  for (const [name] of voucher) { const code = await ledgerCode(user, name); if (!code) missing.push(`Ledger ${name} not found!`); ledgerCodes.push(code); }
  if (missing.length) throw new HttpError(422, 'Ledgers missing', missing.map((message) => ({ path: 'ledgers', message })));
  if (body.expenseLedger === body.vendorLedger) throw badRequest('The expense ledger cannot be the vendor ledger');
  const dr = round2(voucher.reduce((t, l) => t + l[1], 0)); const cr = round2(voucher.reduce((t, l) => t + l[2], 0));
  if (dr !== cr) throw new HttpError(422, `The voucher does not balance (Dr ${dr}, Cr ${cr})`);

  const [br] = await query('select short_code from branch_master where branch_code = @b', { b: user.currentBranch.code });
  const shortCode = s(br?.short_code); const fyShort = finYr(user.financialYear);
  const narration = body.narration || `Purchase from Vendor ${body.vendorLedger} , Purchase Amount : ${tot.taxable} ,CGST Amount : ${tot.cgst} ,SGST Amount : ${tot.sgst} ,IGST Amount : ${tot.igst}`;

  return withTransaction(async (tx) => {
    const prefix = `OTH${shortCode}${fyShort}`;
    const [last] = await query(
      `select top 1 InvoiceNo from OtherVendorInvoice with (updlock, holdlock) where InvoiceNo like @p + '%' and len(InvoiceNo) = len(@p) + 6
        order by InvoiceNo desc`, { p: prefix }, { tx });
    const invoiceNo = `${prefix}${String((last ? Number(s(last.InvoiceNo).slice(-6)) : 0) + 1).padStart(6, '0')}`;
    await query(
      `insert into OtherVendorInvoice(InvoiceNo, InvoiceDate, InvoiceFor, PartsType, VendorCode, VendorLedger, VendorInvNo, PurchaseDate,
         ExpenseLedger, TDSLedger, TaxType, Qty, TaxableAmt, CGSTAmt, SGSTAmt, IGSTAmt, BillAmt, TDS, TotTDS, AfterTDSAmt, Narration,
         IsAllocation, Branch_Code, ShortCode, FinYr, Financial_Year, Division, UserId)
       values (@no, @d, @for, @pt, @vc, @vl, @vin, @pd, @el, @tl, @tt, @qty, @taxable, @cgst, @sgst, @igst, @total, @tdsp, @tds, @after, @nar,
         @alloc, @b, @sc, @fys, @fy, @div, @u)`,
      {
        no: invoiceNo, d: body.invoiceDate, for: body.invoiceFor, pt: body.partType, vc: vendor.code, vl: ledgerCodes[0], vin: body.vendorInvNo,
        pd: body.purchaseDate || null, el: await ledgerCode(user, body.expenseLedger, tx), tl: tdsLedger ? await ledgerCode(user, tdsLedger, tx) : null,
        tt: body.taxType, qty: tot.qty, taxable: tot.taxable, cgst: tot.cgst, sgst: tot.sgst, igst: tot.igst, total: tot.total, tdsp: vendor.tds,
        tds: tot.tds, after: round2(tot.total - tot.tds), nar: narration, alloc: costs.length ? 1 : 0, b: user.currentBranch.code, sc: shortCode,
        fys: fyShort, ...fyDiv(user), u: user.userId,
      }, { tx });
    for (const l of lines) {
      await query(
        `insert into OtherVendorInvoice_Details(InvoiceNo, ItemCode, ItemSrNo, Quantity, Rate, TaxableAmt, TaxModeFor, TaxType, CGST, CGSTAmt,
           SGST, SGSTAmt, IGST, IGSTAmt, TotalAmount, ITDescription, TDSPrc, TDSAmt, AfterTDSAmt, PayableAmt)
         values (@no, @ic, @sn, @q, @r, @taxable, @slab, @tt, @cgst, @cgsta, @sgst, @sgsta, @igst, @igsta, @total, @desc, @tdsp, @tds, @after, @pay)`,
        {
          no: invoiceNo, ic: l.itemCode, sn: l.sacHsn, q: l.quantity, r: l.rate, taxable: l.taxable, slab: l.slabId, tt: body.taxType,
          cgst: l.cgst, cgsta: l.cgstAmt, sgst: l.sgst, sgsta: l.sgstAmt, igst: l.igst, igsta: l.igstAmt, total: l.total, desc: l.description,
          tdsp: l.tdsPct, tds: l.tdsAmt, after: l.afterTds, pay: l.payable,
        }, { tx });
    }
    for (const c of costs) {
      await query('insert into OtherVendorInvoiceCostProfit(InvoiceNo, CostProfit, Code, Name, Amount) values (@no, @t, @c, @n, @a)',
        { no: invoiceNo, t: c.type, c: c.code, n: c.name, a: c.amount }, { tx });
    }
    for (const [i, [, d, cAmt]] of voucher.entries()) {
      await query(
        `insert into tblAccountTrasaction(LedgerCode, Dr, Cr, CreatedDate, VoucherNo, Mode, Entry, Financial_Year, Division)
         values (@l, @dr, @cr, @d, @no, @mode, 'Ledger', @fy, @div)`,
        { l: ledgerCodes[i], dr: d, cr: cAmt, d: body.invoiceDate, no: invoiceNo, mode: MODE, ...fyDiv(user) }, { tx });
    }
    return { invoiceNo, totalAmount: tot.total, payable: round2(tot.total - tot.tds), message: `Invoice ${invoiceNo} saved` };
  });
}

// ------------------------------------------------------------------ list / view / cancel

const toInvoice = (r) => ({
  invoiceNo: s(r.InvoiceNo), invoiceDate: iso(r.InvoiceDate), invoiceFor: s(r.InvoiceFor), partType: s(r.PartsType),
  vendorCode: s(r.VendorCode), vendorName: s(r.vendor_name), vendorLedger: s(r.vendor_ledger), vendorInvNo: s(r.VendorInvNo),
  purchaseDate: iso(r.PurchaseDate), expenseLedger: s(r.expense_ledger), tdsLedger: s(r.tds_ledger), taxType: s(r.TaxType),
  quantity: n(r.Qty), taxable: n(r.TaxableAmt), cgstAmt: n(r.CGSTAmt), sgstAmt: n(r.SGSTAmt), igstAmt: n(r.IGSTAmt), total: n(r.BillAmt),
  tdsPct: n(r.TDS), tds: n(r.TotTDS), payable: n(r.AfterTDSAmt), narration: s(r.Narration), costCentre: Boolean(r.IsAllocation),
  status: r.IsCancelled ? 'Cancelled' : 'Active', createdBy: s(r.UserId), cancelledBy: s(r.CancelBy), cancelRemarks: s(r.CancelRemarks),
});
const SELECT = `select i.*, v.name as vendor_name, lv.LedgerName as vendor_ledger, le.LedgerName as expense_ledger, lt.LedgerName as tds_ledger
  from OtherVendorInvoice i left join Other_Vendor_Master v on v.vendor_code = i.VendorCode
  left join tblAccountLedger lv on lv.LedgerCode = i.VendorLedger left join tblAccountLedger le on le.LedgerCode = i.ExpenseLedger
  left join tblAccountLedger lt on lt.LedgerCode = i.TDSLedger`;

/** VehiclePartStockEntryDetails (V_VehiclePartStockEntry): the branch's invoices of the login year. */
export async function listInvoices(user, { from, to, status = 'all', search = '' }) {
  const rows = await query(
    `${SELECT} where i.Branch_Code = @b and i.Financial_Year = @fy and i.InvoiceDate between @from and @to
       and (@st = 'all' or (@st = 'Cancelled' and i.IsCancelled = 1) or (@st = 'Active' and i.IsCancelled = 0))
       and (@q = '' or i.InvoiceNo like '%' + @q + '%' or v.name like '%' + @q + '%' or i.VendorInvNo like '%' + @q + '%')
     order by i.InvoiceNo desc`, { b: user.currentBranch.code, fy: user.financialYear, from, to, st: status, q: search });
  return rows.map(toInvoice);
}

/** VOtherVendorInvoice + OtherVendorInvoiceCostProfit (OthVndInvoiceDetails) + the voucher. */
export async function getInvoice(user, invoiceNo) {
  const [r] = await query(
    `select x.*, br.branch_name, br.address as branch_address, br.Branch_Gstin_no, v.address as vendor_address, v.Gstin_No as vendor_gstin,
            v.pan_no as vendor_pan, v.vendor_phone_no
       from (${SELECT} where i.InvoiceNo = @no and i.Branch_Code = @b) x
       left join branch_master br on br.branch_code = x.Branch_Code left join Other_Vendor_Master v on v.vendor_code = x.VendorCode`,
    { no: invoiceNo, b: user.currentBranch.code });
  if (!r) throw notFound(`Invoice ${invoiceNo} not found at this branch`);
  const [lines, costs, voucher] = await Promise.all([
    query(`select d.*, p.ProductName, p.UOM, ts.Slab from OtherVendorInvoice_Details d left join ProductMaster p on p.ProductCode = d.ItemCode
             left join Misc_Tax_Slab ts on ts.SlNo = d.TaxModeFor where d.InvoiceNo = @no order by d.id`, { no: invoiceNo }),
    query('select * from OtherVendorInvoiceCostProfit where InvoiceNo = @no order by id', { no: invoiceNo }),
    query(`select t.LedgerCode, l.LedgerName, t.Dr, t.Cr, t.IsCancelled from tblAccountTrasaction t
             left join tblAccountLedger l on l.LedgerCode = t.LedgerCode where t.VoucherNo = @no and t.Mode = @mode order by t.Dr desc, t.Cr desc`,
    { no: invoiceNo, mode: MODE }),
  ]);
  return {
    ...toInvoice(r),
    branch: { code: s(r.Branch_Code), name: s(r.branch_name), address: s(r.branch_address), gstin: s(r.Branch_Gstin_no) },
    vendor: { code: s(r.VendorCode), name: s(r.vendor_name), address: s(r.vendor_address), gstin: s(r.vendor_gstin), pan: s(r.vendor_pan), phone: s(r.vendor_phone_no) },
    lines: lines.map((l) => ({
      itemCode: s(l.ItemCode), itemName: s(l.ProductName), uom: s(l.UOM), sacHsn: s(l.ItemSrNo), quantity: n(l.Quantity), rate: n(l.Rate),
      taxable: n(l.TaxableAmt), slab: s(l.Slab), cgst: n(l.CGST), cgstAmt: n(l.CGSTAmt), sgst: n(l.SGST), sgstAmt: n(l.SGSTAmt), igst: n(l.IGST),
      igstAmt: n(l.IGSTAmt), total: n(l.TotalAmount), description: s(l.ITDescription), tdsPct: n(l.TDSPrc), tdsAmt: n(l.TDSAmt), payable: n(l.PayableAmt),
    })),
    costCentres: costs.map((c) => ({ type: s(c.CostProfit), code: s(c.Code), name: s(c.Name), amount: n(c.Amount) })),
    voucher: voucher.map((v) => ({ ledgerCode: s(v.LedgerCode), ledger: s(v.LedgerName), dr: n(v.Dr), cr: n(v.Cr), cancelled: Boolean(v.IsCancelled) })),
  };
}

/** New: cancel an invoice and its voucher lines. */
export async function cancelInvoice(user, invoiceNo, remarks) {
  const inv = await getInvoice(user, invoiceNo);
  if (inv.status === 'Cancelled') throw conflict(`Invoice ${invoiceNo} is already cancelled`);
  await withTransaction(async (tx) => {
    await query(
      `update OtherVendorInvoice set IsCancelled = 1, CancelBy = @u, CancelDate = getdate(), CancelRemarks = @rem
        where InvoiceNo = @no and IsCancelled = 0`, { u: user.userId, rem: remarks, no: invoiceNo }, { tx });
    await query('update tblAccountTrasaction set IsCancelled = 1 where VoucherNo = @no and Mode = @mode and isnull(IsCancelled, 0) = 0',
      { no: invoiceNo, mode: MODE }, { tx });
  });
  return { invoiceNo, message: 'Invoice cancelled' };
}
