// Change docket financial year — port of Setting/ChangeDocket_FY.aspx.
//
// At the start of a new financial year, dockets of the previous year that are still moving are brought into the login
// year, stage by stage: not yet manifested (booking), manifested without challan, challan not arrived, arrived without
// DRS, on a DRS without challan, DRS challan not delivered, not yet billed. Each stage moves its own rows (and the
// docket's / challan's account entries) to the login financial year.
//
// Changes from the page (docs/MIGRATION.md "Settings"):
//   * every stage is one transaction per request (the page ran one UPDATE per docket, no transaction);
//   * docket numbers are parameters (they were concatenated into the SQL);
//   * "DRS challan" updated every row of Dispatch_Master (its UPDATE … FROM did not join Dispatch_Master) — now only
//     the DRS's own challan;
//   * a challan's account entries are moved only when every ledger exists in the new year (the page skipped a missing
//     ledger and still cancelled the old entry, losing it);
//   * the loading-sheet stage is not ported (Loading_Sheet is not in the new app yet).
import { query, exec, withTransaction } from '../../db/index.js';
import { badRequest, HttpError } from '../../middleware/errors.js';
import { s, iso } from '../../utils/values.js';

export const STAGES = {
  booking: 'Booked, not manifested',
  manifest: 'Manifested, no challan',
  challan: 'Challan, not arrived',
  arrival: 'Arrived, no DRS',
  drs: 'On DRS, no DRS challan',
  delivery: 'DRS challan, not delivered',
  bill: 'Not billed',
};

/** The login year and the year before it (txtfromdateOld / txtTodateOld). */
export function years(user) {
  const [a, b] = s(user.financialYear).split('-').map((x) => Number(x.trim()));
  if (!a || !b) throw badRequest('The login has no financial year');
  return { current: user.financialYear, from: `${a - 1}-04-01`, to: `${a}-03-31`, previous: `${a - 1}-${a}` };
}

const DOCKET_COLS = `g.docket_no, g.booking_date, g.booking_mode, g.origin_branch, g.destination_branch, g.destination, g.booking_type,
  g.consigner_name, g.consignee_name, g.Financial_Year`;

// the pending-docket query of each stage (GetDocektWithOut…)
const STAGE_SQL = {
  booking: `g.manifest_status is null and g.booking_date between @from and @to and g.Invoice_status is null and g.bill_no is null
            and isnull(g.IsCancel, 0) = 0 and isnull(g.Financial_Year, '') <> @fy`,
  manifest: `g.docket_no in (select mg.docket_no from Manifest_grn mg join mainfest_entry me on me.mainfest_no = mg.Manifest_no
              where me.challan_no is null and isnull(me.IsCancelled, 0) = 0 and isnull(me.Financial_Year, '') <> @fy
                and me.mainfest_date between @from and @to)`,
  challan: `g.docket_no in (select mg.docket_no from Manifest_grn mg join mainfest_entry me on me.mainfest_no = mg.Manifest_no
             where me.challan_no is not null and isnull(me.IsCancelled, 0) = 0 and isnull(me.Financial_Year, '') <> @fy
               and me.Arrived_status is null and me.mainfest_date between @from and @to
               and me.challan_no not in (select challan_no from dispatch_master where Financial_Year = @fy))`,
  arrival: `g.docket_no in (select ap.docket_no from Arrival_Packg ap join Arrival_entry ae on ae.ArrivalNo = ap.ArrivalNo
             where ap.drs_no is null and isnull(ap.IsCancelled, 0) = 0 and isnull(ap.Financial_Year, '') <> @fy
               and ap.drs_status_entry is null and ae.Receive_Date between @from and @to)`,
  drs: `g.docket_no in (select dg.docket_no from drs_entry_details_grn dg join drs_entry_details de on de.Drs_no = dg.Drs_no
         where isnull(de.IsCancelled, 0) = 0 and de.Dispatch_Status is null and de.challan_no is null
           and isnull(dg.Financial_Year, '') <> @fy and de.Drs_date between @from and @to)`,
  delivery: `g.docket_no in (select dg.docket_no from drs_entry_details_grn dg join drs_entry_details de on de.Drs_no = dg.Drs_no
              where isnull(de.IsCancelled, 0) = 0 and de.Dispatch_Status = 'Dispatch_Drs_Entry_generated'
                and de.challan_no is not null and isnull(dg.Financial_Year, '') <> @fy and de.Drs_date between @from and @to)`,
  bill: `g.booking_date between @from and @to and g.Invoice_status is null and g.bill_no is null and isnull(g.IsCancel, 0) = 0
         and isnull(g.Financial_Year, '') <> @fy`,
};

