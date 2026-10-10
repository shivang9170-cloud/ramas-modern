// Setting bindings — port of three Setting pages:
//   * Setting/Bind_Destinationtobranch.aspx  — which cities (destinations) a branch delivers, per division
//     (Courier / Parcel / FTL flags), in Branch_bind_For_city;
//   * Setting/Franchisee_Bind_Branch.aspx    — which branch a franchisee (or master franchisee) runs, in Bind_Franch_Branch;
//   * Setting/Bind_Franchisee_to_Client.aspx + Franchisee_to_Client_View.aspx — clients handled by a franchisee,
//     in Bind_Franchisee_To_Client.
//
// Changes from the pages (docs/MIGRATION.md "Settings"):
//   * destinations: only the logged-in division's flag can change (the page disabled the others but re-saved whatever
//     the browser posted); the other divisions' flags are kept from the saved rows; the branch's own city stays bound;
//   * franchisee ↔ branch: a branch already bound is refused on save (the page only warned when the branch was picked);
//   * franchisee ↔ client: a client already bound (active) to a franchisee is refused (the page inserted duplicates and
//     only checked when a record was re-activated).
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../middleware/errors.js';
import { s } from '../../utils/values.js';

const b = (v) => v === true || v === 1 || v === '1' || s(v).toLowerCase() === 'true';

// division → the flag it owns (Enable_Disable_Checkboxes)
const DIVISION_FLAG = { DIV1001: 'courier', DIV1002: 'parcel', DIV1003: 'ftl' };
const FLAG_COLUMN = { courier: 'IsCourier', parcel: 'IsParcel', ftl: 'IsFTL' };

// ------------------------------------------------------------------ destinations → branch

export async function destinationBranches() {
  const rows = await query(
    `select branch_code, branch_name, city_code, state_code, IsFranchisee as fr, IsMasterFranchisee as mfr
       from branch_master where status = 'Active' order by branch_name`);
  return rows.map((r) => ({
    value: s(r.branch_code), label: `${s(r.branch_name)}${b(r.fr) || b(r.mfr) ? ' (FR)' : ''} : ${s(r.branch_code)}`,
    franchisee: b(r.fr) || b(r.mfr), city: s(r.city_code), state: s(r.state_code),
  }));
}

export async function states() {
  const rows = await query("select state_code, state_name from state_master where isnull(active_flag, 'Active') = 'Active' order by state_name");
  return rows.map((r) => ({ value: s(r.state_code), label: s(r.state_name) }));
}

async function branchRow(code) {
  const [r] = await query('select branch_code, branch_name, city_code, IsFranchisee as fr, IsMasterFranchisee as mfr from branch_master where branch_code = @b', { b: code });
  if (!r) throw notFound('Branch not found');
  return { code: s(r.branch_code), name: s(r.branch_name), city: s(r.city_code), franchisee: b(r.fr) || b(r.mfr) };
}

/** Cities of the state with this branch's bindings (select_Destination_Details / Other_State_City). */
export async function destinations(branch, state) {
  const br = await branchRow(branch);
  const rows = await query(
    `select c.city_code, c.city_name, bf.IsCourier, bf.IsParcel, bf.IsFTL, bf.active_flag, bf.FranchiseeType,
            (select string_agg(bm.branch_name, ', ') from Branch_bind_For_city o join branch_master bm on bm.branch_code = o.BindTo
              where o.city_code = c.city_code and o.BindTo <> @b and o.active_flag = 1) as other_branches
       from city_master c
       left join Branch_bind_For_city bf on bf.city_code = c.city_code and bf.BindTo = @b
      where c.state_code = @st and isnull(c.active_flag, 'Active') = 'Active'
      order by c.city_name`, { b: branch, st: state });
  const franchiseeType = rows.map((r) => Number(r.FranchiseeType) || 0).find((t) => t > 0) || (br.franchisee ? 1 : 0);
  return {
    branch: br,
    franchiseeType,
    cities: rows.map((r) => ({
      city: s(r.city_code), cityName: s(r.city_name),
      bound: b(r.active_flag), courier: b(r.IsCourier), parcel: b(r.IsParcel), ftl: b(r.IsFTL),
      ownCity: s(r.city_code) === br.city, otherBranches: s(r.other_branches),
    })),
  };
}

