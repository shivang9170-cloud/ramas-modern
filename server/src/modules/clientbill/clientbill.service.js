// Client bill (GST) — port of Invoice/Client_Bill_GST.aspx (generate), Client_Bill_Cancel.aspx (cancel) and the bill
// views / prints (Client_Bill_PrintGST, Client_Bill_Print, client_bill_ReportGST, client_bill_Report). ClientBill_dal /
// Invoice_dal (bin/ClassLibrary.dll only).
//
// A contract client's dockets billed at this branch (billing at), booked in a date range, not yet billed, are picked and
// put on one bill: client_bill (header and totals) + client_bill_charge_details (one row per docket); the dockets are marked
// Invoice_status = 'invoicegenerated' with the bill no. Submission / finalize / receipt come later (bill life cycle:
// generated → submitted (ClientBill_Summation_status) → finalized (ClientBill_Finalize_status) → paid).
//
// Changes from the page (docs/MIGRATION.md "Client bill"):
//   * the dockets and every amount are re-read on the server — the page saved the amounts posted from its grid;
//   * the bill no. is taken inside the save's transaction (the page worked it out on load / search, so two users could get
//     the same number) and header, rows and docket flags are saved together;
//   * "Amount Mismatch, Plz Modify docket" (docket total ≠ freight + docket charge + other + fuel + GST + after-tax charges)
//     and "GST Amount not available" are checked for every docket on save, not only when a box was ticked;
//   * a docket already on another active bill is refused (the page checked client_bill_charge_details per row and returned
//     half-way through the save, leaving the transaction open);
//   * cancel is refused once the bill is submitted, finalized or paid (those checks were commented out on the cancel page)
//     and frees the dockets for a new bill;
//   * SQL is parameterised (bill no., docket nos. and client were concatenated).
import { config } from '../../config.js';
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { finYr } from '../pickup/pickup.service.js';
import { s, n, iso, today, round2 } from '../../utils/values.js';

const STATUS_SQL = `case when cb.client_bill_status is not null then 'Cancelled'
  when cb.Payment_Status = 1 then 'Paid'
  when exists (select 1 from Bill_Receive_Details r where r.Bill_no = cb.bill_no and r.IsCancelled = 0) then 'Part paid'
  when cb.ClientBill_Finalize_status = 'Finalized' then 'Finalized'
  when cb.ClientBill_Summation_status = 'Active' then 'Submitted' else 'Generated' end`;

export const BILL_TYPES = ['To Be Billed', 'Paid', 'To Pay'];
// bill no. prefix per bill type (the page's BillTypeShortCode P / T for Paid / To Pay bills)
const PREFIX = { 'To Be Billed': 'BL', Paid: 'BP', 'To Pay': 'BT' };

const addDays = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// ------------------------------------------------------------------ lookups

/** Service types and SAC codes (Sac_Master), booking modes. */
export async function options() {
  const [sac, modes] = await Promise.all([
    query('select ServiceType, SubServiceType, Sac_Code from Sac_Master order by id'),
    query('select mode_code, mode_name from mode_master order by mode_name'),
  ]);
  return {
    serviceTypes: sac.map((r) => ({ value: s(r.ServiceType), label: s(r.ServiceType), subType: s(r.SubServiceType), sacCode: s(r.Sac_Code) })),
    bookingModes: modes.map((r) => ({ value: s(r.mode_code), label: s(r.mode_name) })),
    taxTypes: ['GST', 'IGST', 'NA'],
    billTypes: BILL_TYPES,
    deliveryStatus: [{ value: 'All', label: 'All' }, { value: 'DLVRD', label: 'Delivered' }, { value: 'UNDELIVERED', label: 'Undelivered' }],
  };
}

/**
 * GetClients + select_ClientDetails + GetTaxType: the branch's active clients of the division (head office: all), with
 * the billing address, credit period (due date) and the tax type — GST when the client's state is the branch's, else IGST.
 */
