// Docket (GRN) booking — port of:
//   wwwroot/Operation/GrnEntry.aspx(.cs)          page + ?x=0/1/2 modes
//   wwwroot/App_Code/Service/OperationService.cs  Save/Update/Cancel_GrnEntry_New, lookups
//   grn_class/DAL/OperationDAL.cs                 stored-procedure chains
//
// The same stored procedures are called, in the same order, inside one
// transaction. Differences from legacy (all deliberate, see docs):
//   * totals are recomputed on the server (shared/docketCalc.js) — the browser
//     can no longer post arbitrary freight/tax/grand totals;
//   * every negative/zero result code from Save_GrnEntry aborts and rolls back
//     (legacy committed the header for some codes and even inserted charges for -2);
//   * session values (division, branch, user, FY) come from the JWT, not the body.

import { exec, query, sql, withTransaction } from '../../db/index.js';
import { autoPickupForDocket } from '../pickup/autoPickup.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../../middleware/errors.js';
import { codeOf } from '../../utils/legacy.js';
import { calculateDocket } from '../../../../shared/docketCalc.js';
import { s, n } from '../../utils/values.js';
import { profile as businessProfile } from '../business/business.service.js';
import { INCOTERMS } from './docket.schema.js';

// ------------------------------------------------------------------ lookups

export async function bookingOptions() {
  const [modes, deliveryModes, items, chargeCodes, taxChargeCodes, branches, freightTypes] = await Promise.all([
    exec('Get_BookingMode'),
    exec('Get_DeliveryModeMaster'),
    exec('Get_ItemMaster'),
    exec('Get_ChargeCode'),
    exec('Get_TaxChargeCode'),
    exec('sp_select_Branch_Master_Details'),
    exec('Get_FreightMaster'), // OperationDAL.GetFtlType -> ddlfrttype (required in legacy)
  ]);
  const opt = (rows, v, l) => rows.map((r) => ({ value: s(r[v]), label: s(r[l]) }));
  return {
    bookingModes: opt(modes.recordset, 'mode_code', 'mode_name'),
    deliveryModes: opt(deliveryModes.recordset, 'mode_code', 'mode_name'),
    items: opt(items.recordset, 'item_code', 'item_name'),
    chargeCodes: opt(chargeCodes.recordset, 'mode_code', 'mode_name'),
    taxChargeCodes: opt(taxChargeCodes.recordset, 'mode_code', 'mode_name'),
    branches: opt(branches.recordset, 'branch_code', 'branch_name'),
    freightTypes: opt(freightTypes.recordset, 'container_code', 'freight_name'),
    customerTypes: ['Contractual Client', 'General Client'],
    bookingTypes: ['To Pay', 'Paid', 'FOC', 'Inter Division'],
    loadTypes: ['PTL', 'FTL'],
    taxModes: ['GST', 'IGST', 'NA'],
    gstPaidBy: ['Transporter', 'Billing Party'],
    dimensionUnits: ['cm', 'Inch', 'mm', 'feet'],
    pkgSizes: ['BIG', 'MEDIUM', 'SMALL'],
  };
}

/** Destination autocomplete (Get_CityMasterByCityName). */
export async function searchCities(term) {
  const { recordset } = await exec('Get_CityMasterByCityName', { city_name: term });
  return recordset.map((r) => ({ name: s(r.city_name), code: s(r.city_code) }));
}

/** Branch(es) serving a destination city (usp_Get_CityExist). */
export async function destinationBranches(cityName) {
  const { recordset } = await exec('usp_Get_CityExist', { city_name: cityName });
  return recordset.map((r) => ({ code: s(r.branch_code), name: s(r.branch_name), cityCode: s(r.city_code) }));
}

/** Consigner/consignee autocomplete (Get_Consigner). Returns [{ name, code }]. */
export async function searchConsigners(term, { isTemp = 'false', city = '' } = {}) {
  const { recordset } = await exec('Get_Consigner', { company_name: term, consigner_code: '', IsTemp: isTemp, CityCode: city });
  return recordset.map((r) => ({ name: s(r.company_name), code: s(r.consigner_code), ...pickParty(r) }));
}

function pickParty(r) {
  return {
    address: s(r.address), city: s(r.city), state: s(r.state), pinCode: s(r.pin_code),
    phone: s(r.phone), gstin: s(r.GSTIN_No ?? r.gstin_no ?? ''),
  };
}

/** Contractual clients (On account of): active clients of the division (Check_ValidOnAccountOf). */
export async function searchClients(user, term) {
  const rows = await query(
    `select top 20 client_code, client_name from client_Master
      where (client_name like @t or client_code like @t) and isnull(is_Active, 1) = 1
        and (@div = '' or ',' + isnull(DivCode, '') + ',' like '%,' + @div + ',%')
      order by client_name`,
    { t: `%${term}%`, div: s(user.divCode) });
  return rows.map((r) => ({ code: s(r.client_code), name: s(r.client_name), value: `${s(r.client_name)}:${s(r.client_code)}` }));
}

export async function billingAt(user, q) {
  const { recordset } = await exec('Get_BillingAt', {
    origin: q.origin ?? user.currentBranch.code,
    destination: q.destination,
    mode_id: q.bookingMode,
    ClientCode: codeOf(q.onAccountOf),
    OLocation: q.originLocation ?? '',
    DLocation: q.destinationLocation ?? '',
    BranchCode: user.currentBranch.code,
    DivCode: user.divCode,
  });
  return recordset.map((r) => ({ code: s(r.billingat), name: s(r.branch_Name) }));
}

/**
 * Slab rate for the charge weight (OperationScript.js: Get_ClientSlabRate_Weight / _Discount_Weight /
 * _SpacialDiscount_Weight). The rate replaces the flat contract rate; the special-discount box took the approved
 * discount of the band. Rate on CATEGORY: Get_ClientSlabRateWeight_Category with the package size and type of
 * packages (product). Null when the inputs are missing or no band holds them.
 */
