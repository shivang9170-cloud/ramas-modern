// Vendor and vehicle — port of Setting/Vendor_and_vehicle.aspx (bal_vendor_vechile_master, vendor_vehicle_master).
//
// Which vehicles a vendor (or our own fleet, "Self") runs, by mode: road trucks (name, truck / engine / chassis number,
// model, make, validity, capacity, state), flights (number and name) and trains (train number, name, direction and —
// for Self — the train type). Challans pick the vendor's vehicles from here.
//
// Changes from the page (docs/MIGRATION.md "Settings"):
//   * the rows are saved in one transaction (the page inserted them one by one and cleared the list whatever failed);
//   * the "added" list was a static field shared by every user of the server; it is now the browser's own list;
//   * truck / engine / chassis numbers are checked against vendor_vehicle_master and the Vehicle Master inside the save
//     and against the other rows of the same save; a train is refused when the vendor already has it;
//   * vendor names are joined from the vendor master only (temp_vendors_master "VT…" vendors are not used by the new app).
import { query, withTransaction } from '../../db/index.js';
import { badRequest, conflict, notFound } from '../../middleware/errors.js';
import { s, n } from '../../utils/values.js';

export const VENDOR_TYPES = { VENDOR: 'Vendor', SELF: 'Self' };
// mode codes → form kind (ddlmode_SelectedIndexChanged)
const KIND = { AR: 'air', TR: 'train' };
const kindOf = (mode) => KIND[mode] ?? 'road';

export async function options() {
  const [modes, names, capacities, trains] = await Promise.all([
    query('select mode_code, mode_name from mode_master order by slno'),
    query("select no, vehicle_name from VehicleName_Master where isnull(active_flag, 'Active') = 'Active' order by vehicle_name"),
    query("select freight_name, container_Capacity, ContainerSize from freight_master where isnull(active_flag, 'Active') = 'Active' order by freight_name"),
    query("select TrainCode, TrainName, Directions from Train_Master where isnull(active_flag, 'Active') = 'Active' order by TrainCode"),
  ]);
  return {
    vendorTypes: Object.entries(VENDOR_TYPES).map(([value, label]) => ({ value, label })),
    modes: modes.map((r) => ({ value: s(r.mode_code), label: s(r.mode_name), kind: kindOf(s(r.mode_code)) })),
    vehicleNames: names.map((r) => ({ value: s(r.vehicle_name), label: s(r.vehicle_name) })),
    capacities: capacities.map((r) => ({ value: s(r.freight_name), label: s(r.freight_name), capacity: n(r.container_Capacity), size: s(r.ContainerSize) })),
    trains: trains.map((r) => ({ value: s(r.TrainCode), label: `${s(r.TrainCode)} - ${s(r.TrainName)}`, name: s(r.TrainName), direction: s(r.Directions) || 'UP' })),
    trainTypes: ['VP', 'SLR'].map((v) => ({ value: v, label: v })),                 // ddltrainType
  };
}

/** bind_all_vendor(type): vendors of the type. */
export async function vendors(type) {
  const rows = await query('select vendor_code, Name from vendors_master where vendor_type = @t and isnull(active_flag, 1) = 1 order by Name', { t: VENDOR_TYPES[type] });
  return rows.map((r) => ({ value: s(r.vendor_code), label: `${s(r.Name)} : ${s(r.vendor_code)}` }));
}

const mapRow = (r) => ({
  id: Number(r.slno), vendor: s(r.vendor_code), vendorName: s(r.Name), vendorType: s(r.vendor_type), mode: s(r.mode_code),
  modeName: s(r.mode_name), vehicleNo: s(r.vehicle_no), vehicleName: s(r.vehicle_name), truckNo: s(r.truck_no), engineNo: s(r.engine_no),
  chassisNo: s(r.chasis_no), model: s(r.model), make: s(r.make), validity: s(r.validity), capacity: s(r.capacity),
  vehicleCapacity: n(r.Vehicle_Capacity), containerSize: s(r.Container_Size), state: s(r.of_state), trainType: s(r.train_type),
  direction: s(r.Direction), active: r.Status === null || r.Status === undefined ? true : Boolean(r.Status),
});

/** get_vendor_vehicle_details (+ the vendor / mode / type filters of the page). */
export async function list({ vendorType = '', vendor = '', mode = '', search = '' } = {}) {
  const rows = await query(
    `select vv.*, vm.Name, vm.vendor_type, mm.mode_name from vendor_vehicle_master vv
       left join vendors_master vm on vm.vendor_code = vv.vendor_code
       left join mode_master mm on mm.mode_code = vv.mode_code
      where (@vt = '' or vm.vendor_type = @vt) and (@v = '' or vv.vendor_code = @v) and (@m = '' or vv.mode_code = @m)
        and (@q = '' or vm.Name like '%' + @q + '%' or vv.truck_no like '%' + @q + '%' or vv.vehicle_no like '%' + @q + '%')
      order by vm.Name, vv.mode_code, vv.slno`,
    { vt: vendorType ? VENDOR_TYPES[vendorType] : '', v: vendor, m: mode, q: search });
  return rows.map(mapRow);
}

