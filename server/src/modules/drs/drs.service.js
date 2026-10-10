// DRS (delivery run sheet) — port of:
//   wwwroot/Operation/Drs_Entry.aspx(.cs)          create ("MAIN" DRS at the delivering branch)
//   wwwroot/Operation/Drs_Entry_Cancel.aspx(.cs)   list / cancel
//   wwwroot/Operation/Drs_Entry_View.aspx(.cs)     list / view
//   ClassLibrary/dal/dal_drs_entry.cs, Drs_Cancel_Dal.cs
//
// Dockets that have arrived at this branch (and are delivered from here) go out with a
// delivery person; packets can be split across DRS runs. usp_insert_DRS saves the DRS,
// its dockets and the per-branch pending/status flags in one call.
//
// Fixed legacy bugs (docs/SECURITY.md):
//   * the DRS no. was worked out when the page opened (max + 1) and passed in, so two
//     users could save the same number — now generated inside the save transaction;
//   * the docket-number filter was ignored by the search (both branches ran the same
//     query) — now applied;
//   * dockets already out for delivery were silently skipped yet reported as saved, and
//     a DRS could be saved with no dockets — now refused;
//   * the header's docket list was always empty (built from a variable never filled);
//   * weight / freight for split packets and the total weight came from the browser —
//     now prorated / summed here; the DRS date must be on or after each docket's arrival.
//
//   * a DRS can be given to a franchisee (chkFranchisee / ddlFranchisee → Franchisee_Code, isFranchisee), from the
//     franchisees with an active branch binding.
//
// Not ported: direct DRS at the booking branch (Drs_Entry_direct.aspx), local DRS, DRS edit and the DRS print.

