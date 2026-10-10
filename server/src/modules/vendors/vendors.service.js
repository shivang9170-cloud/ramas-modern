// Vendor Master — port of wwwroot/Master/Vendor_Entry.aspx(.cs). There is no vendor_master_dal.cs in the
// ClassLibrary source; procedure names were read from the deployed bin/ClassLibrary.dll.
//
// Saving a vendor also binds its ledger for every division it works in (GeneralMethods.AutoBindLedger):
// "<NAME> :<CODE> :<BRANCH NAME> :<BRANCH CODE>" under Sundry Creditors (Cr, type Vendor). The challan
// screen lists vendors through that ledger, so a vendor without it cannot be picked on a challan.
//
// Fixed legacy bugs (docs/SECURITY.md):
//   * the vendor code was generated when the page opened (race) — now inside the save transaction;
//   * the duplicate-name checks concatenated the typed name into SQL (injection) — parameters;
//   * the insert and the ledger bindings ran separately, ledger failures ignored — one transaction;
//   * saving an edit with no mode ticked threw inside a swallowed try/catch (nothing saved, no message);
//   * the edit popup loaded every city of every state and could not change PIN, PAN, e-mail, fax,
//     confirmation letter or remarks — cities follow the state, and those fields are editable;
//   * the edit popup overwrote the text of the first "approved by" item with the saved approver;
//   * delete removed the vendor even while challans, vehicles, rates or ledger entries used it.

import { exec, query, sql, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound, HttpError } from '../../middleware/errors.js';
import { s } from '../../utils/values.js';

const truthy = (v) => ['1', 'true', 'yes'].includes(s(v).toLowerCase());
const unprocessable = (msg) => new HttpError(422, msg);

export const VENDOR_TYPES = [
  { value: 'VENDOR', label: 'Vendor' },
  { value: 'SELF', label: 'Self (own fleet)' },
  { value: 'COLOADER', label: 'Co-loader' },
];

// ------------------------------------------------------------------ lookups

export async function options() {
  const [states, branches, modes, approvers, divisions] = await Promise.all([
    query("select state_code, state_name from state_master where active_flag = 'Active' order by state_name"),
    query("select branch_code, branch_name from branch_master where status = 'Active' order by branch_name"),
    exec('sp_select_Mode_Master').then((r) => r.recordset),
    query("select empname + ' :' + empcode as emp_name, empcode from Employee_Master where IsActive = '1' order by empname"),
    query('select DivCode, DivName from DivisionMaster order by DivCode'),
  ]);
  return {
    vendorTypes: VENDOR_TYPES,
    states: states.map((x) => ({ value: s(x.state_code), label: s(x.state_name) })),
    branches: branches.map((b) => ({ value: s(b.branch_code), label: `${s(b.branch_name)} : ${s(b.branch_code)}` })),
    modes: modes.map((m) => ({ value: s(m.mode_code), label: s(m.mode_name) })),
    approvers: approvers.map((e) => ({ value: s(e.empcode), label: s(e.emp_name) })),
    divisions: divisions.map((d) => ({ value: s(d.DivCode), label: s(d.DivName) })),
  };
}

// ------------------------------------------------------------------ list / get

const list = (v) => s(v).split(',').map((x) => x.trim()).filter(Boolean);
const typeOf = (v) => {
  const t = s(v).toUpperCase();
  return VENDOR_TYPES.some((x) => x.value === t) ? t : s(v);
};

const mapListRow = (r) => ({
  code: s(r.vendor_code),
  name: s(r.name),
  vendorType: typeOf(r.vendor_type),
  modes: list(r.mode_name),
  branchCode: s(r.Branch),
  branch: s(r.branch_name),
  contactPerson: s(r.ContactPrsnName),
  phone: s(r.vendor_phone_no),
  city: s(r.city_name),
  state: s(r.state_name),
  approvedDate: s(r.approvedDate),
  approvedBy: s(r.ApprovBy),
  tdsPercent: Number(r.TDS) || 0,
  gstin: s(r.Gstin_No),
  fastTag: s(r.IsFastTag) === 'Yes' || truthy(r.IsFastTag),
  divisions: list(r.DivCode),
  active: s(r.Status) === 'Active',
});

