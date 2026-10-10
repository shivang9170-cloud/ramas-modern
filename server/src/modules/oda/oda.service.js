// ODA Charge master — port of Rate/ODA_Charge.aspx (ODA_Charge_bal / _dal, inline SQL in the DLL).
//
// For a location (picked branch → city → location, as on the page) the ODA ("out of delivery area") charge by weight
// band: 0–100, 101–200, 201–300, 301–400, 401–500, 501–1000 and over 1000 kg, with the distance, from an effective
// date. The docket's ODA box is filled from it (docket.service.js odaCharge → usp_Get_OdaRate).
//
// Changes from the page (docs/MIGRATION.md):
//   * a new rate for a location is a new version; the older ones stay (the page switched them off at once —
//     Update_Status_If_Exists — so a location had no ODA charge until the new, future, effective date came);
//   * the "already exists" check was on the location + effective date, but the page still saved when the effective
//     date was not in the future (it only showed a message) — both are refused now;
//   * the ODA code (ODC…) is numbered inside the save's transaction.
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../middleware/errors.js';
import { s, n, iso, today } from '../../utils/values.js';

// API band name → column, in weight order
export const BANDS = {
  upTo100: 'Till_1H_Kg', upTo200: 'Till_2H_Kg', upTo300: 'Till_3H_Kg', upTo400: 'Till_4H_Kg',
  upTo500: 'Till_5H_Kg', upTo1000: 'Till_1T_Kg', above1000: 'Above_1T_Kg',
};

// ------------------------------------------------------------------ pickers (ddlbranch → ddlCity → ddlLocation)

export async function branches() {
  const rows = await query("select branch_code, branch_name from branch_master where status = 'Active' order by branch_name");
  return rows.map((r) => ({ value: s(r.branch_code), label: `${s(r.branch_name)} : ${s(r.branch_code)}` }));
}

/** Cities served by a branch (the page's Select_City by city_master.BindTo; the branch's own city as well). */
export async function cities(branch) {
  const rows = await query(
    `select c.city_code, c.city_name from city_master c
      where c.active_flag = 'Active'
        and (c.BindTo = @b or c.city_code = (select city_code from branch_master where branch_code = @b))
      order by c.city_name`, { b: branch });
  return rows.map((r) => ({ value: s(r.city_code), label: s(r.city_name) }));
}

export async function locations(city) {
  const rows = await query(
    `select Location_Code, Location_Name from New_Location_master
      where City_Code = @c and isnull(IsActinve_Flag, 'Active') = 'Active' order by Location_Name`, { c: city });
  return rows.map((r) => ({ value: s(r.Location_Code), label: s(r.Location_Name) }));
}

// ------------------------------------------------------------------ list / get

const SELECT = `
  select od.*, bm.branch_name, cm.city_name, nlm.Location_Name, zm.zone_name
    from ODA_Charge od
    left join Branch_Master bm on bm.branch_code = od.Branch_Code
    left join city_master cm on cm.city_code = od.City_Code
    left join New_Location_master nlm on nlm.Location_Code = od.Location_Code
    left join zone_master zm on zm.zone_code = od.Zone_Code`;

const mapRow = (r) => ({
  id: Number(r.ID),
  code: s(r.ODA_Code),
  branch: s(r.Branch_Code),
  branchName: s(r.branch_name),
  city: s(r.City_Code),
  cityName: s(r.city_name),
  location: s(r.Location_Code),
  locationName: s(r.Location_Name),
  zone: s(r.Zone_Code),
  zoneName: s(r.zone_name),
  distance: n(r.Distance),
  charges: Object.fromEntries(Object.entries(BANDS).map(([k, col]) => [k, n(r[col])])),
  effectiveDate: iso(r.Effective_Date),
  active: Boolean(r.Status),
});

/** ODA rates; `inForce` marks the one a docket booked today would use (per location). */
export async function listRates({ branch = '', city = '', location = '', status = 'all' } = {}) {
  const rows = (await query(
    `${SELECT}
      where (@b = '' or od.Branch_Code = @b) and (@c = '' or od.City_Code = @c) and (@l = '' or od.Location_Code = @l)
        and (@st = 'all' or od.Status = case when @st = 'active' then 1 else 0 end)
      order by nlm.Location_Name, od.Effective_Date desc, od.ID desc`,
    { b: branch, c: city, l: location, st: status })).map(mapRow);
  const inForce = new Map();
  for (const r of rows) {
    if (r.active && r.effectiveDate <= today() && !inForce.has(r.location)) inForce.set(r.location, r.id);
  }
  return rows.map((r) => ({ ...r, inForce: inForce.get(r.location) === r.id, upcoming: r.active && r.effectiveDate > today() }));
}

export async function getRate(id) {
  const [r] = await query(`${SELECT} where od.ID = @id`, { id });
  if (!r) throw notFound('ODA rate not found');
  return mapRow(r);
}

// ------------------------------------------------------------------ create / status

export async function createRate(user, body) {
  // imgbtnSave_Click / saveRecord: "Effective Date Should Be Grater Than Current Date!"
  if (body.effectiveDate <= today()) throw badRequest('The effective date should be after today');
  const [loc] = await query(
    `select nlm.Location_Code, nlm.City_Code, cm.zone_code from New_Location_master nlm
       join city_master cm on cm.city_code = nlm.City_Code
      where nlm.Location_Code = @l and isnull(nlm.IsActinve_Flag, 'Active') = 'Active'`, { l: body.location });
  if (!loc) throw badRequest('Select the location');
  if (s(loc.City_Code) !== body.city) throw badRequest('The location is not in the selected city');
  const cityOk = (await cities(body.branch)).some((c) => c.value === body.city);
  if (!cityOk) throw badRequest('The city is not served by the selected branch');

  return withTransaction(async (tx) => {
    // "Record Already Exists!" — the same location and effective date
    const [dup] = await query(
      `select top 1 ODA_Code from ODA_Charge with (updlock, holdlock) where Location_Code = @l and Effective_Date = @d`,
      { l: body.location, d: body.effectiveDate }, { tx });
    if (dup) throw conflict(`An ODA rate for this location from ${body.effectiveDate} already exists (${s(dup.ODA_Code)})`);
    const [mx] = await query(
      `select max(try_cast(substring(ODA_Code, 4, 20) as int)) as mx from ODA_Charge with (updlock, holdlock) where ODA_Code like 'ODC%'`,
      {}, { tx });
    const code = `ODC${String((Number(mx?.mx) || 0) + 1).padStart(4, '0')}`;
    const cols = Object.values(BANDS);
    const [row] = await query(
      `insert into ODA_Charge(ODA_Code, Branch_Code, City_Code, Location_Code, Zone_Code, Distance, ${cols.join(', ')},
         Effective_Date, Status, Login_User)
       output inserted.ID
       values (@code, @branch, @city, @loc, @zone, @distance, ${cols.map((c) => `@${c}`).join(', ')}, @eff, 1, @user)`,
      {
        code, branch: body.branch, city: body.city, loc: body.location, zone: s(loc.zone_code), distance: body.distance,
        ...Object.fromEntries(Object.entries(BANDS).map(([k, col]) => [col, body.charges[k]])),
        eff: body.effectiveDate, user: user.userId,
      }, { tx });
    return { id: Number(row.ID), code, message: `ODA rate ${code} saved — from ${body.effectiveDate}` };
  });
}

export async function setStatus(id, active) {
  const r = await getRate(id);
  await query('update ODA_Charge set Status = @s where ID = @id', { s: active ? 1 : 0, id });
  return { id, message: `ODA rate ${r.code} ${active ? 'activated' : 'switched off'}` };
}
