// Automatic pickup (user's choice 2026-10-08): the moment a docket is booked it goes on a pickup (PRS) — the open pickup of
// the same branch, the same booking date, the same consignee city and the same contents (document / non document); when
// there is none yet, a new one is made (pickup date = booking date, time = now, pickup boy left blank to fill later).
//
// "Open" pickup: not cancelled, no PRS challan / dispatch on it, none of its dockets manifested, and every docket on it has
// that consignee city (a hand-made pickup mixing cities is never touched).
// Location of the pickup row: the docket's origin location, else the branch's own location, else the branch's only
// pickup location. Runs in its own transaction after the docket is saved — a docket is never refused because of it.
import { exec, query, sql, withTransaction } from '../../db/index.js';
import { s, n, iso } from '../../utils/values.js';
import { finYr } from './pickup.service.js';

async function pickupLocation(user, docketLocation, tx) {
  if (s(docketLocation)) return s(docketLocation);
  const [b] = await query('select location from branch_master where branch_code = @b', { b: user.currentBranch.code }, { tx });
  if (s(b?.location)) return s(b.location);
  const loc = await exec('usp_Fill_BranchWise_Location', { branch_code: user.currentBranch.code }, {}, { tx });
  return loc.recordset.length === 1 ? s(loc.recordset[0].Location_Code) : '';
}

/** Put a newly booked docket on its pickup. Returns { pickupNo, created } or { skipped: reason }. */
export async function autoPickupForDocket(user, docketNo) {
  const [d] = await query(
    `select g.docket_no, g.booking_date, upper(ltrim(rtrim(isnull(g.consignee_city, '')))) as city, g.OriginLocation, g.docsNoneDocs,
            g.origin_branch, g.pickup_status, g.manifest_status, isnull(g.IsCancel, '0') as IsCancel,
            coalesce(c.pending_freight, c.freight, 0) as freight, coalesce(c.pending_weight, c.charge_weight, 0) as weight,
            coalesce(c.pending_package, c.pcs, 0) as packages
       from grn_master g
       left join grn_docket_charge c on c.docket_no = g.docket_no and isnull(c.branch, g.origin_branch) = g.origin_branch
      where g.docket_no = @no`, { no: docketNo });
  if (!d) return { skipped: 'docket not found' };
  if (s(d.origin_branch) !== user.currentBranch.code) return { skipped: 'booked at another branch' };
  if (s(d.pickup_status) || s(d.manifest_status)) return { skipped: 'already on a pickup / manifest' };
  if (!s(d.city)) return { skipped: 'no consignee city' };
  const date = iso(d.booking_date);
  const doc = s(d.docsNoneDocs) || '2';

  return withTransaction(async (tx) => {
    const location = await pickupLocation(user, d.OriginLocation, tx);
    if (!location) return { skipped: 'no pickup location for this branch — choose it on the Pickup page' };

    // the open pickup of this date + consignee city + contents (locked so two bookings at once share one pickup)
    const [open] = await query(
      `select top 1 pe.pickup_no from Pick_up_entry pe with (updlock, holdlock)
        where pe.from_branch = @b and pe.pickup_date = @d and isnull(pe.DockNonDock, '2') = @doc and isnull(pe.Division, '') = @div
          and isnull(pe.IsCancelled, '0') = '0' and isnull(pe.challan_no, '') = '' and isnull(pe.Dispatch_Status, '') = ''
          and exists (select 1 from Pick_Up_grn pg where pg.Pickup_no = pe.pickup_no)
          and not exists (select 1 from Pick_Up_grn pg join grn_master g on g.docket_no = pg.docket_no
                           where pg.Pickup_no = pe.pickup_no
                             and (upper(ltrim(rtrim(isnull(g.consignee_city, '')))) <> @city or isnull(g.manifest_status, '') <> ''))
        order by pe.pickup_no desc`,
      { b: user.currentBranch.code, d: date, doc, div: s(user.divCode), city: s(d.city) }, { tx });

    let pickupNo = s(open?.pickup_no);
    const created = !pickupNo;
    if (created) {
      const [br] = await query('select Short_Code from branch_master where branch_code = @b', { b: user.currentBranch.code }, { tx });
      const now = new Date();
      const res = await exec('usp_insert_PickUpEntry', {
        pickup_no: '', pickup_date: date, pickup_time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        from_branch: user.currentBranch.code, user_id: user.userId, Franchisee_Code: '', Financial_Year: user.financialYear,
        PickUpBy: '', PickUpByNo: '', ShortCode: s(br?.Short_Code), FinYr: finYr(user.financialYear), Division: user.divCode, DockNonDock: doc,
      }, { retval: [sql().VarChar(20), null] }, { tx });
      pickupNo = s(res.output.retval);
      if (!pickupNo) return { skipped: 'pickup number could not be generated' };
    }
    await query(
      `insert into Pick_Up_grn(docket_no, freight, package, weight, Pickup_no, Location_Code, Financial_Year, Division)
       values (@docket, @freight, @package, @weight, @pickup, @loc, @fy, @div);
       update grn_master set pickup_status = 'generated', DocketStatus = 'DOCKET AVAILABLE FOR PRS CHALLAN' where docket_no = @docket;`,
      { docket: docketNo, freight: n(d.freight), package: n(d.packages), weight: n(d.weight), pickup: pickupNo, loc: location,
        fy: user.financialYear, div: user.divCode }, { tx });
    return { pickupNo, created, city: s(d.city), date };
  });
}
