// Vehicle Master — port of wwwroot/Master/Vechile_Master.aspx(.cs) (add / edit) and
// View_Vechile_Master.aspx(.cs) (list, status). Procedure names come from the deployed bin/ClassLibrary.dll.
//
// A vehicle belongs to a vendor of one of three kinds: Self (own fleet), Vendor (attached, with up to ten
// routes) or MARKET (market vendor, temp_vendors_master). Saving also binds the vehicle's ledger (named after
// the vehicle number, "Direct Expense") as GeneralMethods.AutoBindLedger did.
//
// Fixed legacy bugs (docs/SECURITY.md):
//   * the edit page built its SELECT from the ?x= query string (SQL injection); the list page's status change
//     used a session value and concatenated SQL — both parameterised, status is changed per vehicle;
//   * the vehicle ledger was created before the vehicle and stayed behind when the insert failed — now one
//     transaction; the update swallowed every error (catch {}) and never checked the result;
//   * "Vehicle route cannot be the same" only compared the first two routes on a text change and was never
//     enforced on save — every route must exist and appear once;
//   * capacity came from a disabled textbox posted by the browser — now taken from the vehicle type;
//   * switching the vendor type listed vendors of every division — now the user's division only.
//
// Not ported (docs/MIGRATION.md): the Self-vehicle purchase voucher (loan receive + purchase entries), the EMI
// loan sheet, insurance and accident entries, the Excel export and the trip-voucher shortcut.

import { config } from '../../config.js';
import { exec, query, sql, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound, HttpError } from '../../middleware/errors.js';
import { s, n, iso } from '../../utils/values.js';
import { groupNameForSection } from '../books/posting.js';

const unprocessable = (msg) => new HttpError(422, msg);

// Values as the legacy page stored them (rblVenderType).
export const VENDOR_TYPES = [
  { value: 'Self', label: 'Self (own fleet)' },
  { value: 'Vendor', label: 'Attached vendor' },
  { value: 'MARKET', label: 'Market vehicle' },
];
export const FUEL_TYPES = ['DIESEL', 'PETROL', 'CNG'];
// ddl_amc stored the item text; "Platinam" is the legacy spelling.
export const AMC_TYPES = [{ value: 'Silver', label: 'Silver' }, { value: 'Platinam', label: 'Platinum' }];
const ROUTE_COLS = ['veh_route', ...Array.from({ length: 9 }, (_, i) => `veh_route_${i + 1}`)];

// ------------------------------------------------------------------ lookups

export async function options() {
  const [branches, types, makers] = await Promise.all([
    query("select branch_code, branch_name from branch_master where status = 'Active' order by branch_name"),
    query(`select container_code, freight_name, container_Capacity, ContainerSize, Container_Type, Bodys, VehicleMode, NoOfWheel
             from freight_master where isnull(active_flag, 'Active') = 'Active' order by freight_name`),
    query("select slno, vehicle_name from Vehicle_master where active_flag = 'Active' order by vehicle_name"),
  ]);
  return {
    vendorTypes: VENDOR_TYPES,
    fuelTypes: FUEL_TYPES.map((f) => ({ value: f, label: f })),
    amcTypes: AMC_TYPES,
    branches: branches.map((b) => ({ value: s(b.branch_code), label: `${s(b.branch_name)} : ${s(b.branch_code)}` })),
    vehicleTypes: types.map((t) => ({
      value: s(t.container_code), label: s(t.freight_name), capacity: n(t.container_Capacity), containerSize: s(t.ContainerSize),
      containerType: s(t.Container_Type), body: s(t.Bodys), mode: s(t.VehicleMode), wheels: n(t.NoOfWheel),
    })),
    makers: makers.map((m) => ({ value: Number(m.slno), label: s(m.vehicle_name) })),
  };
}

/** Vendors of one kind in the user's division (the page's rblVenderType_SelectedIndexChanged). */
export async function vendors(user, type) {
  const rows = type === 'MARKET'
    ? await query(
      `select vendor_code, Name from temp_vendors_master
        where isnull(active_flag, 1) = 1 and isnull(FTLDIVISION, '') like '%' + @div + '%' order by Name`, { div: user.divCode })
    : await query(
      `select vendor_code, Name from vendors_master
        where vendor_type = @t and isnull(active_flag, 1) = 1 and isnull(DivCode, '') like '%' + @div + '%' order by Name`,
      { t: type === 'Self' ? 'SELF' : 'VENDOR', div: user.divCode });
  return rows.map((r) => ({ value: s(r.vendor_code), label: `${s(r.Name)} : ${s(r.vendor_code)}` }));
}

