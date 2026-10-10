// Challan entry (vehicle dispatch of manifests, road) — port of:
//   wwwroot/Operation/dispatchentry_fleet.aspx(.cs)          create ("FOR MANIFEST", ROAD)
//   wwwroot/Operation/dispatchentry_fleet_Cancel.aspx(.cs)   list / cancel
//   wwwroot/Operation/dispatchentry_fleet_View.aspx(.cs)     list / view
//   ClassLibrary/dal/dispatch_master_dal.cs, dispatch_master_Cancel_Dal.cs, vendor_master_dal.cs,
//   VehicleName_Master_Dal.cs, Account_Contra_dal.cs; App_Code/GeneralMethods.cs (ledgers)
//
// A challan puts manifests lying at this branch on one vehicle (own, attached vendor
// or market truck) with driver details and the hire amount. sp_insert_Dispatch_Master
// saves it, marks the manifests dispatched and posts the accounting entry
// (operation expense Dr / vendor Cr / TDS payable Cr).
//
// Fixed legacy bugs (docs/SECURITY.md):
//   * the challan no. was generated when the page opened, so two users could save the
//     same number — now generated inside the save transaction;
//   * "Advance amount not be greater than total freight" was inside `if (advance == "")`
//     and could never fire — now enforced;
//   * freight, TDS and balance were taken from the browser — now recomputed here from
//     the charges and the vendor's TDS % in the vendor master;
//   * manifest totals (weight / packages) came from the screen — now summed from Manifest_grn;
//   * vendor, vehicle, route and rate lookups concatenated values into SQL — now parameters;
//   * the second driver's DL no. was saved as the first driver's.
//
// Not ported (see docs/MIGRATION.md): AIR / TRAIN / TEMPO dispatch, "FOR PICKUP" / "FOR DRS"
// dispatch types (Stage 4), "without manifest" challans, consolidated e-way bill
// generation (external API), challan edit (dispatchentry_fleet_Edit.aspx). The hidden
// "Rate On" vendor-rate lookup is not used: the live screen hides it and freight is the
// sum of the charges typed in.

