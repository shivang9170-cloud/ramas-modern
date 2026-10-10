// Declarative definitions for the simple "General" masters.
//
// Each definition reproduces one legacy page (General/*.aspx) and the matching
// ClassLibrary DAL. SQL identifiers here are server-side constants; request
// values only ever reach SQL as parameters.
//
// Shape:
//   key, title, legacyPage       identity + the old URL (used for menu mapping)
//   table, keyField              primary table and business key column
//   fields[]                     drives validation AND the generic React form
//     { name, label, type: text|number|select|status|textarea|checkbox,
//       required, upper, max, createOnly, list, options }
//   listSql                      grid query (select * ... as the old page did)
//   statusValues                 [active, inactive] strings used by this table
//   unique[]                     { field, message } duplicate checks (excluding self)
//   inUse[]                      { sql, message } checks before delete (param @code)
//   blockUpdateWhenInUse[]       same, but blocks updates (legacy validate())
//   create/update/remove         { proc, inputs(body,user), outputs, check } | { sql, inputs }
//   mirrorFleet                  repeat write on the fleet DB (legacy *FMS methods)
//   group                        'general' (GENERAL MASTER menu) | 'master' (MASTER menu) — documentation only
//   autoCode                     { prefix, width } the Add form is opened with the next free code (prefix + number)
//   field.autofill               sql (param @v = the field's new value) returning one row whose columns are other
//                                field names: the form fills them in when the user picks / types this field
//   field.default                value of the field on a new record
//   field.quick                  { master, value } a select whose list is another master: the form offers "+ New …" to
//                                add one there and then (value = the column of the new row the select stores).
//                                Fields with options.master get it automatically (masters.service.js publicDefinition)
//   nameField                    the field a quick add pre-fills with what the user typed (default: first text field
//                                that is not the key)

import { exec, query, sql } from '../../db/index.js';
import { badRequest, HttpError } from '../../middleware/errors.js';

const ACTIVE = ['Active', 'Deactive'];

/** temp-vendor afterSave: GeneralMethods.AutoBindLedger(name, "Sundry Creditors", "Cr", "Vendor", …) per division. */
async function bindTempVendorLedgers(v, user, { tx, mode }) {
  const wanted = [...new Set(String(v.FTLDIVISION ?? '').split(',').map((d) => d.trim().toUpperCase()).filter(Boolean))];
  const known = new Set((await query('select rtrim(DivCode) as d from DivisionMaster', {}, { tx })).map((r) => String(r.d).toUpperCase()));
  const bad = wanted.filter((d) => !known.has(d));
  if (!wanted.length || bad.length) throw badRequest(bad.length ? `Unknown division: ${bad.join(', ')}` : 'Enter at least one division');
  // keep the stored list clean (DIV1001,DIV1003)
  await query('update temp_vendors_master set FTLDIVISION = @d where vendor_code = @c', { d: wanted.join(','), c: v.vendor_code }, { tx });
  const [row] = await query('select Name from temp_vendors_master where vendor_code = @c', { c: v.vendor_code }, { tx });
  const branch = user.currentBranch ?? {};
  const ledger = `${String(row?.Name ?? v.Name).trim()} :${v.vendor_code} :${branch.name ?? ''} :${branch.code ?? ''}`.toUpperCase();
  for (const div of wanted) {
    // on update only the divisions that have no ledger of this vendor yet
    if (mode === 'update') {
      const [has] = await query('select top 1 1 as x from tblAccountLedger where ltrim(rtrim(VendorOrClientCode)) = @c and Division = @div and Financial_Year = @fy',
        { c: v.vendor_code, div, fy: user.financialYear }, { tx });
      if (has) continue;
    }
    const res = await exec('usp_AutoBindLedger', {
      LedgerName: ledger, GroupName: 'Sundry Creditors', VendorOrClientCode: v.vendor_code, DrCr: 'Cr', Ledger_Type: 'Vendor',
      CreatedDate: `${String(user.financialYear).slice(0, 4)}-04-01`, Branch_Code: branch.code ?? '', Emp_Code: user.userId,
      Financial_Year: user.financialYear, division: div,
    }, { status: [sql().VarChar(500), null] }, { tx });
    if (String(res.output.status ?? '').trim().toLowerCase() !== 'success') {
      throw new HttpError(422, `Ledger "${ledger}" could not be created: ${String(res.output.status ?? '').trim()}`);
    }
  }
}
const ACTIVE_I = ['Active', 'Inactive'];
const STATE_OPTIONS = { sql: "select state_code as value, state_name as label from state_master where active_flag = 'Active' order by state_name" };
const CITY_OPTIONS = { sql: "select city_code as value, city_name as label from city_master where active_flag = 'Active' order by city_name" };
const BRANCH_OPTIONS = { sql: "select branch_code as value, branch_name as label from branch_master where status = 'Active' order by branch_name" };
const MODE_OPTIONS = { sql: 'select mode_code as value, mode_name as label from booking_mode order by mode_name' };
const Q_STATE = { master: 'state', value: 'state_code' };
const Q_CITY = { master: 'city', value: 'city_code' };

