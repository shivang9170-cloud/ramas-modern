// Employee Master — port of wwwroot/Master/Employee_Master.aspx(.cs). No Employee_Master_Dal source exists;
// procedure names come from the deployed bin/ClassLibrary.dll.
//
// Saving an employee binds the employee's ledger for every ticked division (GeneralMethods.AutoBindLedger):
// "<NAME>:<CODE>:<BRANCH NAME>:<BRANCH CODE>" under Salary Expenses (DR, type EMPLOYEE).
//
// Fixed legacy bugs (docs/SECURITY.md):
//   * the employee code came from two different generators at page load (E00n from a count, then E100n filling gaps),
//     so two users could get the same code and the code of a deleted employee was handed out again — now generated
//     inside the save transaction and never reused;
//   * the insert, the photo-path update and the ledger bindings ran separately, failures ignored — one transaction;
//   * "effective from ≥ joining date" was checked with the server's culture while the dates were saved as dd/MM/yyyy,
//     so the check could compare the wrong dates — ISO dates now;
//   * editing without a new document replaced the document path with the photo path;
//   * photo / document uploads were saved under the file name sent by the browser (path traversal) and that name was
//     concatenated into an UPDATE (SQL injection) — uploads are not accepted until ported safely (see MIGRATION.md);
//   * delete removed the employee even while logins, permissions, pickups, DRS, clients, vendors, reports-to links or
//     ledger entries used it.
//
// Not ported (docs/MIGRATION.md): photo / document upload and the employee files page, salary / PF / ESI settings,
// resignation, leave, the Excel export.

import { exec, query, sql, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound, HttpError } from '../../middleware/errors.js';
import { s, iso } from '../../utils/values.js';

const truthy = (v) => ['1', 'true', 'yes'].includes(s(v).toLowerCase());
const unprocessable = (msg) => new HttpError(422, msg);

// The page's fixed lists (value = what was stored).
export const LISTS = {
  employmentTypes: [{ value: 'OnRole', label: 'On roll' }, { value: 'OffRole', label: 'Off roll' }],
  guardianTypes: [{ value: 'Father', label: "Father's name" }, { value: 'Mother', label: "Mother's name" }, { value: 'Husband', label: "Husband's name" }],
  religions: ['Hindu', 'Muslim', 'Sikh', 'Christian', 'Other'].map((v) => ({ value: v, label: v })),
  maritalStatus: [{ value: '1', label: 'Married' }, { value: '0', label: 'Unmarried' }],
  categories: ['General', 'SC', 'ST', 'OBC'].map((v) => ({ value: v, label: v })),
  nationalities: ['Indian', 'Other'].map((v) => ({ value: v, label: v })),
  bloodGroups: ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'].map((v) => ({ value: v, label: v })),
  genders: ['Male', 'Female'].map((v) => ({ value: v, label: v })),
  joiningTypes: [{ value: '0', label: 'Pre-joining' }, { value: '1', label: 'Joining' }],
};

// ------------------------------------------------------------------ lookups

export async function options() {
  const [designations, branches, departments, companies, cities, divisions, employees] = await Promise.all([
    exec('sp_select_emp_type').then((r) => r.recordset),
    query("select branch_code, branch_name from branch_master where status = 'Active' order by branch_name"),
    query('select DepartmentCode, DepartmentName from HeadOfficeDepartmentMaster order by DepartmentName'),
    query('select CCode, CName from CompanyMster order by CName'),
    query("select city_code, city_name from city_master where active_flag = 'Active' order by city_name"),
    query('select DivCode, DivName from DivisionMaster where isnull(IsActive, 1) = 1 order by DivCode'),
    exec('sp_Fill_Employee').then((r) => r.recordset),
  ]);
  return {
    ...LISTS,
    designations: designations.map((d) => ({ value: s(d.emp_type_code), label: s(d.emp_type_name) })),
    branches: branches.map((b) => ({ value: s(b.branch_code), label: `${s(b.branch_name)} : ${s(b.branch_code)}` })),
    departments: departments.map((d) => ({ value: s(d.DepartmentCode), label: s(d.DepartmentName) })),
    companies: companies.map((c) => ({ value: s(c.CCode), label: s(c.CName) })),
    cities: cities.map((c) => ({ value: s(c.city_code), label: s(c.city_name) })),
    divisions: divisions.map((d) => ({ value: s(d.DivCode), label: s(d.DivName) })),
    employees: employees.map((e) => ({ value: s(e.empcode), label: `${s(e.empname)} : ${s(e.empcode)}` })),
  };
}

