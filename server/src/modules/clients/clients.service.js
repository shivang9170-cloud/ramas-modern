// Client Master — port of wwwroot/Master/Client_Master.aspx(.cs). No Client_Master_Dal source exists; procedure
// names come from the deployed bin/ClassLibrary.dll.
//
// Saving a client binds its two ledgers (GeneralMethods.AutoBindLedger, Sundry Debtors, DR, type CLIENT):
//   "<NAME> :<CODE>:<BRANCH NAME>:<BRANCH CODE> :BILLED" and "… :UNBILLED".
// The docket booking charges post to these, so a client without them cannot be billed.
//
// Fixed legacy bugs (docs/SECURITY.md):
//   * the client code was generated when the page opened (race) — now inside the save transaction, never reusing
//     the code of a deleted client (its ledgers stay);
//   * the insert and the two ledger bindings ran separately, ledger failures ignored — one transaction;
//   * the "Contract by" list was only filled on the edit popup, so every new client was saved without it;
//   * the create page refused a client whose address / place / e-mail / phone *equalled* an existing client's
//     ("Input Address!!!") — replaced by a real duplicate-name check; the GSTIN checks were commented out — enforced;
//   * the edit popup looked the branch up by name with concatenated SQL and overwrote the text of the selected
//     submission / collection location item; the PO date was not saved on edit;
//   * delete removed the client even while dockets, rates, logins or ledger entries used it.
//
// Not ported (docs/MIGRATION.md): Client_Master_AddOn.aspx (extra branches of a client), client documents,
// client login users, contracts / rates, the Excel export.

import { exec, query, sql, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound, HttpError } from '../../middleware/errors.js';
import { s, iso } from '../../utils/values.js';

const truthy = (v) => ['1', 'true', 'yes'].includes(s(v).toLowerCase());
const unprocessable = (msg) => new HttpError(422, msg);

// ddlPlaceofSupply stored the item text.
export const PLACE_OF_SUPPLY = [{ value: 'INTRASTATE', label: 'Intrastate (CGST + SGST)' }, { value: 'INTERSTATE', label: 'Interstate (IGST)' }];
export const CREDIT_TYPES = [{ value: 'Consigner', label: 'Consignor credit' }, { value: 'Consignee', label: 'Consignee credit' }];
const CUST_TYPES = [{ value: 0, label: 'GTA' }, { value: 1, label: 'Courier' }];

// ------------------------------------------------------------------ lookups

export async function options(user) {
  const [branches, business, employees, parents] = await Promise.all([
    query("select branch_code, branch_name from branch_master where status = 'Active' order by branch_name"),
    exec('GET_NATURE_OF_BUSINESS_MASTER').then((r) => r.recordset),
    query("select empcode, empname from Employee_Master where isnull(IsActive, 1) = 1 order by empname"),
    query(
      `select client_code, company_name from client_Master
        where isnull(is_Active, 1) = 1 and ',' + isnull(DivCode, '') + ',' like '%,' + @div + ',%' order by company_name`,
      { div: user.divCode }),
  ]);
  return {
    placeOfSupply: PLACE_OF_SUPPLY,
    creditTypes: CREDIT_TYPES,
    custTypes: CUST_TYPES,
    branches: branches.map((b) => ({ value: s(b.branch_code), label: `${s(b.branch_name)} : ${s(b.branch_code)}` })),
    natureOfBusiness: business.map((b) => ({ value: Number(b.ID), label: s(b.nob_name) })),
    employees: employees.map((e) => ({ value: s(e.empcode), label: `${s(e.empname)} : ${s(e.empcode)}` })),
    parentClients: parents.map((c) => ({ value: s(c.client_code), label: `${s(c.company_name)} : ${s(c.client_code)}` })),
  };
}

