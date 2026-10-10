// Approvals — port of Setting/Special_Booking_Approval.aspx and Setting/Freight_THC_Margin_Approval.aspx.
//
// Special booking: a docket booked with a discount needs approval, level by level, by the size of the discount
// (btnapproved_Click): up to 10 % the branch manager's approval is final; 11–20 % needs the area manager as well;
// 21–70 % the division head as well; above 70 % a final approval after the division head. Status codes as saved in
// grn_master_splapl.Approve_status: "" → Aproved (branch manager) → FA (area manager) → SA (division head) → FinA (final);
// or Rejected.
//
// Freight / THC margin: a challan whose truck-hire (THC) freight leaves too little margin on the dockets' freight
// (margin % below the minimum) needs approval; a rejected challan is cancelled (Cancel_Challan).
//
// Changes from the pages (docs/MIGRATION.md "Settings"):
//   * special booking: the next status is worked out on the server from the saved discount (the page read the
//     discount, freight and status from the grid cells posted by the browser); a docket with discount 0 and special
//     discount up to 10 % got no status at all and stayed pending — it is now final at the first approval;
//   * freight margin: the pending list is the challans of the login year / division / branch whose margin % is below
//     the minimum set on the page (the rules of GET_FREIGHT_THC_MARGIN_APPROVAL and its four approval levels BDM → AM →
//     Head → GM are not in the source — one approval decides; see docs/SCHEMA-VERIFICATION.md); a reject is refused
//     when the challan can no longer be cancelled (arrived), instead of being marked rejected with the challan alive.
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict } from '../../middleware/errors.js';
import { cancelChallan } from '../challan/challan.service.js';
import { s, n, iso, round2 } from '../../utils/values.js';

// ------------------------------------------------------------------ special booking

const STAGE_LABEL = {
  '': 'Pending', Aproved: 'Approved by Branch Manager', FA: 'Approved by Area Manager', SA: 'Approved by Division Head',
  FinA: 'Final approved', Rejected: 'Rejected',
};
// who approves next, and the columns that approval fills
const LEVEL = {
  '': { by: 'Branch Manager', user: 'User_Id', date: 'approval_date' },
  Aproved: { by: 'Area Manager', user: 'second_approval', date: 'sec_app_date' },
  FA: { by: 'Division Head', user: 'third_approval', date: 'thrdapprovaldate' },
  SA: { by: 'Final approver', user: 'final_approval', date: 'finalapprovaldate' },
};

/** btnapproved_Click's switch on the current status (d = discount %, sp = special discount %). */
function nextStatus(stage, d, sp) {
  switch (stage) {
    case '': return d !== 0 && d < 11 ? 'FinA' : d === 0 ? (sp > 10 ? 'Aproved' : 'FinA') : 'Aproved';
    case 'Aproved': return d !== 0 && d > 10 && d < 21 ? 'FinA' : d === 0 ? (sp > 20 ? 'FA' : 'FinA') : 'FA';
    case 'FA': return d !== 0 && d > 20 && d < 71 ? 'FinA' : d === 0 ? (sp > 20 && sp > 70 ? 'SA' : 'FinA') : 'SA';
    case 'SA': return 'FinA';
    default: return null;
  }
}

const SPECIAL_SELECT = `
  select g.docket_no, g.booking_date, g.booking_type, g.on_account_of, g.consigner_name, g.consignee_name, g.Division,
         ob.branch_name as origin_name, db.branch_name as dest_name, g.destination,
         c.pcs, c.actual_weight, c.charge_weight, c.freight, c.docket_rate, isnull(c.Discount, 0) as Discount,
         a.Approve_status, a.remarks, a.User_Id, a.approval_date, a.second_approval, a.sec_app_date, a.third_approval,
         a.thrdapprovaldate, a.final_approval, a.finalapprovaldate, a.rejected, a.rejected_date
    from grn_master g
    join grn_docket_charge c on c.Docket_No = g.docket_no
    left join grn_master_splapl a on a.docket_no = g.docket_no
    left join branch_master ob on ob.branch_code = g.origin_branch
    left join branch_master db on db.branch_code = g.destination_branch`;

