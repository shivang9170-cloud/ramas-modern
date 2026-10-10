// Octroi bills — port of Invoice/Octroi_Bills.aspx (octroi paid on a client's dockets, billed back with a service charge),
// Octroi_Bill_Summation (submission), Octroi_Bill_Cancel, Octroi_Bill_Report and Octroi_Bill_Print. octroi_Bill_bal / _dal
// (bin/ClassLibrary.dll). OctroBillFinalise.aspx is an empty page — octroi bills had no finalize and no voucher.
//
// The client's dockets booked at this branch (on account of the client, not on another octroi bill) are picked; per docket:
// octroi amount paid, other charges, service charge % of the octroi and tax % on the service charge + other charges; one
// octroi receipt no. per bill (unique). The dockets get Octroi_Status = 'invoicegenerated' and the bill no.
//
// Changes from the page (docs/MIGRATION.md "Octroi bills"):
//   * amounts are worked out on the server (the page saved its text boxes, and the header total was saved as 0 before the
//     rows were added);
//   * the old service tax, Swachh Bharat cess and Krishi Kalyan cess columns (SBC / KKC) are one "tax %" — octroi itself ended
//     with GST in 2017, so the bills here are for completeness / old data;
//   * the bill no. (OB + short code + FY + 6 digits) is taken inside the save (the page's "OB-yy-n" took the max of all years);
//   * the octroi no. and the dockets are checked again inside the save; cancel frees the dockets.
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { finYr } from '../pickup/pickup.service.js';
import { s, n, iso, today, round2 } from '../../utils/values.js';

const STATUS = `case when b.OctroiBill_Cancel_status is not null then 'Cancelled' when isnull(b.mr_status, '') <> '' then 'Received'
  when b.OctroiBill_Summation_status = 'Active' then 'Submitted' else 'Generated' end`;

/** bind_client: active clients of the division (any branch — the dockets must be booked here). */
export async function clients(user, term) {
  const rows = await query(
    `select top 20 client_code, company_name from client_Master where isnull(is_Active, 1) = 1 and (company_name like @t or client_code like @t)
        and (@div = '' or ',' + isnull(DivCode, '') + ',' like '%,' + @div + ',%') order by company_name`,
    { t: `%${term}%`, div: s(user.divCode) });
  return rows.map((r) => ({ code: s(r.client_code), name: s(r.company_name) }));
}
/** select_docket_no_generate_Client_Bill: the client's dockets booked here, not on an active octroi bill. */
export async function pendingDockets(user, { clientCode, from, to, bookingMode = '', dockets = [] }) {
  const params = { c: clientCode, b: user.currentBranch.code, from, to, mode: bookingMode, div: s(user.divCode) };
  let list = '';
  if (dockets.length) list = ` and g.docket_no in (${dockets.map((d, i) => { params[`d${i}`] = d; return `@d${i}`; }).join(',')})`;
  const rows = await query(
    `select g.docket_no, g.booking_date, g.booking_mode, g.destination, c.pcs, c.charge_weight, c.charges,
            (select string_agg(i.invoice_no, ',') from docket_invoice i where i.docketNo = g.docket_no) as invoices
       from grn_master g join grn_docket_charge c on c.Docket_No = g.docket_no and isnull(c.rate_on, '') <> ''
      where right(g.on_account_of, len(@c) + 1) = ':' + @c and g.origin_branch = @b
        and isnull(g.grn_cancel_status, '') = '' and cast(isnull(g.IsCancel, 0) as varchar(5)) in ('0', 'false')
        and isnull(g.Octroi_Bill_No, '') = '' and g.booking_date between @from and @to
        and (@mode = '' or g.booking_mode = @mode) and (@div = '' or g.DivCode = @div) ${list}
      order by g.booking_date, g.docket_no`, params);
  return rows.map((r) => ({
    docketNo: s(r.docket_no), bookingDate: iso(r.booking_date), bookingMode: s(r.booking_mode), destination: s(r.destination),
    invoiceNos: s(r.invoices), packages: n(r.pcs), weight: n(r.charge_weight), freight: n(r.charges),
  }));
}

/** One row: service charge = octroi × %; tax on (service charge + other charges); total = octroi + other + charge + tax. */
export function rowAmounts({ octroiAmount, otherCharges = 0, chargePercent = 0, taxPercent = 0 }) {
  const charge = round2(octroiAmount * chargePercent / 100);
  const tax = round2((charge + otherCharges) * taxPercent / 100);
  return { charge, tax, total: round2(octroiAmount + otherCharges + charge + tax) };
}

