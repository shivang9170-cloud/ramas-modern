// Branch Master — port of wwwroot/Master/Branch_Master.aspx(.cs) and ClassLibrary/dal/Branch_Master_Dal.cs.
//
// Saving a branch also binds its four ledgers for every division it works in
// (GeneralMethods.AutoBindLedger): "CASH <NAME>" (Cash In Hand), "TOPAY RECOVERY :<NAME> :<CODE>",
// "PAID RECOVERY :<NAME> :<CODE>" and "<NAME> :<CODE>" (Branch / Divisions). Challans need the
// CASH ledger, so a branch without it cannot pay an own-fleet advance.
//
// Fixed legacy bugs (docs/SECURITY.md):
//   * the short-code uniqueness check ran the branch-NAME query (cmd1 instead of cmd2), so two
//     branches could get the same short code — and the short code is part of every document
//     number (PS/ME/CTH/AE/DS…), so their numbers collided; now enforced on create and edit;
//   * the branch code was generated when the page opened (race) — now inside the save transaction;
//   * editing always set the company to the 2nd item of the list (ddlCompForEdit.SelectedIndex = 1)
//     and showed a debug popup "Location = …" — gone;
//   * the first branch in the controlling-branch list could never be picked (index 0 was treated
//     as "not selected");
//   * delete had no "in use" check — now refused while dockets, employees, branches, challans
//     etc. refer to the branch (deactivate it instead);
//   * the insert and the four ledger bindings ran separately — now one transaction;
//   * SQL built from typed values (name search, location check, state → cities) — parameters.

import { exec, query, sql, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound, HttpError } from '../../middleware/errors.js';
import { s } from '../../utils/values.js';
import { groupNameForSection } from '../books/posting.js';

const truthy = (v) => ['1', 'true', 'yes'].includes(s(v).toLowerCase());
const unprocessable = (msg) => new HttpError(422, msg);

// ------------------------------------------------------------------ lookups

export async function options() {
  const [companies, states, divisions, branches] = await Promise.all([
    query('select CCode, CName from CompanyMster order by CName'),
    query("select state_code, state_name, Gstin_No from state_master where active_flag = 'Active' order by state_name"),
    query('select DivCode, DivName from DivisionMaster where isnull(IsActive, 1) = 1 order by DivCode'),
    query("select branch_code, branch_name from branch_master where status = 'Active' order by branch_name"),
  ]);
  return {
    companies: companies.map((c) => ({ value: s(c.CCode), label: s(c.CName) })),
    states: states.map((x) => ({ value: s(x.state_code), label: s(x.state_name), gstin: s(x.Gstin_No) })),
    divisions: divisions.map((d) => ({ value: s(d.DivCode), label: s(d.DivName) })),
    branches: branches.map((b) => ({ value: s(b.branch_code), label: `${s(b.branch_name)} : ${s(b.branch_code)}` })),
  };
}

export async function cities(state) {
  const rows = await query(
    "select city_code, city_name, zone_code from city_master where state_code = @s and active_flag = 'Active' order by city_name", { s: state });
  return rows.map((c) => ({ value: s(c.city_code), label: s(c.city_name) }));
}

export async function locations(city) {
  const rows = await query(
    `select l.Location_Code, l.Location_Name, l.Pin_Code, b.branch_code, b.branch_name
       from New_Location_master l left join branch_master b on b.location = l.Location_Code
      where l.City_Code = @c and isnull(l.IsActinve_Flag, 'Active') = 'Active' order by l.Location_Name`, { c: city });
  return rows.map((l) => ({
    value: s(l.Location_Code), label: s(l.Location_Name), pinCode: s(l.Pin_Code),
    linkedTo: l.branch_code ? `${s(l.branch_name)} : ${s(l.branch_code)}` : '',
    linkedCode: s(l.branch_code),
  }));
}

// ------------------------------------------------------------------ list / get

const mapBranch = (r) => ({
  code: s(r.branch_code),
  name: s(r.branch_name),
  shortCode: s(r.short_code),
  contactPerson: s(r.contact_person),
  address: s(r.address),
  place: s(r.place),
  stateCode: s(r.state_code),
  state: s(r.state_name),
  cityCode: s(r.city_code),
  city: s(r.city_name),
  zoneCode: s(r.zone_code),
  location: s(r.location),
  locationName: s(r.Location_Name),
  email: s(r.email),
  phone: s(r.phone),
  fax: s(r.fax),
  remarks: s(r.remarks),
  gstin: s(r.Branch_Gstin_no),
  company: s(r.company),
  companyName: s(r.CName),
  controllingBranch: s(r.ControllingBranch),
  controllingBranchName: s(r.ControllingBrnachName),
  sapCode: s(r.SapCode),
  manualCode: s(r.Manual_code),
  maxLimit: s(r.maxlimit),
  divisions: s(r.Division).split(',').map((d) => d.trim()).filter(Boolean),
  active: s(r.status) === 'Active',
  isHub: truthy(r.IsHub),
  isMasterFranchisee: truthy(r.IsMasterFranchisee),
  isFranchisee: truthy(r.IsFranchisee),
  docketAutoNumber: truthy(r.isDocketAutoInc),
});

