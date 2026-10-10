// Franchisee commission invoices — port of Invoice/Franchisee_Commission_Invoice.aspx and Franchisee_Invoice_Cancel.aspx
// (Franchisee_Comm_Invoice_Dal / Franchisee_Invoice_Cancel_bal, bin/ClassLibrary.dll).
//
// A monthly invoice of what a franchisee earned: pick the franchisee (Franchise_Master bound to its branch in Bind_Franch_Branch)
// and the month; the dockets booked at its branch that month and not yet invoiced are listed with the commission, the docket's
// handling and collection charges; tick and save. Grn_master gets Franchisee_Invoice_Status = 'Generated'; cancel frees them.
//
// Commission per docket — from the franchisee commission master (Rate → Franchisee Commission, Franchisee_Commission_Master +
// _Detail) in force for the docket's mode on its booking date, on the base freight (FTL rate, else freight, else rate × weight / boxes):
//   * Road, part load: the booking type's "LTL 03 Tons" row — % up to 3 tons charged weight, the 3–6 tons % above that;
//   * Road, full load (LoadType FTL): the booking type's FTL row by weight (FTL 3–6 t up to 6 t, FTL 9–16 t up to 16 t, trailer above)
//     — commission per consignment + share % of the freight;
//   * no row for the booking type: the master's "commission on base freight" %;
//   * Train: train % + per-rail commission;  Air: air %.
// The monthly rent, mobile bill and signage of the road master can be added once per franchisee and month; TDS % is entered.
//
// Changes from the pages (docs/MIGRATION.md "Franchisee commission invoices"):
//   * the commission comes from the commission master the Rate pages maintain (the page read an older per-franchisee table,
//     Franchise_Commission_Master, that no page wrote, and its "Fixed" commission was always 0);
//   * amounts are worked out on the server; the selected dockets are re-checked inside the save (the page saved its grid labels,
//     and saved the header even when no docket was ticked);
//   * the month's end date used the start month for both ends and the current year's day count; fixed;
//   * the invoice no. (FINV + short code + FY + 6 digits) is taken inside the save; the cancel list shows the branch's invoices
//     (the page showed only the user's own) and its docket reset used a join that matched every invoice.
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { finYr } from '../pickup/pickup.service.js';
import { s, n, iso, today, round2 } from '../../utils/values.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthRange = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}`, label: `${MONTHS[m - 1]} ${y}` };
};

// ------------------------------------------------------------------ lookups

/** Bind_Franchisee_Name: franchisees with the branch they are bound to. */
export async function franchisees() {
  const rows = await query(
    `select f.FranCode, f.FranName, b.Branch_Code, bm.branch_name from Franchise_Master f
       join Bind_Franch_Branch b on b.Franchise_Code = f.FranCode and isnull(b.Status, 1) = 1
       join branch_master bm on bm.branch_code = b.Branch_Code
      order by f.FranName, bm.branch_name`);
  return rows.map((r) => ({
    value: `${s(r.FranCode)}|${s(r.Branch_Code)}`, code: s(r.FranCode), name: s(r.FranName), branchCode: s(r.Branch_Code),
    branchName: s(r.branch_name), label: `${s(r.FranName)} : ${s(r.FranCode)} : ${s(r.branch_name)} : ${s(r.Branch_Code)}`,
  }));
}

async function franchisee(franCode, branchCode) {
  const f = (await franchisees()).find((x) => x.code === franCode && x.branchCode === branchCode);
  if (!f) throw badRequest('Select the franchisee');
  return f;
}

