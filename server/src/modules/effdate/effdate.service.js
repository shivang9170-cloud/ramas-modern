// Effective date change — port of Setting/EffectiveDateChange.aspx and Setting/ClientRateMasterEffectiveDateMmodification.aspx.
//
// Moves the effective date of saved rates: client contract rates (Credit per client, Paid / To Pay general rows) of the
// four contract types, and PRS / DRS vendor rates. The first page listed rates not yet in force (effective date from
// today) and pushed their dates; the second back-dated a rate (not after today, not before its start date). One page
// now does both: pick the rates, give the new date.
//
// Changes from the pages (docs/MIGRATION.md "Settings"):
//   * the new date must lie inside the contract's start / end dates (the first page did not check; the second only
//     checked the start date) and may not clash with another version of the same rate on that date (both pages saved
//     duplicates that docket booking could not tell apart);
//   * all selected rates change in one transaction; slnos are parameters (they were concatenated into the SQL);
//   * the second page's full contract edit (amounts and charges) is on the Client Contract page already;
//   * vendor road rates (vendor_road_rate_master) wait for the Vendor Road Rate Master port.
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict } from '../../middleware/errors.js';
import { TYPES, listContracts } from '../contracts/contracts.service.js';
import { financialYearRange } from '../../utils/legacy.js';
import { s, n, iso, today } from '../../utils/values.js';

// ------------------------------------------------------------------ client contract rates

/** bind_client: clients with contract rates in the division. */
export async function clients(user) {
  const rows = (await listContracts(user, { rateType: 'Credit' })).filter((c) => c.clientCode);
  const seen = new Map();
  for (const c of rows) if (!seen.has(c.clientCode)) seen.set(c.clientCode, c.clientName);
  return [...seen].map(([value, name]) => ({ value, label: `${name} : ${value}` })).sort((a, b) => a.label.localeCompare(b.label));
}

/** ViewClientContract(client) / uspViewClientContract_V: active rates; `upcoming` = not in force yet. */
export async function clientRates(user, { rateType, client = '', scope = 'upcoming' }) {
  if (rateType === 'Credit' && !client) throw badRequest('Select client');
  const rows = await listContracts(user, { rateType, client: rateType === 'Credit' ? client : '', status: 'active' });
  return rows
    .filter((c) => (rateType === 'Credit' ? c.clientCode === client : !c.clientCode))
    .filter((c) => scope === 'all' || c.effectiveFrom >= today())
    .map((c) => ({
      key: `${c.type}:${c.id}`, type: c.type, typeLabel: c.typeLabel, id: c.id, entRef: c.entRef, clientName: c.clientName,
      originName: c.originName, destinationName: c.destinationName, modeName: c.modeName, rateOn: c.rateOn,
      rate: c.rateOn === 'FTL' ? c.ftlRate : c.rateOn === 'FREIGHT' ? c.freight : c.rate,
      startDate: c.startDate, endDate: c.endDate, effectiveFrom: c.effectiveFrom,
    }));
}