const mapSpecial = (r) => {
  const stage = s(r.Approve_status);
  const d = n(r.Discount);
  return {
    docketNo: s(r.docket_no), bookingDate: iso(r.booking_date), bookingType: s(r.booking_type), onAccountOf: s(r.on_account_of),
    consignor: s(r.consigner_name), consignee: s(r.consignee_name), origin: s(r.origin_name), destination: s(r.dest_name) || s(r.destination),
    packages: n(r.pcs), actualWeight: n(r.actual_weight), chargeWeight: n(r.charge_weight), freight: n(r.freight), rate: n(r.docket_rate),
    discount: d, specialDiscount: d, stage, stageLabel: STAGE_LABEL[stage] ?? stage, nextApprover: LEVEL[stage]?.by ?? '',
    remarks: s(r.remarks),
    history: [
      r.User_Id && { level: 'Branch Manager', by: s(r.User_Id), date: iso(r.approval_date) },
      r.second_approval && { level: 'Area Manager', by: s(r.second_approval), date: iso(r.sec_app_date) },
      r.third_approval && { level: 'Division Head', by: s(r.third_approval), date: iso(r.thrdapprovaldate) },
      r.final_approval && { level: 'Final', by: s(r.final_approval), date: iso(r.finalapprovaldate) },
      r.rejected && { level: 'Rejected', by: s(r.rejected), date: iso(r.rejected_date) },
    ].filter(Boolean),
  };
};

const scope = (user) => ({ div: s(user.divCode), br: user.role === 'admin' ? '' : s(user.currentBranch?.code) });

/** getGridDtl: discounted dockets of the division (and branch) still waiting for an approval. */
export async function pendingSpecial(user) {
  const rows = await query(
    `${SPECIAL_SELECT}
      where isnull(g.IsCancel, 0) = 0 and isnull(c.Discount, 0) > 0 and (@div = '' or g.Division = @div)
        and (@br = '' or g.origin_branch = @br) and isnull(a.Approve_status, '') not in ('FinA', 'Rejected')
      order by g.booking_date, g.docket_no`, scope(user));
  return rows.map(mapSpecial);
}

/** getGridDtl_view: the decided ones. */
export async function decidedSpecial(user, search = '') {
  const rows = await query(
    `${SPECIAL_SELECT}
      where a.docket_no is not null and (@div = '' or g.Division = @div) and (@br = '' or g.origin_branch = @br)
        and (@q = '' or g.docket_no like @q + '%' or g.on_account_of like '%' + @q + '%')
      order by g.booking_date desc, g.docket_no`, { ...scope(user), q: search });
  return rows.map(mapSpecial);
}

async function lockSpecial(tx, user, docketNo) {
  const [r] = await query(
    `${SPECIAL_SELECT} where g.docket_no = @d and isnull(g.IsCancel, 0) = 0 and (@div = '' or g.Division = @div) and (@br = '' or g.origin_branch = @br)`,
    { d: docketNo, ...scope(user) }, { tx });
  if (!r) throw badRequest(`Docket ${docketNo} not found in your division / branch`);
  const row = mapSpecial(r);
  if (!(row.discount > 0)) throw badRequest(`Docket ${docketNo} has no discount to approve`);
  if (row.stage === 'FinA' || row.stage === 'Rejected') throw conflict(`Docket ${docketNo} is already ${row.stageLabel.toLowerCase()}`);
  return { row };
}