export async function searchClients(user, term) {
  const branch = user.currentBranch.code;
  const rows = await query(
    `select top 20 cm.client_Id, cm.client_code, cm.company_name, cm.address, cm.place, cm.credit_period, cm.Gstin_No,
            cs.state_code as client_state, bs.state_code as branch_state
       from client_Master cm
       left join city_master cs on cs.city_code = cm.city
       left join branch_master b on b.branch_code = @b
       left join city_master bs on bs.city_code = b.city_code
      where isnull(cm.is_Active, 1) = 1 and (cm.company_name like @t or cm.client_code like @t)
        and (@b = @ho or cm.Branch_Code = @b)
        and (@div = '' or ',' + isnull(cm.DivCode, '') + ',' like '%,' + @div + ',%')
      order by cm.company_name`,
    { t: `%${term}%`, b: branch, ho: config.headOfficeBranch, div: s(user.divCode) });
  return rows.map((r) => ({
    id: Number(r.client_Id), code: s(r.client_code), name: s(r.company_name),
    address: [s(r.address), s(r.place)].filter(Boolean).join(', '), gstin: s(r.Gstin_No), creditPeriod: n(r.credit_period),
    taxType: s(r.client_state) && s(r.client_state) === s(r.branch_state) ? 'GST' : 'IGST',
  }));
}

/**
 * client_topay_paid_bill: the party of a Paid bill is the consignor, of a To Pay bill the consignee (consigner_master,
 * VConsignorConsignee); select_ClientDetailsPaidToPay gives the address and GSTIN. A party that is also a client keeps its
 * client id (its BILLED ledger is then used — "client wise").
 */
export async function searchParties(user, term, billType = 'To Be Billed') {
  if (billType === 'To Be Billed') return searchClients(user, term);
  const rows = await query(
    `select top 20 p.consigner_code, p.company_name, p.address, p.city, p.pin_code, p.GSTIN_No, cm.client_Id, cm.credit_period,
            cs.state_code as party_state, bs.state_code as branch_state
       from consigner_master p
       left join client_Master cm on cm.client_code = p.consigner_code
       left join city_master cs on cs.city_name = p.city or cs.city_code = p.city
       left join branch_master b on b.branch_code = @b
       left join city_master bs on bs.city_code = b.city_code
      where (p.company_name like @t or p.consigner_code like @t) order by p.company_name`,
    { t: `%${term}%`, b: user.currentBranch.code });
  return rows.map((r) => ({
    id: r.client_Id === null || r.client_Id === undefined ? null : Number(r.client_Id), code: s(r.consigner_code), name: s(r.company_name),
    address: [s(r.address), s(r.city), s(r.pin_code)].filter(Boolean).join(', '), gstin: s(r.GSTIN_No), creditPeriod: n(r.credit_period),
    taxType: s(r.party_state) && s(r.party_state) === s(r.branch_state) ? 'GST' : 'IGST',
  }));
}

async function partyByCode(user, code, billType) {
  const rows = await searchParties(user, code, billType);
  const c = rows.find((r) => r.code === code);
  if (!c) throw badRequest(billType === 'To Be Billed' ? 'Select a client of this branch' : 'Select Client Name');
  return c;
}

// ------------------------------------------------------------------ dockets to bill

/**
 * SEARCH_DOCKET_DETAILS_FOR_CLIENT_BILL(_CITYWISE): the client's contract dockets billed at this branch, not yet billed,
 * with amounts > 0 and a rate / freight type, of the tax type, booked in the range (optionally a docket list, booking mode,
 * delivered / undelivered, origin city → destination city).
 */