/** btnairsubmit / btntrainsubmit / btnvehiclesubmit: insert_vendor_vehicle_master for every added row. */
export async function create(user, body) {
  const [v] = await query('select vendor_code, vendor_type from vendors_master where vendor_code = @v', { v: body.vendor });
  if (!v || s(v.vendor_type) !== VENDOR_TYPES[body.vendorType]) throw badRequest('Select a vendor of the chosen type');
  const [m] = await query('select mode_code from mode_master where mode_code = @m', { m: body.mode });
  if (!m) throw badRequest('Select mode');
  const kind = kindOf(body.mode);
  const opts = await options();
  const rows = body.rows.map((r, i) => {
    const at = `Row ${i + 1}`;
    if (kind === 'air') {
      if (!s(r.vehicleNo) || !s(r.vehicleName)) throw badRequest(`${at}: enter the flight number and name`);
      return { vehicle_no: s(r.vehicleNo).toUpperCase(), vehicle_name: s(r.vehicleName).toUpperCase(), Direction: 'UP' };
    }
    if (kind === 'train') {
      const t = opts.trains.find((x) => x.value === s(r.trainCode));
      if (!t) throw badRequest(`${at}: select the train`);
      return {
        vehicle_no: t.value, vehicle_name: t.name, Direction: r.direction === 'DOWN' ? 'DOWN' : 'UP',
        train_type: body.vendorType === 'SELF' ? s(r.trainType) : '',
      };
    }
    if (!s(r.truckNo)) throw badRequest(`${at}: enter the truck number`);
    if (!opts.vehicleNames.some((x) => x.value === s(r.vehicleName))) throw badRequest(`${at}: select the vehicle name`);
    const cap = opts.capacities.find((x) => x.value === s(r.capacity));
    if (!cap) throw badRequest(`${at}: select the capacity`);
    return {
      vehicle_no: '', vehicle_name: s(r.vehicleName), truck_no: s(r.truckNo).toUpperCase().replace(/\s+/g, ''), engine_no: s(r.engineNo),
      chasis_no: s(r.chassisNo), model: s(r.model), make: s(r.make), validity: s(r.validity), capacity: cap.value,
      Vehicle_Capacity: n(r.vehicleCapacity) || cap.capacity, Container_Size: s(r.containerSize) || cap.size, of_state: s(r.state), Direction: 'UP',
    };
  });
  // duplicates inside this save
  const seen = new Set();
  for (const r of rows) {
    for (const k of kind === 'road' ? ['truck_no', 'engine_no', 'chasis_no'] : ['vehicle_no']) {
      if (!r[k]) continue;
      const key = `${k}:${r[k].toUpperCase()}`;
      if (seen.has(key)) throw badRequest(`${r[k]} is entered twice`);
      seen.add(key);
    }
  }
  return withTransaction(async (tx) => {
    for (const r of rows) {
      if (kind === 'road') {
        // Check_Data(truck_no / engine_no / chasis_no) + check_truck_num_exist
        const [dup] = await query(
          `select top 1 x from (
             select truck_no as x from vendor_vehicle_master with (updlock, holdlock)
              where truck_no = @t or (@e <> '' and engine_no = @e) or (@c <> '' and chasis_no = @c)
             union all select VEHICLE_NO from Vechile_Master where VEHICLE_NO = @t or (@e <> '' and ENGINE_NO = @e) or (@c <> '' and CHASSIS_NO = @c)) d`,
          { t: r.truck_no, e: r.engine_no, c: r.chasis_no }, { tx });
        if (dup) throw conflict(`This truck no, engine no or chassis no already exists (${r.truck_no})`);
      } else {
        const [dup] = await query('select top 1 slno from vendor_vehicle_master with (updlock, holdlock) where vendor_code = @v and vehicle_no = @no and mode_code = @m',
          { v: body.vendor, no: r.vehicle_no, m: body.mode }, { tx });
        if (dup) throw conflict(`${r.vehicle_no} is already added to this vendor`);
      }
      await query(
        `insert into vendor_vehicle_master(vendor_code, mode_code, vehicle_no, vehicle_name, engine_no, truck_no, chasis_no, model, make,
           validity, capacity, of_state, train_type, Vehicle_Capacity, Container_Size, Direction, Status, created_by)
         values (@v, @m, @vehicle_no, @vehicle_name, @engine_no, @truck_no, @chasis_no, @model, @make, @validity, @capacity, @of_state,
           @train_type, @Vehicle_Capacity, @Container_Size, @Direction, 1, @u)`,
        { v: body.vendor, m: body.mode, engine_no: '', truck_no: '', chasis_no: '', model: '', make: '', validity: '', capacity: '',
          of_state: '', train_type: '', Vehicle_Capacity: 0, Container_Size: '', ...r, u: user.userId }, { tx });
    }
    return { saved: rows.length, message: `${rows.length} ${kind === 'road' ? 'vehicle' : kind === 'air' ? 'flight' : 'train'}(s) added` };
  });
}

/** btnUpdate_Click → update_Status. */
export async function setStatus(id, active) {
  const [r] = await query('select slno from vendor_vehicle_master where slno = @id', { id });
  if (!r) throw notFound('Vehicle not found');
  await query('update vendor_vehicle_master set Status = @s where slno = @id', { s: active ? 1 : 0, id });
  return { id, message: active ? 'Activated' : 'Deactivated' };
}
