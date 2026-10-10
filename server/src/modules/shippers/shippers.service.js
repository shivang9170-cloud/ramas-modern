// Shippers (docket-number stock) — port of Setting/Shiper_Master.aspx, Setting/GatePassShiper_Master.aspx,
// Setting/Shiper_Issue_Details.aspx and Setting/shiper_issue_details_to_Franchisee.aspx.
//
// Head office receives printed docket books as number series ("shippers": shipper_master; gate-pass books:
// GatePasshipper_master), then issues parts of a series to branches or franchisee branches (shiper_issue_to_branch).
// A single unused number can be moved from one branch to another (Shipper_issue_frombranch_tobranch). Series are
// saved as "<first letter of the type>-<number>" (G-100001), as the pages did.
//
// Changes from the pages (docs/MIGRATION.md "Settings"):
//   * a series may not overlap another series of the same type (stock) or another issue (issue); the pages compared
//     numbers as text in places and missed overlaps; start ≤ end and the quantity is computed, not typed;
//   * an issue must lie inside one received series of the same GRN type (Manual LR / IBA LR); the pages showed "This
//     series is used in IBA LR" and still saved it;
//   * the "issue only in lots of 50" rule is not ported: the page applied it only when the start number equalled the
//     first number of the latest stock (a leftover), so it never guarded anything consistently;
//   * a stock series can be edited only in its date and "received from" (the page let the numbers be changed after
//     issues were made from them); delete is refused once anything is issued from it;
//   * an issue can be deleted only while none of its numbers is used on a docket (the page checked number by number
//     with one query each; now one query); transfers are refused for a number already used or already transferred.
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../middleware/errors.js';
import { s, n, iso } from '../../utils/values.js';

// stock books (identifiers only from here)
export const STOCKS = { shipper: 'shipper_master', gatepass: 'GatePasshipper_master' };
// ddlshipertype: only "GRN Shipper" is live on the pages (Challan / MR / DRS / Seal shippers are commented out)
export const SHIPPER_TYPES = ['GRN Shipper'];
export const GRN_TYPES = { 1: 'Manual LR', 2: 'IBA LR' };
const MAX_RANGE = 100000;

const prefix = (type) => `${type[0]}-`;
const num = (col) => `try_cast(substring(${col}, 3, 30) as bigint)`;
const seriesNo = (v) => n(s(v).replace(/^[A-Za-z]-/, ''));

// ------------------------------------------------------------------ stock (Shiper_Master / GatePassShiper_Master)

const mapStock = (r) => ({
  id: Number(r.id), shipperType: s(r.shipper_type), receivingDate: iso(r.receving_date), start: seriesNo(r.starting_series),
  end: seriesNo(r.End_series), startSeries: s(r.starting_series), endSeries: s(r.End_series), quantity: n(r.Total_quantity),
  receivedFrom: s(r.received_from), grnType: s(r.GRN_Type), grnTypeName: GRN_TYPES[s(r.GRN_Type)] ?? '', division: s(r.Division),
});

/** select_Shipper_master(type, grnType, division, docketNo). */
export async function listStock(user, kind, { shipperType = '', grnType = '', number = '' } = {}) {
  const rows = await query(
    `select * from ${STOCKS[kind]}
      where (@t = '' or shipper_type = @t) and (@g = '' or GRN_Type = @g) and (@div = '' or Division = @div)
        and (@no = '' or try_cast(@no as bigint) between ${num('starting_series')} and ${num('End_series')})
      order by id desc`, { t: shipperType, g: grnType, div: s(user.divCode), no: number });
  return rows.map(mapStock);
}

/** select_shiper_maxno: the next number after the last received series of the type. */
export async function nextStockNumber(kind, shipperType) {
  const [r] = await query(`select max(${num('End_series')}) as mx from ${STOCKS[kind]} where shipper_type = @t`, { t: shipperType });
  return { next: r?.mx ? Number(r.mx) + 1 : null };
}