export async function pendingDockets(user, q) {
  const params = {
    code: q.clientCode, branch: user.currentBranch.code, div: s(user.divCode), from: q.from, to: q.to,
    tax: q.taxType ?? '', mode: q.bookingMode ?? '', dl: q.delivery ?? 'All', oc: q.fromCity ?? '', dc: q.toCity ?? '',
    bt: q.billType ?? 'To Be Billed',
  };
  // To Be Billed: the client's contract dockets billed at this branch (SEARCH_DOCKET_DETAILS_FOR_CLIENT_BILL);
  // Paid: the consignor's Paid dockets booked here; To Pay: the consignee's To Pay dockets delivered from here
  // (SEARCH_DOCKET_DETAILS_FOR_CLIENT_BILL_PAIDTOPAY).
  const party = `((@bt = 'To Be Billed' and right(g.on_account_of, len(@code) + 1) = ':' + @code and g.customer_type = 'Contractual Client'
                    and g.billing_at = @branch)
               or (@bt = 'Paid' and g.booking_type = 'Paid' and g.consigner_code = @code and g.origin_branch = @branch)
               or (@bt = 'To Pay' and g.booking_type = 'To Pay' and g.consignee_code = @code and g.destination_branch = @branch))`;
  let list = '';
  if (q.dockets?.length) list = ` and g.docket_no in (${q.dockets.map((d, i) => { params[`d${i}`] = d; return `@d${i}`; }).join(',')})`;
  const rows = await query(
    `select g.docket_no, g.ManualDocketNo, g.booking_date, g.booking_mode, g.destination, g.gstPaidBy, g.StaxBy, oc.city_name as origin,
            c.pcs, c.charge_weight, c.docket_rate, c.rate_on, c.freight, c.docket_charge, c.other_charge, c.service_tax, c.s_tax,
            c.CGST_Tax, c.CGST_Amt, c.SGST_Tax, c.SGST_Amt, c.charges,
            isnull(o.sour_charge, 0) as fuel, isnull(o.FuelChargePercent, 0) as fuel_per,
            (select isnull(sum(e.Charge_Amount), 0) from docket_charge_entry e where e.Docket_No = g.docket_no and e.IsTax = 1) as after_tax,
            (select string_agg(i.invoice_no, ',') from docket_invoice i where i.docketNo = g.docket_no) as invoices,
            case when exists (select 1 from delivery_status_entry_details d where d.docket_no = g.docket_no and d.pkt_status = 'DLVRD'
                                and isnull(d.IsCancelled, 0) = 0) then 1 else 0 end as delivered
       from grn_master g
       join grn_docket_charge c on c.Docket_No = g.docket_no and isnull(c.rate_on, '') <> ''
       left join docket_other_charges o on o.docket = g.docket_no
       left join branch_master ob on ob.branch_code = g.origin_branch
       left join city_master oc on oc.city_code = ob.city_code
      where ${party} and isnull(g.Invoice_status, '') = '' and isnull(g.bill_no, '') = ''
        and isnull(g.grn_cancel_status, '') = '' and cast(isnull(g.IsCancel, 0) as varchar(5)) in ('0', 'false')
        and c.charges > 0 and isnull(c.freight_type, '') <> ''
        and g.booking_date between @from and @to and (@div = '' or g.DivCode = @div)
        and (@tax = '' or g.StaxBy = @tax) and (@mode = '' or g.booking_mode = @mode)
        and (@oc = '' or ob.city_code = @oc) and (@dc = '' or g.destination = @dc)
        and not exists (select 1 from client_bill_charge_details x join client_bill b on b.bill_no = x.bill_no
                         where x.docket_no = g.docket_no and b.client_bill_status is null) ${list}
      order by g.booking_date, g.docket_no`, params);
  return rows
    .filter((r) => params.dl === 'All' || (params.dl === 'DLVRD' ? r.delivered : !r.delivered))
    .map((r) => {
      const taxType = s(r.StaxBy) || 'NA';
      const freight = n(r.freight); const docketCharge = n(r.docket_charge); const other = n(r.other_charge); const fuel = n(r.fuel);
      const cgst = taxType === 'GST' ? n(r.CGST_Amt) : 0;
      const sgst = taxType === 'GST' ? n(r.SGST_Amt) : 0;
      const igst = taxType === 'IGST' ? n(r.service_tax) : 0;
      const tax = round2(cgst + sgst + igst);
      const afterTax = n(r.after_tax);
      const total = n(r.charges);
      const reverse = s(r.gstPaidBy) === 'Billing Party';
      const expected = round2(freight + docketCharge + other + fuel + (reverse ? 0 : tax) + afterTax);
      const problems = [];
      // cbSelect_CheckedChanged: "Amount Mismatch, Plz Modify docket !!!"
      if (Math.abs(total - expected) >= 1) problems.push(`amount mismatch (total ${total}, charges ${expected}) — modify the docket`);
      // btnsubmit_Click: GST dockets of DIV1001 with no CGST amount
      if (taxType === 'GST' && cgst === 0 && s(user.divCode) === 'DIV1001') problems.push('GST amount not available');
      return {
        docketNo: s(r.docket_no), manualNo: s(r.ManualDocketNo), bookingDate: iso(r.booking_date), bookingMode: s(r.booking_mode),
        origin: s(r.origin), destination: s(r.destination), invoiceNos: s(r.invoices), rateOn: s(r.rate_on),
        packages: n(r.pcs), weight: n(r.charge_weight), rate: n(r.docket_rate),
        freight, docketCharge, otherCharge: other, fuel, fuelPercent: n(r.fuel_per),
        taxType, cgstRate: n(r.CGST_Tax), cgst, sgstRate: n(r.SGST_Tax), sgst, igstRate: taxType === 'IGST' ? n(r.s_tax) : 0, igst,
        tax, afterTax, total, gstPaidBy: s(r.gstPaidBy), delivered: Boolean(r.delivered), problems,
      };
    });
}