async function slabRate(user, q) {
  const category = q.rateOn === 'CATEGORY';
  if (category ? !(q.itemCode && q.pkgSize) : !(q.weight > 0)) return null;
  const params = {
    origin: user.cityCode ?? '',
    destination: q.destination,
    mode_id: q.bookingMode,
    ClientCode: codeOf(q.onAccountOf),
    Weight: q.weight,
    CustomerType: q.customerType,
    BookingDate: q.bookingDate,
    BookingType: q.bookingType,
    OLocation: q.originLocation ?? '',
    DLocation: q.destinationLocation ?? '',
    DivCode: user.divCode,
    DocType: q.docType === 'DOC' ? '1' : '2',
    Rateon: q.rateOn,
  };
  if (category) {
    // CATEGORY: the product's band for the weight, the rate of the package size; the discounts stay the contract's.
    const { recordset } = await exec('usp_Get_OnAccountSlabRateWeight_Category', { ...params, PkgSize: q.pkgSize, Item_code: q.itemCode });
    const row = recordset[0];
    if (!row || !(n(row.rate) > 0)) return null;
    return { rate: n(row.rate), slabDiscount: null, weight: q.weight, itemCode: q.itemCode, pkgSize: q.pkgSize };
  }
  const [rate, discount, approved] = await Promise.all([
    exec('usp_Get_OnAccountSlabRateWeight_Curier', params),
    exec('usp_Get_OnAccountSlabDiscountWeight_Curier', params),
    exec('usp_Get_OnAccountSlabApprovedDiscountWeight_Curier', params),
  ]);
  const row = rate.recordset[0];
  if (!row || !(n(row.rate) > 0)) return null;
  const disc = n(discount.recordset[0]?.rate);
  const appr = n(approved.recordset[0]?.rate);
  return { rate: n(row.rate), discountPercent: disc, approvedDiscountPercent: appr, slabDiscount: appr || disc, weight: q.weight };
}

/**
 * Minimum pickup / delivery charge from the contract's charge slabs (OperationScript.js GetMinCharges →
 * sp_GetMinChargeRate, Rate_Type PICKUP / DEL). The unit is the charge weight on WEIGHT and the packets on BOX.
 * The page wrote 0 into the collection / delivery box when no slab matched; here the contract's own charge stays.
 */
async function minCharges(user, q) {
  if (q.customerType === 'General Client') return { collection: null, delivery: null };   // GetMinCharges returned early
  const unit = q.rateOn === 'WEIGHT' ? q.weight : q.rateOn === 'BOX' ? q.packets : 0;
  if (!(unit > 0)) return { collection: null, delivery: null };
  const params = {
    client_code: codeOf(q.onAccountOf), origin_city: user.cityCode ?? '', destination_city: q.destination,
    rate_on: q.rateOn, delivery_mode: q.deliveryMode ?? '', Unit: String(unit),
  };
  const [pickup, del] = await Promise.all([
    exec('sp_GetMinChargeRate', { ...params, Rate_Type: 'PICKUP' }),
    exec('sp_GetMinChargeRate', { ...params, Rate_Type: 'DEL' }),
  ]);
  const amount = (rs) => (rs.recordset[0] ? n(rs.recordset[0].MinChargeAmt) : null);
  return { collection: amount(pickup), delivery: amount(del) };
}

/**
 * Contract rate (sp_Select_Rate). Returns the pricing inputs for the calculator, or null. A contractual client gets its
 * own contract; a General Client (no "on account of") the Paid / To Pay general rate of its booking type.
 */
export async function contractRate(user, q) {
  if (q.customerType === 'General Client') q = { ...q, onAccountOf: '' };
  else if (!codeOf(q.onAccountOf)) return null;
  const { recordset } = await exec('sp_Select_Rate', {
    OBranch: user.currentBranch.code,
    DBranch_Name: q.destination,
    Booking_Mode: q.bookingMode,
    Client_Code: codeOf(q.onAccountOf),
    Rate_On: q.rateOn,
    customer_type: q.customerType,
    FreightType: q.freightType ?? '',
    BookingDate: q.bookingDate,
    Booking_Type: q.bookingType,
    DivCode: user.divCode,
    OLocation: q.originLocation ?? '',
    DLocation: q.destinationLocation ?? '',
    DocumentType: q.docType === 'DOC' ? '1' : '2',
    LoadType: q.loadType ?? '',
    delivery_mode: q.deliveryMode ?? '',
  });
  const r = recordset[0];
  if (!r) return null;
  const [slab, chargeSlab] = await Promise.all([slabRate(user, q), minCharges(user, q)]);
  return {
    slabRate: Boolean(slab),          // the rate came from a weight slab (the page's Slab_Rate = "1")
    slab,
    chargeSlab,                       // { collection, delivery }: from the pickup / delivery charge slabs, null = none
    rateId: s(r.slno),
    billingAt: s(r.billingat),
    billingAtName: s(r.branch_Name),
    rateOn: s(r.rate_on).toUpperCase() || q.rateOn,
    rate: slab ? slab.rate : n(r.rate),
    flatRate: n(r.rate),
    minWeight: n(r.minchargewt),
    minFreight: n(r.minFreight),
    fuelPercent: n(r.sour_charge),
    ftlAmount: n(r.FtlRate),
    discountPercent: slab && slab.slabDiscount !== null ? slab.slabDiscount : n(r.ApproveDiscPrc) || n(r.DisPrc),
    expectedDays: n(r.Expected_Days),
    charges: {
      fov: n(r.fov), oda: n(r.oda),
      collection: chargeSlab.collection ?? n(r.collection_charge), delivery: chargeSlab.delivery ?? n(r.dly),
      logistics: n(r.logistic_charge), dod: n(r.dod), risk: n(r.risk_charge), handling: n(r.handling_charge),
      service: n(r.Service_charge), ocs: n(r.ocs), halting: n(r.halthing_charge), topay: n(r.TopayCharge),
      hamali: n(r.hamali_charge),
    },
    loadingRate: n(r.LoadingCharge),
    unloadingRate: n(r.UnLoadingCharge),
    minLoading: n(r.MinLoadingCharge),
    minUnloading: n(r.MinUnLoadingCharge),
    invoiceValueMin: n(r.InvoiceValueMin),
    invoiceValueMax: n(r.InvoiceValueMax),
    fovFlatRate: n(r.FovFlatRate),
    volumetricWeight: n(r.VolumetricWeight),
    // KM: the route's distance for rate x distance. BindRateOnftl filled txtDistance from the result's DisPrc; the
    // new app reads totaldistance when the procedure returns it and falls back to that legacy column.
    distance: s(r.rate_on).toUpperCase() === 'KM' ? n(r.totaldistance !== undefined ? r.totaldistance : r.DisPrc) : null,
  };
}

/**
 * Locations of a city (Get_Destination_LocationList + Get_Pin_Code): PIN code, the branch serving it and whether an ODA
 * rate is in force for it (IsODA). The docket's destination location fills the PIN and, for an ODA location, the ODA
 * charge; the origin location list uses the same call with the branch's own city.
 */
