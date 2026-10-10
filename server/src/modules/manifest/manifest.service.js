// Manifest entry — port of:
//   wwwroot/Operation/menifest.aspx(.cs)          create
//   wwwroot/Operation/manifest_Cancel.aspx(.cs)   list / cancel
//   wwwroot/Operation/manifest_View.aspx(.cs)     list / view
//   ClassLibrary/dal/Manifest_dal.cs, Manifest_Cancel_dal.cs
//
// A manifest groups dockets lying at the current branch for one destination
// branch (SUNDRY / PTL) or city (FTL). Packages may be split across manifests:
// the procedure reduces grn_docket_charge.pending_* by what is manifested.
//
// Fixed legacy bugs:
//   * the destination lookup mode (branch vs city) was a *static* field shared by
//     every user of the web server — now a request parameter;
//   * the success message showed the manifest no. typed on screen, not the one
//     returned by usp_insert_Manifest (@retval);
//   * the duplicate / pending check was commented out on the page — now the API
//     verifies every docket is at this branch with enough pending packages;
//   * a manifest "from a loading sheet" (rdManifestType / ddlLoadingSheet) takes only the
//     sheet's dockets and marks the sheet manifested; unticked rows were silently marked
//     cancelled on the loading sheet — now they stay free for the next sheet; cancelling
//     the manifest opens the sheet again;
//   * the cancel page built SQL from the raw postback argument (injection).