export async function listVendors(user, { q = '', status = 'all', type = '' } = {}) {
  const { recordset } = await exec('usp_select_vendors_masterALL', { DivCode: user.divCode });
  const term = q.toUpperCase();
  return recordset.map(mapListRow)
    .filter((v) => !term || [v.name, v.code, v.city, v.phone, v.gstin].some((x) => x.toUpperCase().includes(term)))
    .filter((v) => !type || v.vendorType === type)
    .filter((v) => status === 'all' || (status === 'active' ? v.active : !v.active));
}

export async function getVendor(user, code) {
  const [r] = await query(
    `select vm.*, bm.branch_name, sm.state_name, cm.city_name
       from vendors_master vm
       left join branch_master bm on bm.branch_code = vm.Branch
       left join state_master sm on sm.state_code = vm.state
       left join city_master cm on cm.city_code = vm.vendor_city
      where vm.vendor_code = @code and vm.DivCode like '%' + @div + '%'`, { code, div: user.divCode });
  if (!r) throw notFound(`Vendor ${code} not found in this division`);
  // ApprovBy holds the list text "EMPNAME :EMPCODE".
  const approvedBy = s(r.ApprovBy);
  return {
    code: s(r.vendor_code),
    name: s(r.Name ?? r.name),
    vendorType: typeOf(r.vendor_type),
    modes: list(r.vendor_Mode),
    branchCode: s(r.Branch),
    branch: s(r.branch_name),
    address: s(r.address),
    stateCode: s(r.state),
    state: s(r.state_name),
    cityCode: s(r.vendor_city),
    city: s(r.city_name),
    pinCode: s(r.pin_code),
    contactPerson: s(r.ContactPrsnName),
    pan: s(r.pan_no),
    email: s(r.email),
    phone: s(r.vendor_phone_no),
    fax: s(r.Fax),
    approvalDate: r.approvalDate ? new Date(r.approvalDate).toISOString().slice(0, 10) : '',
    approvedBy: approvedBy.includes(' :') ? approvedBy.split(' :').pop().trim() : approvedBy,
    approvedByText: approvedBy,
    confLetterNo: s(r.ConfLetterNo),
    remarks: s(r.remarks),
    tdsPercent: Number(r.TDS) || 0,
    sapCode: s(r.sap_code),
    manualCode: s(r.manual_no),
    gstRegistered: s(r.AutoGstStatus) === '' ? Boolean(s(r.Gstin_No)) : s(r.AutoGstStatus) === '1',
    gstin: s(r.Gstin_No),
    fastTag: truthy(r.IsFastTag),
    ifsc: s(r.IFCCode),
    accountNo: s(r.AccountNo),
    divisions: list(r.DivCode),
    active: truthy(r.active_flag),
  };
}

// ------------------------------------------------------------------ validation shared by create / update

async function validate(body, user, current = null) {
  if (!body.divisions.includes(user.divCode)) throw badRequest('Keep your own division ticked, or the vendor leaves your list');
  const known = new Set((await query('select DivCode from DivisionMaster')).map((d) => s(d.DivCode)));
  const unknown = body.divisions.filter((d) => !known.has(d));
  if (unknown.length) throw badRequest(`Unknown division(s): ${unknown.join(', ')}`);

  const [city] = await query('select state_code from city_master where city_code = @c', { c: body.cityCode });
  if (!city) throw badRequest('Select city');
  if (s(city.state_code) !== body.stateCode) throw badRequest('The city does not belong to the selected state');

  const [branch] = await query('select branch_code, branch_name from branch_master where branch_code = @b', { b: body.branch });
  if (!branch) throw badRequest('Select branch');

  // Modes are stored in mode-master order: the challan screen matches vendor_Mode like 'RD%'.
  const modes = (await exec('sp_select_Mode_Master')).recordset.map((m) => s(m.mode_code));
  const bad = body.modes.filter((m) => !modes.includes(m));
  if (bad.length) throw badRequest(`Unknown mode(s): ${bad.join(', ')}`);
  const modeList = modes.filter((m) => body.modes.includes(m));

  const [approver] = await query(
    "select empname + ' :' + empcode as emp_name from Employee_Master where empcode = @e", { e: body.approvedBy });
  // Keep an approver saved by the old page even if the employee has left since.
  const approvedByText = approver ? s(approver.emp_name) : (current?.approvedBy === body.approvedBy ? current.approvedByText : null);
  if (!approvedByText) throw badRequest('Select who approved the vendor');

  const name = current ? current.name : body.name;
  if (!current) {
    const [dup] = await query('select top 1 vendor_code from vendors_master where Name = @n', { n: name });
    if (dup) throw conflict(`Vendor name already exists (${name} : ${s(dup.vendor_code)})`);
  }

  const gstin = body.gstRegistered ? body.gstin : '';
  if (body.gstRegistered && !gstin) throw badRequest('Enter the GSTIN (or mark the vendor as not registered for GST)');
  if (gstin && gstin !== current?.gstin) {
    const res = await exec('usp_CheckValidateGstinNo', { Gstin_No: gstin }, { retval: [sql().VarChar(20), null] });
    if (s(res.output.retval).toUpperCase() === gstin) throw conflict(`GSTIN ${gstin} already exists`);
  }
  return { name, gstin, modeList, approvedByText, branchName: s(branch.branch_name), branchCode: s(branch.branch_code) };
}