export async function odaLocations(cityName) {
  const rows = await query(
    `select l.Location_Code, l.Location_Name, l.Pin_Code, l.branch_code,
            case when exists (select 1 from ODA_Charge o where o.Location_Code = l.Location_Code and o.Status = 1
                               and o.Effective_Date <= cast(getdate() as date)) then 1 else 0 end as is_oda
       from New_Location_master l
       join city_master c on c.city_code = l.City_Code
      where (c.city_name = @c or c.city_code = @c) and isnull(l.IsActinve_Flag, 'Active') = 'Active' order by l.Location_Name`, { c: cityName });
  return rows.map((r) => ({
    code: s(r.Location_Code), name: s(r.Location_Name), pinCode: s(r.Pin_Code), branch: s(r.branch_code), oda: Boolean(r.is_oda),
  }));
}

/** Get_Location(Pincode, city): the location of the destination city with this PIN code. */
export async function locationByPin(pin, cityName) {
  const hit = (await odaLocations(cityName)).find((l) => l.pinCode === pin);
  if (!hit) throw badRequest('This postal code does not belong to the destination city');
  return hit;
}

/** The booking branch's city locations, with the branch's own location first (Get_LocationByBranch). */
export async function originLocations(user) {
  const [b] = await query('select city_code, location from branch_master where branch_code = @b', { b: user.currentBranch.code });
  const list = b ? await odaLocations(s(b.city_code)) : [];
  return { locations: list, default: s(b?.location) || list.find((l) => l.branch === user.currentBranch.code)?.code || '' };
}

/** GetStatebyCity: the state of a city (by name or code) for a consignor / consignee. */
export async function stateOfCity(city) {
  const [r] = await query(
    `select top 1 c.city_code, c.city_name, st.state_name from city_master c left join state_master st on st.state_code = c.state_code
      where c.city_name = @c or c.city_code = @c`, { c: city });
  return r ? { city: s(r.city_name), cityCode: s(r.city_code), state: s(r.state_name) } : { city, cityCode: '', state: '' };
}

/** A GSTIN's state: its first two digits are the GST state code (state_master.StateCode). */
export async function stateOfGstin(gstin) {
  const code = String(gstin || '').trim().slice(0, 2);
  if (!/^\d{2}$/.test(code)) return { state: '', stateCode: '' };
  const [r] = await query("select top 1 state_name, state_code from state_master where StateCode = @c and isnull(active_flag, 'Active') = 'Active'", { c: code });
  return { state: s(r?.state_name), stateCode: s(r?.state_code), gstCode: code };
}

/**
 * Get_Branch_shiper_issue / Get_client_shiper_issue: the branch (and client) the docket number was issued to from the
 * shipper stock — a number moved to another branch counts for that branch. `issued` false when it is in no issue.
 */
export async function docketIssue(user, docketNo) {
  const no = Number(docketNo);
  if (!Number.isInteger(no) || no <= 0) return { issued: false };
  const [r] = await query(
    `select top 1 i.slno, i.branch_code, bm.branch_name, i.Client_Code, cm.company_name,
            t.issue_to_branch, tb.branch_name as moved_name
       from shiper_issue_to_branch i
       left join branch_master bm on bm.branch_code = i.branch_code
       left join client_Master cm on cm.client_code = i.Client_Code
       outer apply (select top 1 x.issue_to_branch from Shipper_issue_frombranch_tobranch x
                     where x.shippers_issued_id = i.slno and x.isCancel = 0 and try_cast(substring(x.shipper_no, 3, 30) as bigint) = @no) t
       left join branch_master tb on tb.branch_code = t.issue_to_branch
      where i.shipper_type = 'GRN Shipper'
        and @no between try_cast(substring(i.starting_series, 3, 30) as bigint) and try_cast(substring(i.endseries, 3, 30) as bigint)
      order by i.slno desc`, { no });
  if (!r) return { issued: false };
  const branch = s(r.issue_to_branch) || s(r.branch_code);
  return {
    issued: true, branch, branchName: s(r.moved_name) || s(r.branch_name), ownBranch: branch === user.currentBranch.code,
    client: s(r.Client_Code), clientName: s(r.company_name),
    onAccountOf: r.Client_Code ? `${s(r.company_name)}:${s(r.Client_Code)}` : '',
  };
}

/**
 * What the "on account of" client brings to the docket (Check_ValidOnAccountOf, GetOnAccountRateOn / DeliveryMode /
 * GstinNo, AutoConsigner): the client must be active in the division; its own details fill the consignor (or the
 * consignee, by client_Master.Credit_Type); the rate-on and delivery modes of its active contracts to the destination
 * (city, its locations, state or zone) are offered — one of each is filled in.
 */
export async function clientDefaults(user, onAccountOf, destination) {
  const code = codeOf(onAccountOf) || s(onAccountOf);
  const [c] = await query(
    `select client_code, company_name, address, city, pin_code, phone, Mobile, Gstin_No, Credit_Type, is_Active, DivCode
       from client_Master where client_code = @c`, { c: code });
  if (!c || !(c.is_Active === true || c.is_Active === 1 || s(c.is_Active) === '1')
    || (user.divCode && !`,${s(c.DivCode)},`.includes(`,${user.divCode},`))) {
    throw badRequest('Invalid On Account Of');
  }
  const cityInfo = await stateOfCity(s(c.city));
  const party = {
    code: s(c.client_code), name: s(c.company_name), address: s(c.address), city: cityInfo.city || s(c.city), state: cityInfo.state,
    pinCode: s(c.pin_code), phone: s(c.Mobile) || s(c.phone), gstin: s(c.Gstin_No),
  };
  let rateOns = []; let deliveryModes = [];
  if (destination) {
    const [d] = await query('select city_code, state_code, zone_code from city_master where city_name = @d or city_code = @d', { d: destination });
    if (d) {
      const rows = await query(
        `select rate_on, delivery_mode from (
           select rate_on, delivery_mode, status, effective_from, client_code from client_contract_city where destination_city = @city
           union all select rate_on, delivery_mode, status, effective_from, client_code from client_contract_location
             where destination_location in (select Location_Code from New_Location_master where City_Code = @city)
           union all select rate_on, delivery_mode, status, effective_from, client_code from client_contract_State where destination_State = @st
           union all select rate_on, delivery_mode, status, effective_from, client_code from client_contract_zone where destination_zone = @z) x
          where client_code = @c and status = 'Active' and effective_from <= cast(getdate() as date)`,
        { city: s(d.city_code), st: s(d.state_code), z: s(d.zone_code), c: code });
      rateOns = [...new Set(rows.map((r) => s(r.rate_on)).filter(Boolean))];
      deliveryModes = [...new Set(rows.map((r) => s(r.delivery_mode)).filter(Boolean))];
    }
  }
  return {
    client: { code: s(c.client_code), name: s(c.company_name) },
    partyRole: s(c.Credit_Type).toLowerCase() === 'consignee' ? 'consignee' : 'consigner',
    party, rateOns, deliveryModes,
  };
}

