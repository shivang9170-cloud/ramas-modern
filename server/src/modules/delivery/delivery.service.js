// Delivery status entry — port of:
//   wwwroot/Operation/deliverystatusentry.aspx(.cs)          DRS-wise (door delivery) and godown delivery
//   wwwroot/Operation/deliverystatusentry_Cancel.aspx(.cs)   list / cancel (per DRS, admin only)
//   wwwroot/Operation/deliverystatusentry_view.aspx(.cs)     list
//   ClassLibrary/dal/delivery_status_entry_dal.cs, deliverystatusentry_Cancel_dal.cs
//
// Each docket gets DELIVERED / UNDELIVERED / RTO / LOST with date, time, receiver and
// remarks (a reason from Drs_status_reason when undelivered). To Pay dockets are billed
// automatically once delivered.
//
// Fixed legacy bugs (docs/SECURITY.md):
//   * every docket was saved with ~6 statements on separate connections, errors
//     swallowed — now one transaction;
//   * a DRS disappeared from the list as soon as ANY docket on it had a status, so the
//     remaining dockets could never be updated — now listed until every docket has one;
//   * already-delivered dockets were silently skipped yet reported as saved — refused;
//   * the status date was not checked — now on/after the DRS (or arrival) date, not future;
//   * UNDELIVERED reset grn_docket_charge.drs_statusC and arrival_packg for EVERY branch the
//     docket had been at — now this branch only;
//   * the To Pay auto bill ran for any status (also undelivered / lost) — now only on
//     delivery, after the save, and a billing failure no longer disappears silently;
//   * SQL built from docket numbers in the duplicate / bill checks — now parameters.
//
// Not ported: FTL docket-wise status (usp_GetFTL_DocketwiseList), franchisee delivery
// commission, direct delivery status (deliverystatusentrydirect.aspx), cancelling godown
// statuses (the legacy cancel works per DRS only).

import { exec, query, withTransaction, sql } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { logger } from '../../utils/logger.js';
import { finYr } from '../pickup/pickup.service.js';
import { round2 } from '../../../../shared/challanCalc.js';
import { s, n, iso, today } from '../../utils/values.js';

const unprocessable = (msg, details) => new HttpError(422, msg, details);

export const STATUSES = [
  { value: 'DLVRD', label: 'Delivered' },
  { value: 'UNDELIVERED', label: 'Undelivered' },
  { value: 'RTO', label: 'RTO (return to origin)' },
  { value: 'LOST', label: 'Lost' },
];
// The godown grid offered no UNDELIVERED.
const GODOWN_STATUSES = ['DLVRD', 'RTO', 'LOST'];

export async function options() {
  const reasons = await query('select status_reason from Drs_status_reason order by status_reason');
  return { statuses: STATUSES, godownStatuses: GODOWN_STATUSES, undeliveredReasons: reasons.map((r) => s(r.status_reason)) };
}

// ------------------------------------------------------------------ what can get a status

/** select_all_drs_no — DRS at this branch that still have dockets without a status. */
export async function openDrs(user) {
  const rows = await query(
    `select d.Drs_no, d.Drs_date, d.Drs_time, d.DelBy, d.Vehicle_No,
            count(*) as dockets, sum(case when st.docket_no is null then 1 else 0 end) as open_dockets
       from drs_entry_details d
       join drs_entry_details_grn g on g.Drs_no = d.Drs_no and isnull(g.isCancel, 0) = 0
       outer apply (select top 1 x.docket_no from delivery_status_entry_details x
                     where x.drs_no = d.Drs_no and x.docket_no = g.docket_no and isnull(x.IsCancelled, 0) = 0) st
      where d.from_branch = @b and d.Division = @div and isnull(d.IsCancelled, 0) = 0
      group by d.Drs_no, d.Drs_date, d.Drs_time, d.DelBy, d.Vehicle_No
     having sum(case when st.docket_no is null then 1 else 0 end) > 0
      order by d.Drs_date, d.Drs_no`,
    { b: user.currentBranch.code, div: user.divCode });
  return rows.map((r) => ({
    drsNo: s(r.Drs_no), drsDate: iso(r.Drs_date), drsTime: s(r.Drs_time), deliveredBy: s(r.DelBy), vehicleNo: s(r.Vehicle_No),
    dockets: n(r.dockets), open: n(r.open_dockets),
  }));
}