/** The commission masters (with their road rows) that can apply in the period. */
async function masters(to) {
  const heads = await query('select * from Franchisee_Commission_Master where EffectiveDate <= @to order by EffectiveDate desc, CommId desc', { to });
  const rows = await query('select * from Franchisee_Commission_Master_Detail');
  return heads.map((h) => ({
    code: s(h.Comm_Code), mode: s(h.Mode), effectiveDate: iso(h.EffectiveDate), endDate: iso(h.EndDate), rent: n(h.Rent),
    mobile: n(h.Mobile_Bills), signage: n(h.Signage_Payment), basePct: n(h.Comm_On_Base_Freight), airPct: n(h.Air_Commission),
    trainPct: n(h.Train_Commission), trainPerRail: n(h.Train_V_Commission),
    rows: rows.filter((r) => s(r.CommId) === s(h.Comm_Code)).map((r) => ({
      bookingType: s(r.Booking_Type), category: s(r.Commission_1), c2: s(r.Commission_2), c3: n(r.Commission_3), c4: n(r.Commission_4),
    })),
  }));
}
const inForce = (all, mode, date) => all.find((m) => m.mode === mode && m.effectiveDate <= date && (!m.endDate || m.endDate >= date));

/** The commission of one docket (see the header). */
export function commission(master, d) {
  const none = { rate: 0, type: 'No commission rate in force', amount: 0 };
  if (!master) return none;
  const pct = (p, type) => ({ rate: p, type, amount: round2(d.freight * p / 100) });
  if (d.mode === 'AI') return pct(master.airPct, 'Air %');
  if (d.mode === 'TR') return { rate: master.trainPct, type: `Train % + ${master.trainPerRail} per rail`, amount: round2(d.freight * master.trainPct / 100 + master.trainPerRail) };
  const rows = master.rows.filter((r) => r.bookingType === d.bookingType);
  if (d.loadType === 'FTL') {
    const cat = d.weight <= 6000 ? 'FTL 36 Tons' : d.weight <= 16000 ? 'FTL 916 Tons' : 'FTL Trailor';
    const r = rows.find((x) => x.category === cat);
    if (r) return { rate: r.c4, type: `${cat}: ${r.c3} + ${r.c4}%`, amount: round2(r.c3 + d.freight * r.c4 / 100) };
  } else {
    const r = rows.find((x) => x.category === 'LTL 03 Tons');
    if (r) return d.weight <= 3000 ? pct(n(r.c2), 'LTL up to 3 tons %') : pct(r.c4, 'LTL 3–6 tons %');
  }
  return pct(master.basePct, 'Base freight %');
}

/** Bind_Grid_View: the franchisee branch's dockets of the month not yet invoiced, with their commission. */
export async function pendingDockets(user, { franCode, branchCode, month, dockets = [] }) {
  await franchisee(franCode, branchCode);
  const { from, to } = monthRange(month);
  const rows = await query(
    `select g.docket_no, g.booking_date, g.booking_type, g.booking_mode, g.LoadType, g.origin_branch, g.destination_branch,
            bd.branch_name as destination, c.pcs, c.charge_weight, c.rate_on, c.docket_rate,
            case when isnull(c.FtlRate, 0) > 0 then c.FtlRate when isnull(c.freight, 0) > 0 then c.freight
                 when c.rate_on = 'BOX' then isnull(c.docket_rate, 0) * isnull(c.pcs, 0) else isnull(c.docket_rate, 0) * isnull(c.charge_weight, 0) end as base_freight,
            isnull(o.handling_charge, 0) as handling_charge, isnull(o.collection_charges, 0) as collection_charges
       from grn_master g join grn_docket_charge c on c.Docket_No = g.docket_no
       left join docket_other_charges o on o.docket = g.docket_no left join branch_master bd on bd.branch_code = g.destination_branch
      where g.origin_branch = @b and g.booking_date between @from and @to and isnull(g.IsCancel, 0) = 0
        and g.Franchisee_Invoice_Status is null and (@div = '' or g.Division = @div)
        and (@list = '' or g.docket_no in (select value from string_split(@list, ',')))
      order by g.booking_date, g.docket_no`,
    { b: branchCode, from, to, div: s(user.divCode), list: dockets.join(',') });
  const all = await masters(to);
  return rows.map((r) => {
    const d = {
      docketNo: s(r.docket_no), bookingDate: iso(r.booking_date), bookingType: s(r.booking_type), mode: s(r.booking_mode),
      loadType: s(r.LoadType), originBranch: s(r.origin_branch), destinationBranch: s(r.destination_branch), destination: s(r.destination),
      packets: n(r.pcs), weight: n(r.charge_weight), freight: round2(n(r.base_freight)),
      handling: round2(n(r.handling_charge)), collection: round2(n(r.collection_charges)),
    };
    const master = inForce(all, d.mode, d.bookingDate);
    const c = commission(master, d);
    return { ...d, masterCode: master?.code ?? '', rate: c.rate, commissionType: c.type, commission: c.amount, total: round2(c.amount + d.handling + d.collection) };
  });
}