/** Route search for attached vehicles (the page's SearchCustomers autocomplete). */
export async function routes(q = '') {
  const rows = await query(
    `select top 20 route_code, route_name from route where isnull(isStatus, 1) = 1 and route_name like '%' + @q + '%' order by route_name`,
    { q });
  return rows.map((r) => ({ value: s(r.route_code), label: s(r.route_name) }));
}

// ------------------------------------------------------------------ list / get

const LIST_SQL = `
  select vm.*, isnull(v.Name, tv.Name) as vendor_name, b.branch_name as branch_name, cl.branch_name as currentloc_name,
         mk.vehicle_name as maker_name, fm.freight_name
    from Vechile_Master vm
    left join vendors_master v on v.vendor_code = vm.VendorCodeName
    left join temp_vendors_master tv on tv.vendor_code = vm.VendorCodeName
    left join branch_master b on b.branch_code = vm.Created_Branch
    left join branch_master cl on cl.branch_code = vm.currentloc
    left join Vehicle_master mk on mk.slno = vm.VehicleName_id_fk
    left join freight_master fm on fm.container_code = vm.VehicelType`;

const mapVehicle = (r) => ({
  vehicleNo: s(r.VEHICLE_NO),
  vendorType: s(r.VenderType),
  vendorCode: s(r.VendorCodeName),
  vendor: s(r.vendor_name),
  ownerName: s(r.OwnerName),
  vehicleType: s(r.VehicelType),
  vehicleTypeName: s(r.freight_name) || s(r.Vechile_Type_Code),
  capacity: n(r.Vechile_Capacity),
  containerSize: s(r.ContainerSize),
  chassisNo: s(r.CHASSIS_NO),
  engineNo: s(r.ENGINE_NO),
  make: s(r.MAKE),
  model: s(r.MODEL),
  makerId: r.VehicleName_id_fk === null || r.VehicleName_id_fk === undefined ? null : Number(r.VehicleName_id_fk),
  maker: s(r.maker_name),
  fuelType: s(r.fuel_type),
  tankCapacity: s(r.tank_capacity),
  amc: s(r.AMC),
  branch: s(r.Created_Branch),
  branchName: s(r.branch_name),
  currentLocation: s(r.currentloc_name) || s(r.currentloc),
  routes: ROUTE_COLS.map((c) => s(r[c])).filter(Boolean),
  dealerName: s(r.DealerName),
  dealerAddress: s(r.Address),
  purchaseDate: iso(r.Date_Of_Purchase),
  invoiceNo: s(r.InvoiceNo),
  invoiceValue: r.InvoiceValue === null || r.InvoiceValue === undefined ? null : n(r.InvoiceValue),
  dealMaturityAmount: r.DealMaturityAmount === null || r.DealMaturityAmount === undefined ? null : n(r.DealMaturityAmount),
  active: s(r.Vechile_Status || 'Active').toLowerCase() === 'active',
});

// The page listed the vehicles of the user's division (vehicles saved before the division column existed too).
export async function listVehicles(user, { q = '', status = 'all', vendorType = '' } = {}) {
  const rows = await query(`${LIST_SQL} where (vm.division = @div or vm.division is null) order by vm.VEHICLE_NO`, { div: user.divCode });
  const term = q.toUpperCase();
  return rows.map(mapVehicle)
    .filter((v) => !term || [v.vehicleNo, v.vendor, v.ownerName, v.vehicleTypeName].some((x) => x.toUpperCase().includes(term)))
    .filter((v) => !vendorType || v.vendorType.toUpperCase() === vendorType.toUpperCase())
    .filter((v) => status === 'all' || (status === 'active' ? v.active : !v.active));
}

export async function getVehicle(user, vehicleNo) {
  const [r] = await query(`${LIST_SQL} where vm.VEHICLE_NO = @no and (vm.division = @div or vm.division is null)`,
    { no: vehicleNo, div: user.divCode });
  if (!r) throw notFound(`Vehicle ${vehicleNo} not found in this division`);
  const v = mapVehicle(r);
  const names = v.routes.length
    ? await query(`select route_code, route_name from route where route_code in (${v.routes.map((_, i) => `@r${i}`).join(', ')})`,
      Object.fromEntries(v.routes.map((c, i) => [`r${i}`, c])))
    : [];
  const byCode = new Map(names.map((x) => [s(x.route_code), s(x.route_name)]));
  return { ...v, routeOptions: v.routes.map((c) => ({ value: c, label: byCode.get(c) || c })) };
}