export async function listBranches(user, { q = '', status = 'all' } = {}) {
  const { recordset } = await exec('sp_select_Branch_Master_Details_WithDivision', { division: user.divCode });
  const term = q.toUpperCase();
  return recordset.map(mapBranch)
    .filter((b) => !term || b.name.includes(term) || b.code.includes(term) || b.shortCode.includes(term) || b.city.includes(term))
    .filter((b) => status === 'all' || (status === 'active' ? b.active : !b.active));
}

export async function getBranch(user, code) {
  const row = (await listBranches(user)).find((b) => b.code === code);
  if (!row) throw notFound(`Branch ${code} not found in this division`);
  return row;
}

// ------------------------------------------------------------------ validation shared by create / update

async function validate(body, code = null, user = null) {
  if (user && body.divisions.length) {
    if (!body.divisions.includes(user.divCode)) throw badRequest('Keep your own division ticked, or the branch leaves your list');
    const known = new Set((await query('select DivCode from DivisionMaster')).map((d) => s(d.DivCode)));
    const unknown = body.divisions.filter((d) => !known.has(d));
    if (unknown.length) throw badRequest(`Unknown division(s): ${unknown.join(', ')}`);
  }
  const [city] = await query('select city_code, state_code, zone_code from city_master where city_code = @c', { c: body.cityCode });
  if (!city) throw badRequest('Select city');
  if (s(city.state_code) !== body.stateCode) throw badRequest('The city does not belong to the selected state');

  const p = { name: body.name, city: body.cityCode, sc: body.shortCode, code: code ?? '' };
  const [dupName] = await query(
    'select top 1 branch_code from branch_master where branch_name = @name and branch_code <> @code', p);
  if (dupName) throw conflict(`Branch name already exists (${s(dupName.branch_code)})`);
  const [dupShort] = await query(
    'select top 1 branch_code, branch_name from branch_master where short_code = @sc and branch_code <> @code', p);
  if (dupShort) throw conflict(`Short code already exists (${s(dupShort.branch_name)} : ${s(dupShort.branch_code)})`);

  if (body.location) {
    const [loc] = await query('select City_Code from New_Location_master where Location_Code = @l', { l: body.location });
    if (!loc || s(loc.City_Code) !== body.cityCode) throw badRequest('The location does not belong to the selected city');
    const [linked] = await query(
      "select top 1 branch_name + ' : ' + branch_code as b from branch_master where location = @l and branch_code <> @code",
      { l: body.location, code: code ?? '' });
    if (linked) throw conflict(`There is already a branch linked to this location (${s(linked.b)})`);
  }
  const [company] = await query('select CCode from CompanyMster where CCode = @c', { c: body.company });
  if (!company) throw badRequest('Select company');
  if (body.controllingBranch !== code) {
    const [cb] = await query('select branch_code from branch_master where branch_code = @b', { b: body.controllingBranch });
    if (!cb) throw badRequest('Select controlling branch');
  }
  return { zone: s(city.zone_code) };
}

/** GeneralMethods.AutoBindLedger x 4 per division (inside the caller's transaction). */
async function bindLedgers(user, tx, code, name, divisions) {
  const ledgers = [
    [`CASH ${name}`, await groupNameForSection('CASH', tx)],   // the chart's cash group (legacy name "Cash In Hand")
    [`TOPAY RECOVERY :${name} :${code}`, 'TO PAY RECOVERY'],
    [`PAID RECOVERY :${name} :${code}`, 'PAID RECOVERY'],
    [`${name} :${code}`, 'Branch / Divisions'],
  ];
  const createdDate = `${String(user.financialYear).slice(0, 4)}-04-01`;
  for (const div of divisions) {
    for (const [ledger, group] of ledgers) {
      const res = await exec('usp_AutoBindLedger', {
        LedgerName: ledger, GroupName: group, VendorOrClientCode: null, DrCr: 'Dr', Ledger_Type: 'Ledger',
        CreatedDate: createdDate, Branch_Code: code, Emp_Code: user.userId, Financial_Year: user.financialYear, division: div,
      }, { status: [sql().VarChar(500), null] }, { tx });
      if (s(res.output.status).toLowerCase() !== 'success') throw unprocessable(`Ledger "${ledger}" could not be created: ${s(res.output.status)}`);
    }
  }
}

// ------------------------------------------------------------------ create / update / delete

