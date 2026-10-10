// Loading sheets — port of Operation/Loading_Sheet.aspx (create), Loading_Sheet_Cancel / Loading_Sheet_View /
// Loading_Sheet_Edit (list, view, cancel) and Manual_Loading_Sheet_Cancel_Uncancel (one docket off / back on a sheet).
// Loading_dal / Loading_bal.
//
// A loading sheet lists the dockets lying at the branch that are put on the dock for loading. A manifest can then be
// made from an open loading sheet (manifest.service.js): the sheet is marked manifested; cancelling that manifest opens
// the sheet again.
//
// Changes from the pages (docs/MIGRATION.md "Loading sheets"):
//   * the number (LS + short code + FY + 6 digits) is taken inside the save's transaction (the page worked it out on
//     page load, so two users got the same number) and header and dockets are saved together;
//   * the dockets are re-read on the server: lying at this branch with packages pending, not cancelled, booked on or
//     before the loading date, not on another open loading sheet ("Skipped Dockets" were dropped silently);
//   * the loading date may not be after today;
//   * SQL is parameterised (docket numbers and the manual cancel's docket were concatenated).
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { finYr } from '../pickup/pickup.service.js';
import { s, n, iso, today } from '../../utils/values.js';

// a docket is on an open loading sheet of the branch
const ON_OPEN_SHEET = `exists (select 1 from Loading_Sheet_Details d join Loading_Sheet l on l.Ls_no = d.Ls_no
  where d.docket_no = g.docket_no and d.IsCancel = 0 and l.IsCancel = 0 and l.manifest_status is null and l.Loading_Branch = @branch)`;

/** SearchDocketForLS / SearchDocketForLSLoadType: dockets lying here that can go on a loading sheet. */
export async function pendingDockets(user, { from, to, loadType = '', dockets = [] }) {
  const params = { branch: user.currentBranch.code, from, to, div: s(user.divCode), lt: loadType };
  let extra = '';
  if (dockets.length) extra = ` and g.docket_no in (${dockets.map((d, i) => { params[`d${i}`] = d; return `@d${i}`; }).join(',')})`;
  const rows = await query(
    `select top 1000 g.docket_no, g.booking_date, g.Consigner_Name, g.consignee_name, g.destination, g.origin_branch, g.destination_branch,
            ob.branch_name as origin_name, db.branch_name as dest_name, c.rate_on,
            coalesce(c.pending_package, c.pcs) as packages, coalesce(c.pending_weight, c.charge_weight) as weight
       from grn_master g
       join grn_docket_charge c on c.Docket_No = g.docket_no and coalesce(c.branch, g.origin_branch) = @branch
       left join branch_master ob on ob.branch_code = g.origin_branch
       left join branch_master db on db.branch_code = g.destination_branch
      where isnull(g.IsCancel, 0) = 0 and coalesce(c.pending_package, c.pcs) > 0
        and isnull(g.destination_branch, '') <> @branch
        and g.booking_date between @from and @to and (@div = '' or g.Division = @div)
        and (@lt = '' or (@lt = 'FTL' and c.rate_on = 'FTL') or (@lt = 'PTL' and isnull(c.rate_on, '') <> 'FTL'))
        and not ${ON_OPEN_SHEET} ${extra}
      order by g.booking_date, g.docket_no`, params);
  return rows.map((r) => ({
    docketNo: s(r.docket_no), bookingDate: iso(r.booking_date), consigner: s(r.Consigner_Name), consignee: s(r.consignee_name),
    origin: s(r.origin_name), toBranch: s(r.destination_branch), destination: s(r.dest_name) || s(r.destination),
    packages: n(r.packages), weight: n(r.weight), loadType: s(r.rate_on) === 'FTL' ? 'FTL' : 'PTL',
  }));
}