// ------------------------------------------------------------------ validation shared by create / update

async function validate(body, user) {
  const [type] = await query(
    "select container_code, freight_name, container_Capacity from freight_master where container_code = @c and isnull(active_flag, 'Active') = 'Active'",
    { c: body.vehicleType });
  if (!type) throw badRequest('Select vehicle type');

  const vendorList = await vendors(user, body.vendorType);
  if (!vendorList.some((v) => v.value === body.vendorCode)) throw badRequest(`Select a ${body.vendorType === 'MARKET' ? 'market' : body.vendorType.toLowerCase()} vendor of this division`);

  const [branch] = await query("select branch_code from branch_master where branch_code = @b and status = 'Active'", { b: body.branch });
  if (!branch) throw badRequest('Select branch');
  if (body.makerId !== null) {
    const [maker] = await query("select slno from Vehicle_master where slno = @m and active_flag = 'Active'", { m: body.makerId });
    if (!maker) throw badRequest('Select maker');
  }

  // Routes only for attached vehicles (the page enabled the route boxes only for "Vendor").
  const routeList = body.vendorType === 'Vendor' ? body.routes : [];
  if (new Set(routeList).size !== routeList.length) throw badRequest('Vehicle route cannot be the same');
  if (routeList.length) {
    const found = new Set((await query(
      `select route_code from route where isnull(isStatus, 1) = 1 and route_code in (${routeList.map((_, i) => `@r${i}`).join(', ')})`,
      Object.fromEntries(routeList.map((r, i) => [`r${i}`, r])))).map((r) => s(r.route_code)));
    const missing = routeList.filter((r) => !found.has(r));
    if (missing.length) throw badRequest(`Unknown route(s): ${missing.join(', ')}`);
  }
  return { typeName: s(type.freight_name), capacity: n(type.container_Capacity), routeList };
}

const routeParams = (list) => Object.fromEntries(ROUTE_COLS.map((c, i) => [c, list[i] ?? '']));

/** GeneralMethods.AutoBindLedger(vehicleNo, "Direct Expense", "DR", "Bank", …) when the ledger does not exist yet. */
async function bindLedger(user, tx, vehicleNo, branchCode) {
  const [existing] = await query(
    'select top 1 LedgerCode from tblAccountLedger where LedgerName = @n and Financial_Year = @fy and Division = @div',
    { n: vehicleNo, fy: user.financialYear, div: user.divCode }, { tx });
  if (existing) return;
  const res = await exec('usp_AutoBindLedger', {
    LedgerName: vehicleNo, GroupName: await groupNameForSection('DIRECT_EXP', tx), VendorOrClientCode: null, DrCr: 'DR', Ledger_Type: 'Bank',
    CreatedDate: `${String(user.financialYear).slice(0, 4)}-04-01`, Branch_Code: branchCode, Emp_Code: user.userId,
    Financial_Year: user.financialYear, division: user.divCode,
  }, { status: [sql().VarChar(500), null] }, { tx });
  if (s(res.output.status).toLowerCase() !== 'success') throw unprocessable(`Vehicle ledger could not be created: ${s(res.output.status)}`);
}

// Empty accounting table: the purchase voucher (Self vehicles bought on loan) is not ported yet.
function emptyTransactions() {
  const S = sql();
  const t = new S.Table(config.tvp.transaction);
  t.columns.add('Ledger_code', S.VarChar(20));
  t.columns.add('Amount_Dr', S.Float);
  t.columns.add('Amount_Cr', S.Float);
  t.columns.add('Balance', S.Real);
  t.columns.add('TransId', S.Int);
  t.columns.add('Entry', S.VarChar(20));
  t.columns.add('Mode', S.VarChar(20));
  return t;
}

// ------------------------------------------------------------------ create / update / status