/** select_docket_no_drs_no_wise — dockets on the DRS still without a status (and not delivered elsewhere). */
export async function drsDockets(user, drsNo) {
  const [d] = await query(
    'select Drs_no, Drs_date, DelBy from drs_entry_details where Drs_no = @no and from_branch = @b and isnull(IsCancelled, 0) = 0',
    { no: drsNo, b: user.currentBranch.code });
  if (!d) throw notFound(`DRS ${drsNo} not found at this branch`);
  const rows = await query(
    `select g.docket_no, g.packg, g.weight, g.freight, m.booking_date, m.booking_type, m.Consigner_Name, m.consignee_name
       from drs_entry_details_grn g
       join grn_master m on m.docket_no = g.docket_no
      where g.Drs_no = @no and isnull(g.isCancel, 0) = 0
        and not exists (select 1 from delivery_status_entry_details x
                         where x.drs_no = g.Drs_no and x.docket_no = g.docket_no and isnull(x.IsCancelled, 0) = 0)
        and g.docket_no not in (select docket_no from delivery_status_entry_details where pkt_status = 'DLVRD' and isnull(IsCancelled, 0) = 0)
      order by g.docket_no`, { no: drsNo });
  return {
    drsNo: s(d.Drs_no),
    drsDate: iso(d.Drs_date),
    deliveredBy: s(d.DelBy),
    dockets: rows.map((r) => ({
      docketNo: s(r.docket_no), packages: n(r.packg), weight: round2(n(r.weight)), freight: round2(n(r.freight)),
      bookingDate: iso(r.booking_date), bookingType: s(r.booking_type), consigner: s(r.Consigner_Name), consignee: s(r.consignee_name),
    })),
  };
}

/** GET_GODOWN_DELIVERY_DOCKETS_IN_DRS_STATUS_ENTRY */
export async function godownDockets(user) {
  const { recordset } = await exec('GET_GODOWN_DELIVERY_DOCKETS_IN_DRS_STATUS_ENTRY', {
    Division: user.divCode, current_branch: user.currentBranch.code, Financial_Year: user.financialYear,
  });
  return recordset.map((r) => ({
    docketNo: s(r.docket_no), packages: n(r.packg), weight: round2(n(r.weight)), freight: round2(n(r.freight)),
    arrivalDate: iso(r.Arrival_date), bookingDate: iso(r.booking_date), consigner: s(r.consigner), consignee: s(r.consignee),
  }));
}

// ------------------------------------------------------------------ save

export async function saveStatuses(user, body) {
  const branch = user.currentBranch.code;
  const godown = body.mode === 'GODOWN';
  const nos = body.entries.map((e) => e.docketNo);
  if (new Set(nos).size !== nos.length) throw badRequest('The same docket is listed twice');

  let available; let minDate;
  if (godown) {
    available = new Map((await godownDockets(user)).map((d) => [d.docketNo, d]));
  } else {
    const drs = await drsDockets(user, body.drsNo);
    available = new Map(drs.dockets.map((d) => [d.docketNo, d]));
    minDate = drs.drsDate;
  }
  const { undeliveredReasons } = await options();
  const problems = [];
  for (const e of body.entries) {
    const d = available.get(e.docketNo);
    const lowest = godown ? d?.arrivalDate : minDate;
    if (!d) problems.push(`${e.docketNo}: not waiting for a delivery status here (already delivered or not on this ${godown ? 'branch' : 'DRS'})`);
    else if (godown && !GODOWN_STATUSES.includes(e.status)) problems.push(`${e.docketNo}: ${e.status} is not allowed for godown delivery`);
    else if (e.date > today()) problems.push(`${e.docketNo}: date cannot be in the future`);
    else if (lowest && e.date < lowest) problems.push(`${e.docketNo}: date is before the ${godown ? 'arrival' : 'DRS'} date (${lowest})`);
    else if (e.status === 'UNDELIVERED' && !undeliveredReasons.includes(e.reason)) problems.push(`${e.docketNo}: select the undelivered reason`);
  }
  if (problems.length) throw unprocessable('Some statuses cannot be saved', problems.map((message) => ({ path: 'entries', message })));

  const flag = godown ? 'Godown Delivery' : 'Drs_delivery_status_generate';
  await withTransaction(async (tx) => {
    for (const e of body.entries) {
      await exec('Insert_Delivery_status_entry_Details', {
        drs_no: godown ? '' : body.drsNo,
        docket_no: e.docketNo,
        pkt_status: e.status,
        rcv_date: e.date,
        rcv_time: e.time,
        rcvr_name: e.receiverName,
        rcvr_phone: e.receiverPhone,
        remarks: e.status === 'UNDELIVERED' ? e.reason : e.remarks,
        UserId: user.userId,
        Division: user.divCode,
        Financial_Year: user.financialYear,
        from_branch: branch,
      }, {}, { tx });
      const p = { d: e.docketNo, b: branch, f: flag, drs: body.drsNo ?? '' };
      // update_delivery_status_entry_Arrival_Packg — this branch's rows only
      await query(
        `update grn_docket_charge set drs_status_entry = @f where Docket_No = @d and branch = @b;
         update Arrival_Packg set Drs_delivery_status = @f where docket_no = @d and from_branch = @b and isnull(IsCancelled, 0) = 0;`,
        p, { tx });
      if (godown) {
        await query('update grn_master set drs_status = @f where docket_no = @d', p, { tx });
      } else {
        await query(
          `update grn_master set drs_status = @f where drs_no = @drs and docket_no = @d;
           update drs_entry_details_grn set Drs_delivery_status_Entry = @f where Drs_no = @drs and docket_no = @d;`, p, { tx });
      }
      if (e.status === 'UNDELIVERED') {
        await query('update grn_docket_charge set drs_statusC = null where Docket_No = @d and branch = @b', p, { tx });
      }
    }
    if (!godown) {
      const rows = body.entries.map((e) => available.get(e.docketNo));
      await exec('Insert_delivery_status_entry_grn', {
        drs_no: body.drsNo,
        docket_no: nos.join(','),
        total_freight: round2(rows.reduce((t, r) => t + r.freight, 0)),
        total_weight: round2(rows.reduce((t, r) => t + r.weight, 0)),
        toatal_packg: rows.reduce((t, r) => t + r.packages, 0),
        from_branch: branch,
        Division: user.divCode,
        Financial_Year: user.financialYear,
      }, {}, { tx });
      await query("update drs_entry_details set Drs_delivery_status_Entry = 'Drs_delivery_status_generate' where Drs_no = @drs",
        { drs: body.drsNo }, { tx });
    }
  });

  const billing = await autoBill(user, body.entries.filter((e) => e.status === 'DLVRD').map((e) => e.docketNo));
  const counts = body.entries.reduce((t, e) => ({ ...t, [e.status]: (t[e.status] ?? 0) + 1 }), {});
  return {
    saved: body.entries.length,
    counts,
    billed: billing.billed,
    billingErrors: billing.errors,
    message: `${body.entries.length} delivery status(es) saved`,
  };
}

