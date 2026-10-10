// Arrival entry (receiving a road challan's manifests at a branch) — port of:
//   wwwroot/Operation/Arrival_Entry.aspx(.cs)          create (branch wise)
//   wwwroot/Operation/Arrival_Entry_Cancel.aspx(.cs)   list / cancel
//   wwwroot/Operation/Arrival_Entry_View.aspx(.cs)     list / view
//   ClassLibrary/dal/Arrival_dal.cs, Arrival_Cancel_Dal.cs (and bin/ClassLibrary.dll, which is
//   newer than that source)
//
// The branch picks a challan carrying manifests for it, ticks the dockets that were
// actually received (packages can be fewer than manifested — the rest are "short") and
// saves. sp_insert_Arrival_Entry writes the arrival, its dockets, the "docket now lies
// here" grn_docket_charge rows and every status flag in one call.
//
// Fixed legacy bugs (docs/SECURITY.md):
//   * the header and ~10 statements per docket ran on separate connections with errors
//     swallowed — a failure half-way left a partial arrival; now one transaction;
//   * duplicate dockets were silently skipped and reported as saved; now refused;
//   * received weight / freight were taken from the browser; now prorated here from
//     Manifest_grn (weight may be corrected, freight never);
//   * the arrival-cancel DRS check looked at every branch's arrival of the challan,
//     so a DRS at one stop blocked cancelling at another — now this branch only;
//   * the trip-voucher close (update_TripCreationVoucher) never bound its parameters
//     and the vehicle-status update concatenated SQL — now parameterised (fleet DB).
//
// Excess dockets (txt_excess_docket_no / grd_excess_docket): a docket that came on this truck
// though its manifest is on another challan is scanned and received in full with the arrival
// (IsExcessArrival = 1). Its own manifest is closed once all its dockets have arrived, and
// opened again when the arrival is cancelled.
//
// Not ported: city-wise (FTL, DIV1003) arrival, short-arrival follow-up
// (Short_Arrival_Entry.aspx), master-bag / packet manifests, arrival edit and the arrival print.