/** btn_update_Click / btnUpdateAll_Click for client rates. */
export async function changeClientRates(user, { rows, effectiveFrom }) {
  return withTransaction(async (tx) => {
    for (const { type, id } of rows) {
      const t = TYPES[type];
      const [r] = await query(`select * from ${t.table} with (updlock, holdlock) where slno = @id and isnull(Division, @div) = @div`,
        { id, div: s(user.divCode) }, { tx });
      if (!r) throw badRequest(`${t.label} rate ${id} not found in this division`);
      if (s(r.status) !== 'Active') throw badRequest(`${s(r.EntRef)}: the rate is not active`);
      const start = iso(r.start_date);
      const end = iso(r.end_date);
      if (effectiveFrom < start) throw badRequest(`${s(r.EntRef)}: the effective date should not be before the start date (${start})`);
      if (end && effectiveFrom > end) throw badRequest(`${s(r.EntRef)}: the effective date should not be after the end date (${end})`);
      const [dup] = await query(
        `select top 1 EntRef from ${t.table}
          where slno <> @id and isnull(client_code, '') = @client and isnull(billingat, '') = @billing and ${t.o} = @o and ${t.d} = @d
            and mode_id = @m and isnull(delivery_mode, '') = @dm and rate_on = @ro and isnull(ftl_type, '') = @ft
            and isnull(LoadType, '') = @lt and isnull(nullif(RateType, ''), 'Credit') = @rt and effective_from = @eff
            and isnull(Division, @div) = @div`,
        { id, client: s(r.client_code), billing: s(r.billingat), o: s(r[t.o]), d: s(r[t.d]), m: s(r.mode_id), dm: s(r.delivery_mode),
          ro: s(r.rate_on), ft: s(r.ftl_type), lt: s(r.LoadType), rt: s(r.RateType) || 'Credit', eff: effectiveFrom, div: s(user.divCode) }, { tx });
      if (dup) throw conflict(`${s(r.EntRef)}: another version of this rate already starts on ${effectiveFrom} (${s(dup.EntRef)})`);
      await query(`update ${t.table} set effective_from = @eff where slno = @id`, { eff: effectiveFrom, id }, { tx });
    }
    return { updated: rows.length, message: `Effective date of ${rows.length} rate(s) changed to ${effectiveFrom}` };
  });
}

// ------------------------------------------------------------------ PRS / DRS vendor rates

/** fillddlVendorName: vendors with PRS / DRS rates. */
export async function vendors() {
  const rows = await query(
    `select distinct p.Vendor_Code, vm.Name from PRS_DRS_RATE_MASTER p join vendors_master vm on vm.vendor_code = p.Vendor_Code order by vm.Name`);
  return rows.map((r) => ({ value: s(r.Vendor_Code), label: `${s(r.Name)} : ${s(r.Vendor_Code)}` }));
}

export async function vendorRates({ vendor, scope = 'upcoming' }) {
  const rows = await query(
    `select p.*, vm.Name from PRS_DRS_RATE_MASTER p left join vendors_master vm on vm.vendor_code = p.Vendor_Code
      where p.Vendor_Code = @v and (@scope = 'all' or p.Effective_Date >= cast(getdate() as date))
      order by p.Rate_On, p.FTL_Type, p.Effective_Date desc`, { v: vendor, scope });
  return rows.map((r) => ({
    id: Number(r.Slno), vendorName: s(r.Name), vendorType: s(r.Vendor_Type), rateOn: s(r.Rate_On), ftlType: s(r.FTL_Type),
    fixKm: n(r.Fix_Km), fixKmRate: n(r.Fix_Km_Rate), extraKmRate: n(r.Extra_Km_Rate), perKg: n(r.Per_Kg), effectiveDate: iso(r.Effective_Date),
  }));
}

/** Update PRS_DRS_RATE_MASTER set Effective_Date … — inside the login financial year, no clash with another version. */
export async function changeVendorRates(user, { ids, effectiveDate }) {
  const fy = financialYearRange(user.financialYear);
  if (fy && (effectiveDate < fy.from || effectiveDate > fy.to)) throw badRequest(`The effective date should be in the financial year ${user.financialYear}`);
  return withTransaction(async (tx) => {
    for (const id of ids) {
      const [r] = await query('select * from PRS_DRS_RATE_MASTER with (updlock, holdlock) where Slno = @id', { id }, { tx });
      if (!r) throw badRequest(`PRS / DRS rate ${id} not found`);
      const [dup] = await query(
        `select top 1 Slno from PRS_DRS_RATE_MASTER where Slno <> @id and Vendor_Code = @v and Rate_On = @ro and isnull(FTL_Type, '') = @f and Effective_Date = @d`,
        { id, v: s(r.Vendor_Code), ro: s(r.Rate_On), f: s(r.FTL_Type), d: effectiveDate }, { tx });
      if (dup) throw conflict(`${s(r.Rate_On)} ${s(r.FTL_Type)}: another rate of this vendor already starts on ${effectiveDate}`);
      await query('update PRS_DRS_RATE_MASTER set Effective_Date = @d where Slno = @id', { d: effectiveDate, id }, { tx });
    }
    return { updated: ids.length, message: `Effective date of ${ids.length} rate(s) changed to ${effectiveDate}` };
  });
}
