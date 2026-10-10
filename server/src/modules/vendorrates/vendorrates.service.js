// Vendor rate masters — port of Rate/Vendor_Road_Rate_Master.aspx, Rate/Vendor_Air_Rate_Master.aspx and
// Rate/Vendor_Train_Rate_Master.aspx (Vendor_Road_Rate_Dal, Vendor_Air_rateDal, Vendor_Train_Rate_dal).
//
// What we pay a vendor to carry our load between two cities:
//   * road  — FTL (a lump sum, or per km — FTL_Rate_Type "FTL" / "FTL PKM"), PKG (per kg) or PKM (per km); a co-loader
//             is paid per kg. The challan reads it for the truck-hire charge (challan "Rate mode").
//   * air   — a vendor's rate per kg with optional weight slabs; for our own (Self) consignments the airline's
//             charges: up-to weight and charge, AWB/DO, FSC, unit, X-ray, TSP out / in with their minimums, service tax.
//   * train — per kg or a full-container trip cost, plus the DD amount, for one of the vendor's trains.
// Every rate runs from an effective date (the latest one on or before today is in force) inside its start / end dates.
//
// Changes from the pages (docs/MIGRATION.md "Vendor rates"):
//   * a new rate is a new version by effective date; the pages refused any second active road rate for the vendor and
//     route (so a rate could only change by deactivating the old one first) and did not check air / train duplicates —
//     now the same vendor + route (+ mode / flight / train) + effective date is refused;
//   * the effective date must be today or later and inside the start / end dates, which lie in the login financial year;
//   * the air slabs must be contiguous and increasing (the page only checked each row's from < to); all rows of a save
//     go in one transaction; SQL is parameterised (the duplicate checks were concatenated);
//   * air flights and trains come from the vendor's own flights / trains (Setting → Vendor and Vehicle).
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { s, n, iso, today, round2 } from '../../utils/values.js';

export const VENDOR_TYPES = { road: ['VENDOR', 'COLOADER'], air: ['VENDOR', 'SELF'], train: ['VENDOR', 'SELF'] };
const TYPE_TEXT = { VENDOR: 'Vendor', SELF: 'Self', COLOADER: 'Coloader' };
export const ROAD_MODES = ['FTL', 'PKG', 'PKM'];
export const FTL_RATE_TYPES = ['FTL', 'FTL PKM'];
export const TRAIN_RATE_TYPES = { 1: 'Per kg', 2: 'Full container' };
export const FLIGHT_SHIFTS = ['Morning', 'Evening'];

// ------------------------------------------------------------------ pickers

/** select_VendorName_road_rate_master / select_VendorsName(type): active vendors of the type in the division. */
export async function vendors(user, kind, type) {
  if (!VENDOR_TYPES[kind].includes(type)) return [];
  const rows = await query(
    `select vendor_code, Name from vendors_master
      where upper(vendor_type) = @t and isnull(active_flag, 1) = 1 and (@div = '' or DivCode like '%' + @div + '%')
      order by Name`, { t: type, div: s(user.divCode) });
  return rows.map((r) => ({ value: s(r.vendor_code), label: `${s(r.Name)} : ${s(r.vendor_code)}` }));
}

/** The vendor's flights (air) or trains (train) from Setting → Vendor and Vehicle; trains fall back to the train master. */
export async function vendorCarriers(kind, vendor) {
  const rows = await query(
    `select vehicle_no, vehicle_name, Direction, train_type from vendor_vehicle_master
      where vendor_code = @v and mode_code = @m and isnull(Status, 1) = 1 order by vehicle_no`,
    { v: vendor, m: kind === 'air' ? 'AR' : 'TR' });
  if (rows.length || kind === 'air') {
    return rows.map((r) => ({ value: s(r.vehicle_no), label: `${s(r.vehicle_no)} - ${s(r.vehicle_name)}`, name: s(r.vehicle_name), trainType: s(r.train_type) }));
  }
  const trains = await query("select TrainCode, TrainName from Train_Master where isnull(active_flag, 'Active') = 'Active' order by TrainCode");
  return trains.map((r) => ({ value: s(r.TrainCode), label: `${s(r.TrainCode)} - ${s(r.TrainName)}`, name: s(r.TrainName), trainType: '' }));
}

export async function cities(q) {
  const rows = await query(
    `select top 20 city_code, city_name from city_master
      where isnull(active_flag, 'Active') = 'Active' and (city_name like @q + '%' or city_code = @q) order by city_name`, { q });
  return rows.map((r) => ({ value: s(r.city_code), label: `${s(r.city_name)} : ${s(r.city_code)}` }));
}