import { config } from '../../config.js';
import { exec, query, sql, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { logger } from '../../utils/logger.js';
import { finYr } from '../pickup/pickup.service.js';
import { round2 } from '../../../../shared/challanCalc.js';
import { s, n, iso, today } from '../../utils/values.js';

const notCancelled = (col) => `cast(isnull(${col}, 0) as varchar(5)) in ('0', 'false')`;
const unprocessable = (msg, details) => new HttpError(422, msg, details);

// ------------------------------------------------------------------ pending challans

/** Search_Challan_no: challans carrying manifests for this branch not yet received. */
export async function pendingChallans(user, { from, to }) {
  const rows = await query(
    `select dm.challan_no, dm.challan_date, dm.challan_time, dm.truck_no, dm.mode_code,
            fb.branch_name as from_name, r.route_name,
            count(distinct me.mainfest_no) as manifests,
            sum(t.package) as packages, sum(t.weight) as weight
       from dispatch_master dm
       join mainfest_entry me on me.challan_no = dm.challan_no
       cross apply (select isnull(sum(g.package), 0) as package, isnull(sum(g.weight), 0) as weight
                      from Manifest_grn g where g.Manifest_no = me.mainfest_no) t
       left join branch_master fb on fb.branch_code = dm.from_branch
       left join route r on r.route_code = dm.route_code
      where me.to_branch = @branch and me.div_code = @div
        and me.Dispatch_Status = 'IsActive' and me.Arrived_status is null
        and ${notCancelled('dm.IsCancelled')}
        and dm.challan_date between @from and @to
      group by dm.challan_no, dm.challan_date, dm.challan_time, dm.truck_no, dm.mode_code, fb.branch_name, r.route_name
      order by dm.challan_date, dm.challan_no`,
    { branch: user.currentBranch.code, div: user.divCode, from, to });
  return rows.map((r) => ({
    challanNo: s(r.challan_no),
    challanDate: iso(r.challan_date),
    challanTime: s(r.challan_time),
    truckNo: s(r.truck_no),
    mode: s(r.mode_code),
    from: s(r.from_name),
    route: s(r.route_name),
    manifests: n(r.manifests),
    packages: n(r.packages),
    weight: round2(n(r.weight)),
  }));
}

/** select_Dispatch_Details + OpeningClosingKM + select_DocketList_Details for one challan. */
export async function challanForArrival(user, challanNo) {
  const branch = user.currentBranch.code;
  const [d] = await query(
    `select dm.challan_no, dm.challan_date, dm.challan_time, dm.truck_no, dm.seal_no, dm.opening_meter, dm.closing_meter,
            dm.TPNO, dm.route_code, dm.IsCancelled, fb.branch_name as from_name, r.route_name, r.route_type
       from dispatch_master dm
       left join branch_master fb on fb.branch_code = dm.from_branch
       left join route r on r.route_code = dm.route_code
      where dm.challan_no = @c`, { c: challanNo });
  if (!d || !['0', 'false', ''].includes(s(d.IsCancelled).toLowerCase())) throw notFound(`Challan ${challanNo} not found`);

  const manifests = await query(
    `select me.mainfest_no, me.mainfest_date, me.m_manual_no, fb.branch_name as from_name,
            (select isnull(sum(package), 0) from Manifest_grn g where g.Manifest_no = me.mainfest_no) as package,
            (select isnull(sum(weight), 0) from Manifest_grn g where g.Manifest_no = me.mainfest_no) as weight
       from mainfest_entry me left join branch_master fb on fb.branch_code = me.from_branch
      where me.challan_no = @c and me.to_branch = @branch and me.div_code = @div
        and me.Dispatch_Status = 'IsActive' and me.Arrived_status is null
      order by me.mainfest_no`, { c: challanNo, branch, div: user.divCode });
  if (!manifests.length) throw notFound(`No manifests on challan ${challanNo} are waiting for arrival at this branch`);

  const params = {};
  const inList = manifests.map((m, i) => { params[`m${i}`] = s(m.mainfest_no); return `@m${i}`; }).join(',');
  const dockets = await query(
    `select mg.Manifest_no, mg.docket_no, mg.package, mg.weight, mg.freight, g.booking_date, g.Consigner_Name, g.consignee_name,
            g.destination, ob.branch_name as origin
       from Manifest_grn mg
       join grn_master g on g.docket_no = mg.docket_no
       left join branch_master ob on ob.branch_code = g.origin_branch
      where mg.Manifest_no in (${inList}) and mg.Arrival_status is null
      order by mg.Manifest_no, mg.docket_no`, params);

  // OpeningClosingKM: a multi-stop trip continues from the previous stop's closing km.
  const [prev] = await query(
    `select top 1 ClosingKM, TPNO from Arrival_entry where challan_no = @c and isnull(IsCancelled, 0) = 0 order by slno desc`,
    { c: challanNo });

  return {
    challanNo: s(d.challan_no),
    challanDate: iso(d.challan_date),
    challanTime: s(d.challan_time),
    truckNo: s(d.truck_no),
    sealNo: s(d.seal_no),
    from: s(d.from_name),
    route: s(d.route_name),
    routeType: s(d.route_type),
    openingKm: prev ? n(prev.ClosingKM) : n(d.opening_meter),
    tpNo: s(prev ? prev.TPNO : d.TPNO),
    manifests: manifests.map((m) => ({
      manifestNo: s(m.mainfest_no), manifestDate: iso(m.mainfest_date), manualNo: s(m.m_manual_no), from: s(m.from_name),
      packages: n(m.package), weight: round2(n(m.weight)),
    })),
    dockets: dockets.map((r) => ({
      manifestNo: s(r.Manifest_no),
      docketNo: s(r.docket_no),
      bookingDate: iso(r.booking_date),
      origin: s(r.origin),
      destination: s(r.destination),
      consigner: s(r.Consigner_Name),
      consignee: s(r.consignee_name),
      packages: n(r.package),
      weight: round2(n(r.weight)),
      freight: round2(n(r.freight)),
    })),
  };
}

// ------------------------------------------------------------------ excess dockets

/**
 * GET_DOCKET_DETAILS_FOR_EXCESS_DOCKET_ARRIVAL: a docket that arrived on this challan's truck though
 * its manifest (to this branch, dispatched, not yet received) went on another challan.
 */
export async function excessDocket(user, challanNo, docketNo) {
  const rows = await query(
    `select mg.Manifest_no, mg.docket_no, mg.package, mg.weight, mg.freight, me.challan_no, me.Dispatch_Status,
            g.booking_date, g.Consigner_Name, g.consignee_name, g.destination, ob.branch_name as origin
       from Manifest_grn mg
       join mainfest_entry me on me.mainfest_no = mg.Manifest_no
       join grn_master g on g.docket_no = mg.docket_no
       left join branch_master ob on ob.branch_code = g.origin_branch
      where mg.docket_no = @d and me.to_branch = @b and me.div_code = @div and ${notCancelled('me.IsCancelled')}
        and mg.Arrival_status is null
      order by me.mainfest_date desc, me.mainfest_no desc`,
    { d: docketNo, b: user.currentBranch.code, div: user.divCode });
  if (!rows.length) throw notFound(`${docketNo}: not on any manifest to this branch that is waiting for arrival`);
  if (rows.some((r) => s(r.challan_no) === challanNo)) throw badRequest(`${docketNo} is on this challan — tick it in the docket list`);
  const r = rows.find((x) => s(x.Dispatch_Status) === 'IsActive' && s(x.challan_no));
  if (!r) throw badRequest(`${docketNo}: its manifest ${s(rows[0].Manifest_no)} has not been dispatched on a challan yet`);
  return {
    excess: true,
    manifestNo: s(r.Manifest_no),
    challanNo: s(r.challan_no),
    docketNo: s(r.docket_no),
    bookingDate: iso(r.booking_date),
    origin: s(r.origin),
    destination: s(r.destination),
    consigner: s(r.Consigner_Name),
    consignee: s(r.consignee_name),
    packages: n(r.package),
    weight: round2(n(r.weight)),
    freight: round2(n(r.freight)),
  };
}

// ------------------------------------------------------------------ create

/** Received weight / freight for `packages` of a manifested docket (txtpendingpackage_TextChanged). */
function prorate(row, packages) {
  if (!row.packages) return { weight: 0, freight: 0 };
  return { weight: round2((row.weight / row.packages) * packages), freight: round2((row.freight / row.packages) * packages) };
}

export async function createArrival(user, body) {
  const branch = user.currentBranch.code;
  if (body.receiveDate > today()) throw badRequest('Receive date should not be greater than current date');
  const c = await challanForArrival(user, body.challanNo);
  if (body.receiveDate < c.challanDate) throw badRequest('Receive date should not be before the challan date');

  const key = (m, d) => `${m}|${d}`;
  const onChallan = new Map(c.dockets.map((d) => [key(d.manifestNo, d.docketNo), d]));
  const seen = new Set();
  const problems = [];
  const rows = [];
  for (const r of body.dockets) {
    const k = key(r.manifestNo, r.docketNo);
    const m = onChallan.get(k);
    if (seen.has(k)) { problems.push(`${r.docketNo}: listed twice`); continue; }
    seen.add(k);
    if (!m) { problems.push(`${r.docketNo}: not on a manifest of this challan waiting at this branch`); continue; }
    if (r.packages > m.packages) { problems.push(`${r.docketNo}: received packets cannot be greater than manifested packets (${m.packages})`); continue; }
    const p = prorate(m, r.packages);
    rows.push({ ...m, received: r.packages, weight: r.weight ?? p.weight, freight: p.freight, remarks: r.remarks, booked: m });
  }
  // Excess dockets come in full (the page's received packets box was disabled); weight may be corrected.
  const excess = [];
  for (const r of body.excess ?? []) {
    if (rows.some((x) => x.docketNo === r.docketNo) || excess.some((x) => x.docketNo === r.docketNo)) {
      problems.push(`${r.docketNo}: listed twice`); continue;
    }
    try {
      const m = await excessDocket(user, c.challanNo, r.docketNo);
      excess.push({ ...m, received: m.packages, weight: r.weight ?? m.weight, freight: m.freight, remarks: r.remarks, booked: m });
    } catch (e) { problems.push(e.message); }
  }
  if (problems.length) throw unprocessable('Some dockets cannot be received', problems.map((message) => ({ path: 'dockets', message })));
  if (!rows.length && !excess.length) throw badRequest('Select at least one docket');

  // The weight check is for this challan's manifests; excess dockets are extra.
  const actual = round2(c.manifests.reduce((t, m) => t + m.weight, 0));
  const inward = round2(rows.reduce((t, r) => t + r.weight, 0));
  const diff = round2(actual - inward);
  if (inward === 0 && !excess.length) throw unprocessable('Inward weight cannot be 0');
  if (diff !== 0 && !body.message) {
    throw badRequest(`Remarks are required when the inward weight differs from the manifest weight (difference ${diff} kg)`);
  }
  if (c.openingKm !== 0 && !(n(body.closingKm) > c.openingKm)) {
    throw badRequest(`Closing KM must be greater than the opening KM (${c.openingKm})`);
  }

  const [b] = await query('select Short_Code from branch_master where branch_code = @b', { b: branch });
  const S = sql();
  const tvp = new S.Table(config.tvp.arrivalEntry);
  tvp.columns.add('docket_no', S.VarChar(30));
  tvp.columns.add('manifest_no', S.VarChar(30));
  tvp.columns.add('package', S.Int);
  tvp.columns.add('weight', S.Decimal(18, 2));
  tvp.columns.add('freight', S.Decimal(18, 2));
  tvp.columns.add('booked_package', S.Int);
  tvp.columns.add('booked_weight', S.Decimal(18, 2));
  tvp.columns.add('booked_freight', S.Decimal(18, 2));
  tvp.columns.add('Remarks', S.VarChar(500));
  tvp.columns.add('IsExcessArrival', S.Bit);
  for (const r of [...rows, ...excess]) {
    tvp.rows.add(r.docketNo, r.manifestNo, r.received, r.weight, r.freight, r.booked.packages, r.booked.weight, r.booked.freight, r.remarks,
      Boolean(r.excess));
  }
  // Manifests are received as a whole ("Please select all the manifest!"); dockets not
  // ticked stay unreceived on the manifest (short).
  const manifestNos = c.manifests.map((m) => m.manifestNo);

  const arrivalNo = await withTransaction(async (tx) => {
    const res = await exec('sp_insert_Arrival_Entry', {
      dtArrival_Entry: { type: S.TVP, value: tvp },
      challan_no: c.challanNo,
      Receive_Date: body.receiveDate,
      Receive_time: body.receiveTime,
      Manifest_no: manifestNos.join(','),
      Message: body.message,
      user_id: user.userId,
      from_branch: branch,
      docket_No: '0',
      Rcv_Packg: 0,
      Remarks: '',
      rcv_wt: 0,
      rcv_frt: 0,
      sealno: c.sealNo,
      OpeningKM: String(c.openingKm),
      ClosingKM: body.closingKm === undefined || body.closingKm === null ? '' : String(body.closingKm),
      TPNO: c.tpNo,
      Financial_Year: user.financialYear,
      FinYr: finYr(user.financialYear),
      actualwt: actual,
      inwardwt: inward,
      diffwt: diff,
      div_code: user.divCode,
      ShortCode: s(b?.Short_Code),
    }, { retval: [S.VarChar(500), null] }, { tx });
    const msg = s(res.output.retval);
    // Legacy returns 'success' (Insert_into_arrival) or the new number (Insert_into_arrivaldal).
    if (/^AE/i.test(msg)) return msg;
    if (msg.toLowerCase() !== 'success') {
      throw (/already arrived/i.test(msg) ? conflict(msg) : unprocessable(msg || 'Arrival could not be saved'));
    }
    const [a] = await query(
      `select top 1 ArrivalNo from Arrival_entry where challan_no = @c and from_branch = @b and isnull(IsCancelled, 0) = 0 order by slno desc`,
      { c: c.challanNo, b: branch }, { tx });
    await closeExcessManifests(tx, excess.map((r) => r.manifestNo));
    return s(a?.ArrivalNo);
  });

  await updateFleet(c, branch, user.divCode);

  const short = c.dockets.length - rows.length;
  return {
    arrivalNo,
    challanNo: c.challanNo,
    received: rows.length,
    excess: excess.length,
    short,
    totals: { actualWeight: actual, inwardWeight: inward, difference: diff, packages: [...rows, ...excess].reduce((t, r) => t + r.received, 0) },
    message: `Arrival ${arrivalNo} saved — ${rows.length} docket(s) received${excess.length ? `, ${excess.length} excess` : ''}${short ? `, ${short} short` : ''}`,
  };
}

/** An excess docket's own manifest counts as arrived once none of its dockets is still on the way. */
async function closeExcessManifests(tx, manifestNos) {
  for (const m of [...new Set(manifestNos)]) {
    await query(
      `update mainfest_entry set Arrived_status = 'IsActive'
        where mainfest_no = @m and Arrived_status is null
          and not exists (select 1 from Manifest_grn g where g.Manifest_no = @m and g.Arrival_status is null)`, { m }, { tx });
  }
}

/** update_TripCreationVoucher + update_veh_status on the fleet (FMS) database — best effort, as before. */
async function updateFleet(c, branch, divCode) {
  if (!config.fleetDb || !c.truckNo) return;
  try {
    await query('update vechile_master set status = 1, currentloc = @b where VEHICLE_NO = @t', { b: branch, t: c.truckNo }, { db: 'fleet' });
    if (c.tpNo) {
      const col = divCode === 'DIV1003' ? 'allobranch' : 'ToBranch';
      await query(
        `update tavc set IsReachedAtDestination = 1, IsReachedAtOrigin = 1, Trip_Status = 'CLOSED', Trip_Close_Date = getdate(), CloseTime = ''
           from tbl_Advance_Voutcher_Create tavc join tbl_Advance_Voutcher_CreateSub tavcs on tavc.TPNO = tavcs.TPNO
          where tavc.truckno = @t and tavc.TPNO = @tp and tavcs.${col} = @b and tavcs.ChallanNo is not null`,
        { t: c.truckNo, tp: c.tpNo, b: branch }, { db: 'fleet' });
    }
  } catch (err) {
    logger.warn(`Fleet DB update after arrival of ${c.challanNo} failed: ${err.message}`);
  }
}

// ------------------------------------------------------------------ list / view

export async function listArrivals(user, { from, to, status = 'active', search = '', scope = 'mine' }) {
  const { recordset } = await exec('search_ArrivalEntry', {
    booking_date1: from,
    booking_date2: to,
    currbranch: user.currentBranch.code,
    user_id: `${scope === 'all' ? 'admin' : user.userId}%`,
    IsCancelled: status === 'cancelled' ? 1 : 0,
    challan_no: search || null,
    Financial_Year: user.financialYear,
    division: user.divCode,
  });
  return recordset.map((r) => ({
    arrivalNo: s(r.ArrivalNo),
    challanNo: s(r.challan_no),
    receiveDate: iso(r.receive_date ?? r.Receive_Date),
    receiveTime: s(r.Receive_time),
    truckNo: s(r.truck_no),
    from: s(r.dispatch_from),
    dockets: n(r.docket_count),
    packages: n(r.total_package),
    difference: n(r.diffwt),
    createdBy: s(r.user_id),
  }));
}

export async function getArrival(user, arrivalNo) {
  const [a] = await query(
    `select a.*, d.truck_no, fb.branch_name as dispatch_from
       from Arrival_entry a
       left join dispatch_master d on d.challan_no = a.challan_no
       left join branch_master fb on fb.branch_code = d.from_branch
      where a.ArrivalNo = @no and a.from_branch = @b`, { no: arrivalNo, b: user.currentBranch.code });
  if (!a) throw notFound(`Arrival ${arrivalNo} not found at this branch`);
  const rows = await query(
    `select p.manifest_no, p.docket_no, p.package, p.weight, p.freight, p.Remarks, p.drs_no, p.IsExcessArrival,
            mg.package as booked_package, g.Consigner_Name, g.consignee_name
       from Arrival_Packg p
       left join Manifest_grn mg on mg.docket_no = p.docket_no and mg.Manifest_no = p.manifest_no
       left join grn_master g on g.docket_no = p.docket_no
      where p.ArrivalNo = @no order by p.manifest_no, p.docket_no`, { no: arrivalNo });
  return {
    arrivalNo: s(a.ArrivalNo),
    challanNo: s(a.challan_no),
    receiveDate: iso(a.Receive_Date),
    receiveTime: s(a.Receive_time),
    truckNo: s(a.truck_no),
    from: s(a.dispatch_from),
    sealNo: s(a.seal_no),
    openingKm: s(a.OpeningKM),
    closingKm: s(a.ClosingKM),
    actualWeight: n(a.actualwt),
    inwardWeight: n(a.inwardwt),
    difference: n(a.diffwt),
    message: s(a.Message),
    cancelled: !['0', 'false', ''].includes(s(a.IsCancelled).toLowerCase()),
    createdBy: s(a.user_id),
    dockets: rows.map((r) => ({
      manifestNo: s(r.manifest_no), docketNo: s(r.docket_no), consigner: s(r.Consigner_Name), consignee: s(r.consignee_name),
      packages: n(r.package), bookedPackages: n(r.booked_package), weight: n(r.weight), freight: n(r.freight),
      remarks: s(r.Remarks), drsNo: s(r.drs_no), excess: Boolean(r.IsExcessArrival),
    })),
  };
}

// ------------------------------------------------------------------ cancel

export async function cancelArrival(user, arrivalNo) {
  const a = await getArrival(user, arrivalNo);
  if (a.cancelled) throw conflict('This arrival is already cancelled');
  // Check_Drs_Entry — for this branch's arrival only.
  const drs = await query(
    `select top 1 p.drs_no from Arrival_Packg p
       join Arrival_entry ae on ae.ArrivalNo = p.ArrivalNo
       join drs_entry_details d on d.drs_no = p.drs_no
      where p.challan_no = @c and ae.from_branch = @b and isnull(p.IsCancelled, 0) = 0 and isnull(d.IsCancelled, 0) = 0`,
    { c: a.challanNo, b: user.currentBranch.code });
  if (drs.length) throw conflict(`Arrival entry cannot be cancelled after DRS entry (${s(drs[0].drs_no)})`);
  // the excess dockets' own manifests (on other challans) open again
  const excessManifests = [...new Set(a.dockets.filter((d) => d.excess).map((d) => d.manifestNo))];
  await withTransaction(async (tx) => {
    const res = await exec('usp_Arrival_Cancel', {
      challan_no: a.challanNo, user_id: user.userId, Financial_Year: user.financialYear, branch_Code: user.currentBranch.code,
    }, { success: [sql().VarChar(1000), null] }, { tx });
    if (s(res.output.success).toLowerCase() !== 'success') throw unprocessable(s(res.output.success) || 'Arrival not cancelled');
    for (const m of excessManifests) {
      await query(
        `update mainfest_entry set Arrived_status = null
          where mainfest_no = @m and isnull(challan_no, '') <> @c and to_branch = @b`, { m, c: a.challanNo, b: user.currentBranch.code }, { tx });
    }
  });
  return { arrivalNo, challanNo: a.challanNo, message: 'Arrival entry cancelled successfully' };
}