export async function createStock(user, kind, body) {
  if (body.end < body.start) throw badRequest('End series should not be less than the starting series');
  if (body.end - body.start + 1 > MAX_RANGE) throw badRequest(`A series can hold at most ${MAX_RANGE} numbers`);
  return withTransaction(async (tx) => {
    // CheckShipperSeries: "Series Already Exists!!"
    const [dup] = await query(
      `select top 1 starting_series, End_series from ${STOCKS[kind]} with (updlock, holdlock)
        where shipper_type = @t and ${num('starting_series')} <= @e and ${num('End_series')} >= @s`,
      { t: body.shipperType, s: body.start, e: body.end }, { tx });
    if (dup) throw conflict(`The series overlaps ${s(dup.starting_series)} – ${s(dup.End_series)}`);
    const p = prefix(body.shipperType);
    const [row] = await query(
      `insert into ${STOCKS[kind]}(shipper_type, receving_date, starting_series, End_series, Total_quantity, received_from, type, GRN_Type, Division, created_by)
       output inserted.id values (@t, @d, @s, @e, @q, @from, '', @g, @div, @u)`,
      { t: body.shipperType, d: body.receivingDate, s: `${p}${body.start}`, e: `${p}${body.end}`, q: body.end - body.start + 1,
        from: body.receivedFrom, g: String(body.grnType), div: s(user.divCode), u: user.userId }, { tx });
    return { id: Number(row.id), message: `Series ${p}${body.start} – ${p}${body.end} received` };
  });
}

export async function updateStock(kind, id, body) {
  const [r] = await query(`select id from ${STOCKS[kind]} where id = @id`, { id });
  if (!r) throw notFound('Series not found');
  await query(`update ${STOCKS[kind]} set receving_date = @d, received_from = @f where id = @id`, { d: body.receivingDate, f: body.receivedFrom, id });
  return { id, message: 'Series updated' };
}

async function stockRow(kind, id) {
  const [r] = await query(`select * from ${STOCKS[kind]} where id = @id`, { id });
  if (!r) throw notFound('Series not found');
  return mapStock(r);
}

/** delete_item: refused when any number of the series is issued to a branch (CheckShipperSeriesToBranch). */
export async function deleteStock(kind, id) {
  const st = await stockRow(kind, id);
  const [issued] = await query(
    `select top 1 slno from shiper_issue_to_branch where shipper_type = @t and ${num('starting_series')} <= @e and ${num('endseries')} >= @s`,
    { t: st.shipperType, s: st.start, e: st.end });
  if (issued) throw conflict("Can't delete: already issued to a branch");
  await query(`delete from ${STOCKS[kind]} where id = @id`, { id });
  return { id, message: 'Series deleted' };
}

/** View_item: each number of the series, issued to a branch or not. */
export async function stockNumbers(kind, id) {
  const st = await stockRow(kind, id);
  if (st.end - st.start + 1 > 5000) throw badRequest('The series is too long to list (more than 5000 numbers)');
  const issues = await query(
    `select ${num('starting_series')} as s, ${num('endseries')} as e, bm.branch_name from shiper_issue_to_branch i
       left join branch_master bm on bm.branch_code = i.branch_code
      where i.shipper_type = @t and ${num('i.starting_series')} <= @e and ${num('i.endseries')} >= @s`,
    { t: st.shipperType, s: st.start, e: st.end });
  const out = [];
  for (let x = st.start; x <= st.end; x++) {
    const hit = issues.find((i) => Number(i.s) <= x && Number(i.e) >= x);
    out.push({ number: x, status: hit ? 'Issued to branch' : 'Not issued to branch', branch: hit ? s(hit.branch_name) : '' });
  }
  return out;
}

// ------------------------------------------------------------------ issue (Shiper_Issue_Details / …_to_Franchisee)