// ------------------------------------------------------------------ shared rules

async function checkCommon(user, kind, body) {
  const fy = financialYearRange(user.financialYear);
  if (body.startDate && body.endDate) {
    if (fy && (body.startDate < fy.from || body.endDate > fy.to)) throw badRequest(`Start and end dates should be in the financial year ${user.financialYear}`);
    if (body.endDate < body.startDate) throw badRequest('End date should not be before the start date');
    if (body.effectiveDate < body.startDate || body.effectiveDate > body.endDate) throw badRequest('The effective date should be between the start and end dates');
  } else if (fy && (body.effectiveDate < fy.from || body.effectiveDate > fy.to)) {
    throw badRequest(`The effective date should be in the financial year ${user.financialYear}`);
  }
  if (body.effectiveDate < today()) throw badRequest('The effective date cannot be in the past');
  if (!(await vendors(user, kind, body.vendorType)).some((v) => v.value === body.vendor)) throw badRequest(`Select a ${TYPE_TEXT[body.vendorType].toLowerCase()} of your division`);
  if (body.origin === body.destination) throw badRequest('Origin and destination should be different');
  const known = await query('select city_code from city_master where city_code in (@o, @d)', { o: body.origin, d: body.destination });
  if (known.length < 2) throw badRequest('Select the origin and destination cities');
}

const withStatus = (rows, key) => {
  const inForce = new Map();
  for (const r of rows) if (r.active && r.effectiveDate <= today() && !inForce.has(key(r))) inForce.set(key(r), r.id);
  return rows.map((r) => ({ ...r, inForce: inForce.get(key(r)) === r.id, upcoming: r.active && r.effectiveDate > today() }));
};

// ------------------------------------------------------------------ road

const ROAD_SELECT = `
  select r.*, vm.Name as vendor_label, oc.city_name as origin_name, dc.city_name as destination_name
    from vendor_road_rate_master r
    left join vendors_master vm on vm.vendor_code = r.vendor_name
    left join city_master oc on oc.city_code = r.origin
    left join city_master dc on dc.city_code = r.destination`;
const mapRoad = (r) => ({
  id: Number(r.slno), vendorType: s(r.vendor_type), vendor: s(r.vendor_name), vendorName: s(r.vendor_label), rateMode: s(r.rate_mode),
  ftlRateType: s(r.FTL_Rate_Type), origin: s(r.origin), originName: s(r.origin_name), destination: s(r.destination),
  destinationName: s(r.destination_name), ftlAmount: n(r.ftl_amount), perKg: n(r.ftl_pkg), perKm: n(r.ftl_pkm),
  effectiveDate: iso(r.Effective_Date), startDate: iso(r.StartDate), endDate: iso(r.EndDate), active: r.IsActive === null ? true : Boolean(r.IsActive),
});

export async function listRoad({ vendor = '', origin = '', destination = '' } = {}) {
  const rows = (await query(
    `${ROAD_SELECT} where (@v = '' or r.vendor_name = @v) and (@o = '' or r.origin = @o) and (@d = '' or r.destination = @d)
      order by vm.Name, oc.city_name, dc.city_name, r.rate_mode, r.Effective_Date desc, r.slno desc`,
    { v: vendor, o: origin, d: destination })).map(mapRoad);
  return withStatus(rows, (r) => `${r.vendor}|${r.origin}|${r.destination}|${r.rateMode}`);
}

