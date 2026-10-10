// Vendor bill verification — port of Invoice/Vendor_Invoice_For_Varification.aspx, VendorPendingInvoiceReport.aspx and
// Vendor_Invoice_Print.aspx. Vendor_Invoice_For_Varification_dal (bin/ClassLibrary.dll: Bind_vendor, bindgridvendorchallan,
// sp_insert_vendor_invoice_verification, GET_AUTO_GENERATED_CODE_FOR_VENDOR_BILL).
//
// A transport vendor sends a bill for its lorry challans (CHT, Dispatch_Master). The branch picks the vendor, mode and dates,
// ticks the challans, enters the current payment against each challan's balance and saves: Vendor_Invoice_Verify (header,
// receipt code VIV…, bill no.) + Vendor_Invoice_Verify_Details (challan, freight, advance, current payment, pending balance).
// A challan whose balance is fully covered is marked IsVerified. No voucher is posted (the page posted none either).
//
// Changes from the page (docs/MIGRATION.md "Vendor invoices"):
//   * the balance shown is the challan balance less what earlier verifications already covered, and the current payment
//     cannot be more than that (the page let any amount through and showed the challan balance again next time);
//   * only the branch's own challans are listed; the PRS / DRS challan option is not ported (those entries have no vendor
//     freight in this system);
//   * the bill no. (VB + short code + FY + 6 digits) and the receipt code are taken inside the save; cancel added.
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { finYr } from '../pickup/pickup.service.js';
import { s, n, iso, today, round2 } from '../../utils/values.js';

/** Bind_vendor + BindMode. */
export async function options(user) {
  const [vendors, modes] = await Promise.all([
    query(`select vendor_code, Name from vendors_master where isnull(active_flag, 1) = 1
             and (@div = '' or ',' + isnull(DivCode, '') + ',' like '%,' + @div + ',%') order by Name`, { div: s(user.divCode) }),
    query('select mode_code, mode_name from mode_master order by slno'),
  ]);
  return {
    vendors: vendors.map((r) => ({ value: s(r.vendor_code), label: s(r.Name) })),
    modes: modes.map((r) => ({ value: s(r.mode_code), label: s(r.mode_name) })),
  };
}

const COVERED = `isnull((select sum(d.CurrentPayment) from Vendor_Invoice_Verify_Details d where d.challan_no = dm.challan_no
  and d.IsCancelled = 0), 0)`;

/** bindgridvendorchallan: the vendor's challans with a balance still to verify. */
export async function pendingChallans(user, { vendorCode, mode = '', from, to }) {
  const rows = await query(
    `select dm.challan_no, dm.challan_date, dm.mode_code, dm.truck_no, dm.total_weight, isnull(dm.total_freight, 0) as total_freight,
            isnull(dm.advance, 0) as advance, isnull(dm.bal_amount, 0) as bal_amount, ${COVERED} as covered,
            b.branch_name, isnull(cm.city_name, dm.to_city) as destination
       from Dispatch_Master dm left join branch_master b on b.branch_code = dm.from_branch left join city_master cm on cm.city_code = dm.to_city
      where dm.vendor_code = @v and (@m = '' or dm.mode_code = @m) and dm.challan_date between @from and @to
        and isnull(dm.IsCancelled, 0) = 0 and isnull(dm.IsVerified, 0) = 0 and dm.from_branch = @b
        and isnull(dm.bal_amount, 0) - ${COVERED} > 0
      order by dm.challan_date, dm.challan_no`, { v: vendorCode, m: mode, from, to, b: user.currentBranch.code });
  return rows.map((r) => ({
    challanNo: s(r.challan_no), challanDate: iso(r.challan_date), mode: s(r.mode_code), truckNo: s(r.truck_no), weight: n(r.total_weight),
    origin: s(r.branch_name), destination: s(r.destination), freight: n(r.total_freight), advance: n(r.advance),
    challanBalance: n(r.bal_amount), covered: n(r.covered), balance: round2(n(r.bal_amount) - n(r.covered)),
  }));
}