/** City search (the page's GetCityname autocomplete), with the state for the form. */
export async function cities(q = '') {
  const rows = await query(
    `select top 20 c.city_code, c.city_name, s.state_name from city_master c left join state_master s on s.state_code = c.state_code
      where c.active_flag = 'Active' and c.city_name like @q + '%' order by c.city_name`, { q });
  return rows.map((r) => ({ value: s(r.city_code), label: `${s(r.city_name)}${r.state_name ? `, ${s(r.state_name)}` : ''}` }));
}

// ------------------------------------------------------------------ list / get

const SELECT = `
  select cm.*, c.city_name, st.state_name, b.branch_name, sb.branch_name as submission_name, cb.branch_name as collection_name,
         nb.nob_name, e.empname as contract_by_name, p.company_name as parent_name
    from client_Master cm
    left join city_master c on c.city_code = cm.city
    left join state_master st on st.state_code = c.state_code
    left join branch_master b on b.branch_code = cm.Branch_Code
    left join branch_master sb on sb.branch_code = cm.SubmissionLocation
    left join branch_master cb on cb.branch_code = cm.CollectionLocation
    left join nature_of_business_master nb on nb.ID = cm.nature_of_business_id
    left join Employee_Master e on e.empcode = cm.Contract_By
    left join client_Master p on p.client_code = cm.Under_client and p.client_Id <> cm.client_Id`;
const inDivision = `',' + isnull(cm.DivCode, '') + ',' like '%,' + @div + ',%'`;

const mapClient = (r) => ({
  id: Number(r.client_Id),
  code: s(r.client_code),
  name: s(r.company_name) || s(r.client_name),
  contactPerson: s(r.contact_person),
  address: s(r.address),
  cityCode: s(r.city),
  city: s(r.city_name),
  state: s(r.state_name),
  place: s(r.place),
  pinCode: s(r.pin_code),
  email: s(r.email),
  phone: s(r.phone),
  mobile: s(r.Mobile),
  fax: s(r.fax),
  pan: s(r.pan_no),
  tin: s(r.tin),
  gstRegistered: s(r.AutoGstStatus) === '' ? Boolean(s(r.Gstin_No)) : s(r.AutoGstStatus) === '1',
  gstin: s(r.Gstin_No),
  placeOfSupply: s(r.PlaceofSupply),
  branch: s(r.Branch_Code),
  branchName: s(r.branch_name),
  submissionLocation: s(r.SubmissionLocation),
  submissionName: s(r.submission_name),
  collectionLocation: s(r.CollectionLocation),
  collectionName: s(r.collection_name),
  introDate: iso(r.intro_date),
  creditPeriod: Number(r.credit_period) || 0,
  billingCycle: s(r.Billing_Cycle),
  creditType: s(r.Credit_Type) || 'Consigner',
  custType: Number(r.CustType) || 0,
  natureOfBusinessId: r.nature_of_business_id === null || r.nature_of_business_id === undefined ? null : Number(r.nature_of_business_id),
  natureOfBusiness: s(r.nob_name),
  contractBy: s(r.Contract_By),
  contractByName: s(r.contract_by_name),
  underClient: s(r.Under_client),
  underClientName: s(r.parent_name),
  billing: {
    sameAsClient: false,
    address: s(r.billing_address), name: s(r.billing_client_name), phone: s(r.billing_client_phone), gstin: s(r.billing_client_GSTIN),
  },
  isPs: s(r.IsPs) === 'Yes',
  transportId: s(r.Trans_no),
  showKmOnPrint: Number(r.ShowKMOnPrint) === 1,
  printAs: s(r.print_as),
  poNo: s(r.PO_No),
  poDate: s(r.PO_Date),
  cinNo: s(r.CIN_NO),
  sapCode: s(r.sap_code),
  manualCode: s(r.manual_no),
  remarks: s(r.remarks),
  discount: Number(r.IsDiscount) === 1,
  thirdPartyBilling: truthy(r.IsThirdPartyBilling),
  walkingClient: truthy(r.IsWalkingClient),
  divisions: s(r.DivCode).split(',').map((d) => d.trim()).filter(Boolean),
  active: r.is_Active === null || r.is_Active === undefined ? true : truthy(r.is_Active),
});