export async function createRoad(user, body) {
  const mode = body.vendorType === 'COLOADER' ? 'PKG' : body.rateMode;       // a co-loader is paid per kg
  if (!ROAD_MODES.includes(mode)) throw badRequest('Select the rate mode');
  const amounts = { ftl_amount: 0, ftl_pkg: 0, ftl_pkm: 0 };
  if (mode === 'FTL') {
    if (!FTL_RATE_TYPES.includes(body.ftlRateType)) throw badRequest('Select the FTL rate type');
    if (!(body.ftlAmount > 0)) throw badRequest(body.ftlRateType === 'FTL PKM' ? 'Enter the FTL rate per km' : 'Enter the FTL amount');
    amounts.ftl_amount = body.ftlAmount;
  } else if (mode === 'PKG') {
    if (!(body.perKg > 0)) throw badRequest('Enter the rate per kg');
    amounts.ftl_pkg = body.perKg;
  } else {
    if (!(body.perKm > 0)) throw badRequest('Enter the rate per km');
    amounts.ftl_pkm = body.perKm;
  }
  await checkCommon(user, 'road', body);
  return withTransaction(async (tx) => {
    const [dup] = await query(
      `select top 1 slno from vendor_road_rate_master with (updlock, holdlock)
        where vendor_name = @v and origin = @o and destination = @d and rate_mode = @m and Effective_Date = @e and IsActive = 1`,
      { v: body.vendor, o: body.origin, d: body.destination, m: mode, e: body.effectiveDate }, { tx });
    if (dup) throw conflict('Rate already exists for this vendor, route, rate mode and effective date');
    const [row] = await query(
      `insert into vendor_road_rate_master(vendor_type, vendor_name, vehicle_type, rate_mode, capacity, origin, destination, ftl_amount,
         ftl_pkg, ftl_pkm, Route_Code, Route_Name, Effective_Date, StartDate, EndDate, FTL_Rate_Type, Is_Self, IsActive, created_by)
       output inserted.slno
       values (@t, @v, '', @m, 'NA', @o, @d, @fa, @pkg, @pkm, '', '', @e, @sd, @ed, @frt, 0, 1, @u)`,
      { t: body.vendorType, v: body.vendor, m: mode, o: body.origin, d: body.destination, fa: amounts.ftl_amount, pkg: amounts.ftl_pkg,
        pkm: amounts.ftl_pkm, e: body.effectiveDate, sd: body.startDate, ed: body.endDate, frt: mode === 'FTL' ? body.ftlRateType : '', u: user.userId }, { tx });
    return { id: Number(row.slno), message: `Road rate saved — from ${body.effectiveDate}` };
  });
}

/**
 * select_Vendor_road_rate_master_rate (challan "Rate mode"): the vendor's road rate in force for origin → destination,
 * and the hire charge it gives for the load — FTL lump sum, FTL per km × km, per kg × weight or per km × km.
 */
export async function roadRateFor(vendor, origin, destination, { weight = 0, km = 0 } = {}) {
  const rows = (await listRoad({ vendor, origin, destination })).filter((r) => r.inForce);
  return rows.map((r) => {
    const perKm = r.rateMode === 'PKM' || (r.rateMode === 'FTL' && r.ftlRateType === 'FTL PKM');
    const unit = r.rateMode === 'PKG' ? r.perKg : r.rateMode === 'PKM' ? r.perKm : r.ftlAmount;
    const hire = r.rateMode === 'PKG' ? unit * weight : perKm ? unit * km : unit;
    return {
      id: r.id, rateMode: r.rateMode, ftlRateType: r.ftlRateType, unit, basis: r.rateMode === 'PKG' ? 'kg' : perKm ? 'km' : 'trip',
      hireCharge: round2(hire), effectiveDate: r.effectiveDate,
    };
  });
}

// ------------------------------------------------------------------ air

const AIR_CHARGES = {
  uptoWeight: 'upto_weight', uptoWeightCharge: 'upto_wt_charge', awbDo: 'AWBDO', fscPerKg: 'FSC_Pkg', unitPerKg: 'Unit_Pkg',
  minUnitCharge: 'MinUnit_Charge', xrayPerKg: 'Xray_Pkg', minXrayCharge: 'MinXray_Charge', tspOutPerKg: 'TSPOut_Pkg',
  minTspOutCharge: 'MinTsp_Charge', tspInPerKg: 'TSPIN_Charge', minTspInCharge: 'MinTSPIn_Charge', serviceTax: 'STax',
};
export const AIR_CHARGE_KEYS = Object.keys(AIR_CHARGES);

const AIR_SELECT = `
  select a.*, vm.Name as vendor_label, oc.city_name as origin_name, dc.city_name as destination_name
    from Vendor_Air_RateMaster a
    left join vendors_master vm on vm.vendor_code = a.vendor_code
    left join city_master oc on oc.city_code = a.Origin_city
    left join city_master dc on dc.city_code = a.Destination_city`;
const mapAir = (r) => ({
  id: Number(r.Slno), code: s(r.Air_Rate_Code), vendorType: s(r.Vendor_type), vendor: s(r.vendor_code), vendorName: s(r.vendor_label),
  flight: s(r.Airline_Code), flightName: s(r.Airline_Name), shift: s(r.Flight_shift), origin: s(r.Origin_city), originName: s(r.origin_name),
  destination: s(r.Destination_city), destinationName: s(r.destination_name), ratePerKg: n(r.Rate_pkg), slabRate: Boolean(s(r.Is_Slab_Rate)),
  charges: Object.fromEntries(Object.entries(AIR_CHARGES).map(([k, col]) => [k, n(r[col])])),
  effectiveDate: iso(r.Effective_Date), startDate: iso(r.Start_Date), endDate: iso(r.End_Date), active: Boolean(r.IsActive),
});