export async function createBranch(user, body) {
  const { zone } = await validate(body, null, user);
  const divisions = body.divisions.length ? body.divisions : [user.divCode];
  const code = await withTransaction(async (tx) => {
    // get_id("branch_master", ..., "B"): B + next number, under a lock.
    const [m] = await query(
      `select max(cast(substring(branch_code, 2, 20) as int)) as mx from branch_master with (updlock, holdlock)
        where branch_code like 'B%' and isnumeric(substring(branch_code, 2, 20)) = 1`, {}, { tx });
    const next = `B${Math.max(Number(m?.mx) || 1000, 1000) + 1}`;
    const res = await exec('sp_insert_Branch_master_details', {
      branchid: 0, branch_code: next, branch_name: body.name, contactperson: body.contactPerson, address: body.address,
      state_code: body.stateCode, city_code: body.cityCode, zone_code: zone, email: body.email, phone: body.phone, fax: body.fax,
      remarks: body.remarks, Ishub: body.isHub, status: body.active ? 'Active' : 'Deactive', Company: body.company,
      ControllingBranch: body.controllingBranch || next, IsWarehouse: body.isMasterFranchisee, IsFranchisee: body.isFranchisee,
      User_ID: user.userId, LastUpdate: new Date(), Branch_Gstin_no: body.gstin, location: body.location, ShortCode: body.shortCode,
      SapCode: body.sapCode, ManualCode: body.manualCode, primary_address: '', place: body.place, maxlimit: body.maxLimit,
      Division: divisions.join(','), isDocketAutoInc: body.docketAutoNumber,
    }, { retval: [sql().Int, null] }, { tx });
    if (Number(res.output.retval) !== 1) throw unprocessable('Branch could not be saved');
    await bindLedgers(user, tx, next, body.name, divisions);
    return next;
  });
  return { code, message: `Branch ${body.name} : ${code} saved` };
}

export async function updateBranch(user, code, body) {
  const current = await getBranch(user, code);
  const { zone } = await validate(body, code, user);
  if (!body.active && current.active) {
    const [child] = await query(
      "select top 1 branch_name + ' : ' + branch_code as b from branch_master where ControllingBranch = @c and branch_code <> @c and status = 'Active'",
      { c: code });
    if (child) throw conflict(`Branch is the controlling branch of ${s(child.b)} — it cannot be deactivated`);
  }
  const divisions = body.divisions.length ? body.divisions : current.divisions;
  await withTransaction(async (tx) => {
    await exec('sp_Update_Branch_Master_Details', {
      branch_code: code, branch_name: body.name, contactperson: body.contactPerson, address: body.address, state_code: body.stateCode,
      city_code: body.cityCode, zone_code: zone, email: body.email, phone: body.phone, fax: body.fax, remarks: body.remarks,
      ishub: body.isHub, IsWarehouse: body.isMasterFranchisee, IsFranchisee: body.isFranchisee, status: body.active ? 'Active' : 'Deactive',
      Company: body.company, ControllingBranch: body.controllingBranch || code, Edit_By: user.userId,
      Edit_Date: new Date().toISOString().slice(0, 10), Branch_Gstin_No: body.gstin, Short_Code: body.shortCode, SapCode: body.sapCode,
      ManualCode: body.manualCode, location: body.location, primary_address: '', place: body.place, maxlimit: body.maxLimit,
      Division: divisions.join(','), isDocketAutoInc: body.docketAutoNumber,
    }, {}, { tx });
    await bindLedgers(user, tx, code, body.name, divisions);
  });
  return { code, message: `Branch ${body.name} : ${code} updated` };
}

// Tables that refer to a branch (a deleted branch would orphan them).
const IN_USE = [
  ['dockets booked from or to it', 'select top 1 1 as x from grn_master where origin_branch = @c or destination_branch = @c'],
  ['employees', 'select top 1 1 as x from employee_master where branch = @c'],
  ['branches it controls', 'select top 1 1 as x from branch_master where ControllingBranch = @c and branch_code <> @c'],
  ['manifests', 'select top 1 1 as x from mainfest_entry where from_branch = @c or to_branch = @c'],
  ['challans', 'select top 1 1 as x from dispatch_master where from_branch = @c or tobcode = @c'],
  ['pickups', 'select top 1 1 as x from Pick_up_entry where from_branch = @c'],
  ['routes', 'select top 1 1 as x from route where from_route_code = @c or To_Route_Code = @c'],
];

export async function deleteBranch(user, code) {
  await getBranch(user, code);
  for (const [what, text] of IN_USE) {
    // A table that does not exist in this database is not "in use"; any other error must stop the delete.
    const rows = await query(text, { c: code }).catch((err) => {
      if (/invalid object name/i.test(err.message)) return [];
      throw err;
    });
    if (rows.length) throw conflict(`Branch is in use (${what}) — deactivate it instead`);
  }
  const res = await exec('sp_Delete_Branch_Master_Details', { branch_code: code }, { retval: [sql().Int, null] });
  if (!(Number(res.output.retval) > 0)) throw unprocessable('Branch not deleted');
  return { code, message: 'Branch deleted' };
}