/** Locations of a branch (getBindLocationFromBranch). */
export async function locations(branch) {
  const { recordset } = await exec('getBindLocationFromBranch', { branch_code: branch });
  return recordset.map((l) => ({ value: s(l.Location_Code), label: s(l.Location_Name) }));
}

// ------------------------------------------------------------------ list / get

const SELECT = `
  select em.*, et.emp_type_name, b.branch_name, d.DepartmentName, c.CName, rt.empname as report_to_name, l.Location_Name
    from employee_master em
    left join emp_type_master et on et.emp_type_code = em.emptype
    left join branch_master b on b.branch_code = em.branch
    left join HeadOfficeDepartmentMaster d on d.DepartmentCode = em.Department
    left join CompanyMster c on c.CCode = em.Company
    left join employee_master rt on rt.empcode = em.vc_Report_To
    left join New_Location_master l on l.Location_Code = em.vc_Location_Code`;
const inDivision = `',' + isnull(em.DivCode, '') + ',' like '%,' + @div + ',%'`;

const mapEmployee = (r) => ({
  id: Number(r.empid),
  code: s(r.empcode),
  name: s(r.empname),
  designation: s(r.emptype),
  designationName: s(r.emp_type_name),
  branch: s(r.branch),
  branchName: s(r.branch_name),
  location: s(r.vc_Location_Code),
  locationName: s(r.Location_Name),
  department: s(r.Department),
  departmentName: s(r.DepartmentName),
  company: s(r.Company),
  companyName: s(r.CName),
  reportsTo: s(r.vc_Report_To),
  reportsToName: s(r.report_to_name),
  employmentType: s(r.vc_Type) || 'OnRole',
  joiningType: s(r.vc_Joining_Type) || '1',
  joiningDate: iso(r.dateofjoining),
  effectiveFrom: iso(r.dt_WithEff_Date),
  guardianType: s(r.vc_Guardian_Type) || 'Father',
  guardianName: s(r.vc_Guardian_Name),
  gender: s(r.vc_Gender) || 'Male',
  dob: iso(r.dt_DOB_Date),
  maritalStatus: s(r.vc_Maritial_Status) || '1',
  religion: s(r.vc_Religion),
  category: s(r.vc_Category),
  nationality: s(r.vc_Nationality),
  bloodGroup: s(r.vc_Blood_Group),
  mobile: s(r.mobileno),
  landline: s(r.telephoneno),
  email: s(r.EmailId).toLowerCase(),
  presentAddress: s(r.presentaddress),
  presentCity: s(r.PresentCity),
  presentPin: s(r.pincode),
  permanentAddress: s(r.permanentaddress),
  permanentCity: s(r.PermanentCity),
  permanentPin: s(r.PermanentPinCode),
  qualification: s(r.vc_Highest_Qualification),
  totalExperience: r.fl_Total_Exp === null || r.fl_Total_Exp === undefined ? null : Number(r.fl_Total_Exp),
  pan: s(r.vc_PAN_No),
  passport: s(r.vc_Passport_No),
  previousCompany: { name: s(r.vc_Previous_CompanyName), address: s(r.vc_CompanyAddress), phone: s(r.vc_CompanyPhone) },
  references: [1, 2, 3].map((i) => ({
    name: s(r[`vc_Ret_Name${i}`]), address: s(r[`vc_Ret_Address${i}`]), relation: s(r[`vc_Relation_Name${i}`]), mobile: s(r[`vc_Mobile${i}`]),
  })),
  pf: truthy(r.isPF), esi: truthy(r.isESI), professionalTax: truthy(r.isPTax), lwf: truthy(r.isLWF), costVisible: truthy(r.isCost_visible),
  sapCode: s(r.sap_code),
  manualCode: s(r.manual_no),
  hasPhoto: /\.\w+$/.test(s(r.vc_Emp_Photo)),
  hasDocument: /\.\w+$/.test(s(r.vc_Emp_Document)),
  divisions: s(r.DivCode).split(',').map((d) => d.trim()).filter(Boolean),
  active: r.IsActive === null || r.IsActive === undefined ? true : truthy(r.IsActive),
});