/** Rent / mobile / signage of the road master in force at the month's end, and whether this month already has them. */
export async function monthly(user, { franCode, branchCode, month }) {
  const { to } = monthRange(month);
  const m = inForce(await masters(to), 'RD', to);
  const [taken] = await query(
    `select top 1 F_Invoice_No from Franchisee_Invoice where Fran_Code = @f and Fran_Branch = @b and Month = @m and IsCancel = 0
        and (Rent + Mobile_Bills + Signage) > 0`, { f: franCode, b: branchCode, m: month });
  return { rent: m?.rent ?? 0, mobile: m?.mobile ?? 0, signage: m?.signage ?? 0, masterCode: m?.code ?? '', alreadyOn: s(taken?.F_Invoice_No) };
}

// ------------------------------------------------------------------ create

/** btnsubmit_Click: insert_Invoice + insert_Invoice_Detail + Update_docket_F_Invoice, in one transaction. */
export async function createInvoice(user, body) {
  const now = today();
  const fy = financialYearRange(user.financialYear);
  if (body.invoiceDate > now) throw badRequest('Invoice date should not be greater than current date');
  if (fy && (body.invoiceDate < fy.from || body.invoiceDate > fy.to)) throw badRequest('Invoice date must be in the login financial year');
  if (body.month > now.slice(0, 7)) throw badRequest('The month cannot be after the current month');
  const f = await franchisee(body.franCode, body.branchCode);
  const range = monthRange(body.month);
  if (body.invoiceDate < range.from) throw badRequest('Invoice date should not be before the month');

  const rows = body.dockets.length ? await pendingDockets(user, { ...body, dockets: body.dockets }) : [];
  const missing = body.dockets.filter((d) => !rows.some((r) => r.docketNo === d));
  if (missing.length) throw conflict(`Not open for this franchisee and month (or already invoiced): ${missing.join(', ')}`);
  const mon = body.includeMonthly ? await monthly(user, body) : { rent: 0, mobile: 0, signage: 0 };
  if (body.includeMonthly && mon.alreadyOn) throw conflict(`Rent / mobile / signage of ${range.label} are already on invoice ${mon.alreadyOn}`);
  const sum = (k) => round2(rows.reduce((t, r) => t + r[k], 0));
  const tot = { commission: sum('commission'), handling: sum('handling'), collection: sum('collection') };
  const gross = round2(tot.commission + tot.handling + tot.collection + mon.rent + mon.mobile + mon.signage);
  if (gross <= 0) throw badRequest('Select Atleast One Docket (or add the monthly charges)');
  const tds = round2(gross * body.tdsPercent / 100);

  const [br] = await query('select short_code from branch_master where branch_code = @b', { b: user.currentBranch.code });
  const shortCode = s(br?.short_code); const fyShort = finYr(user.financialYear);
  return withTransaction(async (tx) => {
    const prefix = `FINV${shortCode}${fyShort}`;
    const [last] = await query(
      `select top 1 F_Invoice_No from Franchisee_Invoice with (updlock, holdlock) where F_Invoice_No like @p + '%' and len(F_Invoice_No) = len(@p) + 6
        order by F_Invoice_No desc`, { p: prefix }, { tx });
    const invoiceNo = `${prefix}${String((last ? Number(s(last.F_Invoice_No).slice(-6)) : 0) + 1).padStart(6, '0')}`;
    await query(
      `insert into Franchisee_Invoice(F_Invoice_No, Fran_Code, Fran_Branch, Branch_Code, Invoice_Date, From_Date, To_Date, Month, Rent, Mobile_Bills,
         Signage, Commission_Total, Handling_Total, Collection_Total, Gross_Amount, TDS_Percent, TDS_Amount, Net_Amount, Remarks,
         Financial_Year, Division, ShortCode, FinYr, Created_By)
       values (@no, @f, @fb, @b, @d, @from, @to, @m, @rent, @mob, @sign, @comm, @hand, @coll, @gross, @tdsp, @tds, @net, @rem, @fy, @div, @sc, @fys, @u)`,
      {
        no: invoiceNo, f: f.code, fb: f.branchCode, b: user.currentBranch.code, d: body.invoiceDate, from: range.from, to: range.to, m: body.month,
        rent: mon.rent, mob: mon.mobile, sign: mon.signage, comm: tot.commission, hand: tot.handling, coll: tot.collection, gross,
        tdsp: body.tdsPercent, tds, net: round2(gross - tds), rem: body.remarks, fy: user.financialYear, div: s(user.divCode), sc: shortCode,
        fys: fyShort, u: user.userId,
      }, { tx });
    for (const r of rows) {
      await query(
        `insert into Franchisee_Invoice_Detail(F_Invoice_No, Docket_No, Booking_Date, Booking_Type, Booking_Mode, Origin_Branch_Code,
           Destination_Branch_Code, Packet, Weight, Basic_Freight, Franchisee_Rate, Commaission_Type, Franchisee_Amount, Handling_Charge_Rate,
           Handling_Charge_Amount, Collection_Charge, Total_Amount, Created_By)
         values (@no, @dk, @bd, @bt, @bm, @ob, @db, @p, @w, @fr, @rate, @ct, @comm, 0, @hand, @coll, @tot, @u)`,
        {
          no: invoiceNo, dk: r.docketNo, bd: r.bookingDate, bt: r.bookingType, bm: r.mode, ob: r.originBranch, db: r.destinationBranch, p: r.packets,
          w: r.weight, fr: r.freight, rate: r.rate, ct: r.commissionType, comm: r.commission, hand: r.handling, coll: r.collection, tot: r.total, u: user.userId,
        }, { tx });
      const upd = await query(
        `update grn_master set Franchisee_Invoice_Status = 'Generated', Franchisee_Invoice_No = @no output inserted.docket_no
          where docket_no = @dk and Franchisee_Invoice_Status is null`, { no: invoiceNo, dk: r.docketNo }, { tx });
      if (!upd.length) throw conflict(`Docket ${r.docketNo} was invoiced meanwhile`);
    }
    return { invoiceNo, dockets: rows.length, gross, net: round2(gross - tds), message: 'Record Success Fully Added !' };
  });
}