export async function pending(user, stage, range = {}) {
  const y = years(user);
  const from = range.from || y.from;
  const to = range.to || y.to;
  if (from > to) throw badRequest('From date should not be after the to date');
  const rows = await query(
    `select ${DOCKET_COLS} from grn_master g
      where (@div = '' or g.Division = @div) and ${STAGE_SQL[stage]}
      order by g.booking_date, g.docket_no`, { from, to, fy: y.current, div: s(user.divCode) });
  return {
    stage, from, to, financialYear: y.current,
    dockets: rows.map((r) => ({
      docketNo: s(r.docket_no), bookingDate: iso(r.booking_date), mode: s(r.booking_mode), origin: s(r.origin_branch),
      destinationBranch: s(r.destination_branch), destination: s(r.destination), bookingType: s(r.booking_type),
      consignor: s(r.consigner_name), consignee: s(r.consignee_name), financialYear: s(r.Financial_Year),
    })),
  };
}

/** Challan_Accounts: re-post the challan's entries in the new year's ledgers (same name) and cancel the old ones. */
async function moveChallanAccounts(tx, challanNo, fy, user) {
  const rows = await query(
    `select t.*, l.LedgerName from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
      where t.VoucherNo = @c and isnull(t.IsCancelled, 0) = 0 and isnull(t.Financial_Year, '') <> @fy`, { c: challanNo, fy }, { tx });
  if (!rows.length) return 0;
  const missing = [];
  const map = new Map();
  for (const r of rows) {
    const [l] = await query('select top 1 LedgerCode from tblAccountLedger where LedgerName = @n and Financial_Year = @fy and (@div = \'\' or Division = @div)',
      { n: s(r.LedgerName), fy, div: s(user.divCode) }, { tx });
    if (!l) missing.push(s(r.LedgerName)); else map.set(r.SlNo, l.LedgerCode);
  }
  if (missing.length) throw new HttpError(422, `Create these ledgers in ${fy} first: ${[...new Set(missing)].join(', ')}`);
  for (const r of rows) {
    await query(
      `insert into tblAccountTrasaction(LedgerCode, Dr, Cr, CreatedDate, VoucherNo, Mode, Entry, Financial_Year, Division, IsCancelled)
       values (@l, @dr, @cr, getdate(), @v, @m, @e, @fy, @div, 0);
       update tblAccountTrasaction set IsCancelled = 1 where SlNo = @id`,
      { l: map.get(r.SlNo), dr: r.Dr, cr: r.Cr, v: r.VoucherNo, m: r.Mode, e: r.Entry, fy, div: r.Division, id: r.SlNo }, { tx });
  }
  return rows.length;
}

/** btnUpdate_Click for one stage; only dockets still pending in that stage are moved. */
export async function move(user, stage, body) {
  const y = years(user);
  const list = await pending(user, stage, body);
  const allowed = new Set(list.dockets.map((d) => d.docketNo));
  const skipped = body.dockets.filter((d) => !allowed.has(d));
  const dockets = body.dockets.filter((d) => allowed.has(d));
  if (!dockets.length) throw badRequest('Select at least one docket that is still pending in this stage');
  const fy = y.current;
  const done = await withTransaction(async (tx) => {
    let entries = 0;
    for (const d of dockets) {
      const p = { d, fy };
      if (stage === 'booking' || stage === 'bill') {
        await query(`update grn_master set Old_Financial_Year = Financial_Year, Financial_Year = @fy where docket_no = @d;
                     update grn_docket_charge set Financial_Year = @fy where Docket_No = @d;`, p, { tx });
        await exec('usp_Update_DocketFinancial_Year', { docket: d, Financial_Year: fy }, {}, { tx });
      } else if (stage === 'manifest') {
        await query(`update me set Financial_Year = @fy from mainfest_entry me join Manifest_grn mg on me.mainfest_no = mg.Manifest_no where mg.docket_no = @d;
                     update Manifest_grn set Financial_Year = @fy where docket_no = @d;`, p, { tx });
      } else if (stage === 'challan') {
        const challans = await query('select distinct challan_no from Manifest_grn where docket_no = @d and challan_no is not null', p, { tx });
        for (const c of challans) {
          await query('update dispatch_master set Financial_Year = @fy where challan_no = @c', { fy, c: s(c.challan_no) }, { tx });
          entries += await moveChallanAccounts(tx, s(c.challan_no), fy, user);
        }
      } else if (stage === 'arrival') {
        await query(`update ae set Financial_Year = @fy from Arrival_entry ae join Arrival_Packg ap on ap.ArrivalNo = ae.ArrivalNo where ap.docket_no = @d;
                     update Arrival_Packg set Financial_Year = @fy where docket_no = @d;`, p, { tx });
      } else if (stage === 'drs' || stage === 'delivery') {
        await query(`update de set Financial_Year = @fy from drs_entry_details de join drs_entry_details_grn dg on dg.Drs_no = de.Drs_no where dg.docket_no = @d;
                     update drs_entry_details_grn set Financial_Year = @fy where docket_no = @d;
                     update dispatch_master set Financial_Year = @fy
                      where challan_no in (select de.challan_no from drs_entry_details de join drs_entry_details_grn dg on dg.Drs_no = de.Drs_no
                                            where dg.docket_no = @d and de.challan_no is not null);`, p, { tx });
      }
    }
    return entries;
  });
  return {
    moved: dockets.length, skipped, accountEntries: done,
    message: `${dockets.length} docket(s) moved to ${fy}${skipped.length ? `; ${skipped.length} skipped (no longer pending)` : ''}`,
  };
}
