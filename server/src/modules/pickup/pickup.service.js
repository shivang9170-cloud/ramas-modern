// Pickup (PRS) entry — port of:
//   wwwroot/Operation/pickup_entry.aspx(.cs)          create
//   wwwroot/Operation/Pickup_Entry_Cancel.aspx(.cs)   list / cancel
//   wwwroot/Operation/Pickup_EntryView.aspx(.cs)      list / view
//   ClassLibrary/dal/Pick_Up_Entry_dal.cs, Pick_Up_grn_dal.cs, Pickup_Entry_Cancel_Dal.cs
//
// Fixed legacy bugs (see docs/SECURITY.md "Data integrity bugs"):
//   * header (usp_insert_PickUpEntry) and docket rows were saved in separate
//     connections — now one transaction;
//   * docket rows were stamped with the pickup no. typed on screen, not the one
//     returned by usp_insert_PickUpEntry (@retval) — now the returned number;
//   * the "manifest already generated" cancel check had "and and" in its SQL, so
//     it always failed silently and never blocked a cancel — fixed;
//   * docket values were concatenated into SQL — now parameters.

import { exec, query, sql, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { s, n, iso, today } from '../../utils/values.js';
import { franchiseesForBranch } from '../bindings/bindings.service.js';

/** "2025-2026" / "2025 - 2026" -> "2526" (legacy ViewState["FinYr"]). */
export function finYr(financialYear) {
  const [a = '', b = ''] = String(financialYear || '').split('-').map((x) => x.trim());
  return `${a.slice(-2)}${b.slice(-2)}`;
}

async function branchInfo(branchCode) {
  const rows = await query(
    `select b.Short_Code, z.zone_name
       from branch_master b left join zone_master z on z.zone_code = b.zone_code
      where b.branch_code = @b`, { b: branchCode });
  if (!rows[0]) throw notFound(`Branch ${branchCode} not found`);
  return { shortCode: s(rows[0].Short_Code), zoneName: s(rows[0].zone_name) };
}

// ------------------------------------------------------------------ options

export async function options(user) {
  const branch = user.currentBranch.code;
  const { zoneName } = await branchInfo(branch);
  // Legacy: Delhi NCR branches list locations by zone, others by branch.
  const loc = zoneName === 'DELHI NCR'
    ? await exec('usp_Fill_BranchWise_LocationByZone', { branch_code: branch, ZoneName: zoneName })
    : await exec('usp_Fill_BranchWise_Location', { branch_code: branch });
  // Pickup boys: active employees of type DC-116 at the current branch.
  const staff = await query(
    "select empcode, empname, mobileno from Employee_Master where emptype = 'DC-116' and branch = @b and isnull(IsActive, 1) = 1 order by empname",
    { b: branch });
  return {
    locations: loc.recordset.map((r) => ({ value: s(r.Location_Code), label: s(r.Location_Name) })),
    pickupBy: staff.map((r) => ({ value: s(r.empcode), label: s(r.empname), mobile: s(r.mobileno) })),
    franchisees: await franchiseesForBranch(branch),   // chkFranchisee: the pickup is done by a franchisee
    docTypes: user.divCode === 'DIV1001'
      ? [{ value: '1', label: 'Document' }, { value: '2', label: 'Non document' }]
      : [{ value: '2', label: 'Non document' }],
  };
}

// ------------------------------------------------------------------ pending dockets

/**
 * Dockets booked at the current branch that still need a pickup
 * (Pick_Up_Entry_dal.select_data_on_the_basis_of_docket_no).
 */
export async function pendingDockets(user, { from, to, docType, dockets }) {
  const params = { branch: user.currentBranch.code, from, to, doc: docType };
  let extra = '';
  const list = (dockets || []).map((d) => s(d)).filter(Boolean);
  if (list.length) {
    // Legacy "docket list" search also excluded FTL dockets.
    extra = ` and g2.rate_on <> 'FTL' and g1.docket_no in (${list.map((d, i) => { params[`d${i}`] = d; return `@d${i}`; }).join(',')})`;
  } else {
    extra = " and g2.freight_type <> ''";
  }
  const rows = await query(
    `select top 1000 g1.docket_no, g1.booking_date, g1.booking_mode, g1.Consigner_Name, g1.consignee_name, g1.remarks,
            b.branch_name as originbranch, b1.branch_name as destinationbranch, zm.zone_name,
            coalesce(g2.pending_freight, g2.freight) as pending_freight,
            coalesce(g2.pending_weight, g2.charge_weight) as pending_weight,
            coalesce(g2.pending_package, g2.pcs) as pending_package,
            g2.charges
       from grn_master g1
       join grn_docket_charge g2 on g1.docket_no = g2.docket_no
            and isnull(g2.branch, g1.origin_branch) = g1.origin_branch -- booking row (arrivals add one per branch)
       join branch_master b on g1.origin_branch = b.branch_code
       left join branch_master b1 on g1.destination_branch = b1.branch_code
       left join zone_master zm on zm.zone_code = b.zone_code
      where (g1.pickup_status = '' or g1.pickup_status is null)
        and (g1.manifest_status = '' or g1.manifest_status is null)
        and isnull(g1.IsCancel, '0') = '0'
        and g1.origin_branch = @branch
        and g1.booking_date >= @from and g1.booking_date <= @to
        and g1.docsNoneDocs = @doc
        and g2.charges > 0 ${extra}
      order by g1.docket_no`,
    params);
  return rows.map((r) => ({
    docketNo: s(r.docket_no),
    bookingDate: iso(r.booking_date),
    bookingMode: s(r.booking_mode),
    origin: s(r.originbranch),
    destination: s(r.destinationbranch),
    consigner: s(r.Consigner_Name),
    consignee: s(r.consignee_name),
    packages: n(r.pending_package),
    weight: n(r.pending_weight),
    freight: n(r.pending_freight),
    remarks: s(r.remarks),
  }));
}

// ------------------------------------------------------------------ create

export async function createPickup(user, body) {
  if (body.pickupDate > today()) throw badRequest('Pickup date should not be greater than current date');
  if (body.franchiseeCode && !(await franchiseesForBranch(user.currentBranch.code)).some((f) => f.value === body.franchiseeCode)) {
    throw badRequest('Select a franchisee with an active branch binding');
  }

  const nos = body.dockets.map((d) => d.docketNo);
  if (new Set(nos).size !== nos.length) throw badRequest('The same docket is listed twice');
  const params = {};
  const inList = nos.map((d, i) => { params[`d${i}`] = d; return `@d${i}`; }).join(',');

  // Every docket must still be pending at this branch, and not booked after the pickup date.
  const found = await query(
    `select g.docket_no, g.booking_date, g.origin_branch, g.pickup_status, g.manifest_status, isnull(g.IsCancel,'0') as IsCancel
       from grn_master g where g.docket_no in (${inList})`, params);
  const byNo = new Map(found.map((r) => [s(r.docket_no), r]));
  const problems = [];
  for (const d of body.dockets) {
    const r = byNo.get(d.docketNo);
    if (!r) problems.push(`${d.docketNo}: not found`);
    else if (s(r.origin_branch) !== user.currentBranch.code) problems.push(`${d.docketNo}: not booked at this branch`);
    else if (s(r.IsCancel) !== '0' && s(r.IsCancel).toLowerCase() !== 'false') problems.push(`${d.docketNo}: cancelled`);
    else if (s(r.manifest_status)) problems.push(`${d.docketNo}: already manifested`);
    else if (iso(r.booking_date) > body.pickupDate) problems.push(`${d.docketNo}: booked after the pickup date`);
  }
  if (problems.length) throw new HttpError(422, 'Some dockets cannot be picked up', problems.map((m) => ({ path: 'dockets', message: m })));

  // Already on a pickup that is not cancelled (legacy "PickupNo Already Exist. Docket No (...)").
  const dup = await query(
    `select pg.docket_no, pg.Pickup_no from Pick_Up_grn pg
       join Pick_up_entry pe on pe.pickup_no = pg.Pickup_no
      where isnull(pe.IsCancelled, '0') = '0' and pg.docket_no in (${inList})`, params);
  if (dup.length) {
    throw conflict(`Already on a pickup: ${dup.map((r) => `${s(r.docket_no)} (${s(r.Pickup_no)})`).join(', ')}`);
  }

  const { shortCode } = await branchInfo(user.currentBranch.code);
  const pickupNo = await withTransaction(async (tx) => {
    const res = await exec('usp_insert_PickUpEntry', {
      pickup_no: '',
      pickup_date: body.pickupDate,
      pickup_time: body.pickupTime,
      from_branch: user.currentBranch.code,
      user_id: user.userId,
      Franchisee_Code: body.franchiseeCode || '',
      Financial_Year: user.financialYear,
      PickUpBy: body.pickupBy || '',
      PickUpByNo: body.pickupByMobile || '',
      ShortCode: shortCode,
      FinYr: finYr(user.financialYear),
      Division: user.divCode,
      DockNonDock: body.docType,
    }, { retval: [sql().VarChar(20), null] }, { tx });
    const no = s(res.output.retval);
    if (!no) throw new HttpError(422, 'Pickup could not be created');

    for (const d of body.dockets) {
      await query(
        `insert into Pick_Up_grn(docket_no, freight, package, weight, Pickup_no, Location_Code, Financial_Year, Division)
         values (@docket, @freight, @package, @weight, @pickup, @loc, @fy, @div);
         update grn_master set pickup_status = 'generated', DocketStatus = 'DOCKET AVAILABLE FOR PRS CHALLAN'
          where docket_no = @docket;`,
        {
          docket: d.docketNo, freight: d.freight, package: d.packages, weight: d.weight,
          pickup: no, loc: d.locationCode, fy: user.financialYear, div: user.divCode,
        }, { tx });
    }
    return no;
  });

  return { pickupNo, dockets: body.dockets.length, message: `Pickup ${pickupNo} created with ${body.dockets.length} docket(s)` };
}

// ------------------------------------------------------------------ list / view

export async function listPickups(user, { from, to, status = 'active', search = '' }) {
  const { recordset } = await exec('usp_search_PickupEntry', {
    booking_date1: from,
    booking_date2: to,
    IsCancelled: status === 'cancelled' ? 1 : 0,
    pickup_no: search || null,
    currbranch: user.currentBranch.code,
    user_id: user.userId,
    Financial_Year: user.financialYear,
    division: user.divCode,
  });
  return recordset.map((r) => ({
    pickupNo: s(r.pickup_no ?? r.Pickup_no),
    pickupDate: iso(r.pickup_date),
    pickupTime: s(r.pickup_time),
    challanNo: s(r.challan_no),
    dockets: n(r.docket_count ?? r.TotalDocket ?? r.dockets),
    pickupBy: s(r.PickUpByName ?? r.PickUpBy),
    cancelled: status === 'cancelled',
    raw: r,
  }));
}

export async function getPickup(user, pickupNo) {
  const [h] = await query(
    `select pe.*, e.empname as PickUpByName
       from Pick_up_entry pe left join Employee_Master e on e.empcode = pe.PickUpBy
      where pe.pickup_no = @no and pe.from_branch = @branch`,
    { no: pickupNo, branch: user.currentBranch.code });
  if (!h) throw notFound(`Pickup ${pickupNo} not found at this branch`);
  // Pick_Up_Entry_Edit_dal.Dokectlist_in_Pickup_Entry_ForView
  const rows = await query(
    `select p.docket_no, g.booking_date, g.booking_mode, b.branch_name as origin_branch, g.Consigner_Name, g.consignee_name,
            p.Location_Code, lo.Location_Name, p.freight, p.weight, p.package, g.manifest_status
       from Pick_Up_grn p
       join grn_master g on g.docket_no = p.docket_no
       left join branch_master b on g.origin_branch = b.branch_code
       left join New_Location_master lo on lo.Location_Code = p.Location_Code
      where p.Pickup_no = @no
      order by p.docket_no`, { no: pickupNo });
  return {
    pickupNo: s(h.pickup_no),
    pickupDate: iso(h.pickup_date),
    pickupTime: s(h.pickup_time),
    fromBranch: s(h.from_branch),
    pickupBy: s(h.PickUpByName || h.PickUpBy),
    pickupByMobile: s(h.PickUpByNo),
    docType: s(h.DockNonDock),
    challanNo: s(h.challan_no),
    cancelled: ['1', 'true'].includes(s(h.IsCancelled).toLowerCase()),
    createdBy: s(h.user_id),
    dockets: rows.map((r) => ({
      docketNo: s(r.docket_no), bookingDate: iso(r.booking_date), bookingMode: s(r.booking_mode), origin: s(r.origin_branch),
      consigner: s(r.Consigner_Name), consignee: s(r.consignee_name), location: s(r.Location_Name || r.Location_Code),
      packages: n(r.package), weight: n(r.weight), freight: n(r.freight), manifested: Boolean(s(r.manifest_status)),
    })),
  };
}

// ------------------------------------------------------------------ cancel

export async function cancelPickup(user, pickupNo) {
  const p = await getPickup(user, pickupNo);
  if (p.cancelled) throw conflict('This pickup is already cancelled');
  if (p.challanNo) {
    const ch = await query(
      "select top 1 1 from dispatch_master where challan_no = @c and Financial_Year = @fy and isnull(IsCancelled, '0') = '0'",
      { c: p.challanNo, fy: user.financialYear });
    if (ch.length) throw conflict('Pickup entry cannot be cancelled, challan is generated');
  }
  if (p.dockets.some((d) => d.manifested)) throw conflict('Pickup entry cannot be cancelled, manifest is generated');

  const res = await exec('usp_PickupEntry_Cancel',
    { Pickup_no: pickupNo, user_id: user.userId, Financial_Year: user.financialYear },
    { success: [sql().VarChar(1000), null] });
  if (s(res.output.success).toLowerCase() !== 'success') {
    throw new HttpError(422, s(res.output.success) || 'Pickup entry not cancelled');
  }
  return { pickupNo, message: 'Pickup entry cancelled successfully' };
}
