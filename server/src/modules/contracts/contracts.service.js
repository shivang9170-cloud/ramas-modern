// Client Contract, stages 1–2: City / Location / State / Zone rates of a client (Credit) — port of those parts of
// wwwroot/Rate/Client_Contract.aspx(.cs) (client_contract_branch_bal / _dal, inline SQL in the DLL).
//
// A contract row = client + billing branch + origin + destination (city / location / state / zone) + mode + delivery
// mode + rate on (+ FTL type / load type) with its rate and charges, valid from `effective_from` inside start / end
// dates. Each contract type has its own table (client_contract_city, _location, _State, _zone) with the same columns
// apart from the origin / destination names. A new rate is a new row (a new version); docket booking
// (sp_Select_Rate) takes the most specific type that matches, and within it the latest version effective on the
// booking date.
//
// Fixed legacy bugs (docs/SECURITY.md):
//   * the "rate already added" check compared the destination with the *array's* text (`ToCityCode.ToString()`)
//     and the load type of row 1 instead of the current row, so duplicates went through (or it crashed on a
//     single row) — a row with the same key and effective date is refused, in the list and in the database;
//   * the halting charge was saved from the OCR box (`halthing_charge = txtocr`) — each has its own value;
//   * rows were saved one by one on separate connections (a failure left half a contract) — one transaction;
//   * the EntRef number (RMEC- / RMEL- / RMEZ-) was read as max+1 outside any transaction — under a lock now;
//   * category slabs: band 1's small-package rate was never saved (the page assigned RateSmall2 twice);
//   * the effective-date message said the opposite of the rule ("Current date should be greater than effective
//     date" while refusing *earlier* effective dates).
//
// Stage 3, slab rates: a WEIGHT row can carry up to 10 weight bands (ClientRate_With_Slab), a CATEGORY row must carry
// its category slabs (ClientRate_Category_Slab: product + weight band, a rate per package size), both linked by EntRef;
// docket booking takes the band that holds the charge weight (docket.service.js contractRate). Pickup / delivery charge
// slabs (Min_chargeRate_slab) give the docket's collection / delivery charge by charge weight or packets.
//
// Paid / To Pay general rates: the same rows with RateType Paid / To Pay and no client or billing branch; a General
// Client docket with that booking type takes them.
//
// KM rates: a per-km rate with the route's distance (Location / State / Zone, road, non-document).
//
// CARGO (DIV1002) weight rates on City / Location are built from km x rate per km per kg + admin %; the per-box
// collection / delivery flags are kept on the rate. The list export is done in the browser (ContractPage).