// ------------------------------------------------------------------ create

const sum = (rows, k) => round2(rows.reduce((t, r) => t + (Number(r[k]) || 0), 0));

/** btnsubmit_Click → sp_insert_Client_Bill_Bulk (client_topay_paid_bill: sp_insert_Client_Bill_PaidToPay_Bulk). */
export async function createBill(user, body) {
  const branch = user.currentBranch.code;
  const now = today();
  if (body.billDate > now) throw badRequest('Bill date should not be greater than current date');
  if (body.billDate < addDays(now, -10)) throw badRequest('Bill date can be at most 10 days back');
  const fy = financialYearRange(user.financialYear);
  if (fy && (body.billDate < fy.from || body.billDate > fy.to)) throw badRequest('Bill date must be in the login financial year');
  if (body.to > body.billDate) throw badRequest('Search to date must not be after the bill date');
  if (new Set(body.dockets).size !== body.dockets.length) throw badRequest('The same docket is listed twice');
  const billType = body.billType ?? 'To Be Billed';
  const client = await partyByCode(user, body.clientCode, billType);
  const dueDate = body.dueDate || addDays(body.billDate, client.creditPeriod);
  if (dueDate < body.billDate) throw badRequest('Bill date should not be greater than due date');

  const found = await pendingDockets(user, {
    clientCode: client.code, from: body.from, to: body.to, taxType: body.taxType, bookingMode: body.bookingMode, dockets: body.dockets, billType,
  });
  const byNo = new Map(found.map((d) => [d.docketNo, d]));
  const problems = [];
  for (const no of body.dockets) {
    const d = byNo.get(no);
    if (!d) problems.push(`${no}: not a pending ${body.taxType} ${billType === 'To Be Billed' ? 'docket of this client billed' : `${billType} docket of this party`} at this branch in the date range`);
    else for (const p of d.problems) problems.push(`${no}: ${p}`);
  }
  if (problems.length) throw new HttpError(422, 'Some dockets cannot be billed', problems.map((message) => ({ path: 'dockets', message })));
  const rows = body.dockets.map((no) => byNo.get(no));

  const [b] = await query('select short_code from branch_master where branch_code = @b', { b: branch });
  const shortCode = s(b?.short_code);
  const fyShort = finYr(user.financialYear);
  const sac = (await query('select top 1 Sac_Code, SubServiceType from Sac_Master where ServiceType = @t', { t: body.serviceType }))[0];

  return withTransaction(async (tx) => {
    // GET_AUTO_GENERATED_CODE_FOR_CLIENT_BILL
    const prefix = `${PREFIX[billType]}${shortCode}${fyShort}`;
    const [last] = await query(
      `select top 1 bill_no from client_bill with (updlock, holdlock)
        where bill_no like @p + '%' and len(bill_no) = len(@p) + 6 order by bill_no desc`, { p: prefix }, { tx });
    const billNo = `${prefix}${String((last ? Number(s(last.bill_no).slice(-6)) : 0) + 1).padStart(6, '0')}`;
    // the dockets may not have gone on another bill since they were read
    const taken = await query(
      `select docket_no from grn_master with (updlock, holdlock)
        where docket_no in (select value from string_split(@list, ',')) and (isnull(Invoice_status, '') <> '' or isnull(bill_no, '') <> '')`,
      { list: body.dockets.join(',') }, { tx });
    if (taken.length) throw conflict(`Already billed: ${taken.map((t) => s(t.docket_no)).join(', ')}`);

    const totals = {
      freight: sum(rows, 'freight'), docketCharge: sum(rows, 'docketCharge'), other: sum(rows, 'otherCharge'), fuel: sum(rows, 'fuel'),
      cgst: sum(rows, 'cgst'), sgst: sum(rows, 'sgst'), igst: sum(rows, 'igst'), tax: sum(rows, 'tax'), afterTax: sum(rows, 'afterTax'),
      total: sum(rows, 'total'),
    };
    await query(
      `insert into client_bill(bill_no, bill_date, DueDate, client_Id, client_code, docket_no, Invoice_no, totalfreight, Total_docket_charge,
         Total_other_charge, Furelcharge_Amount, Furelcharge_Per, totalstax, TotCGST, TotSGST, TotIGST, TotAfterTax, totalamount, booking_mode,
         address, origin_branch, Financial_Year, user_id, ShortCode, FinYr, manual_bill_no, remarks, division, docs_enclosed, RateOn,
         BillType, StaxRemark, FromDate, ToDate, SacCode, ServiceType, Bill_Type)
       values (@no, @bd, @due, @cid, @cc, @dockets, @inv, @frt, @dc, @oth, @fuel, 0, @tax, @cgst, @sgst, @igst, @after, @total, @mode,
         @addr, @branch, @fy, @u, @sc, @fys, @manual, @rem, @div, @docs, @rateOn, @bt, @taxType, @from, @to, @sac, @st, @billType)`,
      {
        no: billNo, bd: body.billDate, due: dueDate, cid: client.id, cc: client.code, dockets: body.dockets.join(','),
        inv: rows.map((r) => r.invoiceNos).filter(Boolean).join(','), frt: totals.freight, dc: totals.docketCharge, oth: totals.other,
        fuel: totals.fuel, tax: totals.tax, cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst, after: totals.afterTax, total: totals.total,
        mode: body.bookingMode, addr: body.address || client.address, branch, fy: user.financialYear, u: user.userId, sc: shortCode,
        fys: fyShort, manual: body.manualBillNo, rem: body.remarks, div: s(user.divCode), docs: body.docsEnclosed, rateOn: body.rateOn,
        bt: { GST: 2, IGST: 3 }[body.taxType] ?? 2, taxType: body.taxType, from: body.from, to: body.to,
        sac: s(sac?.Sac_Code), st: body.serviceType, billType,
      }, { tx });
    for (const r of rows) {
      await query(
        `insert into client_bill_charge_details(bill_no, docket_no, amount, booking_date, package, weight, rate, RateOn, Invoice_no,
           freight_charges, docket_charge, other_charges, Furelcharge_Amount, Furelcharge_Per, stax, CGST_Tax, CGST_Amt, SGST_Tax, SGST_Amt,
           IGST_Tax, IGST_Amt, after_tax, grand_total, Taxtype)
         values (@no, @d, @total, @bd, @p, @w, @rate, @ro, @inv, @frt, @dc, @oth, @fuel, @fp, @tax, @ct, @ca, @st, @sa, @it, @ia, @after, @total, @tt)`,
        {
          no: billNo, d: r.docketNo, total: r.total, bd: r.bookingDate, p: r.packages, w: r.weight, rate: r.rate, ro: r.rateOn, inv: r.invoiceNos,
          frt: r.freight, dc: r.docketCharge, oth: r.otherCharge, fuel: r.fuel, fp: r.fuelPercent, tax: r.tax, ct: r.cgstRate, ca: r.cgst,
          st: r.sgstRate, sa: r.sgst, it: r.igstRate, ia: r.igst, after: r.afterTax, tt: r.taxType,
        }, { tx });
    }
    await query(
      `update grn_master set Invoice_status = 'invoicegenerated', bill_no = @no where docket_no in (select value from string_split(@list, ','))`,
      { no: billNo, list: body.dockets.join(',') }, { tx });
    await query(
      `insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog, Origin)
       select value, 'BILL', 'Billed on ' + @no, getdate(), @u, @b from string_split(@list, ',')`,
      { no: billNo, u: user.userId, b: branch, list: body.dockets.join(',') }, { tx });
    return { billNo, billType, dockets: rows.length, totalAmount: totals.total, dueDate, message: `Bill ${billNo} generated for ${rows.length} docket(s)` };
  });
}