// ------------------------------------------------------------------ list / view / cancel

const toInvoice = (r) => ({
  invoiceNo: s(r.F_Invoice_No), invoiceDate: iso(r.Invoice_Date), franCode: s(r.Fran_Code), franName: s(r.FranName),
  franBranch: s(r.Fran_Branch), franBranchName: s(r.fran_branch_name), month: s(r.Month), from: iso(r.From_Date), to: iso(r.To_Date),
  rent: n(r.Rent), mobile: n(r.Mobile_Bills), signage: n(r.Signage), commission: n(r.Commission_Total), handling: n(r.Handling_Total),
  collection: n(r.Collection_Total), gross: n(r.Gross_Amount), tdsPercent: n(r.TDS_Percent), tds: n(r.TDS_Amount), net: n(r.Net_Amount),
  remarks: s(r.Remarks), dockets: n(r.dockets), status: r.IsCancel ? 'Cancelled' : 'Active', createdBy: s(r.Created_By),
  cancelledBy: s(r.Cancel_by), cancelRemarks: s(r.Cancel_Remarks),
});
const SELECT = `select i.*, f.FranName, fb.branch_name as fran_branch_name,
    (select count(*) from Franchisee_Invoice_Detail d where d.F_Invoice_No = i.F_Invoice_No) as dockets
  from Franchisee_Invoice i left join Franchise_Master f on f.FranCode = i.Fran_Code left join branch_master fb on fb.branch_code = i.Fran_Branch`;