/** ODA charge for the location and charge weight (Get_OdaRate → usp_Get_OdaRate; Rate/ODA_Charge.aspx rates). */
export async function odaCharge(location, weight) {
  const { recordset } = await exec('usp_Get_OdaRate', { LocationCode: location, Weight: String(weight ?? 0) });
  return { charge: recordset[0] ? n(recordset[0].odaRate) : null };
}

/** GST mode (ups_Get_TaxType) and rates (Get_GstTaxDetails, "cgst#sgst"). */
export async function taxSetup(user, q) {
  const [type, rates] = await Promise.all([
    exec('ups_Get_TaxType', { OrginCode: user.currentBranch.code, Destination: q.destination, TaxSelect: q.taxSelect ?? '' }),
    exec('Get_GstTaxDetails', { BookingMode: q.bookingMode, BookingDate: q.bookingDate, Division: user.divCode }),
  ]);
  const raw = s(type.recordset[0]?.TaxType).toUpperCase();
  const taxMode = raw === 'IGST' ? 'IGST' : raw === 'GST' || raw === 'CGST' || raw === 'SGST' ? 'GST' : 'NA';
  const cgst = n(rates.recordset[0]?.cgst);
  const sgst = n(rates.recordset[0]?.sgst);
  return { taxMode, cgstRate: cgst, sgstRate: sgst, igstRate: cgst + sgst };
}

export async function expectedDate(q) {
  const { recordset } = await exec('sp_getExpectedDate_grn', { from_city: q.fromCity, to_city: q.toCity, booking_date: q.bookingDate });
  const v = recordset[0] ? Object.values(recordset[0])[0] : null;
  return v ? new Date(v).toISOString().slice(0, 10) : null;
}

export async function nextDocketNo(user) {
  const { recordset } = await exec('SP_GET_max_docket', { branchCode: user.currentBranch.code });
  const v = recordset[0] ? Object.values(recordset[0])[0] : null;
  return v === null || v === undefined ? null : s(v);
}

// ------------------------------------------------------------------ calculation

export function calculate(d, user) {
  return calculateDocket({
    divCode: user.divCode,
    docType: d.docType,
    rateOn: d.rateOn,
    rate: d.rate,
    packets: d.packets,
    chargeWeight: d.chargeWeight,
    minWeight: d.minWeight,
    minFreight: d.minFreight,
    minBox: d.minBox,
    distance: d.distance,
    ftlAmount: d.ftlAmount,
    manualFreight: d.manualFreight,
    discountPercent: d.discountPercent,
    fuelPercent: d.fuelPercent,
    docketCharge: d.docketCharge,
    charges: d.charges,
    additionalCharges: d.additionalCharges,
    additionalChargesTax: d.additionalChargesTax,
    taxMode: d.taxMode,
    igstRate: d.igstRate,
    cgstRate: d.cgstRate,
    sgstRate: d.sgstRate,
    gstPaidBy: d.gstPaidBy,
  });
}

// ------------------------------------------------------------------ save helpers

const SAVE_CODES = {
  '0': [409, 'Docket no already exists.'],
  '-1': [422, 'Invalid shipper.'],
  '-2': [422, 'Invalid consignor or consignee code.'],
  '-3': [422, 'Booking date can not be greater than current date.'],
  '-4': [422, 'Booking date can not be less than 2 days from current date.'],
  '-11': [422, 'Bind all booking income ledgers first.'],
};

function chargeLedgerError(code, d, user) {
  const branch = `${user.currentBranch.name} :${user.currentBranch.code}`;
  if (code === -1) return new HttpError(422, `${d.onAccountOf} ledger not found`);
  if (code === -2) return new HttpError(422, `TOPAY RECOVERY :${branch} ledger not found`);
  if (code === -3) return new HttpError(422, `PAID RECOVERY :${branch} ledger not found`);
  return new HttpError(422, 'Docket charges could not be saved');
}

/** Params shared by Save_GrnEntry and Update_GrnEntry_New. */
function headerParams(d, user) {
  const inv0 = d.invoices[0] || {};
  return {
    docketNo: d.docketNo,
    BookingDate: d.bookingDate,
    Destination_branch: d.destinationBranch,
    CustomerType: d.customerType,
    BookingMode: d.bookingMode,
    Origin: user.currentBranch.code,
    OriginBindCity: d.originCity,
    OnAccountof: d.onAccountOf,
    BillingAt: d.billingAt,
    BookingType: d.bookingType,
    DeliveryMode: d.deliveryMode,
    TopayType: d.topayType,
    Amount: '',
    ConsignerCode: d.consigner.code,
    ConsigneeCode: d.consignee.code,
    ConsignerName: d.consigner.name,
    ConsigneeName: d.consignee.name,
    Consigneraddress: d.consigner.address,
    ConsignerCity: d.consigner.city,
    ConsignerState: d.consigner.state,
    ConsignerPinCode: d.consigner.pinCode,
    ConsignerPhone: d.consigner.phone,
    Consigneeaddress: d.consignee.address,
    ConsigneeCity: d.consignee.city,
    ConsigneeState: d.consignee.state,
    ConsigneePinCode: d.consignee.pinCode,
    ConsigneePhone: d.consignee.phone,
    TypeofPkts: d.itemContent,
    StaxBy: d.taxMode,
    Consignee_BillingAt: d.consigneeBillingAt,
    Consigner_BillingAt: d.consignerBillingAt,
    destination: d.destination,
    ExpectedDate: d.expectedDate,
    Remarks: d.remarks,
    ODA_Location: d.odaLocation,
    Financial_Year: user.financialYear,
    E_WayBill: d.eWayBill,
    Consigner_GSTIN_No: d.consigner.gstin,
    Consignee_GSTIN_No: d.consignee.gstin,
    LoadType: d.loadType,
    PinCode: d.pinCode,
    DestinationLocation: d.destinationLocation,
    OriginLocation: d.originLocation,
    psno: '',
    textiletype: '',
    SenderID: '',
    ReceiverID: '',
    ManualDocketNo: d.manualDocketNo,
    gstPaidBy: d.gstPaidBy,
    MeatingDate: '',
    Vendor_code: '',
    Vendor_docket: '',
    PkgSize: d.pkgSize,
    PM: '',
    cc_attached: '',
    ItemDescription: d.itemDescription,
    _vehicleNo: inv0.vehicleNo ?? '',
  };
}