export async function listClients(user, { q = '', status = 'all' } = {}) {
  const rows = await query(`${SELECT} where ${inDivision} order by cm.company_name, cm.client_code`, { div: user.divCode });
  const term = q.toUpperCase();
  return rows.map(mapClient)
    .filter((c) => !term || [c.name, c.code, c.city, c.gstin, c.phone, c.mobile].some((x) => x.toUpperCase().includes(term)))
    .filter((c) => status === 'all' || (status === 'active' ? c.active : !c.active));
}

export async function getClient(user, id) {
  const [r] = await query(`${SELECT} where cm.client_Id = @id and ${inDivision}`, { id, div: user.divCode });
  if (!r) throw notFound('Client not found in this division');
  const c = mapClient(r);
  const b = c.billing;
  c.billing.sameAsClient = b.address === c.address && b.name === c.name && b.phone === c.phone && b.gstin === c.gstin;
  return c;
}

// ------------------------------------------------------------------ validation shared by create / update

async function validate(body, user, current = null) {
  const name = current ? current.name : body.name;
  const [dup] = await query(
    'select top 1 client_code from client_Master where company_name = @n and (@id = 0 or client_Id <> @id)',
    { n: name, id: current?.id ?? 0 });
  if (dup) throw conflict(`Client name already exists (${name} : ${s(dup.client_code)})`);

  const [city] = await query("select city_code from city_master where city_code = @c and active_flag = 'Active'", { c: body.cityCode });
  if (!city) throw badRequest('City not found / not active in the city master');

  const branchCodes = [...new Set([current ? current.branch : body.branch, body.submissionLocation, body.collectionLocation])];
  const found = new Set((await query(
    `select branch_code from branch_master where status = 'Active' and branch_code in (${branchCodes.map((_, i) => `@b${i}`).join(', ')})`,
    Object.fromEntries(branchCodes.map((b, i) => [`b${i}`, b])))).map((b) => s(b.branch_code)));
  const missing = branchCodes.filter((b) => !found.has(b));
  if (missing.length) throw badRequest(`Unknown or inactive branch(es): ${missing.join(', ')}`);

  if (body.natureOfBusinessId !== null) {
    const nob = (await exec('GET_NATURE_OF_BUSINESS_MASTER')).recordset;
    if (!nob.some((x) => Number(x.ID) === body.natureOfBusinessId)) throw badRequest('Select nature of business');
  }
  if (body.contractBy) {
    const [emp] = await query('select empcode from Employee_Master where empcode = @e', { e: body.contractBy });
    if (!emp) throw badRequest('Select who the contract is by');
  }
  if (body.underClient) {
    const [parent] = await query('select client_code from client_Master where client_code = @c and isnull(is_Active, 1) = 1',
      { c: body.underClient });
    if (!parent || body.underClient === current?.code) throw badRequest('Select a valid parent client');
  }

  const gstin = body.gstRegistered ? body.gstin : '';
  if (body.gstRegistered && !gstin) throw badRequest('Enter the GSTIN (or mark the client as not registered for GST)');
  if (gstin && gstin !== current?.gstin) {
    const [g] = await query('select top 1 client_code from client_Master where Gstin_No = @g and (@id = 0 or client_Id <> @id)',
      { g: gstin, id: current?.id ?? 0 });
    if (g) throw conflict(`GSTIN ${gstin} already belongs to client ${s(g.client_code)}`);
  }
  // "Billing details same as client" copies the client's own details (rbl_bill_details).
  const billing = body.billing.sameAsClient
    ? { address: body.address, name, phone: body.phone, gstin }
    : body.billing;
  if (!billing.address || !billing.name) throw badRequest('Enter the billing address and name (or tick "same as client")');
  return { name, gstin, billing, branch: current ? current.branch : body.branch };
}