/** select_from_Franchisee_Invoice: the branch's invoices of the login year (all / cancelled / search). */
export async function listInvoices(user, { from, to, status = 'all', search = '' }) {
  const rows = await query(
    `${SELECT} where i.Branch_Code = @b and i.Financial_Year = @fy and i.Invoice_Date between @from and @to
       and (@st = 'all' or (@st = 'Cancelled' and i.IsCancel = 1) or (@st = 'Active' and i.IsCancel = 0))
       and (@q = '' or i.F_Invoice_No like '%' + @q + '%' or f.FranName like '%' + @q + '%')
     order by i.F_Invoice_No desc`, { b: user.currentBranch.code, fy: user.financialYear, from, to, st: status, q: search });
  return rows.map(toInvoice);
}

/** The invoice print (Franchisee invoice view): header, franchisee and its dockets. */
export async function getInvoice(user, invoiceNo) {
  const [r] = await query(
    `select x.*, br.branch_name, br.address as branch_address, br.Branch_Gstin_no from (${SELECT} where i.F_Invoice_No = @no and i.Branch_Code = @b) x
       left join branch_master br on br.branch_code = x.Branch_Code`, { no: invoiceNo, b: user.currentBranch.code });
  if (!r) throw notFound(`Invoice ${invoiceNo} not found at this branch`);
  const rows = await query(
    `select d.*, bd.branch_name as destination from Franchisee_Invoice_Detail d left join branch_master bd on bd.branch_code = d.Destination_Branch_Code
      where d.F_Invoice_No = @no order by d.Booking_Date, d.Docket_No`, { no: invoiceNo });
  return {
    ...toInvoice(r), monthLabel: monthRange(s(r.Month)).label,
    branch: { code: s(r.Branch_Code), name: s(r.branch_name), address: s(r.branch_address), gstin: s(r.Branch_Gstin_no) },
    rows: rows.map((d) => ({
      docketNo: s(d.Docket_No), bookingDate: iso(d.Booking_Date), bookingType: s(d.Booking_Type), mode: s(d.Booking_Mode),
      destination: s(d.destination), packets: n(d.Packet), weight: n(d.Weight), freight: n(d.Basic_Freight), rate: n(d.Franchisee_Rate),
      commissionType: s(d.Commaission_Type), commission: n(d.Franchisee_Amount), handling: n(d.Handling_Charge_Amount),
      collection: n(d.Collection_Charge), total: n(d.Total_Amount),
    })),
  };
}

/** Cancel_item: Update_Grn_master (dockets free again) + Cancel_Franchisee_Invoice. */
export async function cancelInvoice(user, invoiceNo, remarks) {
  const inv = await getInvoice(user, invoiceNo);
  if (inv.status === 'Cancelled') throw conflict(`Invoice ${invoiceNo} is already cancelled`);
  await withTransaction(async (tx) => {
    await query(
      `update grn_master set Franchisee_Invoice_Status = null, Franchisee_Invoice_No = null
        where Franchisee_Invoice_No = @no or docket_no in (select Docket_No from Franchisee_Invoice_Detail where F_Invoice_No = @no)`,
      { no: invoiceNo }, { tx });
    await query(
      `update Franchisee_Invoice set IsCancel = 1, Cancel_by = @u, Cancel_Date = getdate(), Cancel_Remarks = @rem where F_Invoice_No = @no`,
      { u: user.userId, rem: remarks, no: invoiceNo }, { tx });
  });
  return { invoiceNo, message: 'Cancelled Successfully!!!' };
}