/** CREATE_AUTO_CLIENT_BILL_AND_FINALIZE for delivered To Pay dockets not billed yet (legacy: best effort). */
async function autoBill(user, docketNos) {
  const billed = []; const errors = [];
  for (const no of docketNos) {
    try {
      const [g] = await query(
        `select booking_type, (select top 1 1 from client_bill_charge_details b where b.docket_no = g.docket_no) as billed
           from grn_master g where g.docket_no = @d`, { d: no });
      if (!g || s(g.booking_type) !== 'To Pay' || g.billed) continue;
      await withTransaction((tx) => exec('CREATE_AUTO_CLIENT_BILL_AND_FINALIZE', {
        Financial_Year: user.financialYear, branch_code: user.currentBranch.code, ShortYear: finYr(user.financialYear),
        docket_no: no, user_id: user.userId,
      }, {}, { tx }));
      billed.push(no);
    } catch (err) {
      logger.warn(`To Pay auto bill for ${no} failed: ${err.message}`);
      errors.push({ docketNo: no, message: 'Auto bill failed — raise the bill from Invoice' });
    }
  }
  return { billed, errors };
}

// ------------------------------------------------------------------ list / cancel

export async function listStatuses(user, { from, to, status = 'active', search = '', scope = 'mine' }) {
  const { recordset } = await exec('usp_search_DeliveryEntry', {
    booking_date1: from,
    booking_date2: to,
    currbranch: user.currentBranch.code,
    IsCancelled: status === 'cancelled' ? 1 : 0,
    Drs_no: search || null,
    user_id: `${scope === 'all' ? 'admin' : user.userId}%`,
    Financial_Year: user.financialYear,
    Division: user.divCode,
  });
  return recordset.map((r) => ({
    drsNo: s(r.drs_no),
    docketNo: s(r.docket_no),
    status: s(r.pkt_status),
    date: iso(r.rcv_date),
    time: s(r.rcv_time),
    receiver: s(r.rcvr_name),
    createdBy: s(r.user_id),
  }));
}

export async function cancelDrsStatuses(user, drsNo) {
  const branch = user.currentBranch.code;
  const live = await query(
    `select docket_no from delivery_status_entry_details
      where drs_no = @no and from_branch = @b and isnull(IsCancelled, 0) = 0`, { no: drsNo, b: branch });
  if (!live.length) throw notFound(`No delivery status to cancel on DRS ${drsNo}`);
  // Check_POD_status
  const pod = await query(
    `select top 1 p.docket_no from pod_dispatch p
      where isnull(p.IsCancelled, 0) = 0 and p.docket_no in
            (select docket_no from delivery_status_entry_details where drs_no = @no and isnull(IsCancelled, 0) = 0)`, { no: drsNo });
  if (pod.length) throw conflict('POD dispatch is generated, delivery status cannot be cancelled');
  const res = await exec('usp_Delivery_Status_Cancel', {
    Drs_no: drsNo, user_id: user.userId, Financial_Year: user.financialYear, branch_Code: branch,
  }, { success: [sql().VarChar(1000), null] });
  if (s(res.output.success).toLowerCase() !== 'success') throw unprocessable(s(res.output.success) || 'Delivery status not cancelled');
  return { drsNo, cancelled: live.length, message: 'Delivery status cancelled' };
}
