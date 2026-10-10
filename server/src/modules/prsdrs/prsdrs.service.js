// PRS / DRS Rate Master — port of Rate/PRS_and_DRS_Rate_Master.aspx (PRS_and_DRS_RATE_MASTER_DAL, Sp_Insert_Prs_and_Drs_Rate).
//
// What a pickup (PRS) / delivery (DRS) vehicle is paid — an outside vendor or an own ("Self") vehicle — by vehicle
// (FTL) type, from an effective date. Three ways (ddlrateon):
//   * Per Km      — a rate per km (Fix_Km_Rate); fixed km, extra km rate and per kg are 0;
//   * Per Kg      — a rate per kg (Per_Kg); the km fields are 0;
//   * Round Trip  — a fixed amount (Fix_Km_Rate) for the first Fix_Km km, then Extra_Km_Rate per extra km.
// ("Monthly" is commented out on the page.) The PRS / DRS challan will read it (Operation pages, not ported yet).
//
// Changes from the page (docs/MIGRATION.md):
//   * the fields the page disabled for a rate-on are forced to 0 here (a Round Trip left Per Kg empty, so
//     float.Parse threw and the save silently did nothing);
//   * the effective date is checked against the financial year (as the page did) and may not be in the past;
//   * the same vendor + rate on + FTL type + effective date is refused (the page saved duplicates);
//   * the vendor must be of the picked type and in the user's division.
import { exec, query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../middleware/errors.js';
import { financialYearRange } from '../../utils/legacy.js';
import { s, n, iso, today } from '../../utils/values.js';

// ddlvendtype (value → vendors_master.vendor_type text, saved as Vendor_Type)
export const VENDOR_TYPES = { VENDOR: 'Vendor', SELF: 'Self' };
// ddlrateon (text is what the page saved in Rate_On)
export const RATE_ON = ['Per Km', 'Per Kg', 'Round Trip'];

// ------------------------------------------------------------------ pickers

export async function options() {
  const ftl = await query("select container_code, freight_name from freight_master where isnull(active_flag, 'Active') = 'Active' order by freight_name");
  return {
    vendorTypes: Object.entries(VENDOR_TYPES).map(([value, label]) => ({ value, label })),
    rateOn: RATE_ON.map((r) => ({ value: r, label: r })),
    ftlTypes: ftl.map((r) => ({ value: s(r.freight_name), label: s(r.freight_name) })),
  };
}

/** Bind_Vendor_master(type): active vendors of the type in the user's division (admin: all divisions). */
export async function vendors(user, type) {
  const rows = await query(
    `select vendor_code, Name from vendors_master
      where vendor_type = @t and isnull(active_flag, 1) = 1 and (@div = '' or DivCode like '%' + @div + '%')
      order by Name`, { t: VENDOR_TYPES[type], div: s(user.divCode) });
  return rows.map((r) => ({ value: s(r.vendor_code), label: `${s(r.Name)} : ${s(r.vendor_code)}` }));
}

/** Check_Effective_Date: the latest effective date already saved for the vendor + rate on (txtprveffectdate). */
export async function previousDate(vendor, rateOn) {
  const [r] = await query(
    'select max(Effective_Date) as d from PRS_DRS_RATE_MASTER where Vendor_Code = @v and Rate_On = @r', { v: vendor, r: rateOn });
  return { previousEffectiveDate: iso(r?.d) };
}

// ------------------------------------------------------------------ list / get

const SELECT = `
  select p.*, vm.Name as vendor_name
    from PRS_DRS_RATE_MASTER p
    left join vendors_master vm on vm.vendor_code = p.Vendor_Code`;

const mapRow = (r) => ({
  id: Number(r.Slno),
  vendorType: s(r.Vendor_Type),
  vendor: s(r.Vendor_Code),
  vendorName: s(r.vendor_name),
  rateOn: s(r.Rate_On),
  ftlType: s(r.FTL_Type),
  fixKm: n(r.Fix_Km),
  fixKmRate: n(r.Fix_Km_Rate),
  extraKmRate: n(r.Extra_Km_Rate),
  perKg: n(r.Per_Kg),
  effectiveDate: iso(r.Effective_Date),
  createdBy: s(r.Created_By),
});

/** Bind_Grid_View; `inForce` marks the rate a challan made today would use (per vendor + rate on + FTL type). */
export async function listRates({ vendorType = '', vendor = '', rateOn = '' } = {}) {
  const rows = (await query(
    `${SELECT}
      where (@vt = '' or p.Vendor_Type = @vt) and (@v = '' or p.Vendor_Code = @v) and (@r = '' or p.Rate_On = @r)
      order by vm.Name, p.Rate_On, p.FTL_Type, p.Effective_Date desc, p.Slno desc`,
    { vt: vendorType ? VENDOR_TYPES[vendorType] : '', v: vendor, r: rateOn })).map(mapRow);
  const key = (r) => `${r.vendor}|${r.rateOn}|${r.ftlType}`;
  const inForce = new Map();
  for (const r of rows) if (r.effectiveDate <= today() && !inForce.has(key(r))) inForce.set(key(r), r.id);
  return rows.map((r) => ({ ...r, inForce: inForce.get(key(r)) === r.id, upcoming: r.effectiveDate > today() }));
}

export async function getRate(id) {
  const [r] = await query(`${SELECT} where p.Slno = @id`, { id });
  if (!r) throw notFound('PRS / DRS rate not found');
  return mapRow(r);
}

// ------------------------------------------------------------------ create

/** The amounts the rate-on uses; the rest are 0 (the page disabled them). */
function amounts(body) {
  const a = { fixKm: 0, fixKmRate: 0, extraKmRate: 0, perKg: 0 };
  if (body.rateOn === 'Per Km') {
    if (!(body.fixKmRate > 0)) throw badRequest('Enter the rate per km');
    a.fixKmRate = body.fixKmRate;
  } else if (body.rateOn === 'Per Kg') {
    if (!(body.perKg > 0)) throw badRequest('Enter the rate per kg');
    a.perKg = body.perKg;
  } else {
    if (!(body.fixKm > 0)) throw badRequest('Enter the fixed km');
    if (!(body.fixKmRate > 0)) throw badRequest('Enter the fixed km amount');
    Object.assign(a, { fixKm: body.fixKm, fixKmRate: body.fixKmRate, extraKmRate: body.extraKmRate ?? 0 });
  }
  return a;
}

export async function createRate(user, body) {
  // btnsubmit_Click: "Date should be exist in current financial year.!"
  const fy = financialYearRange(user.financialYear);
  if (fy && (body.effectiveDate < fy.from || body.effectiveDate > fy.to)) {
    throw badRequest(`The effective date should be in the financial year ${user.financialYear}`);
  }
  if (body.effectiveDate < today()) throw badRequest('The effective date cannot be in the past');
  const a = amounts(body);
  if (!(await vendors(user, body.vendorType)).some((v) => v.value === body.vendor)) {
    throw badRequest(`Select a ${VENDOR_TYPES[body.vendorType].toLowerCase()} vendor of your division`);
  }
  const ftlOk = (await options()).ftlTypes.some((f) => f.value === body.ftlType);
  if (!ftlOk) throw badRequest('Select the FTL type');

  return withTransaction(async (tx) => {
    const [dup] = await query(
      `select top 1 Slno from PRS_DRS_RATE_MASTER with (updlock, holdlock)
        where Vendor_Code = @v and Rate_On = @r and FTL_Type = @f and Effective_Date = @d`,
      { v: body.vendor, r: body.rateOn, f: body.ftlType, d: body.effectiveDate }, { tx });
    if (dup) throw conflict(`A ${body.rateOn} rate for this vendor and ${body.ftlType} from ${body.effectiveDate} already exists`);
    const { recordset } = await exec('Sp_Insert_Prs_and_Drs_Rate', {
      Vend_Type: VENDOR_TYPES[body.vendorType], Vend_Code: body.vendor, Rat_On: body.rateOn,
      Fix_Km: a.fixKm, Fix_Km_rate: a.fixKmRate, Extra_Km_Rate: a.extraKmRate, Per_Kg: a.perKg,
      Effective_Date: body.effectiveDate, Created_By: user.userId, FTL_Type: body.ftlType,
    }, {}, { tx });
    const id = Number(recordset?.[0]?.Slno);
    return { id, message: `${body.rateOn} rate saved — from ${body.effectiveDate}` };
  });
}