// DIV1001 → divcourier, DIV1002 → divparcel, DIV1003 → divftl.
const divisionColumns = (divs) => ({
  divcourier: divs.includes('DIV1001') ? 'DIV1001' : '',
  divparcel: divs.includes('DIV1002') ? 'DIV1002' : '',
  divftl: divs.includes('DIV1003') ? 'DIV1003' : '',
});

async function ledgerNames(name, code, branchCode, tx) {
  const [b] = await query('select branch_name from branch_master where branch_code = @b', { b: branchCode }, { tx });
  const base = `${name} :${code}:${s(b?.branch_name)}:${branchCode}`.toUpperCase();
  return { billed: `${base} :BILLED`, unbilled: `${base} :UNBILLED` };
}

/** GeneralMethods.AutoBindLedger(billed / unbilled, "Sundry Debtors", "DR", "CLIENT", …) for every division of the client. */
async function bindLedgers(user, tx, names, code, branchCode, divisions) {
  for (const div of divisions) {
    for (const ledger of [names.billed, names.unbilled]) {
      const res = await exec('usp_AutoBindLedger', {
        LedgerName: ledger, GroupName: 'Sundry Debtors', VendorOrClientCode: code, DrCr: 'DR', Ledger_Type: 'CLIENT',
        CreatedDate: `${String(user.financialYear).slice(0, 4)}-04-01`, Branch_Code: branchCode, Emp_Code: user.userId,
        Financial_Year: user.financialYear, division: div,
      }, { status: [sql().VarChar(500), null] }, { tx });
      if (s(res.output.status).toLowerCase() !== 'success') throw unprocessable(`Ledger "${ledger}" could not be created: ${s(res.output.status)}`);
    }
  }
}

function commonParams(body, v) {
  return {
    company_name: v.name, contact_person: body.contactPerson, address: body.address, city: body.cityCode, place: body.place,
    pin_code: body.pinCode, email: body.email, phone: body.phone, fax: body.fax, pan_no: body.pan, service_tax_no: '',
    intro_date: body.introDate, is_Active: body.active, credit_period: body.creditPeriod, is_tax_notapplicable: false,
    remarks: body.remarks, Client_Name: v.name, IsThirdPartyBilling: body.thirdPartyBilling, Mobile: body.mobile,
    IsWalkingClient: body.walkingClient, Billing_Cycle: body.billingCycle, Gstin_No: v.gstin, AutoGstStatus: body.gstRegistered ? '1' : '0',
    BillingLocation: v.branch, SubmissionLocation: body.submissionLocation, CollectionLocation: body.collectionLocation,
    PlaceofSupply: body.placeOfSupply, PO_No: body.poNo, CIN_No: body.cinNo,
    billing_address: v.billing.address, billing_client_name: v.billing.name, billing_client_phone: v.billing.phone,
    billing_client_gstin: v.billing.gstin, Credit_Type: body.creditType, IsPs: body.isPs ? 'Yes' : 'No',
    Trans_no: body.isPs ? body.transportId : '', ShowKMOnPrint: body.showKmOnPrint ? 1 : 0,
    nature_of_business_id: body.natureOfBusinessId, IsDiscount: body.discount ? 1 : 0, IsGstReg: body.gstRegistered ? 1 : 0,
    print_as: body.printAs, Contract_By: body.contractBy, under_client: body.underClient || null, sap_code: body.sapCode,
    manual_code: body.manualCode,
  };
}

// ------------------------------------------------------------------ create / update / delete