/** Bind_branch_WIthout_franchisee / Bind_branch_WIth_franchisee. */
export async function issueBranches(franchisee) {
  const rows = await query(
    `select b.branch_code, b.branch_name,
            (select top 1 coalesce(fm.FranName, mf.FranName) from Bind_Franch_Branch bf
               left join Franchise_Master fm on fm.FranCode = bf.Franchise_Code left join MasterFranchise mf on mf.FranCode = bf.Franchise_Code
              where bf.Branch_Code = b.branch_code and isnull(bf.Status, 1) = 1) as franchisee
       from branch_master b
      where b.status = 'Active'
        and case when cast(isnull(b.IsFranchisee, '') as varchar(10)) in ('1', 'true')
                   or cast(isnull(b.IsMasterFranchisee, '') as varchar(10)) in ('1', 'true') then 1 else 0 end = @fr
      order by b.branch_name`, { fr: franchisee ? 1 : 0 });
  return rows.map((r) => ({ value: s(r.branch_code), label: `${s(r.branch_name)} : ${s(r.branch_code)}`, franchisee: s(r.franchisee) }));
}

export async function issueClients(user) {
  const rows = await query(
    `select client_code, company_name from client_Master
      where isnull(is_Active, 1) = 1 and (@div = '' or ',' + isnull(DivCode, '') + ',' like '%,' + @div + ',%') order by company_name`,
    { div: s(user.divCode) });
  return rows.map((r) => ({ value: s(r.client_code), label: `${s(r.company_name)} : ${s(r.client_code)}` }));
}

const mapIssue = (r) => ({
  id: Number(r.slno), shipperType: s(r.shipper_type), branch: s(r.branch_code), branchName: s(r.branch_name),
  start: seriesNo(r.starting_series), end: seriesNo(r.endseries), startSeries: s(r.starting_series), endSeries: s(r.endseries),
  quantity: n(r.total_quantity), issueDate: iso(r.issue_date), grnType: s(r.GRN_Type), grnTypeName: GRN_TYPES[s(r.GRN_Type)] ?? '',
  client: s(r.Client_Code), clientName: s(r.company_name), perShipperCharge: n(r.PerShiperCharge), totalCharge: n(r.TotalShiperCharge),
  franchisee: Boolean(r.IsFranchisee),
});

/** select_shipper_issue_to_branch / _with_franchisee. */
export async function listIssues(user, { franchisee = false, branch = '', shipperType = '', grnType = '', number = '' } = {}) {
  const rows = await query(
    `select i.*, bm.branch_name, cm.company_name from shiper_issue_to_branch i
       left join branch_master bm on bm.branch_code = i.branch_code
       left join client_Master cm on cm.client_code = i.Client_Code
      where i.IsFranchisee = @fr and (@b = '' or i.branch_code = @b) and (@t = '' or i.shipper_type = @t)
        and (@g = '' or i.GRN_Type = @g) and (@div = '' or isnull(i.DivCode, @div) = @div)
        and (@no = '' or try_cast(@no as bigint) between ${num('i.starting_series')} and ${num('i.endseries')})
      order by i.slno desc`,
    { fr: franchisee ? 1 : 0, b: branch, t: shipperType, g: grnType, div: s(user.divCode), no: number });
  return rows.map(mapIssue);
}

/** ddlshipertype_SelectedIndexChanged: after the last issue, else the first received number. */
export async function nextIssueNumber(shipperType) {
  const [r] = await query(`select max(${num('endseries')}) as mx from shiper_issue_to_branch where shipper_type = @t`, { t: shipperType });
  if (r?.mx) return { next: Number(r.mx) + 1 };
  const [m] = await query(`select min(${num('starting_series')}) as mn from shipper_master where shipper_type = @t`, { t: shipperType });
  return { next: m?.mn ? Number(m.mn) : null };
}