export async function listEmployees(user, { q = '', status = 'all', designation = '' } = {}) {
  const rows = await query(`${SELECT} where ${inDivision} order by em.empname`, { div: user.divCode });
  const term = q.toUpperCase();
  return rows.map(mapEmployee)
    .filter((e) => !term || [e.name, e.code, e.mobile, e.branchName, e.designationName].some((x) => x.toUpperCase().includes(term)))
    .filter((e) => !designation || e.designation === designation)
    .filter((e) => status === 'all' || (status === 'active' ? e.active : !e.active));
}

async function rawEmployee(user, id) {
  const [r] = await query(`${SELECT} where em.empid = @id and ${inDivision}`, { id, div: user.divCode });
  if (!r) throw notFound('Employee not found in this division');
  return r;
}

export async function getEmployee(user, id) {
  return mapEmployee(await rawEmployee(user, id));
}

// ------------------------------------------------------------------ validation shared by create / update

async function validate(body, user, current = null) {
  if (!body.divisions.includes(user.divCode)) throw badRequest('Keep your own division ticked, or the employee leaves your list');
  const known = new Set((await query('select DivCode from DivisionMaster')).map((d) => s(d.DivCode)));
  const unknown = body.divisions.filter((d) => !known.has(d));
  if (unknown.length) throw badRequest(`Unknown division(s): ${unknown.join(', ')}`);

  const designations = (await exec('sp_select_emp_type')).recordset.map((d) => s(d.emp_type_code));
  if (!designations.includes(body.designation)) throw badRequest('Select designation');
  const [branch] = await query("select branch_code, branch_name from branch_master where branch_code = @b and status = 'Active'", { b: body.branch });
  if (!branch) throw badRequest('Select branch');
  const locs = await locations(body.branch);
  if (locs.length && !locs.some((l) => l.value === body.location)) throw badRequest('Select a location of the branch');
  const [dept] = await query('select DepartmentCode from HeadOfficeDepartmentMaster where DepartmentCode = @d', { d: body.department });
  if (!dept) throw badRequest('Select department');
  const [company] = await query('select CCode from CompanyMster where CCode = @c', { c: body.company });
  if (!company) throw badRequest('Select company');
  const cityCodes = [...new Set([body.presentCity, body.permanentCity])];
  const cities = await query(`select city_code from city_master where city_code in (${cityCodes.map((_, i) => `@c${i}`).join(', ')})`,
    Object.fromEntries(cityCodes.map((c, i) => [`c${i}`, c])));
  if (cities.length !== cityCodes.length) throw badRequest('Select present and permanent city');
  if (body.reportsTo) {
    if (body.reportsTo === current?.code) throw badRequest('An employee cannot report to himself / herself');
    const [boss] = await query('select empcode from employee_master where empcode = @e and isnull(IsActive, 1) = 1', { e: body.reportsTo });
    if (!boss) throw badRequest('Select who the employee reports to');
  }
  return { branchName: s(branch.branch_name) };
}