/** btnapproved_Click: each ticked docket moves one level up. */
export async function approveSpecial(user, items) {
  return withTransaction(async (tx) => {
    const out = [];
    for (const it of items) {
      const { row } = await lockSpecial(tx, user, it.docketNo);
      const next = nextStatus(row.stage, row.discount, row.specialDiscount);
      const level = LEVEL[row.stage];
      const [saved] = await query('select slno from grn_master_splapl with (updlock, holdlock) where docket_no = @d', { d: it.docketNo }, { tx });
      if (saved) {
        await query(
          `update grn_master_splapl set Approve_status = @st, ${level.user} = @u, ${level.date} = getdate(), remarks = @rm where docket_no = @d`,
          { st: next, u: user.userId, rm: it.remarks, d: it.docketNo }, { tx });
      } else {
        await query(
          `insert into grn_master_splapl(docket_no, originbranch, destinationbranch, Consigner_Name, consignee_name, pcs, actual_weight,
             charge_weight, freight, Rate, Discount, spldiscount, Division, booking_type, booking_date, on_account_of, Approve_status,
             User_Id, approval_date, remarks)
           values (@d, @o, @de, @cn, @ce, @p, @aw, @cw, @f, @r, @di, @sp, @div, @bt, @bd, @oa, @st, @u, getdate(), @rm)`,
          { d: row.docketNo, o: row.origin, de: row.destination, cn: row.consignor, ce: row.consignee, p: row.packages, aw: row.actualWeight,
            cw: row.chargeWeight, f: row.freight, r: row.rate, di: row.discount, sp: row.specialDiscount, div: s(user.divCode),
            bt: row.bookingType, bd: row.bookingDate || null, oa: row.onAccountOf, st: next, u: user.userId, rm: it.remarks }, { tx });
      }
      out.push({ docketNo: it.docketNo, status: next, statusLabel: STAGE_LABEL[next], final: next === 'FinA' });
    }
    return { results: out, message: `${out.length} docket(s) approved` };
  });
}

/** btnreject_Click (UPDATE_REJECT_STATUS_IN_GRN_MASTER_SPLAPL). */
export async function rejectSpecial(user, items) {
  return withTransaction(async (tx) => {
    for (const it of items) {
      const { row } = await lockSpecial(tx, user, it.docketNo);
      const [saved] = await query('select slno from grn_master_splapl with (updlock, holdlock) where docket_no = @d', { d: it.docketNo }, { tx });
      if (saved) {
        await query(`update grn_master_splapl set Approve_status = 'Rejected', rejected = @u, rejected_date = getdate(), remarks = @rm where docket_no = @d`,
          { u: user.userId, rm: it.remarks, d: it.docketNo }, { tx });
      } else {
        await query(
          `insert into grn_master_splapl(docket_no, Discount, spldiscount, Division, booking_date, on_account_of, Approve_status, rejected, rejected_date, remarks)
           values (@d, @di, @sp, @div, @bd, @oa, 'Rejected', @u, getdate(), @rm)`,
          { d: row.docketNo, di: row.discount, sp: row.specialDiscount, div: s(user.divCode), bd: row.bookingDate || null, oa: row.onAccountOf,
            u: user.userId, rm: it.remarks }, { tx });
      }
    }
    return { rejected: items.length, message: `${items.length} docket(s) rejected` };
  });
}

// ------------------------------------------------------------------ freight / THC margin

export async function marginSetting() {
  const [r] = await query('select Min_Margin_Per from Freight_Margin_Setting where id = 1');
  return { minMarginPercent: n(r?.Min_Margin_Per) };
}

export async function saveMarginSetting(user, minMarginPercent) {
  await query(
    `merge Freight_Margin_Setting as t using (select 1 as id) as x on t.id = x.id
      when matched then update set Min_Margin_Per = @m, modified_by = @u, modified_date = getdate()
      when not matched then insert (id, Min_Margin_Per, modified_by, modified_date) values (1, @m, @u, getdate());`,
    { m: minMarginPercent, u: user.userId });
  return { minMarginPercent, message: `Minimum margin set to ${minMarginPercent} %` };
}