/**
 * btnsubmit_Click: Delete_Branch_bind_For_city(branch, state), then insert the ticked cities. A city is bound when any
 * division flag is ticked (OnChangeOfDivisions); a type-2 franchisee branch binds cities without division flags.
 */
export async function saveDestinations(user, branch, state, body) {
  const br = await branchRow(branch);
  const current = await destinations(branch, state);
  const saved = new Map(current.cities.map((c) => [c.city, c]));
  const own = DIVISION_FLAG[user.divCode];                       // admin (no division) may change every flag
  const type = br.franchisee ? body.franchiseeType || 1 : 0;
  const rows = [];
  for (const r of body.cities) {
    const old = saved.get(r.city);
    if (!old) throw badRequest(`City ${r.city} is not in the selected state`);
    const flags = {};
    for (const f of Object.keys(FLAG_COLUMN)) flags[f] = type === 2 ? false : (!own || f === own ? Boolean(r[f]) : old[f]);
    let bound = type === 2 ? Boolean(r.bound) : flags.courier || flags.parcel || flags.ftl;
    if (old.ownCity) bound = true;                               // the branch's own city cannot be unbound
    if (bound) rows.push({ city: r.city, ...flags });
  }
  // cities not sent keep their saved binding
  for (const c of current.cities) {
    if (!body.cities.some((r) => r.city === c.city) && c.bound) rows.push({ city: c.city, courier: c.courier, parcel: c.parcel, ftl: c.ftl });
  }
  await withTransaction(async (tx) => {
    await query(
      `delete bf from Branch_bind_For_city bf join city_master c on c.city_code = bf.city_code
        where bf.BindTo = @b and c.state_code = @st`, { b: branch, st: state }, { tx });
    for (const r of rows) {
      await query(
        `insert into Branch_bind_For_city(state_code, city_code, BindTo, IsCourier, IsParcel, IsFTL, active_flag, FranchiseeType, created_by)
         values (@st, @c, @b, @co, @pa, @ft, 1, @type, @u)`,
        { st: state, c: r.city, b: branch, co: r.courier ? 1 : 0, pa: r.parcel ? 1 : 0, ft: r.ftl ? 1 : 0, type, u: user.userId }, { tx });
    }
  });
  return { bound: rows.length, message: `${rows.length} ${rows.length === 1 ? 'city' : 'cities'} bound to ${br.name}` };
}

// ------------------------------------------------------------------ franchisee ↔ branch

const FRANCHISE_TABLE = { 1: { table: 'Franchise_Master', loc: 'busslocation', flag: 'IsFranchisee' }, 2: { table: 'MasterFranchise', loc: 'newlocation', flag: 'IsMasterFranchisee' } };

/** Bind_Franchisee_Name / Bind_MasterFranchisee_Name: franchisees not bound to a branch yet (plus `include`). */
export async function franchisees(type, include = '') {
  const t = FRANCHISE_TABLE[type];
  const rows = await query(
    `select FranCode, FranName, ${t.loc} as loc from ${t.table}
      where FranCode not in (select Franchise_Code from Bind_Franch_Branch where Status = 1) or FranCode = @inc
      order by FranName`, { inc: include });
  return rows.map((r) => ({ value: s(r.FranCode), label: `${s(r.FranName)} : ${s(r.FranCode)}`, location: s(r.loc) }));
}

/** Bind_Franchisee_Branch_Name(location): franchisee branches (of the franchisee's location when it has one). */
export async function franchiseeBranches(type, franchisee) {
  const t = FRANCHISE_TABLE[type];
  const [f] = await query(`select ${t.loc} as loc from ${t.table} where FranCode = @f`, { f: franchisee });
  if (!f) throw notFound('Franchisee not found');
  const rows = await query(
    `select branch_code, branch_name from branch_master
      where status = 'Active' and cast(isnull(${t.flag}, '') as varchar(10)) in ('1', 'true') and (@loc = '' or location = @loc)
      order by branch_name`, { loc: s(f.loc) });
  return rows.map((r) => ({ value: s(r.branch_code), label: `${s(r.branch_name)} : ${s(r.branch_code)}` }));
}