export async function createClient(user, body) {
  const v = await validate(body, user);
  const divisions = [user.divCode];   // the page saved new clients for the logged-in division only
  const created = await withTransaction(async (tx) => {
    // Client_Master_Bal.getid(): C + next number, under a lock; codes still used by ledgers are skipped.
    const [m] = await query(
      `select max(n) as mx from (
         select try_cast(substring(client_code, 2, 20) as int) as n from client_Master with (updlock, holdlock) where client_code like 'C[0-9]%'
         union all
         select try_cast(substring(ltrim(VendorOrClientCode), 2, 20) as int) from tblAccountLedger with (updlock, holdlock)
          where ltrim(VendorOrClientCode) like 'C[0-9]%') x`, {}, { tx });
    const code = `C${Math.max(Number(m?.mx) || 1000, 1000) + 1}`;
    const names = await ledgerNames(v.name, code, v.branch, tx);
    await exec('insert_Client_Master_Details', {
      client_code: code, ...commonParams(body, v), Tin: body.tin, Branch_Code: v.branch, billed_ledger_name: names.billed,
      unbilled_ledger_name: names.unbilled, created_by: user.userId, CustType: body.custType, RegUnreg: body.gstRegistered ? 0 : 1,
      RegNo: '', PO_Date: body.poDate, Division: divisions.join(','), ...divisionColumns(divisions),
    }, {}, { tx });
    const [row] = await query('select client_Id from client_Master where client_code = @c', { c: code }, { tx });
    if (!row) throw unprocessable('Client could not be saved');
    await bindLedgers(user, tx, names, code, v.branch, divisions);
    return { id: Number(row.client_Id), code };
  });
  return { ...created, message: `Client ${v.name} : ${created.code} saved` };
}

export async function updateClient(user, id, body) {
  const current = await getClient(user, id);
  const v = await validate(body, user, current);
  const divisions = current.divisions.length ? current.divisions : [user.divCode];
  await withTransaction(async (tx) => {
    const names = await ledgerNames(v.name, current.code, v.branch, tx);
    await exec('sp_Update_Client_Master', {
      client_Id: id, clinet_code: current.code, ...commonParams(body, v), Tin_Number: body.tin, Branch_Code: v.branch,
      billed_code: names.billed, unbilled_code: names.unbilled, Division: divisions.join(','), ...divisionColumns(divisions),
    }, {}, { tx });
    // Not in the page's update: PO date (commented out there) and customer type.
    await query('update client_Master set PO_Date = @pd, CustType = @ct where client_Id = @id',
      { pd: body.poDate, ct: body.custType, id }, { tx });
    await bindLedgers(user, tx, names, current.code, v.branch, divisions);
  });
  return { id, code: current.code, message: `Client ${v.name} : ${current.code} updated` };
}

// Tables that refer to a client (a deleted client would orphan them).
const IN_USE = [
  ['dockets booked on its account', "select top 1 1 as x from grn_master where on_account_of like '%:' + @c"],
  ['rates', 'select top 1 1 as x from client_rate where client_code = @c'],
  ['client logins', 'select top 1 1 as x from ClientLogin_Users where user_id = @c'],
  ['clients under it', 'select top 1 1 as x from client_Master where Under_client = @c'],
  ['ledger entries', `select top 1 1 as x from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
                       where l.VendorOrClientCode = @c and (t.Dr <> 0 or t.Cr <> 0)`],
];

export async function deleteClient(user, id) {
  const current = await getClient(user, id);
  for (const [what, text] of IN_USE) {
    // A table that does not exist in this database is not "in use"; any other error must stop the delete.
    const rows = await query(text, { c: current.code }).catch((err) => {
      if (/invalid object name/i.test(err.message)) return [];
      throw err;
    });
    if (rows.length) throw conflict(`Client is in use (${what}) — deactivate it instead`);
  }
  await exec('delete_Client_Master_With_Details', { client_Id: id });
  const [still] = await query('select client_Id from client_Master where client_Id = @id', { id });
  if (still) throw unprocessable('Client not deleted');
  return { id, message: `Client ${current.name} : ${current.code} deleted` };
}