function chargeParams(d, c, user) {
  return {
    freight_type: d.freightType,
    rate_on: d.rateOn,
    pcs: d.packets,
    actual_weight: d.actualWeight,
    charge_weight: c.effectiveChargeWeight,
    freight: c.freight,
    docket_charge: c.docketCharge,
    other_charge: c.otherCharges,
    service_tax: c.totalTax,
    charges: c.grandTotal,
    acharges: c.grandTotal,
    docket_rate: d.rate,
    s_tax: c.taxMode === 'IGST' ? c.igstRate : c.cgstRate + c.sgstRate,
    FtlRate: d.ftlAmount,
    RateID: d.rateId,
    minWeight: d.minWeight,
    BookingDate: d.bookingDate,
    Financial_Year: user.financialYear,
    IsGta: d.isGta,
    IsCourier: d.isCourier,
    IsReg: d.isReg,
    CGST_Tax: c.cgstRate,
    CGST_Amt: c.cgstAmount,
    SGST_Tax: c.sgstRate,
    SGST_Amt: c.sgstAmount,
    minFreight: d.minFreight,
    Discount: c.discountPercent,
    SpecialDiscount: c.discountPercent,
    discounttype: '',
    DiscountAmt: c.discountValue,
    Basefrt: c.baseFreight,
    adminCper: 0,
  };
}

function otherChargeParams(d, c) {
  const k = c.chargeBreakup;
  return {
    risk_charge: k.risk,
    handling_charge: k.handling,
    dod_dac_charge: k.dod,
    service_charge: k.service,
    ocs: k.ocs,
    oda: k.oda,
    dly: k.delivery,
    collection_charges: k.collection,
    Logistic_charges: k.logistics,
    sour_charge: c.fuelSurcharge,
    fov: k.fov,
    HaltingChrg: k.halting,
    Stationary: k.stationary,
    FOVPercent: d.fovPercent,
    FuelChargePercent: c.fuelPercent,
    LoadingCharges: k.loading,
    UnLoadingCharges: k.unloading,
    InvoiceValueMin: d.invoiceValueMin,
    InvoiceValueMax: d.invoiceValueMax,
    FovFlatRate: d.fovFlatRate,
    hamali_Rate: d.hamaliRate,
    hamali_charge: k.hamali,
    StatisticalCharges: k.statistical,
    LocalCartage: k.localCartage,
    PFCharges: k.pf,
  };
}

async function saveChildRows(tx, docketNo, d) {
  for (const inv of d.invoices) {
    await exec('Save_InvoiceEntry', {
      invoice_no: inv.invoiceNo,
      invoice_date: inv.invoiceDate || new Date().toISOString().slice(0, 10),
      invoice_value: inv.invoiceValue,
      net_invoice_value: inv.netInvoiceValue,
      part_no: inv.partNo,
      item_description: inv.itemDescription,
      invpct: inv.packets,
      Quantity: inv.quantity,
      docketNo,
      EWayBill: inv.eWayBill,
      EWayBillDate: inv.eWayBillDate,
      EWayBillValidDate: inv.eWayBillValidDate,
    }, {}, { tx });
  }
  for (const ins of d.insurance) {
    await exec('Save_InsuranceEntry', {
      docketNo,
      Risk_at: ins.riskAt,
      Policy_no: ins.policyNo,
      // Legacy always stored today's date here (the posted policy date was ignored).
      Policy_date: ins.policyDate || new Date().toISOString().slice(0, 10),
      Ins_company: ins.insCompany,
      Private_mark: ins.privateMark,
      Ins_Value: 0,
    }, {}, { tx });
  }
  for (const dim of d.dimensions) {
    await exec('Save_DimentionEntry', {
      docket_no: docketNo,
      packet: dim.packets,
      lenght: dim.length,
      width: dim.width,
      height: dim.height,
      total_cft: dim.totalCft,
      percft: dim.perCft,
      packet_chargeweight: dim.chargeWeight,
      actual_weight: dim.actualWeight,
      freight_type: d.freightType,
      rate_on: d.rateOn,
      WtType: dim.weightType,
    }, {}, { tx });
  }
  for (const ch of d.additionalCharges) {
    await exec('Save_ChargeEntry', { Docket_No: docketNo, Charge_Name: ch.name, NoofDays: ch.days, Charge_Amount: ch.amount, Chargeid: ch.code }, {}, { tx });
  }
  for (const ch of d.additionalChargesTax) {
    await exec('Save_ChargeEntryTax', { Docket_No: docketNo, Charge_Name: ch.name, NoofDays: ch.days, Charge_Amount: ch.amount, Chargeid: ch.code }, {}, { tx });
  }
}

// ------------------------------------------------------------------ export / import (docket_international)

/** Countries, ports, currencies (with the rate), carriers and incoterms for the docket's international section. */
export async function internationalOptions() {
  const [countries, ports, currencies, carriers] = await Promise.all([
    query('select CountryCode, CountryName, CurrencyCode from tblCountry where IsActive = 1 order by CountryName'),
    query('select PortCode, PortName, PortType, CountryCode from tblPort where IsActive = 1 order by PortName'),
    query('select CurrencyCode, CurrencyName, RateToINR from tblCurrency where IsActive = 1 order by CurrencyCode'),
    query('select CarrierCode, CarrierName, CarrierType, AwbPrefix from tblCarrier where IsActive = 1 order by CarrierName'),
  ]);
  return {
    countries: countries.map((r) => ({ value: s(r.CountryCode), label: `${s(r.CountryName)} (${s(r.CountryCode)})`, currency: s(r.CurrencyCode) })),
    ports: ports.map((r) => ({ value: s(r.PortCode), label: `${s(r.PortName)} (${s(r.PortCode)})`, type: s(r.PortType), country: s(r.CountryCode) })),
    currencies: currencies.map((r) => ({ value: s(r.CurrencyCode), label: `${s(r.CurrencyCode)} - ${s(r.CurrencyName)}`, rate: n(r.RateToINR) })),
    carriers: carriers.map((r) => ({ value: s(r.CarrierCode), label: `${s(r.CarrierName)} (${s(r.CarrierCode)})`, type: s(r.CarrierType), prefix: s(r.AwbPrefix) })),
    incoterms: INCOTERMS,
  };
}