export async function listAir({ vendor = '', origin = '', destination = '' } = {}) {
  const rows = (await query(
    `${AIR_SELECT} where (@v = '' or a.vendor_code = @v) and (@o = '' or a.Origin_city = @o) and (@d = '' or a.Destination_city = @d)
      order by vm.Name, oc.city_name, dc.city_name, a.Effective_Date desc, a.Slno desc`,
    { v: vendor, o: origin, d: destination })).map(mapAir);
  return withStatus(rows, (r) => `${r.vendor}|${r.flight}|${r.shift}|${r.origin}|${r.destination}`);
}

export async function getAir(id) {
  const [r] = await query(`${AIR_SELECT} where a.Slno = @id`, { id });
  if (!r) throw notFound('Air rate not found');
  const slabs = await query('select From_Weight, To_Weight, Rate from Vendor_Air_Slab_Rate where Air_Rate_Code = @c order by From_Weight', { c: s(r.Air_Rate_Code) });
  return { ...mapAir(r), slabs: slabs.map((x) => ({ from: n(x.From_Weight), to: n(x.To_Weight), rate: n(x.Rate) })) };
}

export async function createAir(user, body) {
  await checkCommon(user, 'air', body);
  const flights = await vendorCarriers('air', body.vendor);
  const flight = flights.find((f) => f.value === body.flight);
  if (!flight) throw badRequest("Select one of the vendor's flights (Setting → Vendor and Vehicle)");
  const self = body.vendorType === 'SELF';
  if (!self && !(body.ratePerKg > 0) && !body.slabs.length) throw badRequest('Enter the rate per kg or the weight slabs');
  // Button2_Click: each slab starts one kg after the previous one ends
  body.slabs.forEach((sl, i) => {
    if (!(sl.to > sl.from)) throw badRequest(`Slab ${i + 1}: "to" weight should be greater than "from" weight`);
    if (i && sl.from !== body.slabs[i - 1].to + 1) throw badRequest(`Slab ${i + 1}: should start at ${body.slabs[i - 1].to + 1} kg`);
  });
  const charges = Object.fromEntries(AIR_CHARGE_KEYS.map((k) => [k, self ? n(body.charges?.[k]) : 0]));
  return withTransaction(async (tx) => {
    const [dup] = await query(
      `select top 1 Air_Rate_Code from Vendor_Air_RateMaster with (updlock, holdlock)
        where vendor_code = @v and Airline_Code = @f and Flight_shift = @sh and Origin_city = @o and Destination_city = @d
          and Effective_Date = @e and IsActive = 1`,
      { v: body.vendor, f: body.flight, sh: body.shift, o: body.origin, d: body.destination, e: body.effectiveDate }, { tx });
    if (dup) throw conflict(`An air rate for this vendor, flight, shift and route from ${body.effectiveDate} already exists (${s(dup.Air_Rate_Code)})`);
    const [mx] = await query(
      "select max(try_cast(substring(Air_Rate_Code, 4, 20) as int)) as mx from Vendor_Air_RateMaster with (updlock, holdlock) where Air_Rate_Code like 'AIR%'", {}, { tx });
    const code = `AIR${String((Number(mx?.mx) || 0) + 1).padStart(4, '0')}`;
    const cols = Object.values(AIR_CHARGES);
    const [row] = await query(
      `insert into Vendor_Air_RateMaster(Air_Rate_Code, Is_Slab_Rate, Vendor_type, vendor_code, Flight_shift, Origin_city, Destination_city,
         Airline_Code, Airline_Name, Rate_pkg, ${cols.join(', ')}, Effective_Date, Start_Date, End_Date, IsActive, Created_By)
       output inserted.Slno
       values (@code, @slab, @t, @v, @sh, @o, @d, @f, @fn, @rate, ${cols.map((c) => `@${c}`).join(', ')}, @e, @sd, @ed, 1, @u)`,
      { code, slab: body.slabs.length ? 'Generated' : '', t: TYPE_TEXT[body.vendorType], v: body.vendor, sh: body.shift, o: body.origin,
        d: body.destination, f: flight.value, fn: flight.name, rate: body.ratePerKg,
        ...Object.fromEntries(Object.entries(AIR_CHARGES).map(([k, col]) => [col, charges[k]])),
        e: body.effectiveDate, sd: body.startDate, ed: body.endDate, u: user.userId }, { tx });
    for (const sl of body.slabs) {
      await query('insert into Vendor_Air_Slab_Rate(Air_Rate_Code, From_Weight, To_Weight, Rate, Created_By) values (@c, @f, @t, @r, @u)',
        { c: code, f: sl.from, t: sl.to, r: sl.rate, u: user.userId }, { tx });
    }
    return { id: Number(row.Slno), code, message: `Air rate ${code} saved — from ${body.effectiveDate}` };
  });
}