import { calculateChallan } from '../../../../shared/challanCalc.js';
import { config } from '../../config.js';
import { exec, query, sql, withTransaction } from '../../db/index.js';
import { badRequest, conflict, HttpError, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { finYr } from '../pickup/pickup.service.js';
import { s, n, iso, today } from '../../utils/values.js';
import { roadRateFor } from '../vendorrates/vendorrates.service.js';

const notCancelled = (col) => `cast(isnull(${col}, 0) as varchar(5)) in ('0', 'false')`;
const unprocessable = (msg, details) => new HttpError(422, msg, details);

export const VENDOR_TYPES = [
  { value: 'Market Vendor', label: 'Market' },
  { value: 'Vendor', label: 'Attached' },
  { value: 'Self', label: 'Self (own fleet)' },
];

export function options() {
  return {
    dispatchTypes: [{ value: 'FOR MANIFEST', label: 'For manifest' }],
    modes: [{ value: 'RD', label: 'ROAD' }],
    vendorTypes: VENDOR_TYPES,
    freightTypes: [{ value: 'SUNDRY', label: 'Sundry' }, { value: 'FTL', label: 'FTL' }],
    destinationTypes: [{ value: 'BRANCH', label: 'Branch wise (route)' }, { value: 'CITY', label: 'City wise' }],
    routeTypes: [{ value: 'DIRECT', label: 'Direct' }, { value: 'VIA', label: 'Via' }],
  };
}

// ------------------------------------------------------------------ lookups

/** vendor_master_dal.select_VendorsName — name is the vendor's ledger name. */
export async function vendors(user, { vendorType, mode = 'RD', code }) {
  const params = { t: vendorType, mode, div: user.divCode, code: code ?? null };
  const rows = vendorType === 'Market Vendor'
    ? await query(
      `select al.LedgerName as name, rtrim(ltrim(al.VendorOrClientCode)) as vendor_code, max(v.TDS) as TDS
         from tblAccountLedger al join temp_vendors_master v on al.VendorOrClientCode = v.vendor_code
        where v.vendor_mode like '%' + @mode + '%' and v.FTLDIVISION like '%' + @div + '%' and v.active_flag = 1
          and (@code is null or v.vendor_code = @code)
        group by al.LedgerName, al.VendorOrClientCode order by al.LedgerName`, params)
    : await query(
      `select al.LedgerName as name, al.VendorOrClientCode as vendor_code, max(v.TDS) as TDS
         from tblAccountLedger al join vendors_master v on al.VendorOrClientCode = v.vendor_code
        where v.vendor_type = @t and v.DivCode like '%' + @div + '%' and v.vendor_Mode like @mode + '%' and v.active_flag = 1
          and (@code is null or v.vendor_code = @code)
        group by al.LedgerName, al.VendorOrClientCode order by al.LedgerName`, params);
  return rows.map((r) => ({ code: s(r.vendor_code), name: s(r.name), tdsPercent: n(r.TDS) }));
}

/**
 * VehicleName_Master_Dal.select_vendor_vehicle_master — the vendor's active trucks: the Vehicle Master and the road
 * vehicles added on Setting → Vendor and Vehicle (vendor_vehicle_master, which the legacy challan read).
 */
export async function vehicles(vendorCode) {
  const rows = await query(
    `select VEHICLE_NO, Vechile_Type_Code, Vechile_Capacity from Vechile_Master
      where VendorCodeName = @v and isnull(Vechile_Status, 'Active') = 'Active'
     union
     select truck_no, vehicle_name, Vehicle_Capacity from vendor_vehicle_master
      where vendor_code = @v and mode_code = 'RD' and isnull(Status, 1) = 1 and isnull(truck_no, '') <> ''
        and truck_no not in (select VEHICLE_NO from Vechile_Master)
     order by 1`,
    { v: vendorCode });
  return rows.map((r) => ({ truckNo: s(r.VEHICLE_NO), type: s(r.Vechile_Type_Code), capacity: n(r.Vechile_Capacity) }));
}

async function runningChallan(truckNo) {
  const [r] = await query(
    `select top 1 dm.challan_no, bm.branch_name as from_branch, isnull(bm1.branch_name, c.city_name) as to_branch
       from dispatch_master dm
       left join branch_master bm on bm.branch_code = dm.from_branch
       left join branch_master bm1 on bm1.branch_code = dm.tobcode
       left join city_master c on c.city_code = dm.to_city
      where dm.truck_no = @t and dm.arrival_status is null and ${notCancelled('dm.IsCancelled')}
      order by dm.challan_date desc`, { t: truckNo });
  return r ? { challanNo: s(r.challan_no), from: s(r.from_branch), to: s(r.to_branch) } : null;
}

async function allocatedDriver(truckNo) {
  // fillDriver(): sahanafms_db.dbo.VGetAllocatedDrivers lives in the fleet (FMS) database.
  if (!config.fleetDb) return null;
  try {
    const [r] = await query(
      `select top 1 driver_name + ':' + driver_code as driver_name, mobile_no
         from dbo.VGetAllocatedDrivers where isactive = 1 and vehicle_No = @t order by created_date desc`,
      { t: truckNo }, { db: 'fleet' });
    return r ? { name: s(r.driver_name), mobile: s(r.mobile_no) } : null;
  } catch {
    return null;
  }
}

/** Truck details + "Truck is running" warning + allocated driver (ddl_truckno_SelectedIndexChanged). */
export async function vehicleDetails(truckNo) {
  const [v] = await query(
    `select VEHICLE_NO, VendorCodeName, Vechile_Type_Code, ENGINE_NO, CHASSIS_NO, MODEL, MAKE, Vechile_Capacity from Vechile_Master where VEHICLE_NO = @t
     union all
     select top 1 truck_no, vendor_code, vehicle_name, engine_no, chasis_no, model, make, Vehicle_Capacity from vendor_vehicle_master
      where truck_no = @t and mode_code = 'RD' and not exists (select 1 from Vechile_Master where VEHICLE_NO = @t)`, { t: truckNo });
  if (!v) throw notFound(`Vehicle ${truckNo} not found`);
  return {
    truckNo: s(v.VEHICLE_NO),
    vendorCode: s(v.VendorCodeName),
    vehicleName: s(v.Vechile_Type_Code),
    engineNo: s(v.ENGINE_NO),
    chassisNo: s(v.CHASSIS_NO),
    model: s(v.MODEL),
    make: s(v.MAKE),
    capacity: n(v.Vechile_Capacity),
    running: await runningChallan(truckNo),
    driver: await allocatedDriver(truckNo),
  };
}

/** Driver name autocomplete (GetDriver web method). */
export async function searchDrivers(term) {
  const rows = await query(
    "select top 20 Drivername, branch, mobile_no from Driver_master where Drivername like @t + '%' and IsActive = 1 order by Drivername",
    { t: term });
  return rows.map((r) => ({ name: s(r.Drivername), branch: s(r.branch), mobile: s(r.mobile_no) }));
}

/** select_fleet_route_changes(branch, "", "ROUTE", DIRECT|VIA) */
/** toBranch (optional): only the routes that reach that branch (its last stop or a station on the way). */
export async function routes(user, routeType, toBranch = '') {
  const rows = await query(
    `select distinct r.route_code, r.route_name from route r
       join routedetail rd on rd.route_code = r.route_code
       join branch_master cm on cm.branch_code = rd.from_station
      where r.from_route_code = @b and r.route_type = @rt
        and (@to = '' or r.To_Route_Code = @to or exists (select 1 from routedetail x where x.route_code = r.route_code and x.to_station = @to))
      order by r.route_name`,
    { b: user.currentBranch.code, rt: routeType, to: toBranch });
  return rows.map((r) => ({ code: s(r.route_code), name: s(r.route_name) }));
}

/** select_route_destination_name + select_route_Time + routedetail stations. */
export async function routeDetails(user, routeCode) {
  const [r] = await query(
    `select top 1 r.route_code, r.route_name, r.route_type, r.total_km, r.from_route_code,
            case when r.route_type = 'VIA' then r.To_Route_Code else rd.to_station end as to_routecode, bm.branch_name
       from route r
       join routedetail rd on rd.route_code = r.route_code
       join branch_master bm on bm.branch_code = (case when r.route_type = 'VIA' then r.To_Route_Code else rd.to_station end)
      where r.route_code = @r`, { r: routeCode });
  if (!r || s(r.from_route_code) !== user.currentBranch.code) throw notFound(`Route ${routeCode} not found for this branch`);
  const times = await query('select Set_Id, Set_Time1 from Route_SetTime where route_code = @r order by Set_Time1', { r: routeCode });
  const stations = await query(
    `select distinct rd.to_station, b.branch_name from routedetail rd left join branch_master b on b.branch_code = rd.to_station
      where rd.route_code = @r`, { r: routeCode });
  return {
    code: s(r.route_code),
    name: s(r.route_name),
    routeType: s(r.route_type),
    totalKm: n(r.total_km),
    destination: { code: s(r.to_routecode), name: s(r.branch_name) },
    times: times.length ? times.map((t) => s(t.Set_Time1)) : ['00:00'],
    stations: stations.map((x) => ({ code: s(x.to_station), name: s(x.branch_name) })),
  };
}

/**
 * ddlRateMode_SelectedIndexChanged (select_Vendor_road_rate_master_rate + KM_ByRouteCode): the vendor's road rate in force
 * from this branch's city to the route's destination branch city (or the destination city), and the hire charge it gives
 * for the load — the route's km for per-km rates.
 */
export async function vendorRate(user, q) {
  const [from] = await query('select city_code from branch_master where branch_code = @b', { b: user.currentBranch.code });
  let destCity = q.city;
  let km = 0;
  if (q.routeCode) {
    const route = await routeDetails(user, q.routeCode);
    const [to] = await query('select city_code from branch_master where branch_code = @b', { b: route.destination.code });
    destCity = s(to?.city_code);
    km = route.totalKm;
  }
  if (!destCity) throw badRequest('Select the route or destination city first');
  const rates = await roadRateFor(q.vendorCode, s(from?.city_code), destCity, { weight: q.weight, km });
  return { origin: s(from?.city_code), destination: destCity, km, rates };
}

// ------------------------------------------------------------------ pending manifests

function manifestFilter(q, params) {
  if (q.destType === 'BRANCH') {
    params.route = q.routeCode;
    return 'me.to_branch in (select to_station from routedetail where route_code = @route)';
  }
  params.dest = q.destination;
  return '(me.To_City = @dest or me.to_branch = @dest)'; // Search_Manifest_Details_CB
}

const manifestSelect = (where) => `
  select me.mainfest_no, me.m_manual_no, me.mainfest_date, me.mainfest_time, me.to_branch, me.To_City,
         isnull(b1.branch_name, c.city_name) as tobranch, me.freight_type, me.from_branch,
         me.Dispatch_Status, me.challan_no, me.IsCancelled, me.div_code,
         (select isnull(sum(package), 0) from Manifest_grn g where g.Manifest_no = me.mainfest_no) as TotalPackage,
         (select isnull(sum(weight), 0) from Manifest_grn g where g.Manifest_no = me.mainfest_no) as Totalweight,
         (select isnull(sum(freight), 0) from Manifest_grn g where g.Manifest_no = me.mainfest_no) as Totalfreight
    from mainfest_entry me
    left join branch_master b1 on b1.branch_code = me.to_branch
    left join city_master c on c.city_code = me.To_City
   where ${where}`;

const mapManifest = (r) => ({
  manifestNo: s(r.mainfest_no),
  manualNo: s(r.m_manual_no),
  manifestDate: iso(r.mainfest_date),
  manifestTime: s(r.mainfest_time),
  toCode: s(r.to_branch || r.To_City),
  to: s(r.tobranch),
  freightType: s(r.freight_type),
  packages: n(r.TotalPackage),
  weight: n(r.Totalweight),
  freight: n(r.Totalfreight),
});

/** Search_Manifest_Details_CB / _route_wise + select_All_MainfestDetails. */
export async function pendingManifests(user, q) {
  const params = { branch: user.currentBranch.code, div: user.divCode, ft: q.freightType, from: q.from, to: q.to };
  const rows = await query(manifestSelect(`
        me.from_branch = @branch and me.div_code = @div and me.freight_type = @ft
    and me.mainfest_date between @from and @to
    and me.Dispatch_Status is null and ${notCancelled('me.IsCancelled')}
    and not exists (select 1 from Manifest_grn g where g.Manifest_no = me.mainfest_no and g.Dispatch_Status is not null)
    and ${manifestFilter(q, params)}
   order by me.mainfest_date, me.mainfest_no`), params);
  return rows.map(mapManifest);
}

// ------------------------------------------------------------------ ledgers

/** GeneralMethods.GetLedgerDetailsByName */
async function ledgerCode(name, user) {
  const [r] = await query(
    `select top 1 al.LedgerCode from tblAccountLedger al
      where al.LedgerName = @n and al.Financial_Year = @fy and al.Division = @div and al.IsActive = 1`,
    { n: name, fy: user.financialYear, div: user.divCode });
  return r ? s(r.LedgerCode) : null;
}

/** GeneralMethods.Get_Ledger_Balance for the financial year (column "blance"). */
async function ledgerBalance(name, user) {
  const fy = financialYearRange(user.financialYear);
  const [r] = await query(
    `select top 1 isnull(case upper(al.DrCr) when 'DR' then sum(isnull(at.Dr, 0)) - sum(isnull(at.Cr, 0)) + al.OpeningBal
                                   else sum(isnull(at.Dr, 0)) - sum(isnull(at.Cr, 0)) - al.OpeningBal end, 0) as blance
       from tblAccountLedger al
       left join tblAccountTrasaction at on at.LedgerCode = al.LedgerCode
             and at.CreatedDate >= @from and at.CreatedDate < dateadd(day, 1, cast(@to as date)) and isnull(at.IsCancelled, 0) = 0
      where al.LedgerName = @n and al.Financial_Year = @fy and al.IsActive = 1 and al.Division = @div
      group by al.LedgerCode, al.OpeningBal, al.DrCr`,
    { n: name, from: fy.from, to: fy.to, fy: user.financialYear, div: user.divCode });
  return r ? n(r.blance) : null;
}

// ------------------------------------------------------------------ create

export async function createChallan(user, body) {
  const branch = user.currentBranch.code;
  if (body.challanDate > today()) throw badRequest('Challan date should not be greater than current date');
  if (body.deliveryDate && body.challanDate > body.deliveryDate) throw badRequest('Challan date should not be greater than delivery date');
  const nos = [...new Set(body.manifests)];
  if (nos.length !== body.manifests.length) throw badRequest('The same manifest is listed twice');

  // --- destination / route
  let destination; let route = null;
  if (body.destType === 'BRANCH') {
    route = await routeDetails(user, body.routeCode);
    if (!route.times.includes(body.routeTime)) throw badRequest('Select a route time for this route');
    destination = { tobcode: route.destination.code, toCity: '' };
  } else {
    const [c] = await query('select city_code from city_master where city_code = @c', { c: body.destination });
    if (!c) throw badRequest('Destination is required');
    destination = { tobcode: '', toCity: s(c.city_code) };
  }

  // --- manifests: at this branch, not dispatched / cancelled, dated on or before the challan
  const params = { branch };
  const inList = nos.map((m, i) => { params[`m${i}`] = m; return `@m${i}`; }).join(',');
  const found = await query(manifestSelect(`me.mainfest_no in (${inList})`), params);
  const byNo = new Map(found.map((r) => [s(r.mainfest_no), r]));
  const stations = route ? new Set(route.stations.map((x) => x.code)) : null;
  const problems = [];
  for (const no of nos) {
    const r = byNo.get(no);
    if (!r) { problems.push(`${no}: not found`); continue; }
    if (s(r.from_branch) !== branch || s(r.div_code) !== user.divCode) problems.push(`${no}: not a manifest of this branch`);
    else if (!['0', 'false', ''].includes(s(r.IsCancelled).toLowerCase())) problems.push(`${no}: cancelled`);
    else if (s(r.Dispatch_Status) || s(r.challan_no)) problems.push(`${no}: already dispatched on challan ${s(r.challan_no)}`);
    else if (s(r.freight_type) !== body.freightType) problems.push(`${no}: is a ${s(r.freight_type)} manifest`);
    else if (iso(r.mainfest_date) > body.challanDate) problems.push(`${no}: challan date should be on or after the manifest date`);
    else if (stations && !stations.has(s(r.to_branch))) problems.push(`${no}: destination is not on route ${route.code}`);
    else if (!stations && s(r.To_City) !== destination.toCity && s(r.to_branch) !== destination.toCity) problems.push(`${no}: not for the selected city`);
  }
  if (problems.length) throw unprocessable('Some manifests cannot be dispatched', problems.map((m) => ({ path: 'manifests', message: m })));
  const manifests = nos.map((no) => mapManifest(byNo.get(no)));
  const totals = manifests.reduce((t, m) => ({
    weight: t.weight + m.weight, packages: t.packages + m.packages, freight: t.freight + m.freight,
  }), { weight: 0, packages: 0, freight: 0 });
  if (totals.weight === 0) throw unprocessable('Total weight should not be zero');
  if (totals.packages === 0) throw unprocessable('Total packages should not be zero');

  // --- vendor, vehicle, capacity
  const [vendor] = await vendors(user, { vendorType: body.vendorType, mode: body.mode, code: body.vendorCode });
  if (!vendor) throw badRequest('Select a vendor');
  const isMarket = body.vendorType === 'Market Vendor';
  let vehicle;
  if (isMarket) {
    vehicle = { truckNo: body.truckNo, capacity: body.capacity, vehicleName: '', engineNo: '', chassisNo: '', model: '', make: '' };
  } else {
    const v = await vehicleDetails(body.truckNo).catch(() => null);
    if (!v || v.vendorCode !== vendor.code) throw badRequest(`Vehicle ${body.truckNo} does not belong to ${vendor.name}`);
    vehicle = v;
  }
  const capacity = n(vehicle.capacity);
  let overloadWeight = 0;
  if (body.isOverload) {
    if (totals.weight <= capacity) throw unprocessable('Truck is not overloaded');
    overloadWeight = Math.round((totals.weight - capacity) * 100) / 100;
  } else if (capacity > 0 && totals.weight > capacity) {
    throw unprocessable(`Truck capacity is overloaded (${totals.weight} kg on a ${capacity} kg truck) — tick "Overload" to continue`);
  }

  // --- amounts (server-side; clcFreight)
  const calc = calculateChallan({ ...body, tdsPercent: vendor.tdsPercent });
  if (calc.freight < 0) throw badRequest('Deduction cannot be more than the charges');
  if (body.vendorType !== 'Self' && calc.advance > calc.freight) throw unprocessable('Advance amount should not be greater than total freight');

  // --- ledgers (Bind Ledger ...)
  const operation = `TRUCK HIRE CHARGE FOR ${body.freightType}`;
  const [opLedger, vendorLedger, tdsLedger] = await Promise.all([
    ledgerCode(operation, user), ledgerCode(vendor.name, user), ledgerCode('TDS PAYABLE', user),
  ]);
  for (const [code, name] of [[vendorLedger, vendor.name], [opLedger, operation], [tdsLedger, 'TDS PAYABLE']]) {
    if (!code) throw unprocessable(`Bind ledger "${name}" for this division and financial year first`);
  }
  if (body.vendorType === 'Self') {
    const cashName = `CASH ${user.currentBranch.name}`;
    const bal = await ledgerBalance(cashName, user);
    if (bal === null) throw unprocessable(`Ledger "${cashName}" not found`);
    if (bal - calc.advance < 0) throw unprocessable(`Ledger ${cashName} balance is ${bal}`);
  }

  const [b] = await query('select Short_Code from branch_master where branch_code = @b', { b: branch });
  const shortCode = s(b?.Short_Code);

  // --- table-valued parameters
  const S = sql();
  const tvpManifests = new S.Table(config.tvp.challanManifest);
  tvpManifests.columns.add('mainfest_no', S.VarChar(30));
  for (const no of nos) tvpManifests.rows.add(no);
  const tvpTrans = new S.Table(config.tvp.transaction);
  tvpTrans.columns.add('Ledger_code', S.VarChar(20));
  tvpTrans.columns.add('Amount_Dr', S.Float);
  tvpTrans.columns.add('Amount_Cr', S.Float);
  tvpTrans.columns.add('Balance', S.Real);
  tvpTrans.columns.add('TransId', S.Int);
  tvpTrans.columns.add('Entry', S.VarChar(20));
  tvpTrans.columns.add('Mode', S.VarChar(20));
  tvpTrans.rows.add(opLedger, calc.freight, 0, 0, 0, 'Ledger', 'CHALLAN');         // operation Dr
  tvpTrans.rows.add(vendorLedger, 0, calc.vendorAmount, 0, 0, 'Ledger', 'CHALLAN'); // vendor Cr
  tvpTrans.rows.add(tdsLedger, 0, calc.tds, 0, 0, 'Ledger', 'CHALLAN');             // TDS Cr

  const challanNo = await withTransaction(async (tx) => {
    // Numbering inside the transaction (legacy took it at page load).
    const prefix = 'CTH';
    const gen = await exec('GET_AUTO_GENERATED_CODE_FOR_ENTRY', {
      prefix, ShortYear: finYr(user.financialYear), branch_code: branch, Financial_Year: user.financialYear,
    }, { retval: [S.VarChar(800), null] }, { tx });
    const no = s(gen.output.retval);
    if (!no) throw unprocessable('Could not generate the challan number');

    const res = await exec('sp_insert_Dispatch_Master', {
      dtMainfest_no: { type: S.TVP, value: tvpManifests },
      ud_Transaction_Details: { type: S.TVP, value: tvpTrans },
      mode_code: body.mode,
      vendor_type: body.vendorType,
      vendor_code: vendor.code,
      fltno: '', airline_name: '', airway_billno: '', train_no: '', rr_no: '', train_name: '',
      draft_no: '', dispatch_date: null, bank: '', amount: 0, delayhrs: '', delaycharge: 0,
      loadedby: body.loadedBy.toUpperCase(),
      drivername: body.driverName,
      address: body.driverMobile,
      dlno: body.dlNo,
      refdispatch: body.driverRef,
      vehicle_name: vehicle.vehicleName, engine_no: vehicle.engineNo, chasis_no: vehicle.chassisNo,
      model: vehicle.model, make: vehicle.make, validity: '',
      capacity: String(capacity),
      ofstate: '',
      delaydate: body.deliveryDate || null,
      delytime: body.deliveryTime,
      penalty: body.penalty, incentive: body.incentive,
      opening_meter: body.openingMeter, closing_meter: body.closingMeter,
      challanno: no,
      challan_date: body.challanDate,
      challantime: body.challanTime,
      tobcode: destination.tobcode,
      message: body.message,
      total_weight: totals.weight,
      total_price: totals.packages, // legacy "total price" field holds total packages
      total_freight: calc.freight,
      advance: calc.advance,
      manifest_no: nos.join(','),
      status: 'Active',
      user_id: user.userId,
      from_branch: branch,
      bal_amount: calc.balance,
      truck_no: vehicle.truckNo,
      br_no: '',
      market_vendor_name: '',
      pickup_no: '', drs_no: '',
      dispatch_type: 'FOR MANIFEST',
      Location: body.location,
      sealno: body.sealNo,
      second_driver_name: body.secondDriverName,
      sec_mobileno: body.secondDriverMobile,
      sec_dlno: body.secondDriverDlNo,
      sec_ref: body.secondDriverRef,
      route_code: route ? route.code : '',
      frt_type: body.freightType,
      rate_on: isMarket ? 'PKM' : '',
      to_city: destination.toCity,
      Route_Time: route ? body.routeTime : '',
      Financial_Year: user.financialYear,
      ShortCode: shortCode,
      IsOverload: body.isOverload,
      OverloadWeight: String(overloadWeight),
      EWayBill: body.ewayBillNo,
      dest_type: body.destType === 'BRANCH' ? 'BRANCH WISE' : 'CITY WISE',
      Labour_Charge: body.labourCharge,
      Division: user.divCode,
      other_charge: body.otherCharge,
      deduction_amt: body.deductionAmt,
      hire_charge: body.hireCharge,
      overload_charge: body.overloadCharge,
    }, { retval: [S.VarChar(200), null] }, { tx });
    const msg = s(res.output.retval);
    if (msg.toLowerCase() !== 'success') throw unprocessable(msg || 'Challan could not be saved');
    return no;
  });

  return {
    challanNo,
    manifests: nos.length,
    totals: { ...totals, ...calc, tdsPercent: vendor.tdsPercent, overloadWeight },
    message: `Challan ${challanNo} saved`,
  };
}

// ------------------------------------------------------------------ list / view

export async function listChallans(user, { from, to, status = 'active', search = '', scope = 'mine' }) {
  const { recordset } = await exec('usp_select_challan_entry_cancel', {
    booking_date1: from,
    booking_date2: to,
    currbranch: user.currentBranch.code,
    user_id: `${scope === 'all' ? 'admin' : user.userId}%`,
    IsCancelled: status === 'cancelled' ? 1 : 0,
    challan_no: search || 'ALL',
    Financial_Year: user.financialYear,
    division: user.divCode,
  });
  return recordset.map((r) => ({
    challanNo: s(r.challan_no),
    challanDate: iso(r.challan_date),
    challanTime: s(r.challan_time),
    mode: s(r.mode_code),
    from: s(r.from_branch),
    to: s(r.tobcode),
    manifests: s(r.manifest_no).split(',').map((x) => x.trim()).filter(Boolean),
    truckNo: s(r.truck_no),
    vendor: s(r.vendor_name),
    weight: n(r.total_weight),
    packages: n(r.total_price),
    freight: n(r.total_freight),
    arrived: Boolean(s(r.arrival_status)),
    createdBy: s(r.user_id),
  }));
}

export async function getChallan(user, challanNo) {
  const [d] = await query(
    `select d.*, b.branch_name as from_name, isnull(tb.branch_name, c.city_name) as to_name,
            isnull(v.Name, tv.Name) as vendor_name, r.route_name
       from dispatch_master d
       left join branch_master b on b.branch_code = d.from_branch
       left join branch_master tb on tb.branch_code = d.tobcode
       left join city_master c on c.city_code = d.to_city
       left join vendors_master v on v.vendor_code = d.vendor_code
       left join temp_vendors_master tv on tv.vendor_code = d.vendor_code
       left join route r on r.route_code = d.route_code
      where d.challan_no = @no and d.from_branch = @branch`,
    { no: challanNo, branch: user.currentBranch.code });
  if (!d) throw notFound(`Challan ${challanNo} not found at this branch`);
  const nos = s(d.manifest_no).split(',').map((x) => x.trim()).filter(Boolean);
  let manifests = [];
  if (nos.length) {
    const params = {};
    const inList = nos.map((m, i) => { params[`m${i}`] = m; return `@m${i}`; }).join(',');
    manifests = (await query(`${manifestSelect(`me.mainfest_no in (${inList})`)} order by me.mainfest_no`, params)).map(mapManifest);
  }
  return {
    challanNo: s(d.challan_no),
    challanDate: iso(d.challan_date),
    challanTime: s(d.challan_time),
    mode: s(d.mode_code),
    dispatchType: s(d.dispatch_type),
    freightType: s(d.frt_type),
    destType: s(d.dest_type),
    from: s(d.from_name),
    to: s(d.to_name),
    route: s(d.route_name),
    routeTime: s(d.Route_Time),
    vendorType: s(d.vendor_type),
    vendor: s(d.vendor_name),
    truckNo: s(d.truck_no),
    capacity: n(d.capacity),
    isOverload: Boolean(d.IsOverload),
    overloadWeight: n(d.OverloadWeight),
    driverName: s(d.drivername),
    driverMobile: s(d.address),
    secondDriverName: s(d.second_driver_name),
    sealNo: s(d.seal_no),
    ewayBillNo: s(d.EWayBill),
    deliveryDate: iso(d.delydate),
    weight: n(d.total_weight),
    packages: n(d.total_price),
    amounts: {
      hireCharge: n(d.hire_charge), labourCharge: n(d.Labour_Charge), otherCharge: n(d.other_charge),
      overloadCharge: n(d.overload_charge), deductionAmt: n(d.deduction_amt),
      freight: n(d.total_freight), advance: n(d.advance), balance: n(d.bal_amount),
    },
    message: s(d.message),
    cancelled: !['0', 'false', ''].includes(s(d.IsCancelled).toLowerCase()),
    arrived: Boolean(s(d.arrival_status)),
    createdBy: s(d.user_id),
    manifests,
  };
}

// ------------------------------------------------------------------ cancel

export async function cancelChallan(user, challanNo) {
  const c = await getChallan(user, challanNo);
  if (c.cancelled) throw conflict('This challan is already cancelled');
  const arrived = await query(
    'select top 1 1 as x from Arrival_entry where challan_no = @c and isnull(IsCancelled, 0) = 0', { c: challanNo });
  if (arrived.length || c.arrived) throw conflict('Challan cannot be cancelled after arrival entry');
  const res = await exec('usp_Dispatch_Master_Cancel', {
    challan_no: challanNo, user_id: user.userId, Financial_Year: user.financialYear,
  }, { success: [sql().VarChar(1000), null] });
  if (s(res.output.success).toLowerCase() !== 'success') throw unprocessable(s(res.output.success) || 'Challan not cancelled');
  return { challanNo, message: 'Challan cancelled successfully' };
}