/** btnsave_Click: Insert_Loading_Sheet + insert_Loading_Sheet_Details. */
export async function createLoadingSheet(user, body) {
  const branch = user.currentBranch.code;
  if (body.loadingDate > today()) throw badRequest('Loading date should not be greater than current date');
  if (new Set(body.dockets).size !== body.dockets.length) throw badRequest('The same docket is listed twice');
  const fy = financialYearRange(user.financialYear);
  const pending = await pendingDockets(user, { from: fy?.from ?? '2000-01-01', to: body.loadingDate, dockets: body.dockets });
  const byNo = new Map(pending.map((p) => [p.docketNo, p]));
  const problems = body.dockets.filter((d) => !byNo.has(d))
    .map((d) => ({ path: 'dockets', message: `${d}: not lying at this branch, booked after the loading date, or already on an open loading sheet` }));
  if (problems.length) throw new HttpError(422, 'Some dockets cannot go on the loading sheet', problems);
  const [b] = await query('select Short_Code from branch_master where branch_code = @b', { b: branch });
  const shortCode = s(b?.Short_Code);
  const fyShort = finYr(user.financialYear);
  return withTransaction(async (tx) => {
    const prefix = `LS${shortCode}${fyShort}`;
    const [last] = await query(
      `select top 1 Ls_no from Loading_Sheet with (updlock, holdlock)
        where Ls_no like @p + '%' and len(Ls_no) = len(@p) + 6 order by Ls_no desc`, { p: prefix }, { tx });
    const lsNo = `${prefix}${String((last ? Number(s(last.Ls_no).slice(-6)) : 0) + 1).padStart(6, '0')}`;
    // the same dockets may not have gone on another sheet since they were read
    const taken = await query(
      `select d.docket_no from Loading_Sheet_Details d with (updlock, holdlock) join Loading_Sheet l on l.Ls_no = d.Ls_no
        where d.IsCancel = 0 and l.IsCancel = 0 and l.manifest_status is null and l.Loading_Branch = @b
          and d.docket_no in (select value from string_split(@list, ','))`, { b: branch, list: body.dockets.join(',') }, { tx });
    if (taken.length) throw conflict(`Already on an open loading sheet: ${taken.map((t) => s(t.docket_no)).join(', ')}`);
    await query(
      `insert into Loading_Sheet(Ls_no, loading_date, entered_by, Loading_Branch, Financial_Year, ShortCode, FinYr, LoadType, Division)
       values (@no, @d, @u, @b, @fy, @sc, @fys, @lt, @div)`,
      { no: lsNo, d: body.loadingDate, u: user.userId, b: branch, fy: user.financialYear, sc: shortCode, fys: fyShort,
        lt: body.loadType, div: s(user.divCode) }, { tx });
    for (const no of body.dockets) {
      const p = byNo.get(no);
      await query(
        `insert into Loading_Sheet_Details(Ls_no, loading_date, Entered_by, docket_no, Booking_date, from_branch, to_branch, Consigner_name,
           weight, pices, IsCancel, Division)
         values (@ls, @d, @u, @no, @bd, @from, @to, @cn, @w, @p, 0, @div)`,
        { ls: lsNo, d: body.loadingDate, u: user.userId, no, bd: p.bookingDate, from: branch, to: p.toBranch, cn: p.consigner,
          w: p.weight, p: p.packages, div: s(user.divCode) }, { tx });
    }
    return { lsNo, dockets: body.dockets.length, message: `Loading sheet ${lsNo} created with ${body.dockets.length} docket(s)` };
  });
}