import { config } from '../../config.js';
import { exec, query, sql, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { finYr } from '../pickup/pickup.service.js';
import { s, n, iso, today } from '../../utils/values.js';
import { markManifested, openSheetDockets, reopenForManifest } from '../loadingsheet/loadingsheet.service.js';
import { profile as businessProfile } from '../business/business.service.js';

// menifest.aspx.cs Bind_Coloader_Name
const COLOADER_NAMES = {
  DIV1001: ['Parcel Coloader', 'FTL Coloader'],
  DIV1002: ['Courier Coloader', 'FTL Coloader'],
  DIV1003: ['Courier Coloader', 'Parcel Coloader'],
  DIV1004: ['Courier Coloader', 'Parcel Coloader'],
};

export async function options(user) {
  const biz = await businessProfile(user.divCode);
  return {
    freightTypes: [
      { value: 'SUNDRY', label: 'Sundry (branch wise, PTL)' },
      { value: 'FTL', label: 'FTL (city wise)' },
    ],
    bookingModes: [{ value: 'All', label: 'All modes' }, { value: 'AI', label: 'Air only' }],
    transportedBy: ['SELF', 'COLOADER'],
    coloadingBy: ['Vendor'],
    coloaderNames: COLOADER_NAMES[user.divCode] ?? [],
    // courier divisions bag their dockets; TMS divisions (cargo / FTL) manifest whole dockets in one entry
    bagging: { enabled: biz.useBagging, businessType: biz.businessType, limits: biz.limits },
  };
}

// ------------------------------------------------------------------ bagging (db/dev/48-manifest-bags.sql)
// The user groups by hand: dockets into a packet / bag / master bag, packets into bags, bags (or packets) into master
// bags. A container holds dockets and / or smaller containers; dockets in no container go on the manifest loose.
// The screen sends the tree with its own keys; numbers are given here.
export const BAG_LEVELS = ['PACKET', 'BAG', 'MASTER'];
const RANK = { PACKET: 1, BAG: 2, MASTER: 3 };
const BAG_PREFIX = { PACKET: 'PK', BAG: 'BG', MASTER: 'MB' };

/** Check the tree against the manifested dockets; returns the nodes with their totals, top level first. */
export function planBags(bags, dockets) {
  const problems = [];
  const byKey = new Map();
  for (const b of bags) {
    if (byKey.has(b.key)) problems.push(`Container ${b.key} is listed twice`);
    byKey.set(b.key, { ...b, children: [], docketRows: [] });
  }
  if (!byKey.size) return { nodes: [], problems };
  const docketByNo = new Map(dockets.map((d) => [d.docketNo, d]));
  const placed = new Map();
  for (const b of byKey.values()) {
    if (b.parent) {
      const p = byKey.get(b.parent);
      if (!p) problems.push(`${b.key}: its container ${b.parent} is not in the list`);
      else if (RANK[p.level] <= RANK[b.level]) problems.push(`${b.key}: a ${b.level.toLowerCase()} cannot go into a ${p.level.toLowerCase()}`);
      else p.children.push(b);
    }
    for (const no of b.dockets ?? []) {
      if (!docketByNo.has(no)) problems.push(`${b.key}: docket ${no} is not on this manifest`);
      else if (placed.has(no)) problems.push(`Docket ${no} is in ${placed.get(no)} and ${b.key}`);
      else { placed.set(no, b.key); b.docketRows.push(docketByNo.get(no)); }
    }
  }
  for (const b of byKey.values()) {
    if (!b.docketRows.length && !b.children.length) problems.push(`${b.key} is empty`);
  }
  // totals bottom-up
  const total = (b) => {
    if (b.t) return b.t;
    const own = b.docketRows.reduce((t, d) => ({ dockets: t.dockets + 1, packages: t.packages + d.packages, weight: t.weight + d.weight }), { dockets: 0, packages: 0, weight: 0 });
    b.t = b.children.map(total).reduce((t, c) => ({ dockets: t.dockets + c.dockets, packages: t.packages + c.packages, weight: t.weight + c.weight }), own);
    return b.t;
  };
  const nodes = [...byKey.values()];
  nodes.forEach(total);
  nodes.sort((a, b) => RANK[b.level] - RANK[a.level]);
  return { nodes, problems };
}

/** Save the containers of a new manifest (inside its transaction): numbers, parents, dockets. */
async function saveBags(tx, user, manifestNo, shortCode, toBranch, nodes) {
  const fy = finYr(user.financialYear);
  const numbers = new Map();
  for (const level of ['MASTER', 'BAG', 'PACKET']) {
    const mine = nodes.filter((b) => b.level === level);
    if (!mine.length) continue;
    const prefix = `${BAG_PREFIX[level]}${shortCode}${fy}`;
    const [m] = await query(
      `select max(try_cast(substring(BagNo, len(@p) + 1, 20) as int)) as n from tblManifestBag with (updlock, holdlock) where BagNo like @p + '%'`,
      { p: prefix }, { tx });
    let next = Number(m?.n) || 0;
    for (const b of mine) {
      next += 1;
      const bagNo = `${prefix}${String(next).padStart(6, '0')}`;
      numbers.set(b.key, bagNo);
      await query(
        `insert into tblManifestBag(BagNo, ManifestNo, BagLevel, ParentBagNo, SealNo, Dockets, Packages, Weight, FromBranch, ToBranch, Financial_Year, DivCode, CreatedBy)
         values (@no, @m, @l, @p, @seal, @d, @pk, @w, @from, @to, @fy, @div, @u)`,
        { no: bagNo, m: manifestNo, l: level, p: b.parent ? numbers.get(b.parent) : null, seal: b.sealNo || '', d: b.t.dockets, pk: b.t.packages,
          w: Math.round(b.t.weight * 100) / 100, from: user.currentBranch.code, to: toBranch, fy: user.financialYear, div: user.divCode, u: user.userId },
        { tx });
      for (const d of b.docketRows) {
        await query('insert into tblManifestBagDocket(BagNo, ManifestNo, DocketNo, Packages, Weight) values (@b, @m, @d, @p, @w)',
          { b: bagNo, m: manifestNo, d: d.docketNo, p: d.packages, w: d.weight }, { tx });
      }
    }
  }
  return nodes.map((b) => ({ key: b.key, bagNo: numbers.get(b.key), level: b.level }));
}

/** The containers of a manifest, top level first, each with the dockets put straight into it and its parent. */
export async function manifestBags(manifestNo) {
  const [bags, rows] = await Promise.all([
    query(`select BagNo, BagLevel, ParentBagNo, SealNo, Dockets, Packages, Weight, IsCancelled from tblManifestBag where ManifestNo = @m
            order by case BagLevel when 'MASTER' then 1 when 'BAG' then 2 else 3 end, BagNo`, { m: manifestNo }),
    query('select BagNo, DocketNo, Packages, Weight from tblManifestBagDocket where ManifestNo = @m order by DocketNo', { m: manifestNo }),
  ]);
  return bags.map((b) => ({
    bagNo: s(b.BagNo), level: s(b.BagLevel), parent: s(b.ParentBagNo), sealNo: s(b.SealNo), dockets: n(b.Dockets), packages: n(b.Packages),
    weight: n(b.Weight), cancelled: Boolean(b.IsCancelled),
    docketNos: rows.filter((r) => s(r.BagNo) === s(b.BagNo)).map((r) => s(r.DocketNo)),
  }));
}

/** Scan a packet / bag / master bag number: its manifest and every docket inside it (through the levels below). */
export async function findBag(bagNo) {
  const [b] = await query('select BagNo, ManifestNo, BagLevel, IsCancelled from tblManifestBag where BagNo = @b', { b: bagNo });
  if (!b) throw notFound(`Bag ${bagNo} not found`);
  const all = await manifestBags(s(b.ManifestNo));
  const under = (no) => all.filter((x) => x.parent === no).flatMap((x) => [x, ...under(x.bagNo)]);
  const self = all.find((x) => x.bagNo === s(b.BagNo));
  const inside = [self, ...under(self.bagNo)];
  return { ...self, manifestNo: s(b.ManifestNo), docketNos: [...new Set(inside.flatMap((x) => x.docketNos))], contains: inside.slice(1) };
}

/** Destination search: branches for SUNDRY, cities for FTL (legacy GetDestination). */
export async function searchDestinations(type, term) {
  if (type === 'city') {
    const rows = await query(
      "select top 20 city_code, city_name from city_master where city_name like @t + '%' and active_flag = 'Active' order by city_name",
      { t: term });
    return rows.map((r) => ({ code: s(r.city_code), name: s(r.city_name) }));
  }
  const rows = await query(
    "select top 20 branch_code, branch_name from branch_master where branch_name like @t + '%' and status = 'Active' order by branch_name",
    { t: term });
  return rows.map((r) => ({ code: s(r.branch_code), name: s(r.branch_name) }));
}

export async function pendingDockets(user, q) {
  const { recordset } = await exec('sp_GetDocketForManifest', {
    current_branch: user.currentBranch.code,
    Destination: q.destination,
    fromdate: q.from,
    todate: q.to,
    loadType: q.loadType,
    division: user.divCode,
    booking_mode: q.bookingMode,
  });
  // select_data_on_the_basis_of_Loasing_No: only the open loading sheet's dockets
  const sheet = q.loadingSheet ? await openSheetDockets(null, user.currentBranch.code, q.loadingSheet) : null;
  return recordset.filter((r) => !sheet || sheet.has(s(r.docket_no))).map((r) => ({
    docketNo: s(r.docket_no),
    bookingDate: iso(r.booking_date),
    bookingMode: s(r.booking_mode),
    origin: s(r.originbranch),
    destination: s(r.destinationbranch),
    destinationCity: s(r.destination_city),
    consigner: s(r.consigner_name),
    consignee: s(r.consignee_name),
    totalPackages: n(r.pcs),
    packages: n(r.pending_package),
    weight: n(r.pending_weight),
    freight: n(r.pending_freight),
    loadType: s(r.LoadType),
  }));
}

// ------------------------------------------------------------------ create

export async function createManifest(user, body) {
  const branch = user.currentBranch.code;
  if (body.manifestDate > today()) throw badRequest('Manifest date should not be greater than current date');
  if (body.freightType === 'SUNDRY' && body.destination === branch) {
    throw badRequest('Destination branch and current branch are the same');
  }
  const nos = body.dockets.map((d) => d.docketNo);
  if (new Set(nos).size !== nos.length) throw badRequest('The same docket is listed twice');

  // Server-side version of the check the legacy page had commented out.
  const params = { branch };
  const inList = nos.map((d, i) => { params[`d${i}`] = d; return `@d${i}`; }).join(',');
  // grn_docket_charge has one row per branch the docket has been at (booking + each
  // arrival); the row for this branch holds what is pending here.
  const found = await query(
    `select g.docket_no, g.booking_date, isnull(g.IsCancel,'0') as IsCancel,
            case when c.Docket_No is null then null else @branch end as at_branch,
            coalesce(c.pending_package, c.pcs) as pending_package
       from grn_master g left join grn_docket_charge c on c.Docket_No = g.docket_no
            and coalesce(c.branch, g.origin_branch) = @branch
      where g.docket_no in (${inList})`, params);
  const byNo = new Map(found.map((r) => [s(r.docket_no), r]));
  const problems = [];
  for (const d of body.dockets) {
    const r = byNo.get(d.docketNo);
    if (!r) problems.push(`${d.docketNo}: not found`);
    else if (!['0', 'false'].includes(s(r.IsCancel).toLowerCase())) problems.push(`${d.docketNo}: cancelled`);
    else if (s(r.at_branch) !== branch) problems.push(`${d.docketNo}: not at this branch`);
    else if (iso(r.booking_date) > body.manifestDate) problems.push(`${d.docketNo}: booked after the manifest date`);
    else if (d.packages > n(r.pending_package)) problems.push(`${d.docketNo}: only ${n(r.pending_package)} package(s) pending`);
  }
  if (problems.length) throw new HttpError(422, 'Some dockets cannot be manifested', problems.map((m) => ({ path: 'dockets', message: m })));

  // packets / bags / master bags — only where the division bags its dockets (TMS: whole dockets, no bags)
  let plan = null;
  if (body.bags?.length) {
    const biz = await businessProfile(user.divCode);
    if (!biz.useBagging) throw badRequest('This division manifests whole dockets — bags are not used here');
    plan = planBags(body.bags, body.dockets);
    if (plan.problems.length) throw new HttpError(422, 'The bags are not complete', plan.problems.map((m) => ({ path: 'bags', message: m })));
  }

  const { shortCode } = (await query('select Short_Code from branch_master where branch_code = @b', { b: branch }))
    .map((r) => ({ shortCode: s(r.Short_Code) }))[0] ?? { shortCode: '' };

  // Table-valued parameter @dtManifest_grn (docket_no, freight, package, weight).
  const S = sql();
  const tvp = new S.Table(config.tvp.manifestGrn);
  tvp.columns.add('docket_no', S.VarChar(50));
  tvp.columns.add('freight', S.Decimal(18, 2));
  tvp.columns.add('package', S.Int);
  tvp.columns.add('weight', S.Decimal(18, 2));
  for (const d of body.dockets) tvp.rows.add(d.docketNo, d.freight, d.packages, d.weight);

  const isFtl = body.freightType === 'FTL';
  const result = await withTransaction(async (tx) => {
    if (body.loadingSheetNo) {
      const onSheet = await openSheetDockets(tx, branch, body.loadingSheetNo);
      const off = nos.filter((d) => !onSheet.has(d));
      if (off.length) throw badRequest(`Not on loading sheet ${body.loadingSheetNo}: ${off.join(', ')}`);
    }
    const res = await exec('usp_insert_Manifest', {
      mainfest_no: '',
      mainfest_date: body.manifestDate,
      mainfest_time: body.manifestTime,
      from_branch: branch,
      to_branch: isFtl ? '' : body.destination,
      docat_list: nos.map((d) => `'${d.replace(/'/g, "''")}'`).join(','), // legacy format: 'D1','D2'
      user_id: user.userId,
      division: user.divCode,
      frt_type: body.freightType,
      To_City: isFtl ? body.destination : '',
      Financial_Year: user.financialYear,
      ShortCode: shortCode,
      FinYr: finYr(user.financialYear),
      Loadtype: ['DIV1003', 'DIV1004'].includes(user.divCode) ? (isFtl ? 'FTL' : 'PTL') : '',
      transportedby: body.transportedBy,
      coloading_by: body.transportedBy === 'COLOADER' ? body.coloadingBy : '',
      coloader_name: body.transportedBy === 'COLOADER' ? body.coloaderName : '',
      m_manual_no: body.manualNo,
      dtManifest_grn: { type: S.TVP, value: tvp },
      remarks: body.remarks,
      dest_type: isFtl ? 'CITY WISE' : 'BRANCH WISE',
    }, { retval: [S.VarChar(20), null], retMsg: [S.VarChar(500), null] }, { tx });
    const msg = s(res.output.retMsg);
    if (msg.toLowerCase() !== 'success') throw new HttpError(422, msg || 'Manifest could not be saved');
    const no = s(res.output.retval);
    if (body.loadingSheetNo) await markManifested(tx, body.loadingSheetNo, no, nos);
    const bags = plan ? await saveBags(tx, user, no, shortCode, isFtl ? '' : body.destination, plan.nodes) : [];
    return { no, bags };
  });

  const count = (l) => result.bags.filter((b) => b.level === l).length;
  const bagText = result.bags.length
    ? ` in ${[['MASTER', 'master bag'], ['BAG', 'bag'], ['PACKET', 'packet']].filter(([l]) => count(l)).map(([l, w]) => `${count(l)} ${w}${count(l) > 1 ? 's' : ''}`).join(', ')}`
    : '';
  return {
    manifestNo: result.no, dockets: nos.length, bags: result.bags,
    message: `Manifest ${result.no} created with ${nos.length} docket(s)${bagText}`,
  };
}

// ------------------------------------------------------------------ list / view

export async function listManifests(user, { from, to, status = 'active', search = '', scope = 'mine' }) {
  const { recordset } = await exec('usp_Select_Manifest_Entry', {
    booking_date1: from,
    booking_date2: to,
    currbranch: user.currentBranch.code,
    // Legacy: the cancel page passed the user (own manifests), the view page "admin".
    user_id: `${scope === 'all' ? 'admin' : user.userId}%`,
    IsCancelled: status === 'cancelled' ? 1 : 0,
    mainfest_no: search || null,
    Financial_Year: user.financialYear,
    division: user.divCode,
  });
  return recordset.map((r) => ({
    manifestNo: s(r.mainfest_no),
    manifestDate: iso(r.mainfest_date),
    manifestTime: s(r.mainfest_time),
    toBranch: s(r.to_branch_name ?? r.to_branch),
    toCity: s(r.To_City),
    freightType: s(r.freight_type ?? r.frt_type),
    dockets: n(r.docket_count),
    packages: n(r.total_package),
    challanNo: s(r.challan_no),
    createdBy: s(r.user_id),
  }));
}

export async function getManifest(user, manifestNo) {
  const [h] = await query(
    `select m.*, b.branch_name as to_branch_name, c.city_name as to_city_name
       from mainfest_entry m
       left join branch_master b on b.branch_code = m.to_branch
       left join city_master c on c.city_code = m.To_City
      where m.mainfest_no = @no and m.from_branch = @branch`,
    { no: manifestNo, branch: user.currentBranch.code });
  if (!h) throw notFound(`Manifest ${manifestNo} not found at this branch`);
  const rows = await query(
    `select mg.docket_no, mg.package, mg.weight, mg.freight, g.booking_date, g.Consigner_Name, g.consignee_name, g.destination
       from Manifest_grn mg join grn_master g on g.docket_no = mg.docket_no
      where mg.Manifest_no = @no order by mg.docket_no`, { no: manifestNo });
  return {
    manifestNo: s(h.mainfest_no),
    manifestDate: iso(h.mainfest_date),
    manifestTime: s(h.mainfest_time),
    freightType: s(h.freight_type ?? h.frt_type),
    destination: s(h.to_branch_name || h.to_city_name || h.to_branch || h.To_City),
    manualNo: s(h.m_manual_no),
    transportedBy: s(h.transportedby),
    coloaderName: s(h.coloader_name),
    remarks: s(h.remarks),
    challanNo: s(h.challan_no),
    cancelled: ['1', 'true'].includes(s(h.IsCancelled).toLowerCase()),
    createdBy: s(h.user_id),
    dockets: rows.map((r) => ({
      docketNo: s(r.docket_no), bookingDate: iso(r.booking_date), consigner: s(r.Consigner_Name), consignee: s(r.consignee_name),
      destination: s(r.destination), packages: n(r.package), weight: n(r.weight), freight: n(r.freight),
    })),
    fromBranch: s(h.from_branch),
    toBranchCode: s(h.to_branch),
    bags: await manifestBags(manifestNo),
  };
}

// ------------------------------------------------------------------ cancel

export async function cancelManifest(user, manifestNo) {
  const m = await getManifest(user, manifestNo);
  if (m.cancelled) throw conflict('This manifest is already cancelled');
  if (m.challanNo) throw conflict(`Challan no ${m.challanNo} has been generated, manifest cannot be cancelled`);
  const res = await exec('usp_Manifest_Cancel', {
    Manifest_no: manifestNo, user_id: user.userId, branch_code: user.currentBranch.code, Financial_Year: user.financialYear,
  }, { success: [sql().VarChar(1000), null] });
  if (s(res.output.success).toLowerCase() !== 'success') throw new HttpError(422, s(res.output.success) || 'Record not cancelled');
  await reopenForManifest(manifestNo);
  await query('update tblManifestBag set IsCancelled = 1 where ManifestNo = @m', { m: manifestNo });
  return { manifestNo, message: 'Manifest cancelled successfully' };
}