export async function createBill(user, body) {
  const fy = financialYearRange(user.financialYear);
  if (body.billDate > today()) throw badRequest('Bill date should not be greater than current date');
  if (fy && (body.billDate < fy.from || body.billDate > fy.to)) throw badRequest('Bill date must be in the login financial year');
  if (new Set(body.rows.map((r) => r.docketNo)).size !== body.rows.length) throw badRequest('Docket_No has AllReady Exist');
  const [client] = await query(
    'select client_Id, client_code, company_name, address, place from client_Master where client_code = @c and isnull(is_Active, 1) = 1',
    { c: body.clientCode });
  if (!client) throw badRequest('Select the client');   // bind_client listed every client; the dockets must be booked here
  const found = new Map((await pendingDockets(user, {
    clientCode: body.clientCode, from: fy?.from ?? '2000-01-01', to: body.billDate, dockets: body.rows.map((r) => r.docketNo),
  })).map((d) => [d.docketNo, d]));
  const missing = body.rows.filter((r) => !found.has(r.docketNo)).map((r) => `${r.docketNo}: not a docket of this client booked here, or already on an octroi bill`);
  if (missing.length) throw new HttpError(422, 'Some dockets cannot be billed', missing.map((message) => ({ path: 'rows', message })));
  const rows = body.rows.map((r) => ({ ...r, ...rowAmounts(r), d: found.get(r.docketNo) }));
  const total = round2(rows.reduce((t, r) => t + r.total, 0));
  const [br] = await query('select short_code from branch_master where branch_code = @b', { b: user.currentBranch.code });
  const shortCode = s(br?.short_code); const fyShort = finYr(user.financialYear);

  return withTransaction(async (tx) => {
    // Selcet_Detail_of_octroi_Check: "Octroi No Already Exists!!"
    const [dup] = await query('select top 1 bill_no from octroi_bill with (updlock, holdlock) where octroi_no = @o and OctroiBill_Cancel_status is null',
      { o: body.octroiNo }, { tx });
    if (dup) throw conflict(`Octroi No already exists on bill ${s(dup.bill_no)}`);
    const prefix = `OB${shortCode}${fyShort}`;
    const [last] = await query(
      `select top 1 bill_no from octroi_bill with (updlock, holdlock) where bill_no like @p + '%' and len(bill_no) = len(@p) + 6 order by bill_no desc`,
      { p: prefix }, { tx });
    const billNo = `${prefix}${String((last ? Number(s(last.bill_no).slice(-6)) : 0) + 1).padStart(6, '0')}`;
    const taken = await query(
      `select docket_no from grn_master with (updlock, holdlock) where docket_no in (select value from string_split(@l, ',')) and isnull(Octroi_Bill_No, '') <> ''`,
      { l: body.rows.map((r) => r.docketNo).join(',') }, { tx });
    if (taken.length) throw conflict(`Bill has Generated: ${taken.map((t) => s(t.docket_no)).join(', ')}`);
    await query(
      `insert into octroi_bill(bill_no, bill_date, client_Id, client_code, client_name, docket_no, booking_mode, address, octroi_no, totalamount,
         remarks, origin_branch, billing_at, Financial_Year, Division, user_id, ShortCode, FinYr)
       values (@no, @d, @cid, @cc, @cn, @dockets, @mode, @addr, @o, @total, @rem, @b, @b, @fy, @div, @u, @sc, @fys)`,
      {
        no: billNo, d: body.billDate, cid: Number(client.client_Id), cc: s(client.client_code), cn: `${s(client.company_name)} :${s(client.client_code)}`,
        dockets: rows.map((r) => r.docketNo).join(','), mode: body.bookingMode, addr: [s(client.address), s(client.place)].filter(Boolean).join(', '),
        o: body.octroiNo, total, rem: body.remarks, b: user.currentBranch.code, fy: user.financialYear, div: s(user.divCode), u: user.userId,
        sc: shortCode, fys: fyShort,
      }, { tx });
    for (const r of rows) {
      await query(
        `insert into octroi_bill_charge_details(bill_no, docket_no, booking_date, Invoice_no, package, weight, OctroiAmount, OtherCharges,
           OctroiCharges_Per, OctroiCharges_Amount, Service_Tax, ServiceTax_Amount, totalamount, octroi_no)
         values (@no, @dk, @bd, @inv, @p, @w, @oa, @oc, @cp, @ca, @tp, @ta, @t, @o)`,
        {
          no: billNo, dk: r.docketNo, bd: r.d.bookingDate, inv: r.d.invoiceNos, p: r.d.packages, w: r.d.weight, oa: r.octroiAmount,
          oc: r.otherCharges, cp: r.chargePercent, ca: r.charge, tp: r.taxPercent, ta: r.tax, t: r.total, o: body.octroiNo,
        }, { tx });
    }
    await query(
      `update grn_master set Octroi_Status = 'invoicegenerated', Octroi_Bill_No = @no where docket_no in (select value from string_split(@l, ','))`,
      { no: billNo, l: rows.map((r) => r.docketNo).join(',') }, { tx });
    return { billNo, totalAmount: total, dockets: rows.length, message: `Octroi bill ${billNo} generated` };
  });
}