// DIV1001 → CourDiv, DIV1002 → PrclDiv, DIV1003 / DIV1004 → FTLDiv (the page's loop let DIV1004 win).
function divisionColumns(divisions) {
  return {
    CourDiv: divisions.includes('DIV1001') ? 'DIV1001' : '',
    PrclDiv: divisions.includes('DIV1002') ? 'DIV1002' : '',
    FTLDiv: divisions.includes('DIV1004') ? 'DIV1004' : divisions.includes('DIV1003') ? 'DIV1003' : '',
  };
}

/** GeneralMethods.AutoBindLedger(name, "Sundry Creditors", "Cr", "Vendor", …) once per division. */
async function bindLedger(user, tx, ledger, code, branchCode, divisions) {
  for (const div of divisions) {
    const res = await exec('usp_AutoBindLedger', {
      LedgerName: ledger, GroupName: 'Sundry Creditors', VendorOrClientCode: code, DrCr: 'Cr', Ledger_Type: 'Vendor',
      CreatedDate: `${String(user.financialYear).slice(0, 4)}-04-01`, Branch_Code: branchCode, Emp_Code: user.userId,
      Financial_Year: user.financialYear, division: div,
    }, { status: [sql().VarChar(500), null] }, { tx });
    if (s(res.output.status).toLowerCase() !== 'success') throw unprocessable(`Ledger "${ledger}" could not be created: ${s(res.output.status)}`);
  }
}

const ledgerName = (name, code, v) => `${name} :${code} :${v.branchName} :${v.branchCode}`.toUpperCase();

// ------------------------------------------------------------------ create / update / delete

export async function createVendor(user, body) {
  const v = await validate(body, user);
  const code = await withTransaction(async (tx) => {
    // The page's getid(): V + next number (V1001, V1002, …), now under a lock. Codes of deleted vendors
    // are never reused: their ledgers stay (keyed by VendorOrClientCode) and would attach to the new vendor.
    const [m] = await query(
      `select max(n) as mx from (
         select try_cast(substring(vendor_code, 2, 20) as int) as n from vendors_master with (updlock, holdlock) where vendor_code like 'V[0-9]%'
         union all
         select try_cast(substring(ltrim(VendorOrClientCode), 2, 20) as int) from tblAccountLedger with (updlock, holdlock)
          where ltrim(VendorOrClientCode) like 'V[0-9]%') x`,
      {}, { tx });
    const next = `V${Math.max(Number(m?.mx) || 1000, 1000) + 1}`;
    const res = await exec('insert_Vendor_Master', {
      vendor_code: next, name: v.name, vendor_type: body.vendorType, vendor_Mode: v.modeList.join(','), Branch: v.branchCode,
      address: body.address, state: body.stateCode, vendor_city: body.cityCode, pin_code: body.pinCode,
      ContactPrsnName: body.contactPerson, pan_no: body.pan, email: body.email, service_tax_no: '', vendor_phone_no: body.phone,
      approvalDate: body.approvalDate, Fax: body.fax, ApprovBy: v.approvedByText, ConfLetterNo: body.confLetterNo,
      remarks: body.remarks, TDS: body.tdsPercent, sap_code: body.sapCode, manual_code: body.manualCode,
      DivCode: body.divisions.join(','), ...divisionColumns(body.divisions), Gstin_No: v.gstin,
      AutoGstStatus: body.gstRegistered ? '1' : '0', IsFastTag: body.fastTag, IFCCode: body.ifsc, AccountNo: body.accountNo,
      active_flag: body.active, IsCoLoader: body.vendorType === 'COLOADER', created_by: user.userId,
    }, { retval: [sql().VarChar(20), null] }, { tx });
    const saved = s(res.output.retval);
    if (!saved) throw unprocessable('Vendor could not be saved');
    await bindLedger(user, tx, ledgerName(v.name, saved, v), saved, v.branchCode, body.divisions);
    return saved;
  });
  return { code, message: `Vendor ${v.name} : ${code} saved` };
}