/** An export / import docket only in a division that allows it (checked before anything is saved). */
async function assertInternationalAllowed(d, user) {
  if (!d.international || d.international.shipmentType === 'DOMESTIC') return;
  const biz = await businessProfile(user.divCode);
  if (!biz.allowInternational) throw badRequest('This division books domestic dockets only (Division Master → business profile)');
}

/** Write a docket's export / import row (replaces the old one; a domestic docket keeps none). */
async function saveInternational(tx, docketNo, x, user) {
  await query('delete from docket_international where docket_no = @d', { d: docketNo }, { tx });
  if (!x || x.shipmentType === 'DOMESTIC') return;
  // every code must be in its master
  const checks = [
    ['tblCountry', 'CountryCode', x.originCountry, 'origin country'], ['tblCountry', 'CountryCode', x.destinationCountry, 'destination country'],
    ['tblPort', 'PortCode', x.originPort, 'origin port'], ['tblPort', 'PortCode', x.destinationPort, 'destination port'],
    ['tblCarrier', 'CarrierCode', x.carrierCode, 'carrier'], ['tblCurrency', 'CurrencyCode', x.currency, 'currency'],
  ];
  for (const [table, col, v, what] of checks) {
    if (!v) continue;
    const [hit] = await query(`select top 1 1 as x from ${table} where ${col} = @v`, { v }, { tx });
    if (!hit) throw badRequest(`Unknown ${what}: ${v}`);
  }
  let rate = Number(x.exchangeRate) || 0;
  if (!rate) rate = n((await query('select RateToINR from tblCurrency where CurrencyCode = @c', { c: x.currency }, { tx }))[0]?.RateToINR) || 1;
  await query(
    `insert into docket_international(docket_no, ShipmentType, OriginCountry, DestinationCountry, OriginPort, DestinationPort, CarrierCode,
       MawbNo, HawbNo, FlightVoyage, Incoterm, CurrencyCode, ExchangeRate, InvoiceValueFC, InvoiceValueINR, HsCode, IecNo, CustomsDocNo,
       CustomsDocDate, OverseasName, OverseasAddress, OverseasCity, OverseasZip, OverseasPhone, OverseasEmail, CreatedBy)
     values (@d, @t, @oc, @dc, @op, @dp, @car, @mawb, @hawb, @fv, @inco, @cur, @rate, @fc, @inr, @hs, @iec, @cdn, @cdd, @on, @oa, @ocity, @oz, @oph, @oe, @u)`,
    {
      d: docketNo, t: x.shipmentType, oc: x.originCountry || (x.shipmentType === 'EXPORT' ? 'IN' : ''), dc: x.destinationCountry || (x.shipmentType === 'IMPORT' ? 'IN' : ''),
      op: x.originPort, dp: x.destinationPort, car: x.carrierCode, mawb: x.mawbNo, hawb: x.hawbNo, fv: x.flightVoyage, inco: x.incoterm,
      cur: x.currency, rate, fc: x.invoiceValueFc, inr: Math.round(x.invoiceValueFc * rate * 100) / 100, hs: x.hsCode, iec: x.iecNo,
      cdn: x.customsDocNo, cdd: x.customsDocDate || null, on: x.overseasName, oa: x.overseasAddress, ocity: x.overseasCity, oz: x.overseasZip,
      oph: x.overseasPhone, oe: x.overseasEmail, u: user.userId,
    }, { tx });
}

async function readInternational(docketNo) {
  const [r] = await query('select * from docket_international where docket_no = @d', { d: docketNo });
  if (!r) return { shipmentType: 'DOMESTIC' };
  const dt = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
  return {
    shipmentType: s(r.ShipmentType), originCountry: s(r.OriginCountry), destinationCountry: s(r.DestinationCountry),
    originPort: s(r.OriginPort), destinationPort: s(r.DestinationPort), carrierCode: s(r.CarrierCode), mawbNo: s(r.MawbNo),
    hawbNo: s(r.HawbNo), flightVoyage: s(r.FlightVoyage), incoterm: s(r.Incoterm), currency: s(r.CurrencyCode),
    exchangeRate: n(r.ExchangeRate), invoiceValueFc: n(r.InvoiceValueFC), invoiceValueInr: n(r.InvoiceValueINR), hsCode: s(r.HsCode),
    iecNo: s(r.IecNo), customsDocNo: s(r.CustomsDocNo), customsDocDate: dt(r.CustomsDocDate), overseasName: s(r.OverseasName),
    overseasAddress: s(r.OverseasAddress), overseasCity: s(r.OverseasCity), overseasZip: s(r.OverseasZip), overseasPhone: s(r.OverseasPhone),
    overseasEmail: s(r.OverseasEmail),
  };
}

async function checkThirdPartyBilling(d) {
  if (d.customerType !== 'Contractual Client') return;
  const { recordset } = await exec('Get_IsThirdPartyBilling', {
    Accountof: codeOf(d.onAccountOf), Consigner: d.consigner.code, Consignee: d.consignee.code, BranchCode: d.billingAt,
  });
  if (s(recordset[0]?.Status) === '1') throw new HttpError(422, 'Third party billing is not valid for this account of.');
}

// ------------------------------------------------------------------ create / update / cancel