export async function listBills(user, { from, to, status = 'all', search = '' }) {
  const rows = await query(
    `select b.*, ${STATUS} as status, (select count(*) from octroi_bill_charge_details d where d.bill_no = b.bill_no) as dockets
       from octroi_bill b where b.origin_branch = @b and b.Financial_Year = @fy and b.bill_date between @from and @to
        and (@st = 'all' or (${STATUS}) = @st)
        and (@q = '' or b.bill_no like '%' + @q + '%' or b.client_name like '%' + @q + '%' or b.octroi_no like '%' + @q + '%')
      order by b.bill_no desc`,
    { b: user.currentBranch.code, fy: user.financialYear, from, to, st: status, q: search });
  return rows.map((r) => ({
    billNo: s(r.bill_no), billDate: iso(r.bill_date), clientCode: s(r.client_code), clientName: s(r.client_name), octroiNo: s(r.octroi_no),
    dockets: n(r.dockets), totalAmount: n(r.totalamount), status: s(r.status), createdBy: s(r.user_id),
  }));
}

export async function getBill(user, billNo) {
  const [h] = await query(
    `select b.*, ${STATUS} as status, br.branch_name, br.address as branch_address, br.Branch_Gstin_no
       from octroi_bill b left join branch_master br on br.branch_code = b.origin_branch where b.bill_no = @no and b.origin_branch = @b`,
    { no: billNo, b: user.currentBranch.code });
  if (!h) throw notFound(`Octroi bill ${billNo} not found at this branch`);
  const rows = await query('select * from octroi_bill_charge_details where bill_no = @no order by booking_date, docket_no', { no: billNo });
  return {
    billNo: s(h.bill_no), billDate: iso(h.bill_date), status: s(h.status), octroiNo: s(h.octroi_no), bookingMode: s(h.booking_mode),
    client: { code: s(h.client_code), name: s(h.client_name), address: s(h.address) },
    branch: { code: s(h.origin_branch), name: s(h.branch_name), address: s(h.branch_address), gstin: s(h.Branch_Gstin_no) },
    remarks: s(h.remarks), totalAmount: n(h.totalamount), submittedOn: iso(h.Summation_date), receiverName: s(h.RcvName),
    cancelledBy: s(h.Cancel_by), cancelRemarks: s(h.Cancel_remarks), createdBy: s(h.user_id),
    rows: rows.map((r) => ({
      docketNo: s(r.docket_no), bookingDate: iso(r.booking_date), invoiceNos: s(r.Invoice_no), packages: n(r.package), weight: n(r.weight),
      octroiAmount: n(r.OctroiAmount), otherCharges: n(r.OtherCharges), chargePercent: n(r.OctroiCharges_Per), charge: n(r.OctroiCharges_Amount),
      taxPercent: n(r.Service_Tax), tax: n(r.ServiceTax_Amount), total: n(r.totalamount),
    })),
  };
}

/** Octroi_Bill_Summation: handed to the client. */
export async function submitBill(user, billNo, body) {
  const b = await getBill(user, billNo);
  if (b.status !== 'Generated') throw conflict(`Bill ${billNo} is ${b.status.toLowerCase()}`);
  if (body.date > today() || body.date < b.billDate) throw badRequest('Submission date must be between the bill date and today');
  await query("update octroi_bill set OctroiBill_Summation_status = 'Active', Summation_date = @d, RcvName = @rn, RcvPhNo = @rp where bill_no = @no",
    { d: body.date, rn: body.receiverName, rp: body.receiverPhone, no: billNo });
  return { billNo, message: 'Octroi bill submitted' };
}

/** Octroi_Bill_Cancel: refused once money is received (octroi MR); the dockets can be billed again. */
export async function cancelBill(user, billNo, remarks) {
  const b = await getBill(user, billNo);
  if (b.status === 'Cancelled') throw conflict('Bill No. already cancelled');
  if (b.status === 'Received') throw conflict('Money is received against this octroi bill; it cannot be cancelled');
  await withTransaction(async (tx) => {
    await query(
      "update octroi_bill set OctroiBill_Cancel_status = 'Cancelled', Cancel_date = getdate(), Cancel_by = @u, Cancel_remarks = @rem where bill_no = @no",
      { u: user.userId, rem: remarks, no: billNo }, { tx });
    await query("update octroi_bill_charge_details set client_bill_status = 'bill_cancel' where bill_no = @no", { no: billNo }, { tx });
    await query("update grn_master set Octroi_Status = 'cancled', Octroi_Bill_No = null where Octroi_Bill_No = @no", { no: billNo }, { tx });
  });
  return { billNo, message: 'Octroi bill cancelled' };
}