export async function createVehicle(user, body) {
  const [dup] = await query('select VEHICLE_NO from Vechile_Master where VEHICLE_NO = @no', { no: body.vehicleNo });
  if (dup) throw conflict(`Vehicle ${body.vehicleNo} already exists`);
  const v = await validate(body, user);
  await withTransaction(async (tx) => {
    const S = sql();
    const res = await exec('usp_Insert_Vechile', {
      VEHICLE_NO: body.vehicleNo, Vechile_Type_Code: v.typeName, CHASSIS_NO: body.chassisNo, ENGINE_NO: body.engineNo, MAKE: body.make,
      MODEL: body.model, Vechile_Capacity: v.capacity, ContainerSize: body.containerSize, Vechile_Status: body.active ? 'Active' : 'InActive',
      Created_By: user.userId, Created_Branch: body.branch, Home_Branch: body.branch, VehicelType: body.vehicleType,
      VenderType: body.vendorType, OwnerName: body.ownerName, VendorCodeName: body.vendorCode, ...routeParams(v.routeList),
      tank_capacity: body.tankCapacity, VehicleName_id_fk: body.makerId, fuel_type: body.fuelType, division: user.divCode,
      Financial_Year: user.financialYear, ud_Transaction_Details: { type: S.TVP, value: emptyTransactions() },
      DealerName: body.dealerName, Address: body.dealerAddress, Date_Of_Purchase: body.purchaseDate || null, InvoiceNo: body.invoiceNo,
      InvoiceValue: body.invoiceValue, DealMaturityAmount: body.dealMaturityAmount, NameofFinancer: '', LoanAccNoChassis: '',
      LoanChassisAmount: null, LoanAccNoBody: '', LoanBodyAmount: null, LoanStartDate: null, LoanEndDate: null, CoverNoteNo: '',
      PolicyNo: '', ReceiptDate: null, InsStartDate: null, InsEndDate: null, NameofInsuranceNo: body.vendorCode, HypothecatedWith: '',
      Narration: `Vehicle Purchase , Vehicle No : ${body.vehicleNo} , Vendor Type : ${body.vendorType}`, AMC: body.amc,
    }, { ReturnValue: [sql().VarChar(200), null] }, { tx });
    const result = s(res.output.ReturnValue);
    if (result.toLowerCase() !== 'success') throw unprocessable(result.replace(/'/g, '') || 'Vehicle could not be saved');
    await bindLedger(user, tx, body.vehicleNo, body.branch);
  });
  return { vehicleNo: body.vehicleNo, message: `Vehicle ${body.vehicleNo} saved` };
}

export async function updateVehicle(user, vehicleNo, body) {
  await getVehicle(user, vehicleNo);
  const v = await validate(body, user);
  await withTransaction(async (tx) => {
    await exec('usp_Update_Vechile', {
      VEHICLE_NO: vehicleNo, Vechile_Type_Code: v.typeName, CHASSIS_NO: body.chassisNo, ENGINE_NO: body.engineNo, MAKE: body.make,
      MODEL: body.model, Vechile_Capacity: v.capacity, ContainerSize: body.containerSize, Vechile_Status: body.active ? 'Active' : 'InActive',
      VehicelType: body.vehicleType, VenderType: body.vendorType, OwnerName: body.ownerName, Create_Branch: body.branch,
      VendorCodeName: body.vendorCode, ...routeParams(v.routeList), tank_capacity: body.tankCapacity, VehicleName_id_fk: body.makerId,
      fuel_type: body.fuelType,
    }, {}, { tx });
    // Not in the page's update (nor, presumably, in the procedure): kept editable here.
    await query(
      `update Vechile_Master set AMC = @amc, DealerName = @dealer, Address = @addr, Date_Of_Purchase = @pd, InvoiceNo = @inv,
              InvoiceValue = @invVal, DealMaturityAmount = @dma, Edit_By = @u, Edit_Date = getdate()
        where VEHICLE_NO = @no`,
      { amc: body.amc, dealer: body.dealerName, addr: body.dealerAddress, pd: body.purchaseDate || null, inv: body.invoiceNo,
        invVal: body.invoiceValue, dma: body.dealMaturityAmount, u: user.userId, no: vehicleNo }, { tx });
    await bindLedger(user, tx, vehicleNo, body.branch);
  });
  return { vehicleNo, message: `Vehicle ${vehicleNo} updated` };
}

/** View_Vechile_Master.aspx status change (Active / InActive), now for the chosen vehicle. */
export async function setStatus(user, vehicleNo, active) {
  const current = await getVehicle(user, vehicleNo);
  if (current.active === active) return { vehicleNo, message: `Vehicle ${vehicleNo} is already ${active ? 'active' : 'inactive'}` };
  await query('update Vechile_Master set Vechile_Status = @st, Edit_By = @u, Edit_Date = getdate() where VEHICLE_NO = @no',
    { st: active ? 'Active' : 'InActive', u: user.userId, no: vehicleNo });
  return { vehicleNo, message: `Vehicle ${vehicleNo} ${active ? 'activated' : 'deactivated'}` };
}