export async function createIssue(user, body, franchisee) {
  if (body.end < body.start) throw badRequest('End series should not be less than the starting series');
  const branches = await issueBranches(franchisee);
  if (!branches.some((x) => x.value === body.branch)) throw badRequest(franchisee ? 'Select a franchisee branch' : 'Select a branch');
  if (body.client && !(await issueClients(user)).some((c) => c.value === body.client)) throw badRequest('Unknown client');
  const qty = body.end - body.start + 1;
  const perCharge = franchisee ? n(body.perShipperCharge) : 0;
  return withTransaction(async (tx) => {
    // series_validation_to_headoffice + Check_GRN_Type_Iba: inside one received series of the same type and GRN type
    const [stock] = await query(
      `select top 1 id, GRN_Type from shipper_master with (updlock, holdlock)
        where shipper_type = @t and ${num('starting_series')} <= @s and ${num('End_series')} >= @e`,
      { t: body.shipperType, s: body.start, e: body.end }, { tx });
    if (!stock) throw badRequest("You can't issue this: the series was not received at the head office");
    if (s(stock.GRN_Type) !== String(body.grnType)) {
      throw badRequest(`Sorry, this series belongs to ${GRN_TYPES[s(stock.GRN_Type)] ?? 'another GRN type'}`);
    }
    // Check_Series_Shipper_issues / select_maxno_to_compare: no overlap with an earlier issue
    const [dup] = await query(
      `select top 1 starting_series, endseries from shiper_issue_to_branch with (updlock, holdlock)
        where shipper_type = @t and ${num('starting_series')} <= @e and ${num('endseries')} >= @s`,
      { t: body.shipperType, s: body.start, e: body.end }, { tx });
    if (dup) throw conflict(`Series already issued: ${s(dup.starting_series)} – ${s(dup.endseries)}`);
    const p = prefix(body.shipperType);
    const [row] = await query(
      `insert into shiper_issue_to_branch(shipper_type, branch_code, starting_series, endseries, total_quantity, issue_date, GRN_Type,
         DivCode, Client_Code, type, IsFranchisee, UserId, PerShiperCharge, TotalShiperCharge)
       output inserted.slno values (@t, @b, @s, @e, @q, @d, @g, @div, @c, '', @fr, @u, @pc, @tc)`,
      { t: body.shipperType, b: body.branch, s: `${p}${body.start}`, e: `${p}${body.end}`, q: qty, d: body.issueDate,
        g: String(body.grnType), div: s(user.divCode), c: body.client || null, fr: franchisee ? 1 : 0, u: user.userId,
        pc: perCharge, tc: perCharge * qty }, { tx });
    return { id: Number(row.slno), message: `Series ${p}${body.start} – ${p}${body.end} issued` };
  });
}

async function issueRow(id) {
  const [r] = await query('select i.*, bm.branch_name, null as company_name from shiper_issue_to_branch i left join branch_master bm on bm.branch_code = i.branch_code where i.slno = @id', { id });
  if (!r) throw notFound('Issue not found');
  return mapIssue(r);
}

// dockets booked on a number of the range (CheckDocketInGrn)
const USED_SQL = `select try_cast(docket_no as bigint) as no from grn_master
  where try_cast(docket_no as bigint) between @s and @e and isnull(IsCancel, 0) = 0`;

export async function deleteIssue(id) {
  const it = await issueRow(id);
  const used = await query(`select top 1 * from (${USED_SQL}) x`, { s: it.start, e: it.end });
  if (used.length) throw conflict("Can't delete: already used in a docket");
  await withTransaction(async (tx) => {
    await query('update Shipper_issue_frombranch_tobranch set isCancel = 1 where shippers_issued_id = @id', { id }, { tx });
    await query('delete from shiper_issue_to_branch where slno = @id', { id }, { tx });
  });
  return { id, message: 'Issue deleted' };
}