function employeeParams(body) {
  const refs = [0, 1, 2].map((i) => body.references[i] ?? { name: '', address: '', relation: '', mobile: '' });
  return {
    empname: body.name, emptype: body.designation, branch: body.branch, depart: body.department, compname: body.company,
    PresentCity: body.presentCity, PermanentCity: body.permanentCity, vc_Type: body.employmentType, vc_Guardian_Type: body.guardianType,
    vc_Guardian_Name: body.guardianName, IsAuthorized: true, telephoneno: body.landline, presentaddress: body.presentAddress,
    permanentaddress: body.permanentAddress, dateofjoining: body.joiningDate, pincode: body.presentPin, mobileno: body.mobile,
    EmailId: body.email.toUpperCase(), PermanentPinCode: body.permanentPin, vc_Religion: body.religion,
    vc_Maritial_Status: body.maritalStatus, vc_Category: body.category, vc_Nationality: body.nationality, vc_Blood_Group: body.bloodGroup,
    vc_Ret_Name1: refs[0].name, vc_Ret_Name2: refs[1].name, vc_Ret_Name3: refs[2].name, vc_Ret_Name4: '',
    vc_Ret_Address1: refs[0].address, vc_Ret_Address2: refs[1].address, vc_Ret_Address3: refs[2].address, vc_Ret_Address4: '',
    vc_Relation_Name1: refs[0].relation, vc_Relation_Name2: refs[1].relation, vc_Relation_Name3: refs[2].relation, vc_Relation_Name4: '',
    vc_Mobile1: refs[0].mobile, vc_Mobile2: refs[1].mobile, vc_Mobile3: refs[2].mobile, vc_Mobile4: '',
    vc_Gender: body.gender, dt_DOB_Date: body.dob, dt_WithEff_Date: body.effectiveFrom, vc_Highest_Qualification: body.qualification,
    dt_Leaving_Date: null, fl_Total_Exp: body.totalExperience, vc_PAN_No: body.pan, vc_Passport_No: body.passport,
    vc_Joining_Type: body.joiningType, vc_Location_Code: body.location, vc_Report_To: body.reportsTo,
    vc_Previous_CompanyName: body.previousCompany.name, vc_CompanyAddress: body.previousCompany.address,
    vc_CompanyPhone: body.previousCompany.phone, IsActive: body.active, isPF: body.pf, isESI: body.esi, isPTax: body.professionalTax,
    isLWF: body.lwf, isCost_visible: body.costVisible, Division: body.divisions.join(','), sap_code: body.sapCode, manual_no: body.manualCode,
  };
}

/**
 * GeneralMethods.AutoBindLedger(name, "Salary Expenses", "DR", "EMPLOYEE", …) for every ticked division — skipped where the
 * employee already has a ledger (a renamed employee keeps the ledger the entries were posted to).
 */
async function bindLedgers(user, tx, code, name, branchCode, branchName, divisions) {
  const ledger = `${name}:${code}:${branchName}:${branchCode}`.toUpperCase();
  for (const div of divisions) {
    const [existing] = await query(
      'select top 1 LedgerCode from tblAccountLedger where ltrim(VendorOrClientCode) = @c and Financial_Year = @fy and Division = @div',
      { c: code, fy: user.financialYear, div }, { tx });
    if (existing) continue;
    const res = await exec('usp_AutoBindLedger', {
      LedgerName: ledger, GroupName: 'Salary Expenses', VendorOrClientCode: code, DrCr: 'DR', Ledger_Type: 'EMPLOYEE',
      CreatedDate: `${String(user.financialYear).slice(0, 4)}-04-01`, Branch_Code: branchCode, Emp_Code: user.userId,
      Financial_Year: user.financialYear, division: div,
    }, { status: [sql().VarChar(500), null] }, { tx });
    if (s(res.output.status).toLowerCase() !== 'success') throw unprocessable(`Ledger "${ledger}" could not be created: ${s(res.output.status)}`);
  }
}