export async function createDocket(d, user) {
  await assertInternationalAllowed(d, user);
  await checkThirdPartyBilling(d);
  const c = calculate(d, user);
  const Int = sql().Int;
  const VarChar = sql().VarChar;

  const docketNo = await withTransaction(async (tx) => {
    const { _vehicleNo, ...hdr } = headerParams(d, user);
    // @sln (result code) and @computeriseno (generated docket no) are OUTPUT params.
    const res = await exec('Save_GrnEntry', {
      ...hdr,
      user: user.userId,
      created_date: new Date(),
      docsNoneDocs: d.docType === 'DOC' ? '1' : '2',
      DivCode: user.divCode,
      IsRTO: '0',
      Vehicleno: _vehicleNo,
      document_date: '',
      tripshtNo: '',
      transporter_document_number: '',
      vehicle_number_update_date: '',
      Vehicle: d.vehicle,
      PartyShiperNo: '',
      LoadNo: '',
      Distance: d.distance,
      isDockeOpen: false,
    }, { sln: Int, computeriseno: [VarChar(50), null] }, { tx });

    const code = s(res.output.sln);
    if (SAVE_CODES[code] || Number(code) < 0 || code === '') {
      const [status, msg] = SAVE_CODES[code] ?? [422, `Docket could not be saved (code ${code || 'empty'})`];
      throw new HttpError(status, msg);
    }
    const saved = s(res.output.computeriseno) || d.docketNo;

    const dc = await exec('Save_DocketCharges', { docket: saved, ...chargeParams(d, c, user), DivCode: user.divCode }, { sln: Int }, { tx });
    if (Number(dc.output.sln) <= 0) throw chargeLedgerError(Number(dc.output.sln), d, user);

    await exec('Save_OtherCharges', {
      docket: saved,
      ...otherChargeParams(d, c),
      TopayCharge: c.chargeBreakup.topay,
      Isocs: '', Isdly: '', Iscollection_charges: '',
    }, {}, { tx });
    await saveChildRows(tx, saved, d);
    await exec('Save_FranchiseeComm', {
      Docket_No: saved, FranchiseeCode: user.userId, BookingComm: d.bookingCommission, BookingPercentage: d.bookingCommissionPercent,
    }, {}, { tx });
    await saveInternational(tx, saved, d.international, user);
    return saved;
  });

  // automatic pickup: same booking date + consignee city → same pickup (never blocks the booking). AUTO_PICKUP=0 turns it
  // off (the older API tests make their pickups by hand).
  let pickup = null;
  if (process.env.AUTO_PICKUP !== '0') {
    try { pickup = await autoPickupForDocket(user, docketNo); } catch (e) { pickup = { skipped: e.message }; }
  }
  const pickupText = !pickup ? ''
    : pickup.pickupNo ? ` · Pickup ${pickup.pickupNo} ${pickup.created ? 'created' : 'updated'} (${pickup.city}, ${pickup.date})`
      : ` · Pickup not made automatically: ${pickup.skipped}`;
  return {
    docketNo,
    totals: c,
    pickup,
    message: `Docket has been entered successfully. Computerised docket no: ${docketNo}${pickupText}`,
  };
}

export async function updateDocket(docketNo, d, user) {
  const current = await getDocket(docketNo, user);
  assertEditable(current, 'modify');
  if (d.docketNo !== docketNo) throw badRequest('Docket no in the body does not match the URL');
  await assertInternationalAllowed(d, user);
  await checkThirdPartyBilling(d);
  const c = calculate(d, user);
  const Int = sql().Int;

  await withTransaction(async (tx) => {
    const { _vehicleNo, ...hdr } = headerParams(d, user); // eslint-disable-line no-unused-vars
    const res = await exec('Update_GrnEntry_New', hdr, { sln: Int }, { tx });
    const code = s(res.output.sln);
    if (code === '-3' || code === '-4') throw new HttpError(422, SAVE_CODES[code][1]);

    const dc = await exec('Update_DocketCharges', { docket: docketNo, ...chargeParams(d, c, user) }, { sln: Int }, { tx });
    if (Number(dc.output.sln) <= 0) throw chargeLedgerError(Number(dc.output.sln), d, user);

    await exec('Update_OtherCharges', { docket: docketNo, ...otherChargeParams(d, c), ToPayCharge: c.chargeBreakup.topay }, {}, { tx });

    for (const proc of ['Delete_InvoiceEntry', 'Delete_Insurance', 'Delete_Dimention', 'Delete_Charge', 'Delete_ChargeTax']) {
      await exec(proc, { docketNo }, {}, { tx });
    }
    await saveChildRows(tx, docketNo, d);
    await exec('Save_FranchiseeComm', {
      Docket_No: docketNo, FranchiseeCode: user.userId, BookingComm: d.bookingCommission, BookingPercentage: d.bookingCommissionPercent,
    }, {}, { tx });
    await saveInternational(tx, docketNo, d.international, user);
  });

  return { docketNo, totals: c, message: 'Docket has been updated successfully' };
}

export async function cancelDocket(docketNo, remark, user) {
  const current = await getDocket(docketNo, user);
  assertEditable(current, 'cancel');
  await withTransaction(async (tx) => {
    await exec('Cancel_GrnEntry', { docketNo, CancelRemark: remark, user: user.userId }, {}, { tx });
  });
  return { docketNo, message: 'Docket has been cancelled successfully' };
}

function assertEditable(docket, action) {
  const h = docket.header;
  if (h.grnCancelled) throw conflict('This docket is already cancelled.');
  if (h.billNo) throw conflict(`Cannot ${action} as bill has been already generated, bill no ${h.billNo}.`);
  if (action === 'cancel' && h.nextStepDone) throw conflict('Cannot cancel as manifest has been already generated.');
}

// ------------------------------------------------------------------ read