/** View_item on an issue: each number, used on a docket or not, and moved to another branch or not. */
export async function issueNumbers(id) {
  const it = await issueRow(id);
  if (it.end - it.start + 1 > 5000) throw badRequest('The series is too long to list (more than 5000 numbers)');
  const used = new Set((await query(USED_SQL, { s: it.start, e: it.end })).map((r) => Number(r.no)));
  const moved = new Map((await query(
    `select t.shipper_no, bm.branch_name from Shipper_issue_frombranch_tobranch t left join branch_master bm on bm.branch_code = t.issue_to_branch
      where t.shippers_issued_id = @id and t.isCancel = 0`, { id })).map((r) => [seriesNo(r.shipper_no), s(r.branch_name)]));
  const out = [];
  for (let x = it.start; x <= it.end; x++) {
    out.push({ number: x, status: moved.has(x) ? `Moved to ${moved.get(x)}` : used.has(x) ? 'Used in docket' : 'Not used', movable: !moved.has(x) && !used.has(x) });
  }
  return { issue: it, numbers: out };
}

/** Button_ok_Click: move one unused GRN-shipper number to another branch. */
export async function transferNumber(user, id, body) {
  const it = await issueRow(id);
  if (it.shipperType !== 'GRN Shipper') throw badRequest('Only GRN shippers can be moved');
  if (body.number < it.start || body.number > it.end) throw badRequest('The number is not in this issue');
  if (body.toBranch === it.branch) throw badRequest('Pick another branch');
  const [br] = await query("select branch_code from branch_master where branch_code = @b and status = 'Active'", { b: body.toBranch });
  if (!br) throw badRequest('Select the branch');
  return withTransaction(async (tx) => {
    const [used] = await query(`select top 1 docket_no from grn_master where try_cast(docket_no as bigint) = @no and isnull(IsCancel, 0) = 0`, { no: body.number }, { tx });
    if (used) throw conflict('Docket already used');
    const shipperNo = `${prefix(it.shipperType)}${body.number}`;
    const [dup] = await query(
      'select top 1 id from Shipper_issue_frombranch_tobranch with (updlock, holdlock) where shipper_no = @no and isCancel = 0', { no: shipperNo }, { tx });
    if (dup) throw conflict('The number has already been moved');
    await query(
      `insert into Shipper_issue_frombranch_tobranch(shipper_type, issue_from_branch, issue_to_branch, shippers_issued_id, shipper_no, issue_date, division, user_id)
       values (@t, @from, @to, @id, @no, getdate(), @div, @u)`,
      { t: it.shipperType, from: it.branch, to: body.toBranch, id, no: shipperNo, div: s(user.divCode), u: user.userId }, { tx });
    return { message: `${shipperNo} moved` };
  });
}

/** transfer_detail: moved numbers. */
export async function listTransfers() {
  const rows = await query(
    `select t.id, t.shipper_type, t.shipper_no, t.issue_date, t.user_id, f.branch_name as from_name, tb.branch_name as to_name
       from Shipper_issue_frombranch_tobranch t
       left join branch_master f on f.branch_code = t.issue_from_branch
       left join branch_master tb on tb.branch_code = t.issue_to_branch
      where t.isCancel = 0 order by t.id desc`);
  return rows.map((r) => ({
    id: Number(r.id), shipperType: s(r.shipper_type), shipperNo: s(r.shipper_no), fromBranch: s(r.from_name), toBranch: s(r.to_name),
    issueDate: iso(r.issue_date), userId: s(r.user_id),
  }));
}

export async function cancelTransfer(user, id) {
  const [r] = await query('select id from Shipper_issue_frombranch_tobranch where id = @id and isCancel = 0', { id });
  if (!r) throw notFound('Transfer not found');
  await query('update Shipper_issue_frombranch_tobranch set isCancel = 1, Cancel_by = @u, Cancel_date = getdate() where id = @id', { u: user.userId, id });
  return { id, message: 'Transfer cancelled' };
}