// ------------------------------------------------------------------ list / view

/** Client bill list (Client_Bill_Cancel grid, client_bill_ReportGST): the branch's bills of the login year. */
export async function listBills(user, { from, to, status = 'active', search = '', billType = '' }) {
  const rows = await query(
    `select cb.bill_no, cb.bill_date, cb.DueDate, cb.client_code, coalesce(cm.company_name, pm.company_name) as company_name, cb.totalamount,
            cb.StaxRemark, cb.user_id, cb.Bill_Type,
            (select count(*) from client_bill_charge_details d where d.bill_no = cb.bill_no) as dockets, ${STATUS_SQL} as status
       from client_bill cb left join client_Master cm on cm.client_Id = cb.client_Id
       left join consigner_master pm on pm.consigner_code = cb.client_code and cb.client_Id is null
      where cb.origin_branch = @b and (@div = '' or cb.division = @div) and cb.Financial_Year = @fy
        and cb.bill_date between @from and @to
        and ((@st = 'cancelled' and cb.client_bill_status is not null) or (@st = 'active' and cb.client_bill_status is null))
        and (@bt = '' or isnull(cb.Bill_Type, 'To Be Billed') = @bt)
        and (@q = '' or cb.bill_no like '%' + @q + '%' or coalesce(cm.company_name, pm.company_name) like '%' + @q + '%')
      order by cb.bill_no desc`,
    { b: user.currentBranch.code, div: s(user.divCode), fy: user.financialYear, from, to, st: status, q: search, bt: billType });
  return rows.map((r) => ({
    billNo: s(r.bill_no), billDate: iso(r.bill_date), dueDate: iso(r.DueDate), clientCode: s(r.client_code), clientName: s(r.company_name),
    totalAmount: n(r.totalamount), taxType: s(r.StaxRemark), dockets: n(r.dockets), status: s(r.status), createdBy: s(r.user_id),
    billType: s(r.Bill_Type) || 'To Be Billed',
  }));
}