// ------------------------------------------------------------------ create / update / delete

export async function createEmployee(user, body) {
  const v = await validate(body, user);
  const created = await withTransaction(async (tx) => {
    // E + next number (E1001, …) under a lock; codes still used by ledgers are skipped.
    const [m] = await query(
      `select max(n) as mx from (
         select try_cast(substring(empcode, 2, 20) as int) as n from employee_master with (updlock, holdlock) where empcode like 'E[0-9]%'
         union all
         select try_cast(substring(ltrim(VendorOrClientCode), 2, 20) as int) from tblAccountLedger with (updlock, holdlock)
          where ltrim(VendorOrClientCode) like 'E[0-9]%') x`, {}, { tx });
    const code = `E${Math.max(Number(m?.mx) || 1000, 1000) + 1}`;
    const res = await exec('usp_insert_Employee_Master', {
      empcode: code, ...employeeParams(body), vc_Emp_Photo: '', vc_Emp_Document: '', User_Id: user.userId,
    }, { emid: [sql().VarChar(50), null] }, { tx });
    const saved = s(res.output.emid) || code;
    const [row] = await query('select empid from employee_master where empcode = @c', { c: saved }, { tx });
    if (!row) throw unprocessable('Employee could not be saved');
    await bindLedgers(user, tx, saved, body.name, body.branch, v.branchName, body.divisions);
    return { id: Number(row.empid), code: saved };
  });
  return { ...created, message: `Employee ${body.name} : ${created.code} saved` };
}

export async function updateEmployee(user, id, body) {
  const raw = await rawEmployee(user, id);
  const current = mapEmployee(raw);
  const v = await validate(body, user, current);
  await withTransaction(async (tx) => {
    await exec('usp_Update_Employee_Master', {
      empcode: current.code, ...employeeParams(body),
      // Photo / document upload is not ported: keep what the legacy page stored (it replaced the document with the photo).
      vc_Emp_Photo: s(raw.vc_Emp_Photo), vc_Emp_Document: s(raw.vc_Emp_Document), Edit_By: user.userId,
    }, {}, { tx });
    await bindLedgers(user, tx, current.code, body.name, body.branch, v.branchName, body.divisions);
  });
  return { id, code: current.code, message: `Employee ${body.name} : ${current.code} updated` };
}

// Tables that refer to an employee (a deleted employee would orphan them).
const IN_USE = [
  ['a login', 'select top 1 1 as x from users where user_id = @c'],
  ['menu permissions', 'select top 1 1 as x from Employee_Permission where Employeeid = @c'],
  ['pickups', 'select top 1 1 as x from Pick_up_entry where PickUpBy = @c'],
  ['delivery run sheets', 'select top 1 1 as x from drs_entry_details where empcode = @c'],
  ['employees reporting to them', 'select top 1 1 as x from employee_master where vc_Report_To = @c'],
  ['clients (contract by)', 'select top 1 1 as x from client_Master where Contract_By = @c'],
  ['vendors (approved by)', "select top 1 1 as x from vendors_master where ApprovBy like '% :' + @c"],
  ['ledger entries', `select top 1 1 as x from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
                       where ltrim(l.VendorOrClientCode) = @c and (t.Dr <> 0 or t.Cr <> 0)`],
];

export async function deleteEmployee(user, id) {
  const current = await getEmployee(user, id);
  for (const [what, text] of IN_USE) {
    // A table that does not exist in this database is not "in use"; any other error must stop the delete.
    const rows = await query(text, { c: current.code }).catch((err) => {
      if (/invalid object name/i.test(err.message)) return [];
      throw err;
    });
    if (rows.length) throw conflict(`Employee is in use (${what}) — deactivate instead`);
  }
  // Employee_Master_Dal: delete from Employee_Master where empid=@empid
  await query('delete from employee_master where empid = @id', { id });
  return { id, message: `Employee ${current.name} : ${current.code} deleted` };
}