/** Get_Loading_List: the branch's loading sheets of the login year. */
export async function listLoadingSheets(user, { status = 'active', search = '', open = false } = {}) {
  const rows = await query(
    `select l.Ls_no, l.loading_date, l.entered_by, l.IsCancel, l.manifest_status, l.ManifestNo, l.LoadType,
            (select count(*) from Loading_Sheet_Details d where d.Ls_no = l.Ls_no and d.IsCancel = 0) as dockets,
            (select isnull(sum(d.pices), 0) from Loading_Sheet_Details d where d.Ls_no = l.Ls_no and d.IsCancel = 0) as packages,
            (select isnull(sum(d.weight), 0) from Loading_Sheet_Details d where d.Ls_no = l.Ls_no and d.IsCancel = 0) as weight
       from Loading_Sheet l
      where l.Loading_Branch = @b and (@div = '' or l.Division = @div) and l.Financial_Year = @fy
        and l.IsCancel = @c and (@q = '' or l.Ls_no like '%' + @q + '%')
        and (@open = 0 or l.manifest_status is null)
      order by l.Ls_no desc`,
    { b: user.currentBranch.code, div: s(user.divCode), fy: user.financialYear,
      c: status === 'cancelled' ? 1 : 0, q: search, open: open ? 1 : 0 });
  return rows.map((r) => ({
    lsNo: s(r.Ls_no), loadingDate: iso(r.loading_date), enteredBy: s(r.entered_by), cancelled: Boolean(r.IsCancel),
    manifested: Boolean(s(r.manifest_status)), manifestNo: s(r.ManifestNo), loadType: s(r.LoadType),
    dockets: n(r.dockets), packages: n(r.packages), weight: n(r.weight),
  }));
}

/** Loading_Sheet_Edit (view): header and dockets. */
export async function getLoadingSheet(user, lsNo) {
  const [h] = await query(
    `select l.*, b.branch_name from Loading_Sheet l left join branch_master b on b.branch_code = l.Loading_Branch
      where l.Ls_no = @no and l.Loading_Branch = @b`, { no: lsNo, b: user.currentBranch.code });
  if (!h) throw notFound(`Loading sheet ${lsNo} not found at this branch`);
  const rows = await query(
    `select d.*, tb.branch_name as to_name from Loading_Sheet_Details d left join branch_master tb on tb.branch_code = d.to_branch
      where d.Ls_no = @no order by d.docket_no`, { no: lsNo });
  return {
    lsNo: s(h.Ls_no), loadingDate: iso(h.loading_date), branch: s(h.Loading_Branch), branchName: s(h.branch_name), enteredBy: s(h.entered_by),
    cancelled: Boolean(h.IsCancel), manifested: Boolean(s(h.manifest_status)), manifestNo: s(h.ManifestNo), loadType: s(h.LoadType),
    dockets: rows.map((r) => ({
      docketNo: s(r.docket_no), bookingDate: iso(r.Booking_date), toBranch: s(r.to_branch), toBranchName: s(r.to_name),
      consigner: s(r.Consigner_name), weight: n(r.weight), packages: n(r.pices), cancelled: Boolean(r.IsCancel), manifestNo: s(r.Manifest_No),
    })),
  };
}

/** Cancel_item: refused once a manifest is made from it ("Loading Sheet Not be Cancel. Manifest Generated!"). */
export async function cancelLoadingSheet(user, lsNo) {
  const ls = await getLoadingSheet(user, lsNo);
  if (ls.cancelled) throw conflict('This loading sheet is already cancelled');
  if (ls.manifested) throw conflict(`Loading sheet cannot be cancelled: manifest ${ls.manifestNo} is generated`);
  await withTransaction(async (tx) => {
    await query('update Loading_Sheet set IsCancel = 1, Cancelled_By = @u, Cancelled_Date = getdate() where Ls_no = @no', { u: user.userId, no: lsNo }, { tx });
    await query('update Loading_Sheet_Details set IsCancel = 1 where Ls_no = @no', { no: lsNo }, { tx });
  });
  return { lsNo, message: 'Cancelled Successfully' };
}

/** Manual_Loading_Sheet_Cancel_Uncancel: a docket's rows on loading sheets of this branch. */
export async function docketRows(user, docketNo) {
  const rows = await query(
    `select d.slno, d.Ls_no, d.loading_date, d.docket_no, d.to_branch, tb.branch_name as to_name, d.weight, d.pices, d.IsCancel,
            d.Manifest_No, l.IsCancel as sheet_cancelled, l.manifest_status
       from Loading_Sheet_Details d join Loading_Sheet l on l.Ls_no = d.Ls_no
       left join branch_master tb on tb.branch_code = d.to_branch
      where d.docket_no = @d and l.Loading_Branch = @b order by d.Ls_no`, { d: docketNo, b: user.currentBranch.code });
  return rows.map((r) => ({
    id: Number(r.slno), lsNo: s(r.Ls_no), loadingDate: iso(r.loading_date), docketNo: s(r.docket_no), toBranchName: s(r.to_name),
    weight: n(r.weight), packages: n(r.pices), cancelled: Boolean(r.IsCancel), manifestNo: s(r.Manifest_No),
    sheetOpen: !r.sheet_cancelled && !s(r.manifest_status),
  }));
}