/** GetClient_Bill_Detail: header, client, branch and docket rows (view and print). */
export async function getBill(user, billNo) {
  const [h] = await query(
    `select cb.*, ${STATUS_SQL} as status, coalesce(cm.company_name, pm.company_name) as company_name,
            coalesce(cm.Gstin_No, pm.GSTIN_No) as client_gstin, cm.place, coalesce(cs.state_name, ps.state_name) as client_state,
            b.branch_name, b.address as branch_address, b.phone as branch_phone, b.Branch_Gstin_no, bs.state_name as branch_state
       from client_bill cb
       left join client_Master cm on cm.client_Id = cb.client_Id
       left join city_master cc on cc.city_code = cm.city left join state_master cs on cs.state_code = cc.state_code
       left join consigner_master pm on pm.consigner_code = cb.client_code and cb.client_Id is null
       left join city_master pc on pc.city_name = pm.city or pc.city_code = pm.city left join state_master ps on ps.state_code = pc.state_code
       left join branch_master b on b.branch_code = cb.origin_branch
       left join state_master bs on bs.state_code = b.state_code
      where cb.bill_no = @no`, { no: billNo });
  if (!h || (s(h.origin_branch) !== user.currentBranch.code && user.role !== 'admin')) throw notFound(`Bill ${billNo} not found at this branch`);
  const rows = await query(
    `select d.*, g.ManualDocketNo, g.destination, g.consignee_name, oc.city_name as origin
       from client_bill_charge_details d
       left join grn_master g on g.docket_no = d.docket_no
       left join branch_master ob on ob.branch_code = g.origin_branch left join city_master oc on oc.city_code = ob.city_code
      where d.bill_no = @no order by d.booking_date, d.docket_no`, { no: billNo });
  return {
    billNo: s(h.bill_no), billDate: iso(h.bill_date), dueDate: iso(h.DueDate), status: s(h.status), taxType: s(h.StaxRemark),
    billType: s(h.Bill_Type) || 'To Be Billed',
    client: { code: s(h.client_code), name: s(h.company_name), address: s(h.address), gstin: s(h.client_gstin), state: s(h.client_state) },
    branch: { code: s(h.origin_branch), name: s(h.branch_name), address: s(h.branch_address), phone: s(h.branch_phone), gstin: s(h.Branch_Gstin_no), state: s(h.branch_state) },
    serviceType: s(h.ServiceType), sacCode: s(h.SacCode), bookingMode: s(h.booking_mode), rateOn: s(h.RateOn),
    from: iso(h.FromDate), to: iso(h.ToDate), manualBillNo: s(h.manual_bill_no), remarks: s(h.remarks), docsEnclosed: s(h.docs_enclosed),
    createdBy: s(h.user_id), cancelledBy: s(h.CancelBy),
    totals: {
      freight: n(h.totalfreight), docketCharge: n(h.Total_docket_charge), other: n(h.Total_other_charge), fuel: n(h.Furelcharge_Amount),
      cgst: n(h.TotCGST), sgst: n(h.TotSGST), igst: n(h.TotIGST), tax: n(h.totalstax), afterTax: n(h.TotAfterTax), total: n(h.totalamount),
    },
    dockets: rows.map((r) => ({
      docketNo: s(r.docket_no), manualNo: s(r.ManualDocketNo), bookingDate: iso(r.booking_date), origin: s(r.origin), destination: s(r.destination),
      consignee: s(r.consignee_name), invoiceNos: s(r.Invoice_no), rateOn: s(r.RateOn), packages: n(r.package), weight: n(r.weight), rate: n(r.rate),
      freight: n(r.freight_charges), docketCharge: n(r.docket_charge), otherCharge: n(r.other_charges), fuel: n(r.Furelcharge_Amount),
      cgst: n(r.CGST_Amt), sgst: n(r.SGST_Amt), igst: n(r.IGST_Amt), afterTax: n(r.after_tax), total: n(r.grand_total),
    })),
  };
}