export async function getDocket(docketNo, user, { isRto = '0' } = {}) {
  const { recordset } = await exec('Get_DocketDetails', {
    DocketNo: docketNo, Origin: user.currentBranch.code, DivCode: user.divCode, IsRTO: isRto,
  });
  const r = recordset[0];
  if (!r) throw notFound(`Docket ${docketNo} not found`);
  if (s(r.Status)) throw new HttpError(404, s(r.Status));
  // Clients may only see their own dockets.
  if (user.role === 'client' && codeOf(r.on_account_of) !== user.userId) throw forbidden();

  const [inv, ins, dim, add, addTax, international] = await Promise.all([
    exec('Get_InvoiceDetails', { DocketNo: docketNo }),
    exec('Get_InsuranceDetails', { DocketNo: docketNo }),
    exec('Get_DimentionDetails', { DocketNo: docketNo }),
    exec('Get_AdditionalDetails', { DocketNo: docketNo }),
    exec('Get_AdditionalDetailsTax', { DocketNo: docketNo }),
    readInternational(s(r.docket_no) || docketNo),
  ]);

  const d = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
  return {
    header: {
      docketNo: s(r.docket_no),
      computeriseGrn: s(r.computerise_grn),
      manualDocketNo: s(r.ManualDocketNo),
      bookingDate: d(r.booking_date),
      expectedDate: d(r.ExpectedDate),
      bookingMode: s(r.booking_mode),
      customerType: s(r.customer_type),
      bookingType: s(r.booking_type),
      deliveryMode: s(r.delivery_mode),
      loadType: s(r.LoadType) || 'PTL',
      docType: s(r.DocsNoneDocs) === '1' ? 'DOC' : 'NONDOC',
      originBranch: s(r.origin_branch),
      originCity: s(r.originBindCity),
      destination: s(r.destination ?? r.city_name),
      destinationBranch: s(r.destination_branch),
      destinationLocation: s(r.destinationLocation),
      pinCode: s(r.PinCode),
      onAccountOf: s(r.on_account_of),
      billingAt: s(r.billing_at),
      itemContent: s(r.item_content),
      remarks: s(r.remarks),
      eWayBill: s(r.E_WayBill),
      gstPaidBy: s(r.gstPaidBy) || 'Transporter',
      // NOTE: the legacy DAL reads consignee_* columns into the consignor and
      // vice versa (OperationDAL.Get_DocketDetails). Mirrored here on purpose —
      // verify against the real Get_DocketDetails before relying on it.
      consigner: {
        code: s(r.consignee_id), name: s(r.Consigner_Name), address: s(r.consignee_address), city: s(r.consignee_city),
        state: s(r.consignee_state), pinCode: s(r.consignee_pin_code), phone: s(r.consignee_phone), gstin: s(r.Gstin_No),
      },
      consignee: {
        code: s(r.consigner_id), name: s(r.consignee_name), address: s(r.address), city: s(r.city),
        state: s(r.state), pinCode: s(r.pin_code), phone: s(r.phone), gstin: s(r.ConsigneeGstin_No),
      },
      consignerBillingAt: s(r.Consigner_BillingAt),
      consigneeBillingAt: s(r.Consignee_BillingAt),
      originLocation: s(r.OriginLocation),
      itemDescription: s(r.ItemDescription),
      pkgSize: s(r.PkgSize),
      freight: n(r.freight),
      otherCharges: n(r.other_charge),
      totalTax: n(r.service_tax),
      grandTotal: n(r.charges),
      // workflow flags
      manifestStatus: s(r.manifest_status),
      arrivedStatus: s(r.Arrived_status),
      drsStatus: s(r.drs_status),
      billNo: s(r.bill_no),
      grnCancelled: ['yes', 'true', '1', 'cancel', 'cancelled'].includes(s(r.grn_cancel_status).toLowerCase()),
      nextStepDone: s(r.IsNextStep) !== '' && s(r.IsNextStep) !== '0',
    },
    // Pricing inputs as stored, so "modify" reproduces the same totals.
    pricing: {
      rateOn: s(r.rate_on).toUpperCase() || 'WEIGHT',
      rate: n(r.docket_rate),
      rateId: s(r.RateID),
      freightType: s(r.freight_type),
      packets: n(r.pcs),
      actualWeight: n(r.actual_weight),
      chargeWeight: n(r.charge_weight),
      minWeight: n(r.minWeight),
      minFreight: n(r.minFreight),
      ftlAmount: n(r.FtlRate),
      discountPercent: n(r.SpecialDiscount) || n(r.Discount),
      fuelPercent: n(r.FuelChargePercent),
      docketCharge: n(r.docket_charge),
      fovPercent: n(r.FOVPercent),
      invoiceValueMin: n(r.InvoiceValueMin),
      invoiceValueMax: n(r.InvoiceValueMax),
      fovFlatRate: n(r.FovFlatRate),
      hamaliRate: n(r.hamali_Rate),
      taxMode: ['IGST', 'GST', 'NA'].includes(s(r.STaxRemark).toUpperCase()) ? s(r.STaxRemark).toUpperCase() : 'NA',
      igstRate: s(r.STaxRemark).toUpperCase() === 'IGST' ? n(r.s_tax) : 0,
      cgstRate: n(r.CGST_Tax),
      sgstRate: n(r.SGST_Tax),
      isGta: s(r.IsGta), isCourier: s(r.IsCourier), isReg: s(r.IsReg),
      charges: {
        risk: n(r.risk_charge), handling: n(r.handling_charge), dod: n(r.dod_dac_charge), service: n(r.service_charge),
        ocs: n(r.ocs), oda: n(r.oda), delivery: n(r.dly), collection: n(r.collection_charges), logistics: n(r.Logistic_charges),
        fov: n(r.fov), halting: n(r.HaltingChrg), stationary: n(r.Stationary), topay: n(r.TopayCharge ?? r.ToPayCharge),
        loading: n(r.LoadingCharge), unloading: n(r.UnLoadingCharge), hamali: n(r.hamali_charge),
        statistical: n(r.StatisticalCharges), localCartage: n(r.LocalCartage), pf: n(r.PFCharges),
      },
    },
    invoices: inv.recordset.map((x) => ({
      invoiceNo: s(x.InvoiceNo), invoiceDate: d(x.InvoiceDate), invoiceValue: n(x.InvoiceValue), netInvoiceValue: n(x.NetInoviceValue),
      partNo: s(x.PartNo), itemDescription: s(x.ItemDescription), packets: n(x.Packet), quantity: n(x.Quantity),
      eWayBill: s(x.EWayBill), eWayBillDate: d(x.EWayBillDate), eWayBillValidDate: d(x.EWayBillValidDate),
    })),
    insurance: ins.recordset.map((x) => ({
      riskAt: s(x.Risk_at), policyNo: s(x.Policy_no), policyDate: d(x.Policy_date), insCompany: s(x.Ins_company), privateMark: s(x.Private_mark),
    })),
    dimensions: dim.recordset.map((x) => ({
      packets: n(x.packet), length: n(x.lenght), width: n(x.width), height: n(x.height), totalCft: n(x.total_cft),
      perCft: n(x.percft), chargeWeight: n(x.packet_chargeweight), actualWeight: n(x.actual_weight), weightType: s(x.WtType),
    })),
    additionalCharges: add.recordset.map((x) => ({ code: s(x.chargeid), name: s(x.charge_name), days: n(x.noofdays), amount: n(x.charge_amount) })),
    additionalChargesTax: addTax.recordset.map((x) => ({ code: s(x.chargeid), name: s(x.charge_name), days: n(x.noofdays), amount: n(x.charge_amount) })),
    international,
  };
}

export async function tracking(docketNo, user) {
  const { recordset } = await exec('Get_TrackingDetails', { DocketNo: docketNo, Division: user.divCode });
  return recordset;
}