/** UPDATE_LOADING_SHEET_MANUAL_CANCEL_UNCANCEL: take a docket off an open sheet, or put it back. */
export async function setDocketCancelled(user, id, cancelled) {
  const [r] = (await query(
    `select d.slno, d.docket_no, d.Ls_no, l.IsCancel as sheet_cancelled, l.manifest_status, l.Loading_Branch from Loading_Sheet_Details d
       join Loading_Sheet l on l.Ls_no = d.Ls_no where d.slno = @id`, { id }));
  if (!r || s(r.Loading_Branch) !== user.currentBranch.code) throw notFound('Loading sheet row not found at this branch');
  if (r.sheet_cancelled || s(r.manifest_status)) throw conflict('The loading sheet is cancelled or already manifested');
  if (!cancelled) {
    const [other] = await query(
      `select top 1 d.Ls_no from Loading_Sheet_Details d join Loading_Sheet l on l.Ls_no = d.Ls_no
        where d.docket_no = @d and d.slno <> @id and d.IsCancel = 0 and l.IsCancel = 0 and l.manifest_status is null and l.Loading_Branch = @b`,
      { d: s(r.docket_no), id, b: user.currentBranch.code });
    if (other) throw conflict(`The docket is on loading sheet ${s(other.Ls_no)} now`);
  }
  await query('update Loading_Sheet_Details set IsCancel = @c where slno = @id', { c: cancelled ? 1 : 0, id });
  return { id, message: cancelled ? 'Docket taken off the loading sheet' : 'Docket put back on the loading sheet' };
}

// ------------------------------------------------------------------ manifest link (manifest.service.js)

/** The open sheet's active dockets (select_data_on_the_basis_of_Loasing_No); throws when the sheet cannot be used. */
export async function openSheetDockets(tx, branch, lsNo) {
  const [l] = await query('select Ls_no, IsCancel, manifest_status from Loading_Sheet with (updlock) where Ls_no = @no and Loading_Branch = @b',
    { no: lsNo, b: branch }, tx ? { tx } : undefined);
  if (!l) throw badRequest(`Loading sheet ${lsNo} not found at this branch`);
  if (l.IsCancel || s(l.manifest_status)) throw conflict(`Loading sheet ${lsNo} is cancelled or already manifested`);
  const rows = await query('select docket_no from Loading_Sheet_Details where Ls_no = @no and IsCancel = 0', { no: lsNo }, tx ? { tx } : undefined);
  return new Set(rows.map((r) => s(r.docket_no)));
}

/** After the manifest is saved: the sheet is manifested, its manifested dockets carry the manifest no. */
export async function markManifested(tx, lsNo, manifestNo, dockets) {
  await query("update Loading_Sheet set manifest_status = 'generated', ManifestNo = @m where Ls_no = @no", { m: manifestNo, no: lsNo }, { tx });
  await query(
    `update Loading_Sheet_Details set Manifest_No = @m where Ls_no = @no and IsCancel = 0
       and docket_no in (select value from string_split(@list, ','))`, { m: manifestNo, no: lsNo, list: dockets.join(',') }, { tx });
}

/** Manifest cancelled: its loading sheet opens again. */
export async function reopenForManifest(manifestNo) {
  await query('update Loading_Sheet_Details set Manifest_No = null where Manifest_No = @m', { m: manifestNo });
  await query('update Loading_Sheet set manifest_status = null, ManifestNo = null where ManifestNo = @m', { m: manifestNo });
}