// ------------------------------------------------------------------ cancel

/** Client_Bill_Cancel: INSERT_INTO_CLIENT_BILL_CANCEL(_DETAIL) + client_bill_Cancel; the dockets can be billed again. */
export async function cancelBill(user, billNo, remarks) {
  const bill = await getBill(user, billNo);
  if (bill.status === 'Cancelled') throw conflict('Bill No. already cancelled');
  if (bill.status !== 'Generated') throw conflict(`Bill ${billNo} is ${bill.status.toLowerCase()} and cannot be cancelled`);
  const [h] = await query('select client_Id, docket_no from client_bill where bill_no = @no', { no: billNo });
  await withTransaction(async (tx) => {
    await query(
      `insert into client_bill_cancel(cancel_bill_no, cancel_bill_date, cancel_bill_time, client_Id, totalamount, docket_no, CancelBy,
         billCancel_Remarks, origin_branch, division, Financial_Year)
       values (@no, cast(getdate() as date), convert(varchar(5), getdate(), 108), @cid, @amt, @dockets, @u, @rem, @b, @div, @fy)`,
      { no: billNo, cid: h.client_Id, amt: bill.totals.total, dockets: s(h.docket_no), u: user.userId, rem: remarks,
        b: user.currentBranch.code, div: s(user.divCode), fy: user.financialYear }, { tx });
    await query("update client_bill set client_bill_status = 'bill_cancel', CancelBy = @u, CancelDate = getdate() where bill_no = @no",
      { u: user.userId, no: billNo }, { tx });
    await query("update client_bill_charge_details set client_bill_status = 'bill_cancel' where bill_no = @no", { no: billNo }, { tx });
    await query("update grn_master set Invoice_status = null, bill_no = null where bill_no = @no", { no: billNo }, { tx });
    await query(
      `insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog)
       select docket_no, 'BILL', 'Bill ' + @no + ' cancelled', getdate(), @u from client_bill_charge_details where bill_no = @no`,
      { no: billNo, u: user.userId }, { tx });
  });
  return { billNo, message: 'Bill cancelled successfully' };
}