const MARGIN_SELECT = `
  select d.challan_no, d.challan_date, d.from_branch, d.total_freight, bm.branch_name,
         (select isnull(sum(g.freight), 0) from Manifest_grn g where g.challan_no = d.challan_no) as docket_freight,
         (select count(distinct g.docket_no) from Manifest_grn g where g.challan_no = d.challan_no) as dockets
    from dispatch_master d left join branch_master bm on bm.branch_code = d.from_branch`;

const withMargin = (r) => {
  const docket = n(r.docket_freight);
  const thc = n(r.total_freight);
  const margin = round2(docket - thc);
  return {
    challanNo: s(r.challan_no), challanDate: iso(r.challan_date), branch: s(r.from_branch), branchName: s(r.branch_name),
    dockets: n(r.dockets), docketFreight: docket, thcFreight: thc, margin, marginPercent: docket > 0 ? round2((margin / docket) * 100) : -100,
  };
};

/** GET_FREIGHT_THC_MARGIN_APPROVAL: undecided challans below the minimum margin. */
export async function pendingMargin(user) {
  const { minMarginPercent } = await marginSetting();
  const rows = await query(
    `${MARGIN_SELECT}
      where isnull(d.IsCancelled, 0) = 0 and d.Financial_Year = @fy and (@div = '' or d.div_code = @div) and (@br = '' or d.from_branch = @br)
        and not exists (select 1 from Freight_THC_Margin_Approval_Details a where a.challan_no = d.challan_no)
      order by d.challan_date, d.challan_no`, { fy: user.financialYear, ...scope(user) });
  return { minMarginPercent, challans: rows.map(withMargin).filter((c) => c.marginPercent < minMarginPercent) };
}

/** GET_FREIGHT_THC_MARGIN_APPROVAL_DETAILS_LIST. */
export async function decidedMargin(user, search = '') {
  const rows = await query(
    `select a.*, d.challan_date, bm.branch_name from Freight_THC_Margin_Approval_Details a
       left join dispatch_master d on d.challan_no = a.challan_no left join branch_master bm on bm.branch_code = a.branch_code
      where (@div = '' or a.div_code = @div) and (@br = '' or a.branch_code = @br) and (@q = '' or a.challan_no like @q + '%')
      order by a.ID desc`, { ...scope(user), q: search });
  return rows.map((r) => ({
    id: Number(r.ID), challanNo: s(r.challan_no), challanDate: iso(r.challan_date), branchName: s(r.branch_name),
    docketFreight: n(r.docket_freight), thcFreight: n(r.thc_freight), margin: n(r.margin), marginPercent: n(r.margin_per),
    approved: Boolean(r.IsApprove), remarks: s(r.remarks), by: s(r.approved_by), date: iso(r.approved_date),
  }));
}

/** btn_margin_approval_Click / btn_margin_reject_Click. */
export async function decideMargin(user, { approve, items }) {
  const pending = new Map((await pendingMargin(user)).challans.map((c) => [c.challanNo, c]));
  const missing = items.filter((it) => !pending.has(it.challanNo)).map((it) => it.challanNo);
  if (missing.length) throw conflict(`Not waiting for approval: ${missing.join(', ')}`);
  const done = [];
  for (const it of items) {
    const c = pending.get(it.challanNo);
    if (!approve) await cancelChallan(user, it.challanNo);         // Cancel_Challan (refused after arrival)
    await query(
      `insert into Freight_THC_Margin_Approval_Details(challan_no, branch_code, div_code, docket_freight, thc_freight, margin, margin_per,
         IsApprove, remarks, approved_by)
       values (@c, @b, @div, @df, @tf, @m, @mp, @a, @rm, @u)`,
      { c: it.challanNo, b: c.branch, div: s(user.divCode), df: c.docketFreight, tf: c.thcFreight, m: c.margin, mp: c.marginPercent,
        a: approve ? 1 : 0, rm: it.remarks, u: user.userId });
    done.push(it.challanNo);
  }
  return { challans: done, message: `${done.length} challan(s) ${approve ? 'approved' : 'rejected and cancelled'}` };
}