// ------------------------------------------------------------------ train

const TRAIN_SELECT = `
  select t.*, vm.Name as vendor_label, oc.city_name as origin_name, dc.city_name as destination_name
    from Vendor_Train_Rate t
    left join vendors_master vm on vm.vendor_code = t.vendor_name
    left join city_master oc on oc.city_code = t.origin
    left join city_master dc on dc.city_code = t.destination`;
const mapTrain = (r) => ({
  id: Number(r.slno), vendorType: s(r.vendor_type), vendor: s(r.vendor_name), vendorName: s(r.vendor_label), train: s(r.train_no),
  trainType: s(r.traintype), origin: s(r.origin), originName: s(r.origin_name), destination: s(r.destination), destinationName: s(r.destination_name),
  rateType: s(r.ratetype), rateTypeName: TRAIN_RATE_TYPES[s(r.ratetype)] ?? '', ratePerKg: n(r.rate), tripCost: n(r.TripCost), ddAmount: n(r.dd_amount),
  effectiveDate: iso(r.Effective_Date), active: Boolean(r.IsActive),
});

export async function listTrain({ vendor = '', origin = '', destination = '' } = {}) {
  const rows = (await query(
    `${TRAIN_SELECT} where (@v = '' or t.vendor_name = @v) and (@o = '' or t.origin = @o) and (@d = '' or t.destination = @d)
      order by vm.Name, t.train_no, t.Effective_Date desc, t.slno desc`,
    { v: vendor, o: origin, d: destination })).map(mapTrain);
  return withStatus(rows, (r) => `${r.vendor}|${r.train}|${r.origin}|${r.destination}`);
}

export async function createTrain(user, body) {
  await checkCommon(user, 'train', body);
  const trains = await vendorCarriers('train', body.vendor);
  const train = trains.find((t) => t.value === body.train);
  if (!train) throw badRequest('Select the train');
  if (body.rateType === '1' && !(body.ratePerKg > 0)) throw badRequest('Enter the rate per kg');
  if (body.rateType === '2' && !(body.tripCost > 0)) throw badRequest('Enter Trip Cost');
  return withTransaction(async (tx) => {
    const [dup] = await query(
      `select top 1 slno from Vendor_Train_Rate with (updlock, holdlock)
        where vendor_name = @v and train_no = @tr and origin = @o and destination = @d and Effective_Date = @e and IsActive = 1`,
      { v: body.vendor, tr: body.train, o: body.origin, d: body.destination, e: body.effectiveDate }, { tx });
    if (dup) throw conflict(`A rate for this vendor, train and route from ${body.effectiveDate} already exists`);
    const [row] = await query(
      `insert into Vendor_Train_Rate(vendor_type, vendor_name, traintype, train_no, origin, destination, dd_amount, rate, ratetype, TripCost,
         Effective_Date, IsActive, User_Id)
       output inserted.slno values (@t, @v, @tt, @tr, @o, @d, @dd, @rate, @rt, @trip, @e, 1, @u)`,
      { t: TYPE_TEXT[body.vendorType], v: body.vendor, tt: train.trainType, tr: body.train, o: body.origin, d: body.destination,
        dd: body.ddAmount, rate: body.rateType === '1' ? body.ratePerKg : 0, rt: body.rateType, trip: body.rateType === '2' ? body.tripCost : 0,
        e: body.effectiveDate, u: user.userId }, { tx });
    return { id: Number(row.slno), message: `Train rate saved — from ${body.effectiveDate}` };
  });
}

// ------------------------------------------------------------------ status (all three)

const STATUS_TABLE = {
  road: { table: 'vendor_road_rate_master', key: 'slno' },
  air: { table: 'Vendor_Air_RateMaster', key: 'Slno' },
  train: { table: 'Vendor_Train_Rate', key: 'slno' },
};

/** btnUpdate_Click (road: update_vendor_road_rate_master status) — switch a rate off / on. */
export async function setStatus(kind, id, active) {
  const t = STATUS_TABLE[kind];
  const [r] = await query(`select ${t.key} from ${t.table} where ${t.key} = @id`, { id });
  if (!r) throw notFound('Rate not found');
  await query(`update ${t.table} set IsActive = @a where ${t.key} = @id`, { a: active ? 1 : 0, id });
  return { id, message: active ? 'Rate activated' : 'Rate switched off' };
}