export async function updateVendor(user, code, body) {
  const current = await getVendor(user, code);
  const v = await validate(body, user, current);
  await withTransaction(async (tx) => {
    await exec('sp_Update_Vendor_Master_Details', {
      vendor_code: code, name: v.name, vendor_type: body.vendorType, vendor_Mode: v.modeList.join(','), Branch: v.branchCode,
      vendor_phone_no: body.phone, state: body.stateCode, vendor_city: body.cityCode, approvalDate: body.approvalDate,
      ApprovBy: v.approvedByText, address: body.address, ContactPrsnName: body.contactPerson, TDS: body.tdsPercent,
      sap_code: body.sapCode, manual_code: body.manualCode, DivCode: body.divisions.join(','), ...divisionColumns(body.divisions),
      Gstin_No: v.gstin, AutoGstStatus: body.gstRegistered ? '1' : '0', IsFastTag: body.fastTag, IFCCode: body.ifsc,
      AccountNo: body.accountNo, active_flag: body.active, IsCoLoader: body.vendorType === 'COLOADER', Edit_By: user.userId,
    }, {}, { tx });
    // Not in the page's edit popup (nor, presumably, in the procedure): kept editable here.
    await query(
      `update vendors_master set pin_code = @pin, pan_no = @pan, email = @email, Fax = @fax, ConfLetterNo = @letter, remarks = @remarks
        where vendor_code = @code`,
      { pin: body.pinCode, pan: body.pan, email: body.email, fax: body.fax, letter: body.confLetterNo, remarks: body.remarks, code },
      { tx });
    await bindLedger(user, tx, ledgerName(v.name, code, v), code, v.branchCode, body.divisions);
  });
  const moved = current.branchCode && current.branchCode !== v.branchCode;
  return {
    code,
    message: `Vendor ${v.name} : ${code} updated`
      + (moved ? ' — a ledger was created for the new branch; the old branch ledger is kept (it may have entries)' : ''),
  };
}

// Tables that refer to a vendor (a deleted vendor would orphan them).
const IN_USE = [
  ['challans', 'select top 1 1 as x from dispatch_master where vendor_code = @c'],
  ['vehicles', 'select top 1 1 as x from Vechile_Master where VendorCodeName = @c'],
  ['vendor vehicles', 'select top 1 1 as x from vendor_vehicle_master where vendor_code = @c'],
  ['road rates', 'select top 1 1 as x from vendor_road_rate_master where vendor_name = @c'],
  ['ledger entries', `select top 1 1 as x from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
                       where l.VendorOrClientCode = @c and (t.Dr <> 0 or t.Cr <> 0)`],
];

export async function deleteVendor(user, code) {
  const current = await getVendor(user, code);
  for (const [what, text] of IN_USE) {
    // A table that does not exist in this database is not "in use"; any other error must stop the delete.
    const rows = await query(text, { c: code }).catch((err) => {
      if (/invalid object name/i.test(err.message)) return [];
      throw err;
    });
    if (rows.length) throw conflict(`Vendor is in use (${what}) — deactivate it instead`);
  }
  await exec('sp_Delete_Vendor_Master', { vendor_code: code });
  const [still] = await query('select vendor_code from vendors_master where vendor_code = @c', { c: code });
  if (still) throw unprocessable('Vendor not deleted');
  return { code, message: `Vendor ${current.name} : ${code} deleted` };
}