import { config } from '../../config.js';
import { exec, query, sql, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { finYr } from '../pickup/pickup.service.js';
import { round2 } from '../../../../shared/challanCalc.js';
import { s, n, iso, today } from '../../utils/values.js';
import { franchiseesForBranch } from '../bindings/bindings.service.js';

const unprocessable = (msg, details) => new HttpError(422, msg, details);

export async function options(user) {
  const staff = await query(
    `select empcode, empname, mobileno from employee_master
      where branch = @b and ',' + isnull(DivCode, '') + ',' like '%,' + @div + ',%' and isnull(IsActive, 1) = 1 order by empname`,
    { b: user.currentBranch.code, div: user.divCode });
  return {
    deliveryStaff: staff.map((e) => ({ value: s(e.empcode), label: s(e.empname), mobile: s(e.mobileno) })),
    franchisees: await franchiseesForBranch(user.currentBranch.code),
  };
}

const mapPending = (r) => ({
  docketNo: s(r.docket_no),
  challanNo: s(r.challan_no),
  arrivalDate: iso(r.Arrival_date),
  bookingDate: iso(r.booking_date),
  consigner: s(r.Consigner_Name ?? r.consigner_name),
  consignee: s(r.consignee_name),
  destination: s(r.destination),
  locationCode: s(r.LocCode),
  location: s(r.Location_Name),
  packages: n(r.package),
  weight: round2(n(r.weight)),
  freight: round2(n(r.freight)),
});

/** SEARCH_DOCKET_NO_FOR_DRS_ENTRY, with the docket filter the legacy page ignored. */
export async function pendingDockets(user, { from, to, dockets = [] }) {
  const { recordset } = await exec('SEARCH_DOCKET_NO_FOR_DRS_ENTRY', {
    branch_code: user.currentBranch.code, from_date: from, to_date: to,
    Financial_Year: user.financialYear, div_code: user.divCode,
  });
  const rows = recordset.map(mapPending);
  if (!dockets.length) return rows;
  const want = new Set(dockets.map((d) => d.toUpperCase()));
  return rows.filter((r) => want.has(r.docketNo.toUpperCase()));
}

// ------------------------------------------------------------------ create

export async function createDrs(user, body) {
  const branch = user.currentBranch.code;
  if (body.drsDate > today()) throw badRequest('DRS date should not be greater than current date');
  if (body.franchiseeCode && !(await franchiseesForBranch(branch)).some((f) => f.value === body.franchiseeCode)) {
    throw badRequest('Select a franchisee with an active branch binding');
  }
  const key = (d, c) => `${d}|${c}`;
  const keys = body.dockets.map((d) => key(d.docketNo, d.challanNo));
  if (new Set(keys).size !== keys.length) throw badRequest('The same docket is listed twice');

  // Re-read what is pending (whole financial year up to today) instead of trusting the screen.
  const fy = financialYearRange(user.financialYear);
  const pending = await pendingDockets(user, { from: fy.from, to: today(), dockets: body.dockets.map((d) => d.docketNo) });
  const byKey = new Map(pending.map((p) => [key(p.docketNo, p.challanNo), p]));
  const problems = [];
  const rows = [];
  for (const d of body.dockets) {
    const p = byKey.get(key(d.docketNo, d.challanNo));
    if (!p) { problems.push(`${d.docketNo}: not pending for delivery at this branch (already on a DRS, delivered or not arrived)`); continue; }
    if (d.packages > p.packages) { problems.push(`${d.docketNo}: only ${p.packages} packet(s) pending`); continue; }
    if (p.arrivalDate && body.drsDate < p.arrivalDate) { problems.push(`${d.docketNo}: arrived on ${p.arrivalDate}, after the DRS date`); continue; }
    const share = p.packages ? d.packages / p.packages : 1;
    const weight = d.packages === p.packages ? p.weight : round2(p.weight * share);
    const freight = d.packages === p.packages ? p.freight : round2(p.freight * share);
    rows.push({
      ...p, packg: d.packages, weight, freight,
      pendingPackage: p.packages - d.packages, pendingWeight: round2(p.weight - weight), pendingFreight: round2(p.freight - freight),
    });
  }
  if (problems.length) throw unprocessable('Some dockets cannot go on this DRS', problems.map((message) => ({ path: 'dockets', message })));

  const S = sql();
  const tvp = new S.Table(config.tvp.drsGrn);
  tvp.columns.add('docket_no', S.VarChar(30));
  tvp.columns.add('freight', S.Decimal(18, 2));
  tvp.columns.add('weight', S.Decimal(18, 2));
  tvp.columns.add('packg', S.Int);
  tvp.columns.add('Location', S.VarChar(60));
  tvp.columns.add('pending_Package', S.Int);
  tvp.columns.add('pending_freight', S.Decimal(18, 2));
  tvp.columns.add('pending_weight', S.Decimal(18, 2));
  tvp.columns.add('challan_no', S.VarChar(30));
  for (const r of rows) {
    tvp.rows.add(r.docketNo, r.freight, r.weight, r.packg, r.locationCode, r.pendingPackage, r.pendingFreight, r.pendingWeight, r.challanNo);
  }

  const [b] = await query('select Short_Code from branch_master where branch_code = @b', { b: branch });
  const shortCode = s(b?.Short_Code);
  const fyShort = finYr(user.financialYear);
  const totalWeight = round2(rows.reduce((t, r) => t + r.weight, 0));

  const drsNo = await withTransaction(async (tx) => {
    // Legacy maxid(): "DS" + ShortCode + FinYr + running number — now under a lock.
    const prefix = `DS${shortCode}${fyShort}`;
    const [last] = await query(
      `select top 1 Drs_no from drs_entry_details with (updlock, holdlock)
        where Drs_no like @p + '%' and len(Drs_no) = len(@p) + 6 order by Drs_no desc`, { p: prefix }, { tx });
    const next = (last ? Number(s(last.Drs_no).slice(-6)) : 0) + 1;
    const no = `${prefix}${String(next).padStart(6, '0')}`;

    const res = await exec('usp_insert_DRS', {
      dtDrs_entry_details_grn: { type: S.TVP, value: tvp },
      Drs_no: no,
      Drs_date: body.drsDate,
      Drs_time: body.drsTime,
      Location: rows.map((r) => r.locationCode).join(','),
      docket_no_list: rows.map((r) => r.docketNo).join(','),
      from_branch: branch,
      total_weight: totalWeight,
      empcode: user.userId,
      Franchisee_Code: body.franchiseeCode || '',
      DRSType: 'MAIN',
      isFranchisee: Boolean(body.franchiseeCode),
      Financial_Year: user.financialYear,
      DelBy: body.deliveredBy,
      DelByNo: body.deliveredByMobile,
      ShortCode: shortCode,
      FinYr: fyShort,
      Division: user.divCode,
      DockNonDock: 0,
      Driver_Name: body.driverName,
      Vehicle_No: body.vehicleNo,
    }, { retval: [S.VarChar(20), null] }, { tx });
    const msg = s(res.output.retval);
    if (msg.toLowerCase() !== 'success') throw unprocessable(msg || 'DRS could not be saved');
    return no;
  });

  return {
    drsNo,
    dockets: rows.length,
    packages: rows.reduce((t, r) => t + r.packg, 0),
    totalWeight,
    message: `DRS ${drsNo} saved with ${rows.length} docket(s)`,
  };
}

// ------------------------------------------------------------------ list / view

export async function listDrs(user, { from, to, status = 'active', search = '', scope = 'mine' }) {
  const { recordset } = await exec('usp_search_DrsEntry', {
    booking_date1: from,
    booking_date2: to,
    currbranch: user.currentBranch.code,
    user_id: `${scope === 'all' ? 'admin' : user.userId}%`,
    IsCancelled: status === 'cancelled' ? 1 : 0,
    Drs_no: search || null,
    DRSType: 'MAIN',
    Financial_Year: user.financialYear,
    division: user.divCode,
  });
  // The procedure returns one row per docket (the legacy grid hid the repeats).
  const byNo = new Map();
  for (const r of recordset) {
    const no = s(r.Drs_no);
    const cur = byNo.get(no) ?? {
      drsNo: no, drsDate: iso(r.Drs_date), drsTime: s(r.Drs_time), deliveredBy: s(r.DelBy), vehicleNo: s(r.Vehicle_No),
      challanNo: s(r.challan_no), createdBy: s(r.empcode), dockets: 0, packages: 0, weight: 0,
    };
    cur.dockets += 1;
    cur.packages += n(r.packg);
    cur.weight = round2(cur.weight + n(r.weight));
    byNo.set(no, cur);
  }
  return [...byNo.values()];
}

export async function getDrs(user, drsNo) {
  const [h] = await query(
    `select d.* from drs_entry_details d where d.Drs_no = @no and d.from_branch = @b`, { no: drsNo, b: user.currentBranch.code });
  if (!h) throw notFound(`DRS ${drsNo} not found at this branch`);
  const rows = await query(
    `select g.docket_no, g.packg, g.weight, g.freight, g.challan_no, g.Location, l.Location_Name, m.consignee_name, m.destination,
            (select top 1 pkt_status from delivery_status_entry_details s
              where s.docket_no = g.docket_no and s.drs_no = g.Drs_no and isnull(s.IsCancelled, 0) = 0) as pkt_status
       from drs_entry_details_grn g
       left join grn_master m on m.docket_no = g.docket_no
       left join New_Location_master l on l.Location_Code = g.Location
      where g.Drs_no = @no order by g.docket_no`, { no: drsNo });
  return {
    drsNo: s(h.Drs_no),
    drsDate: iso(h.Drs_date),
    drsTime: s(h.Drs_time),
    deliveredBy: s(h.DelBy),
    deliveredByMobile: s(h.DelByNo),
    driverName: s(h.Driver_Name),
    vehicleNo: s(h.Vehicle_No),
    totalWeight: n(h.total_weight),
    challanNo: s(h.challan_no),
    onChallan: Boolean(s(h.Dispatch_Status)),
    cancelled: !['0', 'false', ''].includes(s(h.IsCancelled).toLowerCase()),
    createdBy: s(h.empcode),
    dockets: rows.map((r) => ({
      docketNo: s(r.docket_no), packages: n(r.packg), weight: n(r.weight), freight: n(r.freight), challanNo: s(r.challan_no),
      location: s(r.Location_Name || r.Location), consignee: s(r.consignee_name), destination: s(r.destination), status: s(r.pkt_status),
    })),
  };
}

// ------------------------------------------------------------------ cancel

export async function cancelDrs(user, drsNo) {
  const d = await getDrs(user, drsNo);
  if (d.cancelled) throw conflict('This DRS is already cancelled');
  // CheckDrsChallanStatus
  if (d.onChallan) throw conflict(`DRS cannot be cancelled after challan entry${d.challanNo ? ` (${d.challanNo})` : ''} — cancel the challan first`);
  const statuses = await query(
    'select top 1 1 as x from delivery_status_entry_details where drs_no = @no and isnull(IsCancelled, 0) = 0', { no: drsNo });
  if (statuses.length) throw conflict('DRS cannot be cancelled after delivery status entry');
  const res = await exec('usp_DRS_Cancel', {
    Drs_no: drsNo, user_id: user.userId, Financial_Year: user.financialYear, Branch_Code: user.currentBranch.code,
  }, { success: [sql().VarChar(1000), null] });
  if (s(res.output.success).toLowerCase() !== 'success') throw unprocessable(s(res.output.success) || 'DRS not cancelled');
  return { drsNo, message: 'DRS cancelled successfully' };
}