export async function listFranchiseeBranches() {
  const rows = await query(
    `select bf.id, bf.Franchise_Code, bf.Branch_Code, bf.Status, bf.Franchise_Type, bm.branch_name,
            coalesce(fm.FranName, mf.FranName) as FranName
       from Bind_Franch_Branch bf
       left join Franchise_Master fm on fm.FranCode = bf.Franchise_Code
       left join MasterFranchise mf on mf.FranCode = bf.Franchise_Code
       left join branch_master bm on bm.branch_code = bf.Branch_Code
      order by FranName`);
  return rows.map((r) => ({
    id: Number(r.id), franchisee: s(r.Franchise_Code), franchiseeName: s(r.FranName), branch: s(r.Branch_Code),
    branchName: s(r.branch_name), type: Number(r.Franchise_Type) || 1, active: b(r.Status),
  }));
}

export async function createFranchiseeBranch(user, body) {
  const fr = await franchisees(body.type, body.franchisee);
  if (!fr.some((f) => f.value === body.franchisee)) throw badRequest('Select a franchisee that is not bound yet');
  if (!(await franchiseeBranches(body.type, body.franchisee)).some((x) => x.value === body.branch)) throw badRequest('Select a franchisee branch');
  return withTransaction(async (tx) => {
    // Check_Branch_Bind_Franchisee: "This Branch Is already Bind to …"
    const [dup] = await query(
      `select top 1 coalesce(fm.FranName, mf.FranName, bf.Franchise_Code) as name from Bind_Franch_Branch bf with (updlock, holdlock)
         left join Franchise_Master fm on fm.FranCode = bf.Franchise_Code left join MasterFranchise mf on mf.FranCode = bf.Franchise_Code
        where bf.Branch_Code = @b and bf.Status = 1`, { b: body.branch }, { tx });
    if (dup) throw conflict(`This branch is already bound to ${s(dup.name)}`);
    const [row] = await query(
      `insert into Bind_Franch_Branch(Franchise_Code, Branch_Code, Status, Franchise_Type, Created_by)
       output inserted.id values (@f, @b, @st, @t, @u)`,
      { f: body.franchisee, b: body.branch, st: body.active ? 1 : 0, t: body.type, u: user.userId }, { tx });
    return { id: Number(row.id), message: 'Franchisee bound to the branch' };
  });
}

export async function setFranchiseeBranchStatus(id, active) {
  const [r] = await query('select Branch_Code from Bind_Franch_Branch where id = @id', { id });
  if (!r) throw notFound('Binding not found');
  if (active) {
    const [dup] = await query('select top 1 id from Bind_Franch_Branch where Branch_Code = @b and Status = 1 and id <> @id', { b: s(r.Branch_Code), id });
    if (dup) throw conflict('The branch is already bound to another franchisee');
  }
  await query('update Bind_Franch_Branch set Status = @s where id = @id', { s: active ? 1 : 0, id });
  return { id, message: active ? 'Binding activated' : 'Binding deactivated' };
}

/**
 * Franchisees a pickup / DRS can be given to (Franchisee_List of the pickup and DRS pages): franchisees and master
 * franchisees with an active branch binding, the one bound to this branch first.
 */
export async function franchiseesForBranch(branch) {
  const rows = await query(
    `select bf.Franchise_Code, coalesce(fm.FranName, mf.FranName) as FranName, bf.Branch_Code, bm.branch_name
       from Bind_Franch_Branch bf
       left join Franchise_Master fm on fm.FranCode = bf.Franchise_Code
       left join MasterFranchise mf on mf.FranCode = bf.Franchise_Code
       left join branch_master bm on bm.branch_code = bf.Branch_Code
      where isnull(bf.Status, 1) = 1
      order by case when bf.Branch_Code = @b then 0 else 1 end, coalesce(fm.FranName, mf.FranName)`, { b: branch });
  return rows.map((r) => ({
    value: s(r.Franchise_Code), label: `${s(r.FranName)} (${s(r.branch_name)})`, name: s(r.FranName), own: s(r.Branch_Code) === branch,
  }));
}

// ------------------------------------------------------------------ franchisee ↔ client

/** GET_ALL_FRANCHISEE_LIST: franchisees (Id, Franchisee_name). */
export async function franchiseeList() {
  const rows = await query('select id, FranCode, FranName from Franchise_Master order by FranName');
  return rows.map((r) => ({ value: Number(r.id), label: `${s(r.FranName)} : ${s(r.FranCode)}` }));
}