/** btnsubmit_Click (CHT challans) → sp_insert_vendor_invoice_verification. */
export async function createVerification(user, body) {
  const now = today();
  const fy = financialYearRange(user.financialYear);
  if (body.billDate > now) throw badRequest('Bill date should not be greater than current date');
  if (fy && (body.billDate < fy.from || body.billDate > fy.to)) throw badRequest('Bill date must be in the login financial year');
  if (body.deduction > body.billAmount) throw badRequest('Deduction cannot be more than the bill amount');
  const nos = body.rows.map((r) => r.challanNo);
  if (new Set(nos).size !== nos.length) throw badRequest('A challan is listed twice');

  const [br] = await query('select short_code from branch_master where branch_code = @b', { b: user.currentBranch.code });
  const shortCode = s(br?.short_code); const fyShort = finYr(user.financialYear);

  return withTransaction(async (tx) => {
    const open = await query(
      `select dm.challan_no, isnull(dm.total_freight, 0) as total_freight, isnull(dm.advance, 0) as advance,
              isnull(dm.bal_amount, 0) - ${COVERED} as balance
         from Dispatch_Master dm with (updlock, holdlock)
        where dm.vendor_code = @v and dm.from_branch = @b and isnull(dm.IsCancelled, 0) = 0 and isnull(dm.IsVerified, 0) = 0
          and dm.challan_no in (select value from string_split(@c, ','))`,
      { v: body.vendorCode, b: user.currentBranch.code, c: nos.join(',') }, { tx });
    const byNo = new Map(open.map((r) => [s(r.challan_no), r]));
    const rows = body.rows.map((r) => {
      const c = byNo.get(r.challanNo);
      if (!c) throw badRequest(`Challan ${r.challanNo} is not an open challan of this vendor at this branch`);
      const balance = round2(n(c.balance));
      if (r.currentPayment > balance) throw badRequest(`Challan ${r.challanNo}: current payment ${r.currentPayment} is more than the balance ${balance}`);
      return { ...r, freight: n(c.total_freight), advance: n(c.advance), pending: round2(balance - r.currentPayment) };
    });
    const totalPaid = round2(rows.reduce((t, r) => t + r.currentPayment, 0));
    const totalPending = round2(rows.reduce((t, r) => t + r.pending, 0));

    const [lastCode] = await query(
      `select top 1 Vendor_Receipt_Code from Vendor_Invoice_Verify with (updlock, holdlock) where Vendor_Receipt_Code like 'VIV%'
        order by len(Vendor_Receipt_Code) desc, Vendor_Receipt_Code desc`, {}, { tx });
    const receiptCode = `VIV${String((lastCode ? Number(s(lastCode.Vendor_Receipt_Code).slice(3)) : 0) + 1).padStart(4, '0')}`;
    const prefix = `VB${shortCode}${fyShort}`;
    const [last] = await query(
      `select top 1 Vendor_Bill_No from Vendor_Invoice_Verify with (updlock, holdlock) where Vendor_Bill_No like @p + '%'
          and len(Vendor_Bill_No) = len(@p) + 6 order by Vendor_Bill_No desc`, { p: prefix }, { tx });
    const billNo = `${prefix}${String((last ? Number(s(last.Vendor_Bill_No).slice(-6)) : 0) + 1).padStart(6, '0')}`;

    await query(
      `insert into Vendor_Invoice_Verify(Vendor_Receipt_Code, Vendor_Code, Vendor_Mode, Vendor_Bill_No, Vendor_Ref_No, Vendor_Bill_Date,
         Bill_Amount, Deduction, Narration, Challan_amount, Balance_Amount, verify_status, challan_type, Branch_Code, ShortCode, FinYr,
         Financial_Year, division, user_id)
       values (@rc, @v, @m, @no, @ref, @d, @amt, @ded, @nar, @paid, @pend, 1, 1, @b, @sc, @fys, @fy, @div, @u)`,
      {
        rc: receiptCode, v: body.vendorCode, m: body.mode, no: billNo, ref: body.vendorRefNo, d: body.billDate, amt: body.billAmount,
        ded: body.deduction, nar: body.narration, paid: totalPaid, pend: totalPending, b: user.currentBranch.code, sc: shortCode, fys: fyShort,
        fy: user.financialYear, div: s(user.divCode), u: user.userId,
      }, { tx });
    for (const r of rows) {
      await query(
        `insert into Vendor_Invoice_Verify_Details(Vendor_Bill_No, challan_no, vehicle_freight, advance, CurrentPayment, Balance_Amount, CurrentPaymentDate)
         values (@no, @c, @f, @a, @cp, @bal, @d)`,
        { no: billNo, c: r.challanNo, f: r.freight, a: r.advance, cp: r.currentPayment, bal: r.pending, d: body.billDate }, { tx });
      if (r.pending <= 0) await query('update Dispatch_Master set IsVerified = 1 where challan_no = @c', { c: r.challanNo }, { tx });
    }
    return { billNo, receiptCode, totalPaid, message: 'Successfully verified' };
  });
}