export const definitions = [
  // ------------------------------------------------------------------ State
  {
    key: 'state',
    title: 'State Master',
    legacyPage: 'General/State_Master.aspx',
    table: 'state_master',
    keyField: 'state_code',
    autoCode: { fromName: 2 },
    statusValues: ACTIVE,
    fields: [
      { name: 'state_code', label: 'State Code', type: 'text', required: true, upper: true, max: 10, createOnly: true, list: true },
      { name: 'state_name', label: 'State Name', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'StateCode', label: 'GST State Code', type: 'text', max: 5, list: true },
      { name: 'Gstin_No', label: 'GSTIN No', type: 'text', upper: true, max: 20, list: true },
      { name: 'active_flag', label: 'Status', type: 'status', list: true },
    ],
    listSql: 'select * from state_master order by state_name',
    unique: [
      { field: 'state_name', message: 'State name already exists' },
      { field: 'state_code', message: 'State code already exists', createOnly: true },
    ],
    inUse: [
      { sql: 'select top 1 1 from city_master where state_code = @code', message: 'This state is used in City Master' },
      { sql: 'select top 1 1 from DistrictMaster where DistrictState = @code', message: 'This state is used in District Master' },
      { sql: 'select top 1 1 from New_Location_master where State_code = @code', message: 'This state is used in Location Master' },
      { sql: 'select top 1 1 from Branch_Master where State_code = @code', message: 'This state is used in Branch Master' },
      { sql: 'select top 1 1 from MasterFranchise where State = @code', message: 'This state is used in Master Franchisee' },
      { sql: 'select top 1 1 from Franchise_Master where State = @code', message: 'This state is used in Franchisee Master' },
    ],
    create: {
      proc: 'usp_Insert_State_Master',
      inputs: (b) => ({ state_code: b.state_code, state_name: b.state_name, StateCode: b.StateCode, status: b.active_flag, Gstin_No: b.Gstin_No }),
      outputs: { retval: 'Int' },
    },
    update: {
      proc: 'sp_Update_state_master',
      inputs: (b) => ({ state_code: b.state_code, state_name: b.state_name, status: b.active_flag, Gstin_No: b.Gstin_No, StateCode: b.StateCode }),
      outputs: { retval: 'Int' },
    },
    remove: { proc: 'sp_Delete_state_master', inputs: (code) => ({ state_code: code }), outputs: { retval: 'Int' } },
    mirrorFleet: true,
  },

  // ------------------------------------------------------------------ Zone
  {
    key: 'zone',
    title: 'Zone Master',
    legacyPage: 'General/Zone_Master.aspx',
    table: 'zone_master',
    keyField: 'zone_code',
    autoCode: { fromName: 2 },
    statusValues: ACTIVE,
    fields: [
      { name: 'zone_code', label: 'Zone Code', type: 'text', required: true, upper: true, max: 10, createOnly: true, list: true },
      { name: 'zone_name', label: 'Zone Name', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'zone_description', label: 'Description', type: 'textarea', max: 250, list: true },
      { name: 'active_flag', label: 'Status', type: 'status', list: true },
    ],
    listSql: 'select * from zone_master order by zone_name',
    unique: [
      { field: 'zone_name', message: 'Zone name already exists' },
      { field: 'zone_code', message: 'Zone code already exists', createOnly: true },
    ],
    // zone_master_dal.validate: the page refused to update a zone used by an active city.
    blockUpdateWhenInUse: [
      { sql: "select top 1 1 from city_master where zone_code = @code and active_flag = 'Active'", message: 'Cannot update zone as it is already in use by an active city' },
    ],
    inUse: [
      { sql: 'select top 1 1 from city_master where zone_code = @code', message: 'This zone is used in City Master' },
      { sql: 'select top 1 1 from Branch_Master where zone_code = @code', message: 'This zone is used in Branch Master' },
      { sql: 'select top 1 1 from MasterFranchise where Zone = @code', message: 'This zone is used in Master Franchisee' },
      { sql: 'select top 1 1 from Franchise_Master where Zone = @code', message: 'This zone is used in Franchisee Master' },
    ],
    create: {
      proc: 'usp_Insert_Zone_Master',
      inputs: (b) => ({ zone_code: b.zone_code, zone_name: b.zone_name, zone_description: b.zone_description, active_flag: b.active_flag }),
      outputs: { retval: 'Int' },
    },
    update: {
      proc: 'Update_zone_master',
      inputs: (b) => ({ zone_code: b.zone_code, zone_name: b.zone_name, zone_description: b.zone_description, active_flag: b.active_flag }),
      outputs: { retval: 'Int' },
    },
    remove: { proc: 'Delete_zone_master', inputs: (code) => ({ zone_code: code }), outputs: { retval: 'Int' } },
    mirrorFleet: true,
  },

  // ------------------------------------------------------------------ City
  {
    key: 'city',
    title: 'City Master',
    legacyPage: 'General/City_Master.aspx',
    table: 'city_master',
    keyField: 'city_code',
    autoCode: { fromName: 3 },
    statusValues: ACTIVE,
    fields: [
      { name: 'city_code', label: 'City Code', type: 'text', required: true, upper: true, max: 10, createOnly: true, list: true },
      { name: 'city_name', label: 'City Name', type: 'text', required: true, upper: true, max: 100, list: true },
      // picking the state fills the zone most of its cities are in
      { name: 'state_code', label: 'State', type: 'select', required: true, options: { master: 'state' }, list: true, display: 'state_name',
        autofill: 'select top 1 zone_code from city_master where state_code = @v group by zone_code order by count(*) desc' },
      { name: 'zone_code', label: 'Zone', type: 'select', required: true, options: { master: 'zone' }, list: true, display: 'zone_name' },
      { name: 'Districtcode', label: 'District', type: 'select', options: { sql: "select DistrictCode as value, DistrictName as label from DistrictMaster where status='Active' order by DistrictName" }, list: true, display: 'DistrictName',
        quick: { master: 'district', value: 'DistrictCode' } },
      { name: 'oda', label: 'ODA', type: 'checkbox', yes: 'yes', no: 'no', list: true },
      { name: 'oda_km', label: 'ODA Km', type: 'number', min: 0, list: true },
      { name: 'active_flag', label: 'Status', type: 'status', list: true },
    ],
    listSql: `select c.*, s.state_name, z.zone_name, d.DistrictName
                 from city_master c
                 left join state_master s on c.state_code = s.state_code
                 left join zone_master z on c.zone_code = z.zone_code
                 left join districtmaster d on d.DistrictCode = c.Districtcode
                order by c.city_name asc`,
    unique: [
      { field: 'city_name', message: 'City name already exists', scope: ['state_code'] },
      { field: 'city_code', message: 'City code already exists', createOnly: true },
    ],
    // city_master_dal.validate + validate_city_bind_to_branch
    blockUpdateWhenInUse: [
      { sql: "select top 1 1 from Branch_Master where city_code = @code and status = 'Active'", message: 'Cannot update city as it is already in use by an active branch' },
    ],
    inUse: [
      { sql: 'select top 1 1 from New_Location_master where City_Code = @code', message: 'This city is used in Location Master' },
      { sql: 'select top 1 1 from Branch_Master where city_code = @code', message: 'This city is used in Branch Master' },
      { sql: 'select top 1 1 from client_Master where city = @code', message: 'This city is used in Client Master' },
      { sql: 'select top 1 1 from MasterFranchise where city = @code', message: 'This city is used in Master Franchisee' },
      { sql: 'select top 1 1 from Franchise_Master where city = @code', message: 'This city is used in Franchisee Master' },
    ],
    create: {
      proc: 'usp_Insert_City_Master',
      inputs: (b) => ({ city_code: b.city_code, city_name: b.city_name, state_code: b.state_code, zone_code: b.zone_code, Active_flag: b.active_flag, Districtcode: b.Districtcode }),
      // usp_Insert_City_Master has no ODA parameters, so the legacy page silently
      // dropped the ODA tick-box on create. Apply them with the update SP.
      followWithUpdate: (b) => b.oda === 'yes' || Number(b.oda_km) > 0,
    },
    update: {
      proc: 'sp_update_City_master',
      inputs: (b) => ({
        city_code: b.city_code, city_name: b.city_name, state_code: b.state_code, zone_code: b.zone_code,
        oda: b.oda, oda_km: Number(b.oda_km) || 0, activ: b.active_flag, Districtcode: b.Districtcode,
      }),
      outputs: { retval: 'Int' },
    },
    remove: { proc: 'Delete_city_master', inputs: (code) => ({ city_code: code }), outputs: { retval: 'Int' } },
    mirrorFleet: true,
  },

  // ------------------------------------------------------------------ Commodity
  {
    key: 'commodity',
    title: 'Commodity Master',
    legacyPage: 'General/Commodity_Master.aspx',
    table: 'Commodity_master',
    keyField: 'Commodity_code',
    autoCode: { prefix: 'C', width: 3 },
    statusValues: ['Active', 'Inactive'],
    fields: [
      { name: 'Commodity_code', label: 'Commodity Code', type: 'text', required: true, upper: true, max: 20, createOnly: true, list: true },
      { name: 'Commodity_name', label: 'Commodity Name', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'active_flag', label: 'Status', type: 'status', list: true },
    ],
    listSql: 'select * from Commodity_master order by Commodity_name',
    unique: [
      { field: 'Commodity_name', message: 'Commodity name already exists' },
      { field: 'Commodity_code', message: 'Commodity code already exists', createOnly: true },
    ],
    inUse: [],
    create: {
      sql: 'insert into Commodity_master(Commodity_code, Commodity_name, active_flag) values (@Commodity_code, @Commodity_name, @active_flag)',
      inputs: (b) => ({ Commodity_code: b.Commodity_code, Commodity_name: b.Commodity_name, active_flag: b.active_flag }),
    },
    update: {
      proc: 'sp_Update_Commodity_master',
      inputs: (b) => ({ Commodity_code: b.Commodity_code, Commodity_name: b.Commodity_name, status: b.active_flag }),
      outputs: { retval: 'Int' },
    },
    remove: { proc: 'sp_Delete_Commodity_master', inputs: (code) => ({ Commodity_code: code }), outputs: { retval: 'Int' } },
  },

  // ------------------------------------------------------------------ Item (package type)
  {
    key: 'item',
    title: 'Item / Package Master',
    legacyPage: 'General/Item_master.aspx',
    table: 'item_master',
    keyField: 'item_code',
    autoCode: { fromName: 3 },
    statusValues: ACTIVE,
    fields: [
      { name: 'item_code', label: 'Package Code', type: 'text', required: true, upper: true, max: 20, createOnly: true, list: true },
      { name: 'item_name', label: 'Package Name', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'active_flag', label: 'Status', type: 'status', list: true },
    ],
    listSql: 'select * from item_master order by item_code',
    unique: [
      { field: 'item_name', message: 'Package name already exists' },
      { field: 'item_code', message: 'Package code already exists', createOnly: true },
    ],
    // item_master_dal.validate: refuses changes once dockets use the package.
    blockUpdateWhenInUse: [
      { sql: 'select top 1 1 from grn_master where item_content = @code', message: 'Cannot update as package is in use' },
    ],
    inUse: [
      { sql: 'select top 1 1 from grn_master where item_content = @code', message: 'This package is used in dockets' },
    ],
    create: {
      proc: 'usp_Insert_Item_Master',
      inputs: (b) => ({ item_code: b.item_code, item_name: b.item_name, active_flag: b.active_flag }),
    },
    update: {
      sql: 'update item_master set item_name = @item_name, active_flag = @active_flag where item_code = @item_code',
      inputs: (b) => ({ item_code: b.item_code, item_name: b.item_name, active_flag: b.active_flag }),
    },
    // Legacy deleted "where slno=@item_code" (a bug that compared the id to the code).
    remove: { sql: 'delete from item_master where item_code = @item_code', inputs: (code) => ({ item_code: code }) },
  },

  // ------------------------------------------------------------------ Department
  {
    key: 'department',
    title: 'Department Master',
    legacyPage: 'General/DepartmentMaster.aspx',
    table: 'HeadOfficeDepartmentMaster',
    keyField: 'DepartmentCode',
    autoCode: { fromName: 3 },
    fields: [
      { name: 'DepartmentCode', label: 'Department Code', type: 'text', required: true, upper: true, max: 20, createOnly: true, list: true },
      { name: 'DepartmentName', label: 'Department Name', type: 'text', required: true, max: 100, list: true },
    ],
    listSql: 'select * from HeadOfficeDepartmentMaster order by DepartmentName',
    unique: [
      { field: 'DepartmentName', message: 'Department name already exists' },
      { field: 'DepartmentCode', message: 'Department code already exists', createOnly: true },
    ],
    inUse: [],
    // uspHeadOfficeDepartmentMaster @operation: 1 insert, 2 update, 3 delete
    create: { proc: 'uspHeadOfficeDepartmentMaster', inputs: (b) => ({ DepartmentCode: b.DepartmentCode, DepartmentName: b.DepartmentName, operation: 1 }) },
    update: { proc: 'uspHeadOfficeDepartmentMaster', inputs: (b) => ({ DepartmentCode: b.DepartmentCode, DepartmentName: b.DepartmentName, operation: 2 }) },
    remove: { proc: 'uspHeadOfficeDepartmentMaster', inputs: (code) => ({ DepartmentCode: code, operation: 3 }) },
  },

  // ------------------------------------------------------------------ Division
  {
    key: 'division',
    title: 'Division Master',
    legacyPage: 'General/Division_Master.aspx',
    table: 'DivisionMaster',
    keyField: 'DivCode',
    autoCode: { prefix: 'DIV', width: 4 },
    adminOnly: true,
    fields: [
      { name: 'DivCode', label: 'Division Code', type: 'text', required: true, upper: true, max: 20, createOnly: true, list: true },
      { name: 'DivName', label: 'Division Name', type: 'text', required: true, max: 100, list: true },
      { name: 'Domain', label: 'Domain', type: 'text', max: 100, list: true },
      { name: 'CompanyCode', label: 'Company', type: 'select', required: true, options: { sql: 'select SlNo as value, CName as label from CompanyMster order by CName' }, list: true, display: 'CName' },
      { name: 'IsActive', label: 'Active', type: 'checkbox', yes: 1, no: 0, list: true },
      // business profile (tblDivisionProfile): courier / TMS / international — which steps the screens show
      { name: 'BusinessType', label: 'Business type', type: 'select', required: true, list: true, default: 'COURIER',
        options: { sql: "select v as value, l as label from (values ('COURIER', 'Courier'), ('CARGO', 'Cargo / PTL (TMS)'), ('FTL', 'FTL / truck load (TMS)'), ('INTERNATIONAL', 'International (export / import)')) x(v, l)" } },
      { name: 'UseBagging', label: 'Manifest with packets / bags / master bags (courier). Off = whole docket in one entry (TMS)', type: 'checkbox', yes: 1, no: 0, list: true, default: false },
      { name: 'AllowInternational', label: 'Dockets can be Export / Import', type: 'checkbox', yes: 1, no: 0, list: true, default: true },
      { name: 'DocketsPerPacket', label: 'Auto bagging: dockets per packet', type: 'number', min: 1, default: 10 },
      { name: 'ItemsPerBag', label: 'Auto bagging: packets (or dockets) per bag', type: 'number', min: 1, default: 10 },
      { name: 'BagsPerMasterBag', label: 'Auto bagging: bags per master bag', type: 'number', min: 1, default: 10 },
    ],
    listSql: `select DM.Id, DM.DivCode, DM.DivName, DM.Domain, DM.CompanyCode, CM.CName, isnull(DM.IsActive,0) as IsActive,
                     P.BusinessType, isnull(P.UseBagging, 0) as UseBagging, isnull(P.AllowInternational, 0) as AllowInternational,
                     P.DocketsPerPacket, P.ItemsPerBag, P.BagsPerMasterBag
                from DivisionMaster DM left join CompanyMster CM on CM.SlNo = DM.CompanyCode
                left join tblDivisionProfile P on P.DivCode = DM.DivCode
               order by DM.Id`,
    rowSql: `select DM.*, P.BusinessType, isnull(P.UseBagging, 0) as UseBagging, isnull(P.AllowInternational, 0) as AllowInternational,
                    isnull(P.DocketsPerPacket, 10) as DocketsPerPacket, isnull(P.ItemsPerBag, 10) as ItemsPerBag, isnull(P.BagsPerMasterBag, 10) as BagsPerMasterBag
               from DivisionMaster DM left join tblDivisionProfile P on P.DivCode = DM.DivCode where DM.DivCode = @code`,
    afterSave: async (v, user, { tx }) => {
      await query(
        `merge tblDivisionProfile t using (select @d as DivCode) s on t.DivCode = s.DivCode
         when matched then update set BusinessType = @bt, UseBagging = @bag, AllowInternational = @intl, DocketsPerPacket = @dp,
                                      ItemsPerBag = @ib, BagsPerMasterBag = @bm, UpdatedBy = @u, UpdatedDate = getdate()
         when not matched then insert (DivCode, BusinessType, UseBagging, AllowInternational, DocketsPerPacket, ItemsPerBag, BagsPerMasterBag, UpdatedBy)
                                values (@d, @bt, @bag, @intl, @dp, @ib, @bm, @u);`,
        { d: v.DivCode, bt: v.BusinessType, bag: Number(v.UseBagging) ? 1 : 0, intl: Number(v.AllowInternational) ? 1 : 0,
          dp: Math.max(1, Number(v.DocketsPerPacket) || 10), ib: Math.max(1, Number(v.ItemsPerBag) || 10), bm: Math.max(1, Number(v.BagsPerMasterBag) || 10), u: user.userId },
        { tx });
    },
    unique: [
      { field: 'DivName', message: 'Division name already exists' },
      { field: 'DivCode', message: 'Division code already exists', createOnly: true },
    ],
    inUse: [
      { sql: 'select top 1 1 from Employee_Master where DivCode = @code', message: 'This division has employees' },
    ],
    create: {
      proc: 'usp_Insert_Division_Master',
      inputs: (b) => ({ DivCode: b.DivCode, DivName: b.DivName, CompanyCode: b.CompanyCode, Domain: b.Domain, IsActive: Number(b.IsActive) ? 1 : 0 }),
    },
    update: {
      proc: 'usp_Update_Division_Master',
      inputs: (b) => ({ DivCode: b.DivCode, DivName: b.DivName, Domain: b.Domain, CompanyCode: b.CompanyCode, IsActive: Number(b.IsActive) ? 1 : 0 }),
    },
    remove: { proc: 'sp_Delete_Division_Master', inputs: (code) => ({ DivCode: code }) },
  },

  // ================================================================== GENERAL MASTER (added 2026-10-09)
  // ------------------------------------------------------------------ District (General/District_Master.aspx)
  {
    key: 'district',
    group: 'general',
    title: 'District Master',
    legacyPage: 'General/District_Master.aspx',
    table: 'DistrictMaster',
    keyField: 'DistrictCode',
    autoCode: { prefix: 'D', width: 3 },
    statusValues: ACTIVE,
    fields: [
      { name: 'DistrictCode', label: 'District Code', type: 'text', required: true, upper: true, max: 20, createOnly: true, list: true },
      { name: 'DistrictName', label: 'District Name', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'DistrictState', label: 'State', type: 'select', required: true, options: STATE_OPTIONS, list: true, display: 'state_name', quick: Q_STATE },
      { name: 'status', label: 'Status', type: 'status', list: true },
    ],
    listSql: `select d.*, s.state_name from DistrictMaster d left join state_master s on s.state_code = d.DistrictState
               order by d.DistrictName`,
    unique: [
      { field: 'DistrictName', message: 'District name already exists in this state', scope: ['DistrictState'] },
      { field: 'DistrictCode', message: 'District code already exists', createOnly: true },
    ],
    inUse: [{ sql: 'select top 1 1 from city_master where Districtcode = @code', message: 'This district is used in City Master' }],
    create: {
      sql: 'insert into DistrictMaster(DistrictCode, DistrictName, DistrictState, status) values (@DistrictCode, @DistrictName, @DistrictState, @status)',
      inputs: (b) => ({ DistrictCode: b.DistrictCode, DistrictName: b.DistrictName, DistrictState: b.DistrictState, status: b.status }),
    },
    update: {
      sql: 'update DistrictMaster set DistrictName = @DistrictName, DistrictState = @DistrictState, status = @status where DistrictCode = @DistrictCode',
      inputs: (b) => ({ DistrictCode: b.DistrictCode, DistrictName: b.DistrictName, DistrictState: b.DistrictState, status: b.status }),
    },
    remove: { sql: 'delete from DistrictMaster where DistrictCode = @c', inputs: (code) => ({ c: code }) },
  },

  // ------------------------------------------------------------------ Location (General/NewLocationMaster.aspx)
  {
    key: 'location',
    group: 'general',
    title: 'Location Master',
    legacyPage: 'General/NewLocationMaster.aspx',
    table: 'New_Location_master',
    keyField: 'Location_Code',
    autoCode: { prefix: 'L', width: 3 },
    statusValues: ACTIVE,
    fields: [
      { name: 'Location_Code', label: 'Location Code', type: 'text', required: true, upper: true, max: 20, createOnly: true, list: true },
      { name: 'Location_Name', label: 'Location Name', type: 'text', required: true, upper: true, max: 100, list: true },
      // picking the city fills its state and the branch serving it
      { name: 'City_Code', label: 'City', type: 'select', required: true, options: CITY_OPTIONS, list: true, display: 'city_name', quick: Q_CITY,
        autofill: `select c.state_code as State_code,
                          coalesce((select top 1 branch_code from branch_master where city_code = c.city_code and status = 'Active' order by branch_code),
                                   (select top 1 branch_code from New_Location_master where City_Code = c.city_code group by branch_code order by count(*) desc)) as branch_code
                     from city_master c where c.city_code = @v` },
      { name: 'State_code', label: 'State', type: 'select', required: true, options: STATE_OPTIONS, list: true, display: 'state_name', quick: Q_STATE },
      { name: 'branch_code', label: 'Branch', type: 'select', required: true, options: BRANCH_OPTIONS, list: true, display: 'branch_name' },
      { name: 'Pin_Code', label: 'Pin Code', type: 'text', max: 10, list: true },
      { name: 'IsActinve_Flag', label: 'Status', type: 'status', list: true },
    ],
    listSql: `select l.*, c.city_name, s.state_name, b.branch_name from New_Location_master l
                left join city_master c on c.city_code = l.City_Code
                left join state_master s on s.state_code = l.State_code
                left join branch_master b on b.branch_code = l.branch_code
               order by l.Location_Name`,
    unique: [
      { field: 'Location_Name', message: 'Location name already exists in this city', scope: ['City_Code'] },
      { field: 'Location_Code', message: 'Location code already exists', createOnly: true },
    ],
    inUse: [
      { sql: 'select top 1 1 from branch_master where location = @code', message: 'This location is used in Branch Master' },
      { sql: 'select top 1 1 from Pick_Up_grn where Location_Code = @code', message: 'This location is used in pickups' },
      { sql: 'select top 1 1 from ODA_Charge where Location_Code = @code', message: 'This location is used in ODA Charge' },
      { sql: 'select top 1 1 from employee_master where vc_Location_Code = @code', message: 'This location is used in Employee Master' },
      { sql: 'select top 1 1 from client_contract_location where destination_location = @code', message: 'This location is used in client contracts' },
    ],
    create: {
      sql: `insert into New_Location_master(Location_Code, Location_Name, City_Code, State_code, branch_code, Pin_Code, IsActinve_Flag)
            values (@Location_Code, @Location_Name, @City_Code, @State_code, @branch_code, @Pin_Code, @IsActinve_Flag)`,
      inputs: (b) => ({ Location_Code: b.Location_Code, Location_Name: b.Location_Name, City_Code: b.City_Code, State_code: b.State_code,
        branch_code: b.branch_code, Pin_Code: b.Pin_Code, IsActinve_Flag: b.IsActinve_Flag }),
    },
    update: {
      sql: `update New_Location_master set Location_Name = @Location_Name, City_Code = @City_Code, State_code = @State_code,
              branch_code = @branch_code, Pin_Code = @Pin_Code, IsActinve_Flag = @IsActinve_Flag where Location_Code = @Location_Code`,
      inputs: (b) => ({ Location_Code: b.Location_Code, Location_Name: b.Location_Name, City_Code: b.City_Code, State_code: b.State_code,
        branch_code: b.branch_code, Pin_Code: b.Pin_Code, IsActinve_Flag: b.IsActinve_Flag }),
    },
    remove: { sql: 'delete from New_Location_master where Location_Code = @c', inputs: (code) => ({ c: code }) },
  },

  // ------------------------------------------------------------------ Container / freight type (General/Container_Master.aspx)
  {
    key: 'container',
    group: 'general',
    title: 'Container / Freight Type Master',
    legacyPage: 'General/Container_Master.aspx',
    table: 'freight_master',
    keyField: 'container_code',
    autoCode: { fromName: 3 },
    statusValues: ACTIVE,
    fields: [
      { name: 'container_code', label: 'Code', type: 'text', required: true, upper: true, max: 20, createOnly: true, list: true },
      { name: 'freight_name', label: 'Name', type: 'text', required: true, upper: true, max: 60, list: true },
      { name: 'container_Capacity', label: 'Capacity (kg)', type: 'number', min: 0, list: true },
      { name: 'ContainerSize', label: 'Size', type: 'text', upper: true, max: 50, list: true },
      { name: 'Container_Type', label: 'Type', type: 'text', upper: true, max: 50, list: true },
      { name: 'Bodys', label: 'Body', type: 'text', upper: true, max: 50, list: true },
      { name: 'VehicleMode', label: 'Vehicle Mode', type: 'text', upper: true, max: 50, list: true, default: 'ROAD' },
      { name: 'NoOfWheel', label: 'No. of Wheels', type: 'number', min: 0, list: true },
      { name: 'active_flag', label: 'Status', type: 'status', list: true },
    ],
    listSql: 'select * from freight_master order by freight_name',
    unique: [
      { field: 'freight_name', message: 'Name already exists' },
      { field: 'container_code', message: 'Code already exists', createOnly: true },
    ],
    inUse: [
      { sql: 'select top 1 1 from Vechile_Master where VehicelType = @code', message: 'This type is used in Vehicle Master' },
      { sql: 'select top 1 1 from dispatch_master d join freight_master f on f.freight_name = d.frt_type where f.container_code = @code', message: 'This type is used in challans' },
    ],
    create: {
      sql: `insert into freight_master(container_code, freight_name, container_Capacity, ContainerSize, Container_Type, Bodys, VehicleMode, NoOfWheel, active_flag)
            values (@container_code, @freight_name, @container_Capacity, @ContainerSize, @Container_Type, @Bodys, @VehicleMode, @NoOfWheel, @active_flag)`,
      inputs: (b) => ({ ...b }),
    },
    update: {
      sql: `update freight_master set freight_name = @freight_name, container_Capacity = @container_Capacity, ContainerSize = @ContainerSize,
              Container_Type = @Container_Type, Bodys = @Bodys, VehicleMode = @VehicleMode, NoOfWheel = @NoOfWheel, active_flag = @active_flag
            where container_code = @container_code`,
      inputs: (b) => ({ ...b }),
    },
    remove: { sql: 'delete from freight_master where container_code = @c', inputs: (code) => ({ c: code }) },
  },

  // ------------------------------------------------------------------ Vehicle name (General/VehicleName_Master.aspx)
  {
    key: 'vehicle-name',
    group: 'general',
    title: 'Vehicle Name Master',
    legacyPage: 'General/VehicleName_Master.aspx',
    table: 'VehicleName_Master',
    keyField: 'no',
    statusValues: ACTIVE,
    fields: [
      { name: 'vehicle_name', label: 'Vehicle Name', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'active_flag', label: 'Status', type: 'status', list: true },
    ],
    listSql: 'select * from VehicleName_Master order by vehicle_name',
    unique: [{ field: 'vehicle_name', message: 'Vehicle name already exists' }],
    inUse: [{ sql: 'select top 1 1 from vendor_vehicle_master v join VehicleName_Master n on n.vehicle_name = v.vehicle_name where n.no = @code', message: 'This name is used in Vendor And Vehicle' }],
    create: { sql: 'insert into VehicleName_Master(vehicle_name, active_flag) values (@vehicle_name, @active_flag)', inputs: (b) => ({ vehicle_name: b.vehicle_name, active_flag: b.active_flag }) },
    update: { sql: 'update VehicleName_Master set vehicle_name = @vehicle_name, active_flag = @active_flag where no = @no', inputs: (b) => ({ no: Number(b.no), vehicle_name: b.vehicle_name, active_flag: b.active_flag }) },
    remove: { sql: 'delete from VehicleName_Master where no = @no', inputs: (code) => ({ no: Number(code) }) },
  },

  // ------------------------------------------------------------------ Vehicle maker (makes for the Vehicle Master)
  {
    key: 'vehicle-maker',
    group: 'general',
    title: 'Vehicle Maker Master',
    legacyPage: 'General/Vehicle_Maker_Master.aspx',
    table: 'Vehicle_master',
    keyField: 'slno',
    statusValues: ACTIVE,
    fields: [
      { name: 'vehicle_name', label: 'Maker Name', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'active_flag', label: 'Status', type: 'status', list: true },
    ],
    listSql: 'select * from Vehicle_master order by vehicle_name',
    unique: [{ field: 'vehicle_name', message: 'Maker already exists' }],
    inUse: [{ sql: 'select top 1 1 from Vechile_Master where VehicleName_id_fk = @code', message: 'This maker is used in Vehicle Master' }],
    create: { sql: 'insert into Vehicle_master(vehicle_name, active_flag) values (@vehicle_name, @active_flag)', inputs: (b) => ({ vehicle_name: b.vehicle_name, active_flag: b.active_flag }) },
    update: { sql: 'update Vehicle_master set vehicle_name = @vehicle_name, active_flag = @active_flag where slno = @slno', inputs: (b) => ({ slno: Number(b.slno), vehicle_name: b.vehicle_name, active_flag: b.active_flag }) },
    remove: { sql: 'delete from Vehicle_master where slno = @slno', inputs: (code) => ({ slno: Number(code) }) },
  },

  // ------------------------------------------------------------------ Train (General/Train_Master.aspx)
  {
    key: 'train',
    group: 'general',
    title: 'Train Master',
    legacyPage: 'General/Train_Master.aspx',
    table: 'Train_Master',
    keyField: 'TrainCode',
    statusValues: ACTIVE,
    fields: [
      { name: 'TrainCode', label: 'Train No.', type: 'text', required: true, upper: true, max: 20, createOnly: true, list: true },
      { name: 'TrainName', label: 'Train Name', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'Directions', label: 'Direction', type: 'select', required: true, options: { sql: "select v as value, v as label from (values ('UP'), ('DOWN')) x(v)" }, list: true, default: 'UP' },
      { name: 'active_flag', label: 'Status', type: 'status', list: true },
    ],
    listSql: 'select * from Train_Master order by TrainCode',
    unique: [{ field: 'TrainCode', message: 'Train no. already exists', createOnly: true }],
    inUse: [{ sql: 'select top 1 1 from Vendor_Train_Rate where train_no = @code', message: 'This train is used in Vendor Train Rate' }],
    create: {
      sql: 'insert into Train_Master(TrainCode, TrainName, Directions, active_flag) values (@TrainCode, @TrainName, @Directions, @active_flag)',
      inputs: (b) => ({ TrainCode: b.TrainCode, TrainName: b.TrainName, Directions: b.Directions, active_flag: b.active_flag }),
    },
    update: {
      sql: 'update Train_Master set TrainName = @TrainName, Directions = @Directions, active_flag = @active_flag where TrainCode = @TrainCode',
      inputs: (b) => ({ TrainCode: b.TrainCode, TrainName: b.TrainName, Directions: b.Directions, active_flag: b.active_flag }),
    },
    remove: { sql: 'delete from Train_Master where TrainCode = @c', inputs: (code) => ({ c: code }) },
  },

  // ------------------------------------------------------------------ Courier company (Master/Courier_Master.aspx)
  {
    key: 'courier',
    group: 'general',
    title: 'Courier Master',
    legacyPage: 'Master/Courier_Master.aspx',
    table: 'Courier',
    keyField: 'CCode',
    autoCode: { prefix: 'C', width: 2 },
    fields: [
      { name: 'CCode', label: 'Courier Code', type: 'text', required: true, upper: true, max: 20, createOnly: true, list: true },
      { name: 'CName', label: 'Courier Name', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'Active', label: 'Active', type: 'checkbox', yes: 1, no: 0, list: true, default: true },
    ],
    listSql: 'select * from Courier order by CName',
    unique: [
      { field: 'CName', message: 'Courier name already exists' },
      { field: 'CCode', message: 'Courier code already exists', createOnly: true },
    ],
    inUse: [{ sql: 'select top 1 1 from POD_Dispatch_H where CCode = @code', message: 'This courier is used on POD courier documents' }],
    create: { sql: 'insert into Courier(CCode, CName, Active) values (@CCode, @CName, @Active)', inputs: (b) => ({ CCode: b.CCode, CName: b.CName, Active: b.Active }) },
    update: { sql: 'update Courier set CName = @CName, Active = @Active where CCode = @CCode', inputs: (b) => ({ CCode: b.CCode, CName: b.CName, Active: b.Active }) },
    remove: { sql: 'delete from Courier where CCode = @c', inputs: (code) => ({ c: code }) },
  },

  // ------------------------------------------------------------------ Product / service for vendor invoices (General/Product_Master.aspx)
  {
    key: 'product',
    group: 'general',
    title: 'Product / Service Master',
    legacyPage: 'General/Product_Master.aspx',
    table: 'ProductMaster',
    keyField: 'ProductCode',
    autoCode: { prefix: 'P', width: 3 },
    fields: [
      { name: 'ProductCode', label: 'Code', type: 'text', required: true, upper: true, max: 20, createOnly: true, list: true },
      { name: 'ProductName', label: 'Name', type: 'text', required: true, upper: true, max: 200, list: true },
      { name: 'IsSacHsn', label: 'Service (SAC code) — untick for goods (HSN)', type: 'checkbox', yes: 1, no: 0, list: true },
      { name: 'SacHSN', label: 'SAC / HSN Code', type: 'text', max: 20, list: true },
      { name: 'UOM', label: 'Unit (UOM)', type: 'text', upper: true, max: 20, list: true, default: 'PCS' },
      { name: 'Status', label: 'Active', type: 'checkbox', yes: 1, no: 0, list: true, default: true },
    ],
    listSql: 'select * from ProductMaster order by ProductName',
    unique: [
      { field: 'ProductName', message: 'Name already exists' },
      { field: 'ProductCode', message: 'Code already exists', createOnly: true },
    ],
    inUse: [{ sql: 'select top 1 1 from OtherVendorInvoice_Details where ItemCode = @code', message: 'This item is used on vendor invoices' }],
    create: {
      sql: `insert into ProductMaster(ProductCode, ProductName, IsSacHsn, SacHSN, UOM, Status, created_date)
            values (@ProductCode, @ProductName, @IsSacHsn, @SacHSN, @UOM, @Status, getdate())`,
      inputs: (b) => ({ ProductCode: b.ProductCode, ProductName: b.ProductName, IsSacHsn: b.IsSacHsn, SacHSN: b.SacHSN, UOM: b.UOM, Status: b.Status }),
    },
    update: {
      sql: 'update ProductMaster set ProductName = @ProductName, IsSacHsn = @IsSacHsn, SacHSN = @SacHSN, UOM = @UOM, Status = @Status where ProductCode = @ProductCode',
      inputs: (b) => ({ ProductCode: b.ProductCode, ProductName: b.ProductName, IsSacHsn: b.IsSacHsn, SacHSN: b.SacHSN, UOM: b.UOM, Status: b.Status }),
    },
    remove: { sql: 'delete from ProductMaster where ProductCode = @c', inputs: (code) => ({ c: code }) },
  },

  // ------------------------------------------------------------------ Booking mode (Road / Air / Train ...)
  {
    key: 'booking-mode',
    group: 'general',
    title: 'Booking Mode Master',
    legacyPage: 'General/Booking_Mode_Master.aspx',
    table: 'booking_mode',
    keyField: 'mode_code',
    fields: [
      { name: 'mode_code', label: 'Mode Code', type: 'text', required: true, upper: true, max: 10, createOnly: true, list: true },
      { name: 'mode_name', label: 'Mode Name', type: 'text', required: true, upper: true, max: 50, list: true },
    ],
    listSql: 'select * from booking_mode order by mode_name',
    unique: [
      { field: 'mode_name', message: 'Mode name already exists' },
      { field: 'mode_code', message: 'Mode code already exists', createOnly: true },
    ],
    inUse: [
      { sql: 'select top 1 1 from grn_master where booking_mode = @code', message: 'This mode is used on dockets' },
      { sql: 'select top 1 1 from client_rate where mode_id = @code', message: 'This mode is used in client rates' },
    ],
    create: { sql: 'insert into booking_mode(mode_code, mode_name) values (@mode_code, @mode_name)', inputs: (b) => ({ mode_code: b.mode_code, mode_name: b.mode_name }) },
    update: { sql: 'update booking_mode set mode_name = @mode_name where mode_code = @mode_code', inputs: (b) => ({ mode_code: b.mode_code, mode_name: b.mode_name }) },
    remove: { sql: 'delete from booking_mode where mode_code = @c', inputs: (code) => ({ c: code }) },
  },

  // ------------------------------------------------------------------ Delivery mode (door / godown)
  {
    key: 'delivery-mode',
    group: 'general',
    title: 'Delivery Mode Master',
    legacyPage: 'General/Delivery_Mode_Master.aspx',
    table: 'delivery_mode_master',
    keyField: 'mode_code',
    autoCode: { prefix: 'DM-', width: 3 },
    fields: [
      { name: 'mode_code', label: 'Mode Code', type: 'text', required: true, upper: true, max: 20, createOnly: true, list: true },
      { name: 'mode_name', label: 'Mode Name', type: 'text', required: true, upper: true, max: 50, list: true },
    ],
    listSql: 'select * from delivery_mode_master order by mode_code',
    unique: [
      { field: 'mode_name', message: 'Mode name already exists' },
      { field: 'mode_code', message: 'Mode code already exists', createOnly: true },
    ],
    inUse: [{ sql: 'select top 1 1 from grn_master where delivery_mode = @code', message: 'This mode is used on dockets' }],
    create: { sql: 'insert into delivery_mode_master(mode_code, mode_name) values (@mode_code, @mode_name)', inputs: (b) => ({ mode_code: b.mode_code, mode_name: b.mode_name }) },
    update: { sql: 'update delivery_mode_master set mode_name = @mode_name where mode_code = @mode_code', inputs: (b) => ({ mode_code: b.mode_code, mode_name: b.mode_name }) },
    remove: { sql: 'delete from delivery_mode_master where mode_code = @c', inputs: (code) => ({ c: code }) },
  },

  // ------------------------------------------------------------------ Other charge heads on a docket
  {
    key: 'charge-code',
    group: 'general',
    title: 'Charge Code Master',
    legacyPage: 'General/Charge_Code_Master.aspx',
    table: 'charge_code_master',
    keyField: 'mode_code',
    autoCode: { prefix: 'CH', width: 2 },
    fields: [
      { name: 'mode_code', label: 'Charge Code', type: 'text', required: true, upper: true, max: 20, createOnly: true, list: true },
      { name: 'mode_name', label: 'Charge Name', type: 'text', required: true, upper: true, max: 50, list: true },
      // is_tax = 1: a "charge after tax" on the docket (added after GST, no GST on it); 0: a taxable additional charge
      { name: 'is_tax', label: 'Charged after tax (no GST on it)', type: 'checkbox', yes: 1, no: 0, list: true },
    ],
    listSql: 'select * from charge_code_master order by mode_code',
    unique: [
      { field: 'mode_name', message: 'Charge name already exists' },
      { field: 'mode_code', message: 'Charge code already exists', createOnly: true },
    ],
    inUse: [],
    create: { sql: 'insert into charge_code_master(mode_code, mode_name, is_tax) values (@mode_code, @mode_name, @is_tax)', inputs: (b) => ({ mode_code: b.mode_code, mode_name: b.mode_name, is_tax: b.is_tax }) },
    update: { sql: 'update charge_code_master set mode_name = @mode_name, is_tax = @is_tax where mode_code = @mode_code', inputs: (b) => ({ mode_code: b.mode_code, mode_name: b.mode_name, is_tax: b.is_tax }) },
    remove: { sql: 'delete from charge_code_master where mode_code = @c', inputs: (code) => ({ c: code }) },
  },

  // ------------------------------------------------------------------ Reasons for an undelivered docket (DRS / delivery status)
  {
    key: 'undelivered-reason',
    group: 'general',
    title: 'Undelivered Reason Master',
    legacyPage: 'General/Sla_Stock_Reason_Master.aspx',
    table: 'Drs_status_reason',
    keyField: 'id',
    fields: [{ name: 'status_reason', label: 'Reason', type: 'text', required: true, upper: true, max: 100, list: true }],
    listSql: 'select * from Drs_status_reason order by status_reason',
    unique: [{ field: 'status_reason', message: 'Reason already exists' }],
    inUse: [],
    create: { sql: 'insert into Drs_status_reason(status_reason) values (@status_reason)', inputs: (b) => ({ status_reason: b.status_reason }) },
    update: { sql: 'update Drs_status_reason set status_reason = @status_reason where id = @id', inputs: (b) => ({ id: Number(b.id), status_reason: b.status_reason }) },
    remove: { sql: 'delete from Drs_status_reason where id = @id', inputs: (code) => ({ id: Number(code) }) },
  },

  // ------------------------------------------------------------------ Nature of business (client master)
  {
    key: 'nature-of-business',
    group: 'general',
    title: 'Nature Of Business Master',
    legacyPage: 'General/Nature_Of_Business_Master.aspx',
    table: 'nature_of_business_master',
    keyField: 'ID',
    fields: [
      { name: 'nob_name', label: 'Nature Of Business', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'IsActive', label: 'Active', type: 'checkbox', yes: 1, no: 0, list: true },
    ],
    listSql: 'select * from nature_of_business_master order by nob_name',
    unique: [{ field: 'nob_name', message: 'Already exists' }],
    inUse: [{ sql: 'select top 1 1 from client_Master where nature_of_business_id = @code', message: 'This is used in Client Master' }],
    create: { sql: 'insert into nature_of_business_master(nob_name, IsActive) values (@nob_name, @IsActive)', inputs: (b) => ({ nob_name: b.nob_name, IsActive: b.IsActive }) },
    update: { sql: 'update nature_of_business_master set nob_name = @nob_name, IsActive = @IsActive where ID = @ID', inputs: (b) => ({ ID: Number(b.ID), nob_name: b.nob_name, IsActive: b.IsActive }) },
    remove: { sql: 'delete from nature_of_business_master where ID = @ID', inputs: (code) => ({ ID: Number(code) }) },
  },

  // ------------------------------------------------------------------ Road distance city to city (General/Distance_Master.aspx) — used by KM rates
  {
    key: 'distance',
    group: 'general',
    title: 'Distance Master',
    legacyPage: 'General/Distance_Master.aspx',
    table: 'Distance_Master',
    keyField: 'slno',
    fields: [
      { name: 'from_city_code', label: 'From City', type: 'select', required: true, options: CITY_OPTIONS, list: true, display: 'from_city', quick: Q_CITY },
      { name: 'to_city_code', label: 'To City', type: 'select', required: true, options: CITY_OPTIONS, list: true, display: 'to_city', quick: Q_CITY },
      { name: 'distance', label: 'Distance (km)', type: 'number', min: 0, required: true, list: true },
      { name: 'distance_status', label: 'Active', type: 'checkbox', yes: 'True', no: 'False', list: true, default: true },
    ],
    listSql: `select d.*, f.city_name as from_city, t.city_name as to_city from Distance_Master d
                left join city_master f on f.city_code = d.from_city_code left join city_master t on t.city_code = d.to_city_code
               order by f.city_name, t.city_name`,
    unique: [{ field: 'to_city_code', message: 'Distance between these cities already exists', scope: ['from_city_code'] }],
    inUse: [],
    create: {
      sql: 'insert into Distance_Master(from_city_code, to_city_code, distance, distance_status) values (@f, @t, @d, @s)',
      inputs: (b) => ({ f: b.from_city_code, t: b.to_city_code, d: b.distance, s: b.distance_status }),
    },
    update: {
      sql: 'update Distance_Master set from_city_code = @f, to_city_code = @t, distance = @d, distance_status = @s where slno = @id',
      inputs: (b) => ({ id: Number(b.slno), f: b.from_city_code, t: b.to_city_code, d: b.distance, s: b.distance_status }),
    },
    remove: { sql: 'delete from Distance_Master where slno = @id', inputs: (code) => ({ id: Number(code) }) },
  },

  // ------------------------------------------------------------------ SAC codes used on bills
  {
    key: 'sac',
    group: 'general',
    title: 'SAC Code Master',
    legacyPage: 'General/Sac_Master.aspx',
    table: 'Sac_Master',
    keyField: 'id',
    nameField: 'Sac_Code',   // a SAC typed in a bill's drop-down becomes the new record's code
    fields: [
      { name: 'ServiceType', label: 'Service Type', type: 'text', required: true, upper: true, max: 50, list: true },
      { name: 'SubServiceType', label: 'Service Description', type: 'text', required: true, max: 200, list: true },
      { name: 'Sac_Code', label: 'SAC Code', type: 'text', required: true, max: 20, list: true },
    ],
    listSql: 'select * from Sac_Master order by id',
    unique: [{ field: 'SubServiceType', message: 'This service already exists', scope: ['ServiceType'] }],
    inUse: [],
    create: { sql: 'insert into Sac_Master(ServiceType, SubServiceType, Sac_Code) values (@a, @b, @c)', inputs: (b) => ({ a: b.ServiceType, b: b.SubServiceType, c: b.Sac_Code }) },
    update: { sql: 'update Sac_Master set ServiceType = @a, SubServiceType = @b, Sac_Code = @c where id = @id', inputs: (b) => ({ id: Number(b.id), a: b.ServiceType, b: b.SubServiceType, c: b.Sac_Code }) },
    remove: { sql: 'delete from Sac_Master where id = @id', inputs: (code) => ({ id: Number(code) }) },
  },

  // ------------------------------------------------------------------ Designation (General/Designation_Master.aspx) — employee master
  {
    key: 'designation',
    group: 'general',
    title: 'Designation Master',
    legacyPage: 'General/Designation_Master.aspx',
    table: 'emp_type_master',
    keyField: 'emp_type_code',
    autoCode: { fromName: 3 },
    statusValues: ACTIVE,
    fields: [
      { name: 'emp_type_code', label: 'Designation Code', type: 'text', required: true, upper: true, max: 20, createOnly: true, list: true },
      { name: 'emp_type_name', label: 'Designation', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'desig_status', label: 'Status', type: 'status', list: true },
    ],
    listSql: 'select * from emp_type_master order by emp_type_name',
    unique: [
      { field: 'emp_type_name', message: 'Designation already exists' },
      { field: 'emp_type_code', message: 'Designation code already exists', createOnly: true },
    ],
    // emp_type_master_dal.validate: no changes once employees have the designation
    inUse: [{ sql: 'select top 1 1 from employee_master where emptype = @code', message: 'This designation is given to employees' }],
    create: {
      sql: 'insert into emp_type_master(emp_type_code, emp_type_name, desig_status) values (@c, @n, @s)',
      inputs: (b) => ({ c: b.emp_type_code, n: b.emp_type_name, s: b.desig_status }),
    },
    update: {
      sql: 'update emp_type_master set emp_type_name = @n, desig_status = @s where emp_type_code = @c',
      inputs: (b) => ({ c: b.emp_type_code, n: b.emp_type_name, s: b.desig_status }),
    },
    remove: { sql: 'delete from emp_type_master where emp_type_code = @c', inputs: (code) => ({ c: code }) },
  },

  // ================================================================== international (47-business-international.sql)
  // ------------------------------------------------------------------ Currency (with the rate to rupees)
  {
    key: 'currency',
    group: 'general',
    title: 'Currency Master',
    legacyPage: 'General/Currency_Master.aspx',
    table: 'tblCurrency',
    keyField: 'CurrencyCode',
    fields: [
      { name: 'CurrencyCode', label: 'Currency Code (ISO, e.g. USD)', type: 'text', required: true, upper: true, max: 3, createOnly: true, list: true },
      { name: 'CurrencyName', label: 'Currency Name', type: 'text', required: true, upper: true, max: 60, list: true },
      { name: 'Symbol', label: 'Symbol', type: 'text', max: 5, list: true },
      { name: 'RateToINR', label: 'Rate: 1 unit = Rs.', type: 'number', min: 0, required: true, list: true, default: 1 },
      { name: 'IsActive', label: 'Active', type: 'checkbox', yes: 1, no: 0, list: true },
    ],
    listSql: 'select * from tblCurrency order by CurrencyCode',
    unique: [{ field: 'CurrencyCode', message: 'Currency already exists', createOnly: true }],
    inUse: [{ sql: 'select top 1 1 from docket_international where CurrencyCode = @code', message: 'This currency is used on dockets' }],
    create: {
      sql: 'insert into tblCurrency(CurrencyCode, CurrencyName, Symbol, RateToINR, RateDate, IsActive) values (@c, @n, @s, @r, cast(getdate() as date), @a)',
      inputs: (b) => ({ c: b.CurrencyCode, n: b.CurrencyName, s: b.Symbol, r: b.RateToINR, a: b.IsActive }),
    },
    update: {
      sql: `update tblCurrency set CurrencyName = @n, Symbol = @s, IsActive = @a,
              RateDate = case when RateToINR <> @r then cast(getdate() as date) else RateDate end, RateToINR = @r where CurrencyCode = @c`,
      inputs: (b) => ({ c: b.CurrencyCode, n: b.CurrencyName, s: b.Symbol, r: b.RateToINR, a: b.IsActive }),
    },
    remove: { sql: 'delete from tblCurrency where CurrencyCode = @c', inputs: (code) => ({ c: code }) },
  },

  // ------------------------------------------------------------------ Country
  {
    key: 'country',
    group: 'general',
    title: 'Country Master',
    legacyPage: 'General/Country_Master.aspx',
    table: 'tblCountry',
    keyField: 'CountryCode',
    autoCode: { fromName: 2 },
    fields: [
      { name: 'CountryCode', label: 'Country Code (ISO, e.g. AE)', type: 'text', required: true, upper: true, max: 2, createOnly: true, list: true },
      { name: 'CountryName', label: 'Country Name', type: 'text', required: true, upper: true, max: 80, list: true },
      { name: 'IsdCode', label: 'ISD Code', type: 'text', max: 6, list: true },
      { name: 'CurrencyCode', label: 'Currency', type: 'select', list: true, quick: { master: 'currency', value: 'CurrencyCode' },
        options: { sql: 'select CurrencyCode as value, CurrencyName as label from tblCurrency where IsActive = 1 order by CurrencyCode' } },
      { name: 'IsActive', label: 'Active', type: 'checkbox', yes: 1, no: 0, list: true },
    ],
    listSql: 'select * from tblCountry order by CountryName',
    unique: [
      { field: 'CountryName', message: 'Country already exists' },
      { field: 'CountryCode', message: 'Country code already exists', createOnly: true },
    ],
    inUse: [
      { sql: 'select top 1 1 from tblPort where CountryCode = @code', message: 'This country has ports' },
      { sql: 'select top 1 1 from docket_international where OriginCountry = @code or DestinationCountry = @code', message: 'This country is used on dockets' },
    ],
    create: {
      sql: 'insert into tblCountry(CountryCode, CountryName, IsdCode, CurrencyCode, IsActive) values (@c, @n, @i, @cur, @a)',
      inputs: (b) => ({ c: b.CountryCode, n: b.CountryName, i: b.IsdCode, cur: b.CurrencyCode, a: b.IsActive }),
    },
    update: {
      sql: 'update tblCountry set CountryName = @n, IsdCode = @i, CurrencyCode = @cur, IsActive = @a where CountryCode = @c',
      inputs: (b) => ({ c: b.CountryCode, n: b.CountryName, i: b.IsdCode, cur: b.CurrencyCode, a: b.IsActive }),
    },
    remove: { sql: 'delete from tblCountry where CountryCode = @c', inputs: (code) => ({ c: code }) },
  },

  // ------------------------------------------------------------------ Port / airport / ICD
  {
    key: 'port',
    group: 'general',
    title: 'Port / Airport Master',
    legacyPage: 'General/Port_Master.aspx',
    table: 'tblPort',
    keyField: 'PortCode',
    autoCode: { fromName: 3 },
    fields: [
      { name: 'PortCode', label: 'Code (IATA airport / UN-LOCODE)', type: 'text', required: true, upper: true, max: 10, createOnly: true, list: true },
      { name: 'PortName', label: 'Port / Airport Name', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'PortType', label: 'Type', type: 'select', required: true, list: true, default: 'AIR',
        options: { sql: "select v as value, l as label from (values ('AIR', 'Airport'), ('SEA', 'Sea port'), ('ICD', 'Inland container depot'), ('LAND', 'Land border')) x(v, l)" } },
      { name: 'CountryCode', label: 'Country', type: 'select', required: true, list: true, display: 'CountryName', quick: { master: 'country', value: 'CountryCode' },
        options: { sql: 'select CountryCode as value, CountryName as label from tblCountry where IsActive = 1 order by CountryName' } },
      { name: 'CityName', label: 'City', type: 'text', upper: true, max: 60, list: true },
      { name: 'IsActive', label: 'Active', type: 'checkbox', yes: 1, no: 0, list: true },
    ],
    listSql: 'select p.*, c.CountryName from tblPort p left join tblCountry c on c.CountryCode = p.CountryCode order by c.CountryName, p.PortName',
    unique: [{ field: 'PortCode', message: 'Code already exists', createOnly: true }],
    inUse: [{ sql: 'select top 1 1 from docket_international where OriginPort = @code or DestinationPort = @code', message: 'This port is used on dockets' }],
    create: {
      sql: 'insert into tblPort(PortCode, PortName, PortType, CountryCode, CityName, IsActive) values (@c, @n, @t, @cty, @city, @a)',
      inputs: (b) => ({ c: b.PortCode, n: b.PortName, t: b.PortType, cty: b.CountryCode, city: b.CityName, a: b.IsActive }),
    },
    update: {
      sql: 'update tblPort set PortName = @n, PortType = @t, CountryCode = @cty, CityName = @city, IsActive = @a where PortCode = @c',
      inputs: (b) => ({ c: b.PortCode, n: b.PortName, t: b.PortType, cty: b.CountryCode, city: b.CityName, a: b.IsActive }),
    },
    remove: { sql: 'delete from tblPort where PortCode = @c', inputs: (code) => ({ c: code }) },
  },

  // ------------------------------------------------------------------ Airline / shipping line / international courier (General/AirLine_Master.aspx, Sea_Master.aspx)
  {
    key: 'carrier',
    group: 'general',
    title: 'Airline / Shipping Line Master',
    legacyPage: 'General/AirLine_Master.aspx',
    table: 'tblCarrier',
    keyField: 'CarrierCode',
    autoCode: { fromName: 2 },
    fields: [
      { name: 'CarrierCode', label: 'Code (airline IATA / SCAC)', type: 'text', required: true, upper: true, max: 10, createOnly: true, list: true },
      { name: 'CarrierName', label: 'Name', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'CarrierType', label: 'Type', type: 'select', required: true, list: true, default: 'AIRLINE',
        options: { sql: "select v as value, v as label from (values ('AIRLINE'), ('SHIPPING LINE'), ('COURIER'), ('ROAD')) x(v)" } },
      { name: 'AwbPrefix', label: 'MAWB prefix (airline, 3 digits)', type: 'text', max: 5, list: true },
      { name: 'IsActive', label: 'Active', type: 'checkbox', yes: 1, no: 0, list: true },
    ],
    listSql: 'select * from tblCarrier order by CarrierType, CarrierName',
    unique: [
      { field: 'CarrierName', message: 'Name already exists' },
      { field: 'CarrierCode', message: 'Code already exists', createOnly: true },
    ],
    inUse: [{ sql: 'select top 1 1 from docket_international where CarrierCode = @code', message: 'This carrier is used on dockets' }],
    create: {
      sql: 'insert into tblCarrier(CarrierCode, CarrierName, CarrierType, AwbPrefix, IsActive) values (@c, @n, @t, @p, @a)',
      inputs: (b) => ({ c: b.CarrierCode, n: b.CarrierName, t: b.CarrierType, p: b.AwbPrefix, a: b.IsActive }),
    },
    update: {
      sql: 'update tblCarrier set CarrierName = @n, CarrierType = @t, AwbPrefix = @p, IsActive = @a where CarrierCode = @c',
      inputs: (b) => ({ c: b.CarrierCode, n: b.CarrierName, t: b.CarrierType, p: b.AwbPrefix, a: b.IsActive }),
    },
    remove: { sql: 'delete from tblCarrier where CarrierCode = @c', inputs: (code) => ({ c: code }) },
  },

  // ================================================================== MASTER (business masters)
  // ------------------------------------------------------------------ Driver (General/Driver_Master.aspx) — challan driver look-up, payment advances
  {
    key: 'driver',
    group: 'master',
    title: 'Driver Master',
    legacyPage: 'General/Driver_Master.aspx',
    table: 'Driver_master',
    keyField: 'id',
    fields: [
      { name: 'Drivername', label: 'Driver Name', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'branch', label: 'Branch', type: 'select', required: true, list: true,
        options: { sql: "select branch_name as value, branch_name as label from branch_master where status = 'Active' order by branch_name" } },
      { name: 'mobile_no', label: 'Mobile No.', type: 'text', max: 20, list: true },
      { name: 'IsActive', label: 'Active', type: 'checkbox', yes: 1, no: 0, list: true },
    ],
    listSql: 'select * from Driver_master order by Drivername',
    unique: [{ field: 'mobile_no', message: 'A driver with this mobile no. already exists', skipEmpty: true }],
    inUse: [{ sql: "select top 1 1 from tbl_payment_detail where PersonType = 'DRIVER' and PersonId = cast(@code as varchar(30))", message: 'This driver has payment entries — make the driver inactive instead' }],
    create: {
      sql: 'insert into Driver_master(Drivername, branch, mobile_no, IsActive) values (@n, @b, @m, @a)',
      inputs: (b) => ({ n: b.Drivername, b: b.branch, m: b.mobile_no, a: b.IsActive }),
    },
    update: {
      sql: 'update Driver_master set Drivername = @n, branch = @b, mobile_no = @m, IsActive = @a where id = @id',
      inputs: (b) => ({ id: Number(b.id), n: b.Drivername, b: b.branch, m: b.mobile_no, a: b.IsActive }),
    },
    remove: { sql: 'delete from Driver_master where id = @id', inputs: (code) => ({ id: Number(code) }) },
  },

  // ------------------------------------------------------------------ Consignor / consignee (Master/ConsignerConsignee.aspx)
  {
    key: 'consignor',
    group: 'master',
    title: 'Consignor / Consignee Master',
    legacyPage: 'Master/ConsignerConsignee.aspx',
    table: 'consigner_master',
    keyField: 'consigner_code',
    autoCode: { prefix: 'CN', width: 3 },
    fields: [
      { name: 'consigner_code', label: 'Party Code', type: 'text', required: true, upper: true, max: 60, createOnly: true, list: true },
      { name: 'company_name', label: 'Party Name', type: 'text', required: true, upper: true, max: 200, list: true },
      // the GSTIN's first two digits are the state: typing it fills the state
      { name: 'GSTIN_No', label: 'GSTIN', type: 'text', upper: true, max: 20, list: true,
        autofill: "select top 1 state_name as state from state_master where StateCode = left(upper(@v), 2) and len(@v) >= 2" },
      { name: 'address', label: 'Address', type: 'textarea', max: 500 },
      // picking a city fills its state
      { name: 'city', label: 'City', type: 'select', list: true,
        options: { sql: "select city_name as value, city_name as label from city_master where active_flag = 'Active' order by city_name" },
        quick: { master: 'city', value: 'city_name' },
        autofill: 'select top 1 s.state_name as state from city_master c join state_master s on s.state_code = c.state_code where c.city_name = @v' },
      { name: 'state', label: 'State', type: 'select', list: true,
        options: { sql: "select state_name as value, state_name as label from state_master where active_flag = 'Active' order by state_name" },
        quick: { master: 'state', value: 'state_name' } },
      { name: 'pin_code', label: 'Pin Code', type: 'text', max: 10, list: true },
      { name: 'phone', label: 'Phone', type: 'text', max: 30, list: true },
    ],
    listSql: "select * from consigner_master where isnull(IsTemp, 'false') <> 'true' order by company_name",
    unique: [
      { field: 'GSTIN_No', message: 'A party with this GSTIN already exists', skipEmpty: true },
      { field: 'consigner_code', message: 'Party code already exists', createOnly: true },
    ],
    inUse: [],
    create: {
      sql: `insert into consigner_master(consigner_code, company_name, address, city, state, pin_code, phone, GSTIN_No, IsTemp)
            values (@consigner_code, @company_name, @address, @city, @state, @pin_code, @phone, @GSTIN_No, 'false')`,
      inputs: (b) => ({ consigner_code: b.consigner_code, company_name: b.company_name, address: b.address, city: b.city, state: b.state,
        pin_code: b.pin_code, phone: b.phone, GSTIN_No: b.GSTIN_No }),
    },
    update: {
      sql: `update consigner_master set company_name = @company_name, address = @address, city = @city, state = @state, pin_code = @pin_code,
              phone = @phone, GSTIN_No = @GSTIN_No where consigner_code = @consigner_code`,
      inputs: (b) => ({ consigner_code: b.consigner_code, company_name: b.company_name, address: b.address, city: b.city, state: b.state,
        pin_code: b.pin_code, phone: b.phone, GSTIN_No: b.GSTIN_No }),
    },
    remove: { sql: 'delete from consigner_master where consigner_code = @c', inputs: (code) => ({ c: code }) },
  },

  // ------------------------------------------------------------------ Market (temporary) vendor (Master/Temporary_Vendor_Master.aspx)
  {
    key: 'temp-vendor',
    group: 'master',
    title: 'Market / Temporary Vendor Master',
    legacyPage: 'Master/Temporary_Vendor_Master.aspx',
    table: 'temp_vendors_master',
    keyField: 'vendor_code',
    autoCode: { prefix: 'VT', width: 3 },
    fields: [
      { name: 'vendor_code', label: 'Vendor Code', type: 'text', required: true, upper: true, max: 20, createOnly: true, list: true },
      { name: 'Name', label: 'Vendor Name', type: 'text', required: true, upper: true, max: 100, list: true, createOnly: true },
      { name: 'vendor_mode', label: 'Mode', type: 'select', required: true, options: MODE_OPTIONS, list: true, default: 'RD', quick: { master: 'booking-mode', value: 'mode_code' } },
      { name: 'FTLDIVISION', label: 'Divisions (comma separated, e.g. DIV1001,DIV1003)', type: 'text', required: true, upper: true, max: 100, list: true },
      { name: 'TDS', label: 'TDS %', type: 'number', min: 0, list: true },
      { name: 'active_flag', label: 'Active', type: 'checkbox', yes: 1, no: 0, list: true, default: true },
    ],
    listSql: 'select * from temp_vendors_master order by Name',
    unique: [
      { field: 'Name', message: 'Vendor name already exists', createOnly: true },
      { field: 'vendor_code', message: 'Vendor code already exists', createOnly: true },
    ],
    // Temporary_Vendor_Master.aspx: the vendor's ledger "NAME :CODE :BRANCH :BRANCHCODE" (Sundry Creditors, Cr) in every
    // division ticked — the challan lists market vendors through it and payments post to it. The branch is the one
    // the user works in (this table keeps no branch). Added divisions get their ledger on update.
    afterSave: bindTempVendorLedgers,
    inUse: [
      { sql: 'select top 1 1 from dispatch_master where vendor_code = @code', message: 'This vendor is used on challans — make it inactive instead' },
      { sql: 'select top 1 1 from Vechile_Master where VendorCodeName = @code', message: 'This vendor is used in Vehicle Master' },
      { sql: `select top 1 1 from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
               where ltrim(rtrim(l.VendorOrClientCode)) = @code and l.Ledger_Type = 'Vendor'`, message: 'This vendor has account entries — make it inactive instead' },
    ],
    create: {
      sql: 'insert into temp_vendors_master(vendor_code, Name, vendor_mode, FTLDIVISION, active_flag, TDS) values (@c, @n, @m, @d, @a, @t)',
      inputs: (b) => ({ c: b.vendor_code, n: b.Name, m: b.vendor_mode, d: b.FTLDIVISION, a: b.active_flag, t: b.TDS }),
    },
    update: {
      // the name is part of the ledger name: not changed here (as in the vendor master)
      sql: 'update temp_vendors_master set vendor_mode = @m, FTLDIVISION = @d, active_flag = @a, TDS = @t where vendor_code = @c',
      inputs: (b) => ({ c: b.vendor_code, m: b.vendor_mode, d: b.FTLDIVISION, a: b.active_flag, t: b.TDS }),
    },
    // with its (unused — see inUse) ledgers
    remove: {
      sql: `set xact_abort on; begin transaction;
            delete h from tblLedgerHierarchy h join tblAccountLedger l on l.LedgerCode = h.LedgerCode
             where ltrim(rtrim(l.VendorOrClientCode)) = @c and l.Ledger_Type = 'Vendor';
            delete from tblAccountLedger where ltrim(rtrim(VendorOrClientCode)) = @c and Ledger_Type = 'Vendor';
            delete from temp_vendors_master where vendor_code = @c;
            commit;`,
      inputs: (code) => ({ c: code }),
    },
  },
];

export const definitionsByKey = new Map(definitions.map((d) => [d.key, d]));