import { exec, query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { s, n, iso, today } from '../../utils/values.js';

// Contract types: table, origin / destination columns, EntRef prefix, the master the codes come from.
// (Identifiers only from this constant — never from the request.)
export const TYPES = {
  CITY: {
    label: 'City To City', table: 'client_contract_city', o: 'origin_city', d: 'destination_city', prefix: 'RMEC-', perKm: 'perkmperkg_rate',
    master: { table: 'city_master', code: 'city_code', name: 'city_name', where: "active_flag = 'Active'" },
  },
  LOCATION: {
    label: 'Location To Location', table: 'client_contract_location', o: 'origin_location', d: 'destination_location', prefix: 'RMEL-', perKm: 'perkmperkg_rate',
    master: { table: 'New_Location_master', code: 'Location_Code', name: 'Location_Name', where: "isnull(IsActinve_Flag, 'Active') = 'Active'" },
  },
  STATE: {
    label: 'State To State', table: 'client_contract_State', o: 'origin_State', d: 'destination_State', prefix: 'RMES-', perKm: 'PerKMRate',
    master: { table: 'state_master', code: 'state_code', name: 'state_name', where: "active_flag = 'Active'" },
  },
  ZONE: {
    label: 'Zone To Zone', table: 'client_contract_zone', o: 'origin_zone', d: 'destination_zone', prefix: 'RMEZ-', perKm: 'perkmperkg_rate',
    master: { table: 'zone_master', code: 'zone_code', name: 'zone_name', where: "active_flag = 'Active'" },
  },
};
export const TYPE_KEYS = Object.keys(TYPES);

// Rate books: CLIENT = the client contracts above (Rate/Client_Contract.aspx); GENERAL = the General Rate Master
// (Rate/General_Rate_Master.aspx, general_rate_master_bal): the standard tariff — the same columns in its own tables,
// no client or billing branch, rate type Credit only (the page's ddlRateType lists only Credit), weight slabs only
// (General_Rate_With_Slab).
const GENERAL_TABLES = { CITY: 'GenaraleRate_Master_City', LOCATION: 'General_Rate_location', STATE: 'General_Rate_State', ZONE: 'General_Rate_zone' };
const tableOf = (type, book = 'CLIENT') => (book === 'GENERAL' ? GENERAL_TABLES[type] : TYPES[type].table);
const general = (book) => book === 'GENERAL';

// Rate-on choices per division, as Bind_Rate_On left them. KM also needs a Location / State / Zone rate, mode Road and
// non-document (checkKm).
function rateOnFor(divCode) {
  return divCode === 'DIV1001' ? ['WEIGHT', 'CATEGORY'] : ['WEIGHT', 'FREIGHT', 'FTL', 'BOX', 'KM', 'CATEGORY'];
}
const KM_MODE = 'RD';

/**
 * KM: a per-km rate (`rate`) and the route's distance; the docket's freight is rate x distance. The page offered KM
 * for road, non-document rates and removed it on City To City (ddlcontacttype 2, ddlmode_SelectedIndexChanged).
 */
/**
 * DIV1002 WEIGHT rates on City / Location (txtPkV_TextChanged): the rate is built from the distance and a rate per km
 * per kg plus an admin charge % — base freight = km x per-km-per-kg, admin charge = base x % / 100, rate = base + admin.
 * The page disabled the rate box there, so these inputs are required. Returns null when the rule does not apply.
 */
function perKmPricing(divCode, type, r, at) {
  if (divCode !== 'DIV1002' || r.rateOn !== 'WEIGHT' || !['CITY', 'LOCATION'].includes(type)) return null;
  if (!(r.distance > 0)) throw badRequest(`${at}: enter the distance (km) — a CARGO weight rate is built per km`);
  if (!(r.perKmPerKg > 0)) throw badRequest(`${at}: enter the rate per km per kg`);
  const round2 = (x) => Math.round(x * 100) / 100;
  const baseFreight = round2(r.distance * r.perKmPerKg);
  const adminCharge = round2(baseFreight * (r.adminPercent ?? 0) / 100);
  return { baseFreight, adminCharge, adminPercent: r.adminPercent ?? 0, rate: round2(baseFreight + adminCharge) };
}

// The admin charge / base freight columns are on the city table only (the page's City To City INSERT names them; its
// Location INSERT does not).
const adminCols = (type, p) => (type === 'CITY' ? ` ${p}admincharge, ${p}adminchrgper, ${p}basefrt,` : '');
const adminValues = (pricing) => ({
  admincharge: pricing?.adminCharge ?? 0, adminchrgper: pricing?.adminPercent ?? 0, basefrt: pricing?.baseFreight ?? 0,
});
// the per-km column: the rate per km per kg of a CARGO weight rate, the per-km rate of a KM rate
const perKmValue = (r, pricing) => (pricing ? r.perKmPerKg : r.rateOn === 'KM' ? r.rate : 0);

function checkKm(type, r, at) {
  if (r.rateOn !== 'KM') return;
  if (type === 'CITY') throw badRequest(`${at}: rate on KM is not available for City To City rates`);
  if (r.mode !== KM_MODE) throw badRequest(`${at}: rate on KM is only for mode Road`);
  if (r.docType === '1') throw badRequest(`${at}: rate on KM is only for non-document rates`);
  if (!(r.distance > 0)) throw badRequest(`${at}: enter the distance (km)`);
}
const PKG_SIZES = ['BIG', 'MEDIUM', 'SMALL'];
// ddlRateType: Credit = a client's contract (client + billing branch); Paid / To Pay = the general rates a General
// Client docket with that booking type takes (no client, no billing branch — the page saved them with '').
export const RATE_TYPES = ['Credit', 'Paid', 'To Pay'];
const LOAD_TYPES = ['PTL', 'FTL'];

// The charges of a row: API name → column.
export const CHARGES = {
  fuelPercent: 'sour_charge', statistical: 'state', fov: 'fov', oda: 'oda', ocr: 'ocr', halting: 'halthing_charge', delivery: 'dly',
  collection: 'collection_charge', minCollection: 'Min_Collection_Charge', minDelivery: 'Min_Delivery_Charge', logistics: 'logistic_charge',
  dod: 'dod', risk: 'risk_charge', handling: 'handling_charge', service: 'Service_charge', ocs: 'ocs', topay: 'TopayCharge',
  hamali: 'hamali_charge', discount: 'Discount',
};

// Slabs of a contract row, 10 bands each, linked by EntRef:
//   weight   (ClientRate_With_Slab, WEIGHT rates)       WeightFromN / WeightToN / RateN / DisPrcN / ApproveDiscPrcN
//   category (ClientRate_Category_Slab, CATEGORY rates) WeightFromN / WeightToN / Item_codeN + a rate per package size:
//            RateN = BIG, RateMedN = MEDIUM, RateSmallN = SMALL (a product's band; different products may share weights)
export const SLAB_BANDS = 10;
const SLABS = {
  weight: {
    table: 'ClientRate_With_Slab', field: 'slabs', rateOn: 'WEIGHT',
    band: { from: 'WeightFrom', to: 'WeightTo', rate: 'Rate', discount: 'DisPrc', approvedDiscount: 'ApproveDiscPrc' },
  },
  category: {
    table: 'ClientRate_Category_Slab', field: 'categorySlabs', rateOn: 'CATEGORY',
    band: { from: 'WeightFrom', to: 'WeightTo', itemCode: 'Item_code', big: 'Rate', medium: 'RateMed', small: 'RateSmall', discount: 'DisPrc', approvedDiscount: 'ApproveDiscPrc' },
  },
};
const SLAB_KINDS = Object.keys(SLABS);
const bandNos = Array.from({ length: SLAB_BANDS }, (_, i) => i + 1);
const slabCols = (kind) => bandNos.flatMap((i) => Object.values(SLABS[kind].band).map((c) => `${c}${i}`));
const bandValue = (k, v) => (v === null || v === undefined ? null : k === 'itemCode' ? s(v) : n(v));

function slabsOf(kind, r) {
  if (!r) return [];
  const { band } = SLABS[kind];
  return bandNos
    .map((i) => Object.fromEntries(Object.entries(band).map(([k, c]) => [k, bandValue(k, r[`${c}${i}`])])))
    .filter((b) => b.from !== null && b.to !== null && (kind === 'weight' ? b.rate > 0 : Boolean(b.itemCode)))
    .map(({ discount, approvedDiscount, ...b }) => (kind === 'weight'
      ? { ...b, discount: discount ?? 0, approvedDiscount: approvedDiscount ?? 0 }
      : { ...b, big: b.big ?? 0, medium: b.medium ?? 0, small: b.small ?? 0 }));
}

/** "to" above "from", no two bands (of one product, for category slabs) sharing a weight. */
function checkBands(bands, at, what) {
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  sorted.forEach((b, j) => {
    if (!(b.to > b.from)) throw badRequest(`${at}, ${what} ${b.from}–${b.to}: the "to" weight should be more than the "from" weight`);
    if (j && b.from <= sorted[j - 1].to) throw badRequest(`${at}: ${what}s ${sorted[j - 1].from}–${sorted[j - 1].to} and ${b.from}–${b.to} overlap`);
  });
}

/** Weight slabs only on WEIGHT rates; a CATEGORY rate needs its category slabs (btnRateAdd: "Please Enter Category Slab Rate Details"). */
function checkSlabs(r, at, items) {
  if (r.slabs?.length) {
    if (r.rateOn !== 'WEIGHT') throw badRequest(`${at}: weight slabs are only for rate on WEIGHT`);
    checkBands(r.slabs, at, 'slab');
  }
  if (r.rateOn === 'CATEGORY' && r.categorySlabs !== undefined && !r.categorySlabs.length) throw badRequest(`${at}: enter the category slab rates`);
  if (r.categorySlabs?.length) {
    if (r.rateOn !== 'CATEGORY') throw badRequest(`${at}: category slabs are only for rate on CATEGORY`);
    r.categorySlabs.forEach((b) => {
      if (!items.has(b.itemCode)) throw badRequest(`${at}: unknown product ${b.itemCode}`);
      if (!(b.big > 0 || b.medium > 0 || b.small > 0)) throw badRequest(`${at}, ${b.itemCode} ${b.from}–${b.to}: enter a rate for at least one package size`);
    });
    for (const code of new Set(r.categorySlabs.map((b) => b.itemCode))) {
      checkBands(r.categorySlabs.filter((b) => b.itemCode === code), `${at} (${code})`, 'slab');
    }
  }
}

async function activeItems() {
  return new Set((await query("select item_code from item_master where isnull(active_flag, 'Active') = 'Active'")).map((r) => s(r.item_code)));
}

/** Replace a slab of a contract row: one slab row per EntRef and kind, its Status following the contract row. */
// General rates keep weight slabs in General_Rate_With_Slab (read by EntRef in the page's slab popup), never in the
// client slab tables — their EntRef series overlap the client contract ones.
const GENERAL_SLAB_TABLE = 'General_Rate_With_Slab';
const slabTable = (kind, book = 'CLIENT') => (general(book) ? GENERAL_SLAB_TABLE : SLABS[kind].table);

async function saveSlabs(tx, kind, { entRef, label, rateType, billingAt, client, origin, destination, mode, deliveryMode, rateOn, bands, active, book }) {
  const { band } = SLABS[kind];
  if (general(book) && kind !== 'weight') return;
  const table = slabTable(kind, book);
  await query(`delete from ${table} where EntRef = @entRef`, { entRef }, { tx });
  if (!bands?.length) return;
  const sorted = [...bands].sort((a, b) => (a.itemCode ?? '').localeCompare(b.itemCode ?? '') || a.from - b.from);
  const values = Object.fromEntries(bandNos.flatMap((i) => Object.entries(band)
    .map(([k, c]) => [`${c}${i}`, sorted[i - 1] ? sorted[i - 1][k] ?? 0 : null])));
  const cols = slabCols(kind);
  await query(
    `insert into ${table}(billingat, origin_city, destination_city, mode_id, rate_on, client_id, contract_type,
       ${cols.join(', ')}, RateType, EntRef, delivery_mode, Status)
     values (@billing, @o, @d, @m, @ro, @client, @label, ${cols.map((c) => `@${c}`).join(', ')}, @rateType, @entRef, @dm, @status)`,
    { billing: billingAt, o: origin, d: destination, m: mode, ro: rateOn, client, label, ...values, rateType: rateType ?? 'Credit',
      entRef, dm: deliveryMode, status: active ? 'Active' : 'Deactive' }, { tx });
}

// Pickup / delivery charge slabs (Min_chargeRate_slab): units (kg on WEIGHT, packets on BOX) → the minimum collection
// (PICKUP) or delivery (DEL) charge. As on the page they belong to the route — client + origin city + destination city
// + rate on — not to one version: saving a set switches the older set of that kind off (isactive = 0). City To City
// only (the page's BtnAddCharge asks for the from / to city), WEIGHT or BOX only (the docket sends no unit otherwise).
const CHARGE_SLAB_TYPES = { pickup: 'PICKUP', delivery: 'DEL' };
const CHARGE_SLAB_MODES = { pickup: ['DM-101', 'DM-103'], delivery: ['DM-101', 'DM-104'] };   // ddlDeliveryMode_SelectedIndexChanged

function checkChargeSlabs(type, r, at) {
  if (!r.chargeSlabs) return;
  for (const [kind, bands] of Object.entries(r.chargeSlabs)) {
    if (!bands?.length) continue;
    const what = kind === 'pickup' ? 'pickup charge slabs' : 'delivery charge slabs';
    if (type !== 'CITY') throw badRequest(`${at}: ${what} are only for City To City rates`);
    if (!['WEIGHT', 'BOX'].includes(r.rateOn)) throw badRequest(`${at}: ${what} are only for rate on WEIGHT or BOX`);
    if (!CHARGE_SLAB_MODES[kind].includes(r.deliveryMode)) throw badRequest(`${at}: ${what} do not apply to this delivery mode`);
    checkBands(bands, at, `${kind} slab`);
  }
}

async function chargeSlabsOf(c) {
  const rows = await query(
    `select Rate_type, FromUnit, ToUnit, ChargeAmt from Min_chargeRate_slab
      where client_code = @c and origin_city = @o and destination_city = @d and rate_on = @ro and isactive = 1
      order by FromUnit`, { c: c.clientCode, o: c.origin, d: c.destination, ro: c.rateOn });
  return Object.fromEntries(Object.entries(CHARGE_SLAB_TYPES).map(([k, t]) => [k, rows
    .filter((x) => s(x.Rate_type) === t).map((x) => ({ from: n(x.FromUnit), to: n(x.ToUnit), amount: n(x.ChargeAmt) }))]));
}

/** Replace the active pickup and / or delivery charge slab of a route (a kind left undefined is not touched). */
async function saveChargeSlabs(tx, { entRef, client, origin, destination, rateOn }, chargeSlabs) {
  if (!chargeSlabs) return;
  for (const [kind, t] of Object.entries(CHARGE_SLAB_TYPES)) {
    const bands = chargeSlabs[kind];
    if (bands === undefined) continue;
    await query(
      `update Min_chargeRate_slab set isactive = 0
        where client_code = @c and origin_city = @o and destination_city = @d and rate_on = @ro and Rate_type = @t`,
      { c: client, o: origin, d: destination, ro: rateOn, t }, { tx });
    for (const b of [...bands].sort((a, x) => a.from - x.from)) {
      await exec('sp_insMin_chargeRate_slab', {
        client_code: client, origin_city: origin, destination_city: destination, rate_on: rateOn,
        FromUnit: b.from, ToUnit: b.to, ChargeAmt: b.amount, Rate_type: t, EntRef: entRef,
      }, {}, { tx });
    }
  }
}

/** Save both slab kinds of a row given in `r` (a kind left undefined is not touched). */
async function saveRowSlabs(tx, base, r) {
  for (const kind of SLAB_KINDS) {
    const { field, rateOn } = SLABS[kind];
    if (r[field] !== undefined) await saveSlabs(tx, kind, { ...base, bands: base.rateOn === rateOn ? r[field] : [] });
  }
}

// ------------------------------------------------------------------ lookups

export async function options(user) {
  const [modes, deliveryModes, branches, ftlTypes, states, zones, items] = await Promise.all([
    query('select mode_code, mode_name from booking_mode order by mode_name'),
    query('select mode_code, mode_name from delivery_mode_master order by mode_code'),
    query("select branch_code, branch_name from branch_master where status = 'Active' order by branch_name"),
    query("select container_code, freight_name from freight_master where isnull(active_flag, 'Active') = 'Active' order by freight_name"),
    query("select state_code, state_name from state_master where active_flag = 'Active' order by state_name"),
    query("select zone_code, zone_name from zone_master where active_flag = 'Active' order by zone_name"),
    // bindProduct: the products of category slabs
    query("select item_code, item_name from item_master where isnull(active_flag, 'Active') = 'Active' order by item_name"),
  ]);
  const fy = financialYearRange(user.financialYear);
  return {
    types: TYPE_KEYS.map((k) => ({ value: k, label: TYPES[k].label })),
    modes: modes.map((m) => ({ value: s(m.mode_code), label: s(m.mode_name) })),
    deliveryModes: deliveryModes.map((m) => ({ value: s(m.mode_code), label: s(m.mode_name) })),
    billingBranches: branches.map((b) => ({ value: s(b.branch_code), label: `${s(b.branch_name)} : ${s(b.branch_code)}` })),
    ftlTypes: ftlTypes.map((f) => ({ value: s(f.container_code), label: s(f.freight_name) })),
    states: states.map((x) => ({ value: s(x.state_code), label: s(x.state_name) })),
    zones: zones.map((x) => ({ value: s(x.zone_code), label: s(x.zone_name) })),
    rateOn: rateOnFor(user.divCode).map((r) => ({ value: r, label: r })),
    rateTypes: RATE_TYPES.map((r) => ({ value: r, label: r === 'Credit' ? 'Credit (client contract)' : `${r} (general)` })),
    loadTypes: LOAD_TYPES.map((l) => ({ value: l, label: l })),
    items: items.map((x) => ({ value: s(x.item_code), label: s(x.item_name) })),
    pkgSizes: PKG_SIZES,
    financialYear: { from: fy.from, to: fy.to },
    charges: Object.keys(CHARGES),
  };
}

/** Search the places of a contract type (cities / locations; states and zones are short lists in options). */
export async function places(type, q = '') {
  const m = TYPES[type].master;
  const rows = type === 'CITY'
    ? await query(
      `select top 20 c.city_code as code, c.city_name as name, s.state_name as extra from city_master c
         left join state_master s on s.state_code = c.state_code
        where c.active_flag = 'Active' and c.city_name like @q + '%' order by c.city_name`, { q })
    : type === 'LOCATION'
      ? await query(
        `select top 20 l.Location_Code as code, l.Location_Name as name, c.city_name as extra from New_Location_master l
           left join city_master c on c.city_code = l.City_Code
          where isnull(l.IsActinve_Flag, 'Active') = 'Active' and l.Location_Name like @q + '%' order by l.Location_Name`, { q })
      : await query(`select ${m.code} as code, ${m.name} as name, null as extra from ${m.table} where ${m.where} and ${m.name} like @q + '%' order by ${m.name}`, { q });
  return rows.map((r) => ({ value: s(r.code), label: `${s(r.name)}${r.extra ? `, ${s(r.extra)}` : ''}` }));
}

/**
 * Road distance between two places for a KM rate (the page's BindDistance / BindLocDis: Distance_Master by city,
 * Distance_Location_Master by location). States and zones have no distance master — the distance is typed in.
 */
export async function distance(type, from, to) {
  const [row] = type === 'LOCATION'
    ? await query(
      `select top 1 distance from Distance_Location_Master
        where from_Location_code = @from and to_Location_code = @to and isnull(distance_status, 'True') = 'True'`, { from, to })
    : type === 'CITY'
      ? await query(
        `select top 1 distance from Distance_Master
          where from_city_code = @from and to_city_code = @to and isnull(distance_status, 'True') = 'True'`, { from, to })
      : [];
  return { distance: row ? n(row.distance) : null };
}

/** Clients of the division (the page's GetClients autocomplete). */
export async function clients(user, q = '') {
  const rows = await query(
    `select top 20 client_code, company_name from client_Master
      where isnull(is_Active, 1) = 1 and ',' + isnull(DivCode, '') + ',' like '%,' + @div + ',%'
        and (company_name like '%' + @q + '%' or client_code like @q + '%') order by company_name`, { q, div: user.divCode });
  return rows.map((r) => ({ value: s(r.client_code), label: `${s(r.company_name)} : ${s(r.client_code)}` }));
}

// ------------------------------------------------------------------ list / get

function selectFor(type, book = 'CLIENT') {
  const t = TYPES[type];
  const m = t.master;
  return `
  select '${type}' as contract_kind, c.*, c.${t.o} as origin_code, c.${t.d} as destination_code,
         om.${m.name} as origin_name, dm2.${m.name} as destination_name, b.branch_name as billing_name,
         bm.mode_name, dm.mode_name as delivery_mode_name, cm.company_name, fm.freight_name as ftl_type_name
    from ${tableOf(type, book)} c
    left join ${m.table} om on om.${m.code} = c.${t.o}
    left join ${m.table} dm2 on dm2.${m.code} = c.${t.d}
    left join branch_master b on b.branch_code = c.billingat
    left join booking_mode bm on bm.mode_code = c.mode_id
    left join delivery_mode_master dm on dm.mode_code = c.delivery_mode
    left join client_Master cm on cm.client_code = c.client_code
    left join freight_master fm on fm.container_code = c.ftl_type`;
}

const mapRow = (r) => ({
  id: Number(r.slno),
  type: s(r.contract_kind),
  typeLabel: TYPES[s(r.contract_kind)]?.label ?? '',
  entRef: s(r.EntRef),
  rateType: s(r.RateType) || 'Credit',
  clientCode: s(r.client_code),
  clientName: s(r.company_name),
  billingAt: s(r.billingat),
  billingName: s(r.billing_name),
  origin: s(r.origin_code),
  originName: s(r.origin_name) || s(r.origin_code),
  destination: s(r.destination_code),
  destinationName: s(r.destination_name) || s(r.destination_code),
  mode: s(r.mode_id),
  modeName: s(r.mode_name),
  deliveryMode: s(r.delivery_mode),
  deliveryModeName: s(r.delivery_mode_name),
  rateOn: s(r.rate_on),
  ftlType: s(r.ftl_type),
  ftlTypeName: s(r.ftl_type_name),
  loadType: s(r.LoadType),
  rate: n(r.rate),
  ftlRate: n(r.FtlRate),
  freight: n(r.frt),
  minWeight: n(r.minchargewt),
  minBoxes: n(r.minchargebox),
  minFreight: n(r.minFreight),
  volumetricWeight: n(r.VolumetricWeight),
  distance: n(r.totaldistance),
  perKmPerKg: n(r.perkmperkg_rate),
  adminPercent: n(r.adminchrgper),
  adminCharge: n(r.admincharge),
  baseFreight: n(r.basefrt),
  collectionPerBox: Boolean(r.col_charge_IsPerBox),
  deliveryPerBox: Boolean(r.del_charge_IsPerBox),
  division: s(r.Division),
  expectedDays: n(r.Expected_Days),
  charges: Object.fromEntries(Object.entries(CHARGES).map(([k, col]) => [k, n(r[col])])),
  startDate: iso(r.start_date),
  endDate: iso(r.end_date),
  effectiveFrom: iso(r.effective_from),
  active: s(r.status) === 'Active',
  notificationDays: s(r.notification_days),
});

export async function listContracts(user, { client = '', type = '', q = '', status = 'all', expiringInDays = null, rateType = '' } = {}, book = 'CLIENT') {
  const types = type ? [type] : TYPE_KEYS;
  const sets = await Promise.all(types.map((k) => query(
    `${selectFor(k, book)} where (@client = '' or c.client_code = @client) and isnull(c.Division, @div) = @div
        and (@rt = '' or isnull(nullif(c.RateType, ''), 'Credit') = @rt)`,
    { client, div: user.divCode, rt: rateType })));
  const routeKey = (c, o, d, ro) => [c, o, d, ro].map(s).join('|');
  const slabRefs = new Set((await query(general(book)
    ? `select EntRef from ${GENERAL_SLAB_TABLE}`
    : 'select EntRef from ClientRate_With_Slab union select EntRef from ClientRate_Category_Slab')).map((r) => s(r.EntRef)));
  const chargeRoutes = general(book) ? new Set() : new Set((await query(
    `select distinct client_code, origin_city, destination_city, rate_on from Min_chargeRate_slab
      where isactive = 1 and (@client = '' or client_code = @client)`, { client }))
    .map((r) => routeKey(r.client_code, r.origin_city, r.destination_city, r.rate_on)));
  const term = q.toUpperCase();
  const limit = expiringInDays === null ? null : new Date(Date.now() + expiringInDays * 86400000).toISOString().slice(0, 10);
  const order = (a, b) => a.clientName.localeCompare(b.clientName) || TYPE_KEYS.indexOf(a.type) - TYPE_KEYS.indexOf(b.type)
    || a.originName.localeCompare(b.originName) || a.destinationName.localeCompare(b.destinationName)
    || a.rateOn.localeCompare(b.rateOn) || b.effectiveFrom.localeCompare(a.effectiveFrom);
  return sets.flat().map(mapRow).map((c) => ({
    ...c,
    hasSlabs: slabRefs.has(c.entRef),
    hasChargeSlabs: c.type === 'CITY' && c.rateType === 'Credit' && chargeRoutes.has(routeKey(c.clientCode, c.origin, c.destination, c.rateOn)),
  }))
    .filter((c) => !term || [c.entRef, c.clientName, c.originName, c.destinationName, c.billingName].some((x) => x.toUpperCase().includes(term)))
    .filter((c) => status === 'all' || (status === 'active' ? c.active : !c.active))
    .filter((c) => limit === null || (c.active && c.endDate && c.endDate >= today() && c.endDate <= limit))
    .sort(order);
}

export async function getContract(user, type, id, book = 'CLIENT') {
  const [r] = await query(`${selectFor(type, book)} where c.slno = @id and isnull(c.Division, @div) = @div`, { id, div: user.divCode });
  if (!r) throw notFound(general(book) ? 'General rate not found in this division' : 'Contract rate not found in this division');
  const [weight, category] = await Promise.all(SLAB_KINDS.map(async (kind) => {
    if (!r.EntRef || (general(book) && kind !== 'weight')) return [];
    const [row] = await query(`select top 1 * from ${slabTable(kind, book)} where EntRef = @e order by slno desc`, { e: s(r.EntRef) });
    return slabsOf(kind, row);
  }));
  const row = mapRow(r);
  const chargeSlabs = type === 'CITY' && row.rateType === 'Credit' && !general(book) ? await chargeSlabsOf(row) : { pickup: [], delivery: [] };
  return {
    ...row, hasSlabs: weight.length + category.length > 0, slabs: weight, categorySlabs: category,
    hasChargeSlabs: chargeSlabs.pickup.length + chargeSlabs.delivery.length > 0, chargeSlabs,
  };
}

/**
 * A rate to copy into a new client rate — the page's rbtnCERate ("Card Rate" / "Existing Rate"; the chooser was
 * hidden on the legacy page, Visible="false"):
 *   GENERAL  the General Rate Master rate in force for the route (CompToGRM_City / _Location / _State / _Zone);
 *   CLIENT   the client's own current rate for the route at that billing branch and rate type (CompToCRM_*), e.g. to
 *            renew it with a hike.
 * Its rate, charges and weight slabs fill the new row; a discount % or a hike % may then change them. Null if none.
 */
async function copySourceRate(user, q, book) {
  const t = TYPES[q.type];
  const own = book === 'CLIENT'
    ? `and isnull(c.client_code, '') = @client and isnull(c.billingat, '') = @billing and isnull(nullif(c.RateType, ''), 'Credit') = @rt`
    : '';
  const rows = await query(
    `${selectFor(q.type, book)}
      where c.${t.o} = @o and c.${t.d} = @d and c.mode_id = @m and c.rate_on = @ro and c.status = 'Active' ${own}
        and (@dm = '' or isnull(c.delivery_mode, '') = @dm) and (@ft = '' or isnull(c.ftl_type, '') = @ft)
        and isnull(c.DocsType, @doc) = @doc and isnull(c.Division, @div) = @div
        and c.effective_from <= @today and (c.end_date is null or c.end_date >= @today)
      order by c.effective_from desc, c.slno desc`,
    { o: q.origin, d: q.destination, m: q.mode, ro: q.rateOn, dm: q.deliveryMode ?? '', ft: q.ftlType ?? '', doc: q.docType ?? '2',
      div: user.divCode, today: today(), client: q.client ?? '', billing: q.billingAt ?? '', rt: q.rateType ?? 'Credit' });
  if (!rows[0]) return null;
  // its weight slabs too (the page's slab popup read them by EntRef and applied the same discount / hike)
  const [slab] = rows[0].EntRef
    ? await query(`select top 1 * from ${slabTable('weight', book)} where EntRef = @e and isnull(Status, 'Active') = 'Active' order by slno desc`, { e: s(rows[0].EntRef) })
    : [];
  return { ...mapRow(rows[0]), slabs: slabsOf('weight', slab) };
}

export const generalRateFor = (user, q) => copySourceRate(user, q, 'GENERAL');

/** The client's own current rate for the route (Existing Rate); Credit needs the client and billing branch. */
export async function currentClientRate(user, q) {
  if (q.rateType === 'Credit' && (!q.client || !q.billingAt)) throw badRequest('Select the client and billing branch first');
  const credit = q.rateType === 'Credit';
  return copySourceRate(user, { ...q, client: credit ? q.client : '', billingAt: credit ? q.billingAt : '' }, 'CLIENT');
}

// ------------------------------------------------------------------ create

const keyOf = (r) => [r.origin, r.destination, r.mode, r.deliveryMode, r.rateOn, r.ftlType ?? '', r.loadType ?? ''].join('|');

function checkRowAmounts(r, i) {
  const at = `Row ${i + 1}`;
  if (['WEIGHT', 'BOX', 'KM'].includes(r.rateOn) && !(r.rate > 0)) throw badRequest(`${at}: rate should not be zero`);
  if (r.rateOn === 'FTL' && !(r.ftlRate > 0)) throw badRequest(`${at}: FTL rate should not be zero`);
  if (r.rateOn === 'FTL' && !r.ftlType) throw badRequest(`${at}: select the FTL type`);
  if (r.rateOn === 'FREIGHT' && !(r.freight > 0)) throw badRequest(`${at}: freight should not be zero`);
}

export async function createContract(user, body, book = 'CLIENT') {
  const t = { ...TYPES[body.type], table: tableOf(body.type, book) };
  if (general(book)) {
    // General Rate Master: the standard tariff — no client, no billing branch, rate type Credit; weight slabs only
    body = { ...body, rateType: 'Credit', client: '', billingAt: '' };
    body.rows.forEach((r, i) => {
      if (r.rateOn === 'CATEGORY') throw badRequest(`Row ${i + 1}: rate on CATEGORY needs category slabs — not on general rates`);
      if (r.categorySlabs?.length || Object.values(r.chargeSlabs ?? {}).some((b) => b?.length)) {
        throw badRequest(`Row ${i + 1}: only weight slabs are kept on general rates`);
      }
    });
  }
  // Dates: the start date inside the current financial year, the effective date not in the past and inside start / end.
  const fy = financialYearRange(user.financialYear);
  if (body.startDate < fy.from || body.startDate > fy.to) throw badRequest(`Start date should be in the financial year ${user.financialYear}`);
  if (body.endDate < body.startDate) throw badRequest('End date should not be before the start date');
  if (body.effectiveFrom < today()) throw badRequest('The effective date cannot be in the past');
  if (body.effectiveFrom < body.startDate || body.effectiveFrom > body.endDate) throw badRequest('The effective date should be between the start and end dates');

  // Credit: a client and its billing branch; Paid / To Pay: general rates, saved without either (as the page did).
  const credit = body.rateType === 'Credit' && !general(book);
  let client = null;
  if (credit) {
    if (!body.client) throw badRequest('Select client');
    if (!body.billingAt) throw badRequest('Select billing branch');
    [client] = await query(
      `select client_code, company_name from client_Master
        where client_code = @c and isnull(is_Active, 1) = 1 and ',' + isnull(DivCode, '') + ',' like '%,' + @div + ',%'`,
      { c: body.client, div: user.divCode });
    if (!client) throw badRequest('Select an active client of this division');
    const [billing] = await query("select branch_code from branch_master where branch_code = @b and status = 'Active'", { b: body.billingAt });
    if (!billing) throw badRequest('Select the billing branch');
  }
  const clientCode = credit ? body.client : '';
  const billingAt = credit ? body.billingAt : '';

  const allowed = rateOnFor(user.divCode);
  const items = await activeItems();
  const seen = new Set();
  body.rows.forEach((r, i) => {
    if (!allowed.includes(r.rateOn)) throw badRequest(`Row ${i + 1}: rate on ${r.rateOn} is not available in this division`);
    // CARGO weight rates on City / Location: the rate is computed (the typed rate is ignored, as the page disabled it)
    const priced = perKmPricing(user.divCode, body.type, r, `Row ${i + 1}`);
    if (priced) r.rate = priced.rate;
    r.pricing = priced;
    checkRowAmounts(r, i);
    checkSlabs(r, `Row ${i + 1}`, items);
    // btnRateAdd: "Please Enter the Slab Rate Details" — a DIV1001 document rate for Paid / To Pay needs weight slabs
    if (!credit && !general(book) && user.divCode === 'DIV1001' && r.docType === '1' && !r.slabs?.length) {
      throw badRequest(`Row ${i + 1}: enter the slab rates (a ${body.rateType} document rate is charged by weight slab)`);
    }
    // BtnAddCharge: "Select Client First" — pickup / delivery charge slabs are a client's
    if (!credit && Object.values(r.chargeSlabs ?? {}).some((b) => b?.length)) {
      throw badRequest(`Row ${i + 1}: pickup / delivery charge slabs are only for a client's (Credit) rates`);
    }
    checkChargeSlabs(body.type, r, `Row ${i + 1}`);
    checkKm(body.type, r, `Row ${i + 1}`);
    const k = keyOf(r);
    if (seen.has(k)) throw conflict(`Row ${i + 1}: this rate is already in the list`);
    seen.add(k);
  });
  const codes = [...new Set(body.rows.flatMap((r) => [r.origin, r.destination]))];
  const m = t.master;
  const found = new Set((await query(
    `select ${m.code} as code from ${m.table} where ${m.code} in (${codes.map((_, i) => `@c${i}`).join(', ')})`,
    Object.fromEntries(codes.map((c, i) => [`c${i}`, c])))).map((c) => s(c.code)));
  const missing = codes.find((c) => !found.has(c));
  if (missing) throw badRequest(`Unknown ${t.label.split(' ')[0].toLowerCase()} ${missing}`);
  const modes = new Set((await query('select mode_code from booking_mode')).map((x) => s(x.mode_code)));
  const dmodes = new Set((await query('select mode_code from delivery_mode_master')).map((x) => s(x.mode_code)));
  body.rows.forEach((r, i) => {
    if (!modes.has(r.mode)) throw badRequest(`Row ${i + 1}: select the mode`);
    if (!dmodes.has(r.deliveryMode)) throw badRequest(`Row ${i + 1}: select the delivery mode`);
  });

  const refs = await withTransaction(async (tx) => {
    const [mx] = await query(
      `select max(try_cast(replace(EntRef, '${t.prefix}', '') as int)) as mx from ${t.table} with (updlock, holdlock)
        where EntRef like '${t.prefix}%'`, {}, { tx });
    let next = Math.max(Number(mx?.mx) || 100000, 100000);
    const saved = [];
    for (const [i, r] of body.rows.entries()) {
      // CheckExistRateCity / CheckExistRateState: the same rate already has a version with this effective date.
      const [dup] = await query(
        `select top 1 EntRef from ${t.table} with (updlock, holdlock)
          where isnull(client_code, '') = @client and isnull(billingat, '') = @billing and ${t.o} = @o and ${t.d} = @d and mode_id = @m
            and isnull(delivery_mode, '') = @dm and rate_on = @ro and isnull(ftl_type, '') = @ft and isnull(LoadType, '') = @lt
            and isnull(nullif(RateType, ''), 'Credit') = @rt and effective_from = @eff and isnull(Division, @div) = @div`,
        { client: clientCode, billing: billingAt, o: r.origin, d: r.destination, m: r.mode, dm: r.deliveryMode, ro: r.rateOn,
          ft: r.ftlType, lt: r.loadType, rt: body.rateType, eff: body.effectiveFrom, div: user.divCode }, { tx });
      if (dup) throw conflict(`Row ${i + 1}: a rate already exists for this effective date (${s(dup.EntRef)})`);
      next += 1;
      const entRef = `${t.prefix}${next}`;
      const charges = Object.fromEntries(Object.entries(CHARGES).map(([k, col]) => [col, r.charges[k] ?? 0]));
      await query(
        `insert into ${t.table}(EntRef, contract_type, RateType, BookingType, DocsType, Division, client_id, client_code, billingat,
           ${t.o}, ${t.d}, mode_id, delivery_mode, rate_on, ftl_type, LoadType, rate, FtlRate, frt, minchargewt, minchargebox,
           minFreight, VolumetricWeight, Expected_Days, ${Object.values(CHARGES).join(', ')}, FuleCharge, discount_type,
           totaldistance, ${t.perKm}, col_charge_IsPerBox, del_charge_IsPerBox,${adminCols(body.type, '')}
           start_date, end_date, effective_from, status, notification_days, User_Id)
         values (@entRef, @label, @rateType, @rateType, @docs, @div, @client, @client, @billing,
           @o, @d, @m, @dm, @ro, @ft, @lt, @rate, @ftlRate, @frt, @minWt, @minBox,
           @minFreight, @vol, @days, ${Object.values(CHARGES).map((c) => `@${c}`).join(', ')}, @sour_charge, 'P',
           @distance, @perKm, @colBox, @delBox,${adminCols(body.type, '@')} @start, @end, @eff, @status, @notify, @user)`,
        {
          entRef, label: t.label, rateType: body.rateType, docs: r.docType, div: user.divCode, client: clientCode, billing: billingAt, o: r.origin,
          d: r.destination, m: r.mode, dm: r.deliveryMode, ro: r.rateOn, ft: r.ftlType, lt: r.loadType, rate: r.rate, ftlRate: r.ftlRate,
          frt: r.freight, minWt: r.minWeight, minBox: r.minBoxes, minFreight: r.minFreight, vol: r.volumetricWeight, days: r.expectedDays,
          distance: String(r.distance ?? 0), perKm: perKmValue(r, r.pricing), colBox: r.collectionPerBox ? 1 : 0, delBox: r.deliveryPerBox ? 1 : 0,
          ...adminValues(r.pricing),
          ...charges, start: body.startDate, end: body.endDate, eff: body.effectiveFrom, status: body.active ? 'Active' : 'Deactive',
          notify: body.notificationDays, user: user.userId,
        }, { tx });
      await saveRowSlabs(tx, {
        entRef, label: t.label, rateType: body.rateType, billingAt, client: clientCode, origin: r.origin, destination: r.destination,
        mode: r.mode, deliveryMode: r.deliveryMode, rateOn: r.rateOn, active: body.active, book,
      }, r);
      // General rates: weight slabs only, in their own table (saveSlabs); no charge slabs.
      if (general(book)) { saved.push(entRef); continue; }
      // a new version without charge slabs keeps the route's current ones
      const given = Object.fromEntries(Object.entries(r.chargeSlabs ?? {}).filter(([, b]) => b?.length));
      if (Object.keys(given).length) {
        await saveChargeSlabs(tx, { entRef, client: clientCode, origin: r.origin, destination: r.destination, rateOn: r.rateOn }, given);
      }
      saved.push(entRef);
    }
    return saved;
  });
  const whom = general(book) ? 'the general rate master' : credit ? `${s(client.company_name)} : ${body.client}` : `${body.rateType} (general)`;
  return { refs, message: `${refs.length} ${t.label} rate(s) saved for ${whom} (${refs.join(', ')})` };
}

// ------------------------------------------------------------------ update (Update_client_contract_city / _Location / _State / _Zone)

export async function updateContract(user, type, id, body, book = 'CLIENT') {
  const t = { ...TYPES[type], table: tableOf(type, book) };
  const current = await getContract(user, type, id, book);
  if (general(book) && (body.categorySlabs?.length || Object.values(body.chargeSlabs ?? {}).some((b) => b?.length))) {
    throw badRequest('Only weight slabs are kept on general rates');
  }
  // txt_end_date_up_TextChanged: the end date can only be extended.
  if (current.endDate && body.endDate < current.endDate) throw badRequest(`The end date can only be extended (currently ${current.endDate})`);
  // a CARGO weight rate is rebuilt from its distance / per-km-per-kg / admin % (the page's Update recomputed it the same way)
  const pricing = perKmPricing(current.division || user.divCode, type, { ...body, rateOn: current.rateOn }, 'Rate');
  if (pricing) body = { ...body, rate: pricing.rate };
  checkRowAmounts({ ...current, ...body, rateOn: current.rateOn, ftlType: current.ftlType }, 0);
  const distance = body.distance ?? current.distance;
  if (current.rateOn === 'KM' && !(distance > 0)) throw badRequest('Enter the distance (km)');
  checkSlabs({ rateOn: current.rateOn, slabs: body.slabs, categorySlabs: body.categorySlabs }, 'Slab rates',
    body.categorySlabs?.length ? await activeItems() : new Set());
  if (current.rateType !== 'Credit' && Object.values(body.chargeSlabs ?? {}).some((b) => b?.length)) {
    throw badRequest('Pickup / delivery charge slabs are only for a client\'s (Credit) rates');
  }
  checkChargeSlabs(type, { rateOn: current.rateOn, deliveryMode: current.deliveryMode, chargeSlabs: body.chargeSlabs }, 'Charge slabs');
  const charges = Object.fromEntries(Object.entries(CHARGES).map(([k, col]) => [col, body.charges[k] ?? 0]));
  const status = body.active ? 'Active' : 'Deactive';
  await withTransaction(async (tx) => {
    await query(
      `update ${t.table} set rate = @rate, FtlRate = @ftlRate, frt = @frt, minchargewt = @minWt, minchargebox = @minBox,
              minFreight = @minFreight, VolumetricWeight = @vol, Expected_Days = @days,
              ${Object.values(CHARGES).map((c) => `${c} = @${c}`).join(', ')}, FuleCharge = @sour_charge,
              totaldistance = @distance, ${t.perKm} = @perKm, col_charge_IsPerBox = @colBox, del_charge_IsPerBox = @delBox,
              ${type === 'CITY' ? 'admincharge = @admincharge, adminchrgper = @adminchrgper, basefrt = @basefrt,' : ''}
              end_date = @end, status = @status, notification_days = @notify, Edit_By = @user, Edit_Date = getdate()
        where slno = @id`,
      {
        rate: body.rate, ftlRate: body.ftlRate, frt: body.freight, minWt: body.minWeight, minBox: body.minBoxes, minFreight: body.minFreight,
        vol: body.volumetricWeight, days: body.expectedDays, ...charges, end: body.endDate, status,
        distance: String(distance ?? 0), perKm: perKmValue({ ...body, rateOn: current.rateOn }, pricing),
        colBox: body.collectionPerBox ? 1 : 0, delBox: body.deliveryPerBox ? 1 : 0, ...adminValues(pricing),
        notify: body.notificationDays, user: user.userId, id,
      }, { tx });
    if (!current.entRef) return;
    // the page's "update clientrate_with_slab set Status = @status where entref in (…)" — for both slab kinds
    // (general rates: their own slab table only — their EntRef series overlap the client ones)
    for (const table of general(book) ? [GENERAL_SLAB_TABLE] : SLAB_KINDS.map((kind) => SLABS[kind].table)) {
      await query(`update ${table} set Status = @status where EntRef = @e`, { status, e: current.entRef }, { tx });
    }
    await saveRowSlabs(tx, {
      entRef: current.entRef, label: t.label, rateType: current.rateType, billingAt: current.billingAt, client: current.clientCode,
      origin: current.origin, destination: current.destination, mode: current.mode, deliveryMode: current.deliveryMode,
      rateOn: current.rateOn, active: body.active, book,
    }, body);
    if (type === 'CITY' && current.rateType === 'Credit' && !general(book)) {
      await saveChargeSlabs(tx, {
        entRef: current.entRef, client: current.clientCode, origin: current.origin, destination: current.destination, rateOn: current.rateOn,
      }, body.chargeSlabs);
    }
  });
  return { id, type, message: `Rate ${current.entRef} updated` };
}