const toRow = (r) => ({
  billNo: s(r.Vendor_Bill_No), receiptCode: s(r.Vendor_Receipt_Code), billDate: iso(r.Vendor_Bill_Date), vendorCode: s(r.Vendor_Code),
  vendorName: s(r.vendor_name), mode: s(r.Vendor_Mode), vendorRefNo: s(r.Vendor_Ref_No), billAmount: n(r.Bill_Amount),
  deduction: n(r.Deduction), narration: s(r.Narration), paid: n(r.Challan_amount), pending: n(r.Balance_Amount),
  status: r.IsCancelled ? 'Cancelled' : 'Active', createdBy: s(r.user_id), cancelRemarks: s(r.CancelRemarks),
});

/** VendorPendingInvoiceReport: the branch's verified bills, one row per challan. */
export async function report(user, { from, to, vendorCode = '', pendingOnly = false }) {
  const rows = await query(
    `select h.*, vm.Name as vendor_name, d.challan_no, d.vehicle_freight, d.advance, d.CurrentPayment, d.Balance_Amount as challan_pending,
            d.CurrentPaymentDate
       from Vendor_Invoice_Verify h join Vendor_Invoice_Verify_Details d on d.Vendor_Bill_No = h.Vendor_Bill_No
       left join vendors_master vm on vm.vendor_code = h.Vendor_Code
      where h.Branch_Code = @b and h.Financial_Year = @fy and h.Vendor_Bill_Date between @from and @to and h.IsCancelled = 0
        and (@v = '' or h.Vendor_Code = @v) and (@p = 0 or d.Balance_Amount > 0)
      order by h.Vendor_Bill_No desc, d.id`,
    { b: user.currentBranch.code, fy: user.financialYear, from, to, v: vendorCode, p: pendingOnly ? 1 : 0 });
  return rows.map((r) => ({
    ...toRow(r), challanNo: s(r.challan_no), freight: n(r.vehicle_freight), advance: n(r.advance), currentPayment: n(r.CurrentPayment),
    challanPending: n(r.challan_pending), paymentDate: iso(r.CurrentPaymentDate),
  }));
}

/** Getvendorinvoiceprint: one bill with its challans. */
export async function getVerification(user, billNo) {
  const [h] = await query(
    `select h.*, vm.Name as vendor_name, vm.address as vendor_address, vm.Gstin_No as vendor_gstin, br.branch_name, br.address as branch_address
       from Vendor_Invoice_Verify h left join vendors_master vm on vm.vendor_code = h.Vendor_Code
       left join branch_master br on br.branch_code = h.Branch_Code
      where h.Vendor_Bill_No = @no and h.Branch_Code = @b`, { no: billNo, b: user.currentBranch.code });
  if (!h) throw notFound(`Vendor bill ${billNo} not found at this branch`);
  const rows = await query(
    `select d.*, dm.challan_date, dm.truck_no from Vendor_Invoice_Verify_Details d left join Dispatch_Master dm on dm.challan_no = d.challan_no
      where d.Vendor_Bill_No = @no order by d.id`, { no: billNo });
  return {
    ...toRow(h),
    vendor: { code: s(h.Vendor_Code), name: s(h.vendor_name), address: s(h.vendor_address), gstin: s(h.vendor_gstin) },
    branch: { code: s(h.Branch_Code), name: s(h.branch_name), address: s(h.branch_address) },
    challans: rows.map((r) => ({
      challanNo: s(r.challan_no), challanDate: iso(r.challan_date), truckNo: s(r.truck_no), freight: n(r.vehicle_freight), advance: n(r.advance),
      currentPayment: n(r.CurrentPayment), pending: n(r.Balance_Amount),
    })),
  };
}

/** New: cancel a verification; its challans open again. */
export async function cancelVerification(user, billNo, remarks) {
  const v = await getVerification(user, billNo);
  if (v.status === 'Cancelled') throw conflict(`Vendor bill ${billNo} is already cancelled`);
  await withTransaction(async (tx) => {
    await query(
      `update Vendor_Invoice_Verify set IsCancelled = 1, CancelBy = @u, CancelDate = getdate(), CancelRemarks = @rem where Vendor_Bill_No = @no`,
      { u: user.userId, rem: remarks, no: billNo }, { tx });
    await query('update Vendor_Invoice_Verify_Details set IsCancelled = 1 where Vendor_Bill_No = @no', { no: billNo }, { tx });
    await query(
      `update Dispatch_Master set IsVerified = 0
        where challan_no in (select challan_no from Vendor_Invoice_Verify_Details where Vendor_Bill_No = @no)`, { no: billNo }, { tx });
  });
  return { billNo, message: 'Vendor bill verification cancelled' };
}