/** GET_ALL_CLIENTS_FOR_BIND_TO_FRANCHISEE(name, division): active clients of the division, with any current binding. */
export async function clientsForBinding(user, search) {
  const rows = await query(
    `select top 200 cm.client_code, cm.company_name, fm.FranName as bound_to
       from client_Master cm
       left join Bind_Franchisee_To_Client bc on bc.ClientID = cm.client_code and bc.IsActive = 1
       left join Franchise_Master fm on fm.id = bc.FranchiseeID
      where isnull(cm.is_Active, 1) = 1 and (@div = '' or ',' + isnull(cm.DivCode, '') + ',' like '%,' + @div + ',%')
        and (@q = '' or cm.company_name like @q + '%')
      order by cm.company_name`, { div: s(user.divCode), q: search });
  return rows.map((r) => ({ client: s(r.client_code), clientName: s(r.company_name), boundTo: s(r.bound_to) }));
}

export async function bindClients(user, body) {
  const [f] = await query('select id, FranName from Franchise_Master where id = @id', { id: body.franchisee });
  if (!f) throw badRequest('Select franchisee');
  return withTransaction(async (tx) => {
    const taken = await query(
      `select bc.ClientID, cm.company_name from Bind_Franchisee_To_Client bc with (updlock, holdlock)
         join client_Master cm on cm.client_code = bc.ClientID
        where bc.IsActive = 1 and bc.ClientID in (select value from string_split(@list, ','))`,
      { list: body.clients.join(',') }, { tx });
    if (taken.length) throw conflict(`Already bound to a franchisee: ${taken.map((t) => s(t.company_name)).join(', ')}`);
    const known = await query('select client_code from client_Master where client_code in (select value from string_split(@list, \',\'))',
      { list: body.clients.join(',') }, { tx });
    if (known.length !== new Set(body.clients).size) throw badRequest('Unknown client in the list');
    for (const c of new Set(body.clients)) {
      await query('insert into Bind_Franchisee_To_Client(FranchiseeID, ClientID, IsActive, Created_By) values (@f, @c, 1, @u)',
        { f: body.franchisee, c, u: user.userId }, { tx });
    }
    return { bound: new Set(body.clients).size, message: `${new Set(body.clients).size} client(s) bound to ${s(f.FranName)}` };
  });
}

/** GET_ALL_FRANCHISEE_TO_CLIENTS_LIST_IN_VIEW(search, division). */
export async function listFranchiseeClients(user, search = '') {
  const rows = await query(
    `select bc.UniqueNo, bc.FranchiseeID, bc.ClientID, bc.IsActive, bc.Created_By, bc.Created_Date, fm.FranName, cm.company_name
       from Bind_Franchisee_To_Client bc
       left join Franchise_Master fm on fm.id = bc.FranchiseeID
       left join client_Master cm on cm.client_code = bc.ClientID
      where (@div = '' or ',' + isnull(cm.DivCode, '') + ',' like '%,' + @div + ',%')
        and (@q = '' or fm.FranName like '%' + @q + '%' or cm.company_name like '%' + @q + '%')
      order by fm.FranName, cm.company_name`, { div: s(user.divCode), q: search });
  return rows.map((r) => ({
    id: Number(r.UniqueNo), franchisee: Number(r.FranchiseeID), franchiseeName: s(r.FranName), client: s(r.ClientID),
    clientName: s(r.company_name), active: b(r.IsActive), createdBy: s(r.Created_By),
    createdDate: r.Created_Date ? new Date(r.Created_Date).toISOString().slice(0, 10) : '',
  }));
}

/** grd_franch_to_client_RowCommand "status": re-activating is refused when the client is bound elsewhere. */
export async function setFranchiseeClientStatus(user, id, active) {
  const [r] = await query('select ClientID from Bind_Franchisee_To_Client where UniqueNo = @id', { id });
  if (!r) throw notFound('Binding not found');
  if (active) {
    const [dup] = await query('select top 1 UniqueNo from Bind_Franchisee_To_Client where ClientID = @c and IsActive = 1 and UniqueNo <> @id',
      { c: s(r.ClientID), id });
    if (dup) throw conflict('Cannot activate: the client is already bound to a franchisee');
  }
  await query('update Bind_Franchisee_To_Client set IsActive = @a, Modified_By = @u, Modified_Date = getdate() where UniqueNo = @id',
    { a: active ? 1 : 0, u: user.userId, id });
  return { id, message: active ? 'Binding activated' : 'Binding deactivated' };
}
