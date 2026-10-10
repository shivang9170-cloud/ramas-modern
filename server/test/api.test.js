// Integration tests against the local DEV database (npm run db:dev -- --drop).
// Skipped automatically when DB_NAME is not a *_dev database.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { assertConfig, config } from '../src/config.js';
import { closeDb, initDb, query } from '../src/db/index.js';
import { createApp } from '../src/app.js';

const enabled = Boolean(config.db?.database?.endsWith('_dev'));
let app;

async function login(body) {
  const res = await request(app).post('/api/auth/login').send({ divCode: 'DIV1001', financialYear: '2025-2026', ...body });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

// EMP001 logged in with the current financial year, shared by the suites that need it (the login route allows 20 logins / 15 min).
let fyToken;
async function fyLogin() {
  const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0);
  fyToken ??= await login({ username: 'EMP001', password: 'emp123', financialYear: `${y}-${y + 1}` });
  return fyToken;
}

const today = new Date().toISOString().slice(0, 10);

// credit side of a sale voucher: only FREIGHT INCOME / OUTPUT xGST, income present, credits add up to the bill total
function assertSale(credits, total) {
  assert.ok(credits.every(([name, dr]) => dr === 0 && (name === 'FREIGHT INCOME' || /^OUTPUT [CSI]?GST$/.test(name))), JSON.stringify(credits));
  assert.ok(credits.some(([name]) => name === 'FREIGHT INCOME'), JSON.stringify(credits));
  assert.equal(Math.round(credits.reduce((a, [, , cr]) => a + cr, 0) * 100) / 100, total);
}

const docket =(no, extra = {}) => ({
  docketNo: no,
  bookingDate: today,
  bookingMode: 'RD',
  customerType: 'Contractual Client',
  docType: 'NONDOC',
  bookingType: 'Paid',
  deliveryMode: 'DM-101',
  destination: 'MUMBAI',
  destinationBranch: 'B1002',
  onAccountOf: 'ACME TEXTILES:CL001',
  billingAt: 'B1002',
  consigner: { code: 'CN002', name: 'SUNRISE ELECTRONICS', city: 'DELHI', gstin: '07AAACS2222B1Z2' },
  consignee: { code: 'CN001', name: 'ACME TEXTILES', city: 'MUMBAI', gstin: '27AAACA1111A1Z1' },
  itemContent: 'BOX',
  freightType: 'SUN',
  rateOn: 'WEIGHT', rate: 12, packets: 3, actualWeight: 40, chargeWeight: 45, minWeight: 20, minFreight: 500,
  fuelPercent: 10, docketCharge: 50, discountPercent: 5,
  charges: { handling: 40, oda: 120 },
  taxMode: 'IGST', igstRate: 18,
  invoices: [{ invoiceNo: `INV-${no}`, invoiceDate: today, invoiceValue: 10000 }],
  additionalChargesTax: [{ code: 'TX01', name: 'COD CHARGES', amount: 30 }],
  ...extra,
});

describe('API (dev database)', { skip: !enabled && 'DB_NAME is not a *_dev database' }, () => {
  let emp; let admin; let client;

  before(async () => {
    assertConfig();
    await initDb();
    config.rateLimit.off = true;   // hundreds of requests from one address (rate limits: security.test.js)
    app = createApp();
    process.env.AUTO_PICKUP = '0';   // these tests make their pickups by hand (auto pickup: accounts-free test below)
    // Remove test dockets (header + every child table) so the suite can be re-run
    // without recreating the dev database.
    await query(`
      delete from tblManifestBag where ManifestNo in (select ManifestNo from tblManifestBagDocket where DocketNo like 'T%');
      delete from tblManifestBagDocket where DocketNo like 'T%';
      delete from docket_international where docket_no like 'T%';
      delete from New_Location_master where Location_Code in ('TL99', 'TL98');
      delete from Driver_master where Drivername like 'TST DRIVER%';
      delete from tblAccountLedger where VendorOrClientCode = 'VT9901';
      delete from temp_vendors_master where vendor_code = 'VT9901';
      delete from grn_docket_charge where Docket_No like 'T%';
      delete from docket_other_charges where docket like 'T%';
      delete from docket_invoice where docketNo like 'T%';
      delete from docket_insurance where docketNo like 'T%';
      delete from docket_dimension where docket_no like 'T%';
      delete from docket_charge_entry where Docket_No like 'T%';
      delete from docket_franchisee_comm where Docket_No like 'T%';
      delete from docket_tracking where docket_no like 'T%';
      delete from delivery_status_entry_details where docket_no like 'T%';
      delete from delivery_status_entry_grn where docket_no like 'T%';
      delete from octroi_bill_charge_details where docket_no like 'T%';
      delete from octroi_bill where remarks like 'TST%' or bill_no not in (select bill_no from octroi_bill_charge_details);
      delete from tblAccountTrasaction where Mode in ('Miscellaneous Bill Finalized', 'Warehouse Bill Finalized') and VoucherNo in (select Bill_No from miscellaneous_bill where remarks like 'TST%' union select Bill_No from warehouse_bill where remarks like 'TST%');
      delete from miscellaneous_bill where remarks like 'TST%';
      delete from warehouse_bill where remarks like 'TST%';
      delete from tblAccountTrasaction where Mode = 'PURCHASE/PAYBILL' and VoucherNo in (select InvoiceNo from OtherVendorInvoice where Narration like 'TST%');
      delete from OtherVendorInvoice_Details where InvoiceNo in (select InvoiceNo from OtherVendorInvoice where Narration like 'TST%');
      delete from OtherVendorInvoiceCostProfit where InvoiceNo in (select InvoiceNo from OtherVendorInvoice where Narration like 'TST%');
      delete from OtherVendorInvoice where Narration like 'TST%';
      delete from Vendor_Invoice_Verify_Details where challan_no like 'TVC%';
      delete from Vendor_Invoice_Verify where Narration like 'TST%' or Vendor_Bill_No not in (select Vendor_Bill_No from Vendor_Invoice_Verify_Details);
      delete from Dispatch_Master where challan_no like 'TVC%';
      delete from Franchisee_Invoice_Detail where Docket_No like 'T%' or F_Invoice_No in (select F_Invoice_No from Franchisee_Invoice where Remarks like 'TST%');
      delete from Franchisee_Invoice where Remarks like 'TST%';
      delete from tblAccountTrasaction where Mode = 'BILL RECEIVE' and VoucherNo in (select BR_No from Bill_Receive_Details where Bill_no in (select bill_no from client_bill_charge_details where docket_no like 'T%'));
      delete from Bill_Receive where BR_No in (select BR_No from Bill_Receive_Details where Bill_no in (select bill_no from client_bill_charge_details where docket_no like 'T%'));
      delete from Bill_Receive_Details where Bill_no in (select bill_no from client_bill_charge_details where docket_no like 'T%');
      delete from tblAccountTrasaction where Mode = 'Bill Finalized' and VoucherNo in (select bill_no from client_bill_charge_details where docket_no like 'T%');
      delete from client_bill where bill_no in (select bill_no from client_bill_charge_details where docket_no like 'T%');
      delete from client_bill_cancel where docket_no like 'T%';
      delete from client_bill_charge_details where docket_no like 'T%';
      delete from pod_dispatch_image where docket_no like 'T%';
      delete from pod_dispatch where docket_no like 'T%';
      delete from pod_received where docket_no like 'T%';
      delete from POD_Dispatch_D where Doc_No like 'T%' or IOM_No not in (select IOM_number from pod_dispatch where IOM_number is not null);
      delete from POD_Dispatch_H where Doc_No not in (select Doc_No from POD_Dispatch_D);
      delete from drs_entry_details_grn where docket_no like 'T%';
      delete from drs_entry_details where Drs_no not in (select Drs_no from drs_entry_details_grn);
      delete from Arrival_Packg where docket_no like 'T%';
      delete from Arrival_entry where ArrivalNo not in (select ArrivalNo from Arrival_Packg);
      delete t from tblAccountTrasaction t join dispatch_master d on d.challan_no = t.VoucherNo
       where t.Mode = 'CHALLAN' and exists (select 1 from Manifest_grn g where g.docket_no like 'T%'
                                           and ',' + d.manifest_no + ',' like '%,' + g.Manifest_no + ',%');
      delete d from dispatch_master d where exists (select 1 from Manifest_grn g where g.docket_no like 'T%'
                                                   and ',' + d.manifest_no + ',' like '%,' + g.Manifest_no + ',%');
      delete from Arrival_entry where challan_no not in (select challan_no from dispatch_master);
      delete from Loading_Sheet where Ls_no in (select Ls_no from Loading_Sheet_Details where docket_no like 'T%');
      delete from Loading_Sheet_Details where docket_no like 'T%';
      delete from Manifest_grn where docket_no like 'T%';
      delete from mainfest_entry where mainfest_no not in (select Manifest_no from Manifest_grn);
      delete from Pick_Up_grn where docket_no like 'T%';
      delete from Pick_up_entry where pickup_no not in (select Pickup_no from Pick_Up_grn);
      delete from grn_master where docket_no like 'T%';
      delete from tblAccountLedger where LedgerName like '%TST %';
      delete from branch_master where branch_name like 'TST %';
      delete from Vechile_Master where VEHICLE_NO like 'TST%' or VEHICLE_NO like 'TS99%';
      delete from tblAccountLedger where LedgerName like 'TS99%';
      update tblAccountLedger set IsActive = 1 where LedgerName = 'TDS PAYABLE';  -- in case a run stopped inside the challan test
      delete from vendors_master where Name like 'TST %';
      -- test Paid / To Pay general rates carry notification_days '999'
      delete from ClientRate_With_Slab where EntRef in (select EntRef from client_contract_city where isnull(client_code, '') = '' and notification_days = '999');
      delete from client_contract_city where isnull(client_code, '') = '' and notification_days = '999';
      delete from client_contract_location where isnull(client_code, '') = '' and notification_days = '999';
      delete from client_contract_State where isnull(client_code, '') = '' and notification_days = '999';
      delete from client_contract_zone where isnull(client_code, '') = '' and notification_days = '999';
      delete from ODA_Charge where Distance = 777;                     -- test ODA rates
      delete from PRS_DRS_RATE_MASTER where Fix_Km_Rate = 777 or Per_Kg = 777;   -- test PRS / DRS rates
      -- settings: test rows carry TST remarks / headers, tst…@example.com, ODA bands from 90000, series G-99000…, trucks TS99…
      delete from Bind_Franchisee_To_Client where ClientID in (select client_code from client_Master where company_name like 'TST %');
      delete from Client_email where email like 'tst%@example.com';
      delete from Auto_MIS_Header_footer where Header like 'TST %';
      delete from ODA_Configuration_Master where ODA_Distance_ID in (select ID from ODA_Distance_Master where from_distance >= 90000)
                                            or ODA_Weight_ID in (select ID from ODA_Weight_Master where from_weight >= 90000);
      delete from ODA_Distance_Master where from_distance >= 90000;
      delete from ODA_Weight_Master where from_weight >= 90000;
      delete from Shipper_issue_frombranch_tobranch where shipper_no like 'G-99000%';
      delete from shiper_issue_to_branch where starting_series like 'G-99000%';
      delete from shipper_master where starting_series like 'G-99000%';
      delete from GatePasshipper_master where starting_series like 'G-99000%';
      delete from grn_master_splapl where docket_no like 'T%';
      delete from Freight_THC_Margin_Approval_Details where remarks like 'TST%';
      delete from vendor_vehicle_master where truck_no like 'TS99%' or vehicle_no like 'TS99%';
      delete from vendor_road_rate_master where ftl_amount = 777 or ftl_pkg = 777 or ftl_pkm = 777;
      delete from Vendor_Air_Slab_Rate where Air_Rate_Code in (select Air_Rate_Code from Vendor_Air_RateMaster where Rate_pkg = 777);
      delete from Vendor_Air_RateMaster where Rate_pkg = 777;
      delete from Vendor_Train_Rate where TripCost = 777 or rate = 777;
      delete from Franchisee_Commission_Master_Detail where CommId in (select Comm_Code from Franchisee_Commission_Master where Rent = 777);
      delete from Franchisee_Commission_Master where Rent = 777;
      delete from FranchiseeCommissionMaster where Pickup = 777;
      delete from General_Rate_With_Slab where EntRef in (
        select EntRef from GenaraleRate_Master_City where notification_days = '999' union select EntRef from General_Rate_location where notification_days = '999'
        union select EntRef from General_Rate_State where notification_days = '999' union select EntRef from General_Rate_zone where notification_days = '999');
      delete from GenaraleRate_Master_City where notification_days = '999';
      delete from General_Rate_location where notification_days = '999';
      delete from General_Rate_State where notification_days = '999';
      delete from General_Rate_zone where notification_days = '999';
      delete from ClientRate_With_Slab where client_id in (select client_code from client_Master where company_name like 'TST %');
      delete from ClientRate_Category_Slab where client_id in (select client_code from client_Master where company_name like 'TST %');
      delete from Min_chargeRate_slab where client_code in (select client_code from client_Master where company_name like 'TST %');
      delete from client_contract_city where client_code in (select client_code from client_Master where company_name like 'TST %');
      delete from client_contract_location where client_code in (select client_code from client_Master where company_name like 'TST %');
      delete from client_contract_State where client_code in (select client_code from client_Master where company_name like 'TST %');
      delete from client_contract_zone where client_code in (select client_code from client_Master where company_name like 'TST %');
      delete from client_Master where company_name like 'TST %';
      delete from users where user_id in (select empcode from employee_master where empname like 'TST %');
      delete from employee_master where empname like 'TST %';`);
    emp = await login({ username: 'EMP001', password: 'emp123' });
    admin = await login({ username: 'admin', password: 'admin123' });
    client = await login({ loginType: 'client', username: 'CL001', password: 'client123' });
  });
  after(closeDb);

  /** Book dockets at DELHI, manifest + challan them to MUMBAI and receive them there. */
  async function bringToMumbai(nos, docketExtra = () => ({})) {
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    for (const no of nos) {
      const d = await request(app).post('/api/dockets').set(at(emp)).send(docket(no, docketExtra(no)));
      assert.equal(d.status, 201, JSON.stringify(d.body));
    }
    const m = await request(app).post('/api/manifests').set(at(emp)).send({
      manifestDate: today, manifestTime: '12:00', freightType: 'SUNDRY', destination: 'B1002',
      dockets: nos.map((no) => ({ docketNo: no, packages: 3, weight: 45, freight: 513 })),
    });
    assert.equal(m.status, 201, JSON.stringify(m.body));
    const c = await request(app).post('/api/challans').set(at(emp)).send({
      challanDate: today, challanTime: '21:00', deliveryDate: today, vendorType: 'Vendor', vendorCode: 'V001',
      truckNo: 'DL01AB1234', freightType: 'SUNDRY', destType: 'BRANCH', routeType: 'DIRECT', routeCode: 'R001', routeTime: '21:00',
      driverName: 'RAMESH SINGH', driverMobile: '9811100010', hireCharge: 1000, manifests: [m.body.manifestNo],
    });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const bom = (await request(app).post('/api/auth/switch-branch').set(at(emp)).send({ branchCode: 'B1002' })).body.token;
    const a = await request(app).post('/api/arrivals').set(at(bom)).send({
      challanNo: c.body.challanNo, receiveDate: today, receiveTime: '08:00',
      dockets: nos.map((no) => ({ manifestNo: m.body.manifestNo, docketNo: no, packages: 3 })),
    });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    return { bom, challanNo: c.body.challanNo, manifestNo: m.body.manifestNo };
  }

  test('rejects bad credentials with 401', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'EMP001', password: 'nope', divCode: 'DIV1001', financialYear: '2025-2026' });
    assert.equal(res.status, 401);
  });

  test('menu is filtered by role', async () => {
    const e = await request(app).get('/api/menu').set('Authorization', `Bearer ${emp}`);
    const a = await request(app).get('/api/menu').set('Authorization', `Bearer ${admin}`);
    const count = (tree) => tree.reduce((n, m) => n + m.children.length, 0);
    assert.ok(count(a.body) > count(e.body));
    assert.ok(!JSON.stringify(e.body).includes('User Access Rights'));
  });

  test('access rights: admin saves permissions and the employee menu follows', async () => {
    const auth = { Authorization: `Bearer ${admin}` };
    const perms = [
      { menuId: 'M001', subMenuId: 'S004' },                      // Commodity Master
      { menuId: 'M002', subMenuId: 'S010', subSubMenuId: 'SS01' }, // Docket Entry
    ];
    const put = await request(app).put('/api/menu/permissions/EMP002').set(auth).send({ permissions: perms });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const got = await request(app).get('/api/menu/permissions/EMP002').set(auth);
    assert.equal(got.body.length, 2);

    const emp2 = await login({ username: 'EMP002', password: 'emp123' });
    const menu = await request(app).get('/api/menu').set('Authorization', `Bearer ${emp2}`);
    const names = JSON.stringify(menu.body);
    assert.ok(names.includes('Commodity Master') && names.includes('Docket Entry'));
    assert.ok(!names.includes('State Master'));

    // non-admins cannot edit permissions
    const denied = await request(app).put('/api/menu/permissions/EMP002').set('Authorization', `Bearer ${emp}`).send({ permissions: [] });
    assert.equal(denied.status, 403);
  });

  test('masters: create, duplicate, in-use delete guard', async () => {
    const auth = { Authorization: `Bearer ${admin}` };
    await request(app).delete('/api/masters/commodity/TST').set(auth);
    const c = await request(app).post('/api/masters/commodity').set(auth).send({ Commodity_code: 'tst', Commodity_name: 'test goods' });
    assert.equal(c.status, 201);
    assert.equal(c.body.Commodity_name, 'TEST GOODS');
    const dup = await request(app).post('/api/masters/commodity').set(auth).send({ Commodity_code: 'TS2', Commodity_name: 'TEST GOODS' });
    assert.equal(dup.status, 409);
    const inUse = await request(app).delete('/api/masters/zone/NZ').set(auth);
    assert.equal(inUse.status, 409);
    assert.equal((await request(app).delete('/api/masters/commodity/TST').set(auth)).status, 204);
  });

  test('masters: two menus, every master opens, next code and autofill', async () => {
    const auth = { Authorization: `Bearer ${admin}` };
    // GENERAL MASTER first, MASTER right after it; the business masters moved to MASTER
    const menu = (await request(app).get('/api/menu').set(auth)).body;
    assert.deepEqual(menu.slice(0, 2).map((m) => m.name), ['GENERAL MASTER', 'MASTER']);
    const names = (m) => m.children.map((c) => c.name);
    assert.ok(names(menu[0]).includes('Location Master') && names(menu[0]).includes('State Master'));
    assert.ok(names(menu[1]).includes('Branch Master') && names(menu[1]).includes('Driver Master') && !names(menu[0]).includes('Branch Master'));

    for (const d of (await request(app).get('/api/masters').set(auth)).body) {
      const r = await request(app).get(`/api/masters/${d.key}`).set(auth);
      assert.equal(r.status, 200, `${d.key}: ${JSON.stringify(r.body)}`);
    }

    const next = await request(app).get('/api/masters/location/next-code').set(auth);
    assert.match(next.body.code, /^L\d{3,}$/);
    const fill = await request(app).get('/api/masters/location/autofill/City_Code').query({ v: 'DEL' }).set(auth);
    assert.deepEqual(fill.body, { State_code: 'DL', branch_code: 'B1001' });
    const gst = await request(app).get('/api/masters/consignor/autofill/GSTIN_No').query({ v: '27abcde1234f1z5' }).set(auth);
    assert.equal(gst.body.state, 'MAHARASHTRA');
    assert.equal((await request(app).get('/api/masters/location/autofill/Location_Name').query({ v: 'x' }).set(auth)).status, 404);

    // a location with the suggested code: saved, in-use guard on its city, deleted
    await request(app).delete('/api/masters/location/TL99').set(auth);
    const loc = await request(app).post('/api/masters/location').set(auth)
      .send({ Location_Code: 'tl99', Location_Name: 'tst location', City_Code: 'DEL', State_code: 'DL', branch_code: 'B1001', IsActinve_Flag: 'Active' });
    assert.equal(loc.status, 201, JSON.stringify(loc.body));
    assert.equal(loc.body.Location_Name, 'TST LOCATION');
    const dup = await request(app).post('/api/masters/location').set(auth)
      .send({ Location_Code: 'TL98', Location_Name: 'TST LOCATION', City_Code: 'DEL', State_code: 'DL', branch_code: 'B1001' });
    assert.equal(dup.status, 409);
    assert.equal((await request(app).delete('/api/masters/location/TL99').set(auth)).status, 204);

    // identity-keyed master (driver): add, edit, delete
    const drv = await request(app).post('/api/masters/driver').set(auth).send({ Drivername: 'tst driver', branch: 'HEAD OFFICE', mobile_no: '', IsActive: true });
    assert.equal(drv.status, 201, JSON.stringify(drv.body));
    const id = drv.body.id;
    const upd = await request(app).put(`/api/masters/driver/${id}`).set(auth).send({ Drivername: 'tst driver two', branch: 'HEAD OFFICE', IsActive: false });
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    assert.equal(upd.body.Drivername, 'TST DRIVER TWO');
    assert.equal((await request(app).delete(`/api/masters/driver/${id}`).set(auth)).status, 204);

    // employees cannot use admin-only masters' automation either
    assert.equal((await request(app).get('/api/masters/division/next-code').set({ Authorization: `Bearer ${emp}` })).status, 403);
  });

  test('masters: add only with access rights to the master (no "+ New" without it)', async () => {
    const auth = { Authorization: `Bearer ${admin}` };
    // EMP002 may open Commodity Master only
    const put = await request(app).put('/api/menu/permissions/EMP002').set(auth)
      .send({ permissions: [{ menuId: 'M001', subMenuId: 'S004' }, { menuId: 'M002', subMenuId: 'S010', subSubMenuId: 'SS01' }] });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const emp2 = { Authorization: `Bearer ${await login({ username: 'EMP002', password: 'emp123' })}` };

    const defs = Object.fromEntries((await request(app).get('/api/masters').set(emp2)).body.map((d) => [d.key, d.canAdd]));
    assert.equal(defs.commodity, true);
    assert.equal(defs.location, false);
    assert.equal(defs.city, false);
    assert.ok(!('division' in defs));                                   // admin-only: not even listed
    assert.equal((await request(app).get('/api/masters/location').set(emp2)).body.definition.canAdd, false);

    // the server refuses what the button would not offer
    assert.equal((await request(app).get('/api/masters/location/next-code').set(emp2)).status, 403);
    assert.equal((await request(app).get('/api/masters/location/autofill/City_Code').query({ v: 'DEL' }).set(emp2)).status, 403);
    const denied = await request(app).post('/api/masters/city').set(emp2).send({ city_code: 'TZZ', city_name: 'TST CITY', state_code: 'DL', zone_code: 'NZ' });
    assert.equal(denied.status, 403);
    assert.match(denied.body.error, /City Master/);
    // the one he has: allowed
    assert.equal((await request(app).get('/api/masters/commodity/next-code').set(emp2)).status, 200);
    // a code from the name: NOIDA -> NOI (or the next free variant)
    const fromName = await request(app).get('/api/masters/city/next-code').query({ name: 'Noida' }).set(auth);
    assert.match(fromName.body.code, /^NO[A-Z0-9]$/);
    // admin: every master
    const all = (await request(app).get('/api/masters').set(auth)).body;
    assert.ok(all.every((d) => d.canAdd));
  });

  test('masters: a market vendor added from a drop-down gets its ledger and shows on the challan', async () => {
    const auth = { Authorization: `Bearer ${admin}` };
    await request(app).delete('/api/masters/temp-vendor/VT9901').set(auth);
    const bad = await request(app).post('/api/masters/temp-vendor').set(auth)
      .send({ vendor_code: 'VT9901', Name: 'tst market vendor', vendor_mode: 'RD', FTLDIVISION: 'DIV9999', TDS: 1, active_flag: true });
    assert.equal(bad.status, 400);
    assert.equal((await query("select count(*) as n from temp_vendors_master where vendor_code = 'VT9901'"))[0].n, 0);   // rolled back

    const v = await request(app).post('/api/masters/temp-vendor').set(auth)
      .send({ vendor_code: 'VT9901', Name: 'tst market vendor', vendor_mode: 'RD', FTLDIVISION: 'div1001', TDS: 1, active_flag: true });
    assert.equal(v.status, 201, JSON.stringify(v.body));
    const ledgers = await query("select LedgerName, Division from tblAccountLedger where VendorOrClientCode = 'VT9901'");
    assert.equal(ledgers.length, 1);
    assert.match(ledgers[0].LedgerName, /^TST MARKET VENDOR :VT9901 :HEAD OFFICE :B1001$/);
    const onChallan = await request(app).get('/api/challans/vendors').query({ vendorType: 'Market Vendor' }).set(auth);
    assert.ok(onChallan.body.some((x) => x.code === 'VT9901'), JSON.stringify(onChallan.body));

    // the name is part of the ledger: an edit keeps it
    const upd = await request(app).put('/api/masters/temp-vendor/VT9901').set(auth)
      .send({ Name: 'OTHER NAME', vendor_mode: 'RD', FTLDIVISION: 'DIV1001', TDS: 2, active_flag: true });
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    assert.equal(String(upd.body.Name).trim(), 'TST MARKET VENDOR');
    assert.equal((await query("select count(*) as n from tblAccountLedger where VendorOrClientCode = 'VT9901'"))[0].n, 1);

    // delete takes its unused ledger with it
    assert.equal((await request(app).delete('/api/masters/temp-vendor/VT9901').set(auth)).status, 204);
    assert.equal((await query("select count(*) as n from tblAccountLedger where VendorOrClientCode = 'VT9901'"))[0].n, 0);
  });

  test('docket: create -> read -> modify reproduces server-computed totals', async () => {
    const auth = { Authorization: `Bearer ${emp}` };
    const create = await request(app).post('/api/dockets').set(auth).send(docket('T0001'));
    assert.equal(create.status, 201, JSON.stringify(create.body));
    // 12 x 45 = 540, -5% = 513, fuel 51.3, others 160, docket 50 => 774.3; IGST 139.37; + 30 after tax
    assert.equal(create.body.totals.freight, 513);
    assert.equal(create.body.totals.taxableAmount, 774.3);
    assert.equal(create.body.totals.grandTotal, 943.67);

    const read = await request(app).get('/api/dockets/T0001').set(auth);
    assert.equal(read.status, 200);
    assert.equal(read.body.header.grandTotal, 943.67);
    assert.equal(read.body.pricing.charges.oda, 120);
    assert.equal(read.body.pricing.taxMode, 'IGST');
    assert.equal(read.body.additionalChargesTax.length, 1);

    // Re-submit what we read: totals must be identical.
    const { header: h, pricing: p } = read.body;
    const body = docket('T0001', { ...p, packets: p.packets, consigner: h.consigner, consignee: h.consignee });
    const upd = await request(app).put('/api/dockets/T0001').set(auth).send(body);
    assert.equal(upd.status, 200, JSON.stringify(upd.body));
    assert.equal(upd.body.totals.grandTotal, 943.67);
  });

  test('docket: client-supplied totals are ignored', async () => {
    const auth = { Authorization: `Bearer ${emp}` };
    const res = await request(app).post('/api/dockets').set(auth).send({ ...docket('T0002'), grandTotal: 1, freight: 1 });
    assert.equal(res.status, 201);
    const [row] = await query("select charges from grn_docket_charge where Docket_No = 'T0002'");
    assert.equal(Number(row.charges), res.body.totals.grandTotal);
  });

  test('docket: failure mid-chain rolls back the header', async () => {
    const auth = { Authorization: `Bearer ${emp}` };
    const res = await request(app).post('/api/dockets').set(auth).send(docket('T0003', { rateId: 'TEST-NO-LEDGER' }));
    assert.equal(res.status, 422);
    assert.match(res.body.error, /ledger not found/i);
    const rows = await query("select 1 from grn_master where docket_no = 'T0003'");
    assert.equal(rows.length, 0);
  });

  test('docket: validation + permissions', async () => {
    const bad = await request(app).post('/api/dockets').set('Authorization', `Bearer ${emp}`)
      .send(docket('T0004', { invoices: [{ invoiceNo: 'X', invoiceDate: '2999-01-01' }] }));
    assert.equal(bad.status, 400);
    const cl = await request(app).post('/api/dockets').set('Authorization', `Bearer ${client}`).send(docket('T0005'));
    assert.equal(cl.status, 403);
    const noRemark = await request(app).post('/api/dockets/T0001/cancel').set('Authorization', `Bearer ${emp}`).send({ remark: '' });
    assert.equal(noRemark.status, 400);
  });

  test('report: docket register filters by status and validates dates', async () => {
    const auth = { Authorization: `Bearer ${emp}` };
    const booked = await request(app).get('/api/reports/docket-register/run').set(auth).query({ from: today, to: today, status: 'Booked' });
    assert.equal(booked.status, 200, JSON.stringify(booked.body));
    assert.ok(booked.body.rows.some((r) => r.Docket_No === 'T0001'));
    assert.ok(booked.body.columns.length > 5);
    const bad = await request(app).get('/api/reports/docket-register/run').set(auth).query({ from: today, to: '2000-01-01' });
    assert.equal(bad.status, 400);
    const inj = await request(app).get('/api/reports/docket-register/run').set(auth).query({ from: today, to: today, status: "Booked' or 1=1--" });
    assert.equal(inj.status, 400);
  });

  test('docket: freight type is required (legacy "Please check Freight Type.")', async () => {
    const res = await request(app).post('/api/dockets').set('Authorization', `Bearer ${emp}`).send(docket('T0009', { freightType: '' }));
    assert.equal(res.status, 400);
    assert.ok(JSON.stringify(res.body).includes('freightType'));
  });

  test('docket: a GSTIN gives its state (first two digits = GST state code)', async () => {
    const st = (gstin) => request(app).get('/api/dockets/lookup/gst-state').set({ Authorization: `Bearer ${emp}` }).query({ gstin });
    assert.equal((await st('27AAACA1111A1Z1')).body.state, 'MAHARASHTRA');
    assert.equal((await st('07AAACR1234A1Z5')).body.state, 'DELHI');
    assert.equal((await st('XXAAACR1234A1Z5')).body.state, '');
    assert.equal((await request(app).get('/api/dockets/lookup/gst-state').query({ gstin: '27AAACA1111A1Z1' })).status, 401);
  });

  describe('automatic pickup on booking', () => {
    const auth = () => ({ Authorization: `Bearer ${emp}` });
    const book = (no, extra) => request(app).post('/api/dockets').set(auth()).send(docket(no, extra));
    before(() => { process.env.AUTO_PICKUP = '1'; });
    after(() => { process.env.AUTO_PICKUP = '0'; });

    test('same booking date + consignee city share one pickup; another city gets its own', async () => {
      const a = await book('TAP001', { originLocation: 'L002' });
      assert.equal(a.status, 201, JSON.stringify(a.body));
      assert.equal(a.body.pickup.created, true, JSON.stringify(a.body.pickup));
      assert.match(a.body.pickup.pickupNo, /^PSDEL\d{4}\d{6}$/);
      assert.match(a.body.message, /Pickup PSDEL\d+ created \(MUMBAI, /);

      const b = await book('TAP002');   // no origin location: the branch's own (L001)
      assert.equal(b.status, 201, JSON.stringify(b.body));
      assert.deepEqual([b.body.pickup.pickupNo, b.body.pickup.created], [a.body.pickup.pickupNo, false]);

      const c = await book('TAP003', { consignee: { code: 'CN001', name: 'ACME TEXTILES', city: 'PUNE', gstin: '27AAACA1111A1Z1' } });
      assert.equal(c.status, 201, JSON.stringify(c.body));
      assert.equal(c.body.pickup.created, true);
      assert.notEqual(c.body.pickup.pickupNo, a.body.pickup.pickupNo);

      const rows = await query(
        `select pg.docket_no, pg.Pickup_no, pg.Location_Code, pe.pickup_date, g.pickup_status from Pick_Up_grn pg
           join Pick_up_entry pe on pe.pickup_no = pg.Pickup_no join grn_master g on g.docket_no = pg.docket_no
          where pg.docket_no like 'TAP%' order by pg.docket_no`);
      assert.deepEqual(rows.map((r) => [r.docket_no, r.Pickup_no, r.Location_Code, r.pickup_status]), [
        ['TAP001', a.body.pickup.pickupNo, 'L002', 'generated'],
        ['TAP002', a.body.pickup.pickupNo, 'L001', 'generated'],
        ['TAP003', c.body.pickup.pickupNo, 'L001', 'generated'],
      ]);
      assert.ok(rows.every((r) => r.pickup_date.toISOString().slice(0, 10) === today));
      // the auto-picked dockets are no longer waiting for a pickup
      const pending = (await request(app).get('/api/pickups/pending-dockets').set(auth()).query({ from: today, to: today, docType: '2' })).body;
      assert.ok(!pending.some((d) => d.docketNo.startsWith('TAP')));
    });

    test('a cancelled pickup is never reused; AUTO_PICKUP=0 books without a pickup', async () => {
      const [p] = await query("select Pickup_no from Pick_Up_grn where docket_no = 'TAP001'");
      await query("update Pick_up_entry set IsCancelled = '1' where pickup_no = @p", { p: p.Pickup_no });
      const d = await book('TAP004');
      assert.equal(d.status, 201, JSON.stringify(d.body));
      assert.equal(d.body.pickup.created, true);
      assert.notEqual(d.body.pickup.pickupNo, p.Pickup_no);
      process.env.AUTO_PICKUP = '0';
      const e = await book('TAP005');
      assert.equal(e.status, 201, JSON.stringify(e.body));
      assert.equal(e.body.pickup, null);
      const [g] = await query("select isnull(pickup_status, '') as st from grn_master where docket_no = 'TAP005'");
      assert.equal(g.st, '');
    });
  });

  describe('pickup (PRS)', () => {
    const auth = () => ({ Authorization: `Bearer ${emp}` });
    const pend = (q = {}) => request(app).get('/api/pickups/pending-dockets').set(auth())
      .query({ from: today, to: today, docType: '2', ...q });
    const row = (no, extra = {}) => ({ docketNo: no, locationCode: 'L001', packages: 3, weight: 45, freight: 513, ...extra });

    before(async () => {
      for (const no of ['TP001', 'TP002', 'TP003']) {
        const r = await request(app).post('/api/dockets').set(auth()).send(docket(no));
        assert.equal(r.status, 201, JSON.stringify(r.body));
      }
    });

    test('options: locations and pickup staff for the branch', async () => {
      const res = await request(app).get('/api/pickups/options').set(auth());
      assert.equal(res.status, 200);
      assert.ok(res.body.locations.some((l) => l.value === 'L001'));
      assert.ok(res.body.pickupBy.some((p) => p.value === 'EMP003' && p.mobile));
    });

    test('pending dockets lists newly booked dockets', async () => {
      const res = await pend();
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const nos = res.body.map((d) => d.docketNo);
      assert.ok(['TP001', 'TP002', 'TP003'].every((n) => nos.includes(n)));
      const one = await pend({ dockets: 'TP002' });
      assert.deepEqual(one.body.map((d) => d.docketNo), ['TP002']);
    });

    let pickupNo;
    test('create: one transaction, dockets linked to the generated number', async () => {
      const res = await request(app).post('/api/pickups').set(auth()).send({
        pickupDate: today, pickupTime: '10:30', docType: '2', pickupBy: 'EMP003', pickupByMobile: '9811100003',
        dockets: [row('TP001'), row('TP002', { locationCode: 'L002' })],
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      pickupNo = res.body.pickupNo;
      assert.match(pickupNo, /^PSDEL\d{4}\d{6}$/);
      const linked = await query('select docket_no from Pick_Up_grn where Pickup_no = @p order by docket_no', { p: pickupNo });
      assert.deepEqual(linked.map((r) => r.docket_no), ['TP001', 'TP002']);
      const nos = (await pend()).body.map((d) => d.docketNo);
      assert.ok(!nos.includes('TP001') && nos.includes('TP003'));
    });

    test('create: rejects duplicates, future dates, missing location', async () => {
      const dup = await request(app).post('/api/pickups').set(auth())
        .send({ pickupDate: today, pickupTime: '11:00', docType: '2', dockets: [row('TP001')] });
      assert.equal(dup.status, 409);
      assert.match(dup.body.error, /TP001/);
      const future = await request(app).post('/api/pickups').set(auth())
        .send({ pickupDate: '2999-01-01', pickupTime: '11:00', docType: '2', dockets: [row('TP003')] });
      assert.equal(future.status, 400);
      const noLoc = await request(app).post('/api/pickups').set(auth())
        .send({ pickupDate: today, pickupTime: '11:00', docType: '2', dockets: [row('TP003', { locationCode: '' })] });
      assert.equal(noLoc.status, 400);
    });

    test('create: a failing docket row rolls back the whole pickup', async () => {
      const before = await query('select count(*) as c from Pick_up_entry');
      const res = await request(app).post('/api/pickups').set(auth())
        .send({ pickupDate: today, pickupTime: '11:00', docType: '2', dockets: [row('TP003', { weight: 1e17 })] });
      assert.equal(res.status, 500);
      const after = await query('select count(*) as c from Pick_up_entry');
      assert.equal(after[0].c, before[0].c);
      const [g] = await query("select pickup_status from grn_master where docket_no = 'TP003'");
      assert.ok(!g.pickup_status);
    });

    test('view + list', async () => {
      const one = await request(app).get(`/api/pickups/${pickupNo}`).set(auth());
      assert.equal(one.status, 200);
      assert.equal(one.body.dockets.length, 2);
      assert.equal(one.body.pickupBy, 'SURESH YADAV');
      const list = await request(app).get('/api/pickups').set(auth()).query({ from: today, to: today });
      assert.ok(list.body.some((p) => p.pickupNo === pickupNo));
    });

    test('cancel is blocked once a docket is manifested (legacy check never ran)', async () => {
      await query("update grn_master set manifest_status = 'generated' where docket_no = 'TP002'");
      const res = await request(app).post(`/api/pickups/${pickupNo}/cancel`).set(auth());
      assert.equal(res.status, 409);
      assert.match(res.body.error, /manifest/i);
      await query("update grn_master set manifest_status = null where docket_no = 'TP002'");
    });

    test('cancel releases the dockets; cancelling twice is refused', async () => {
      const res = await request(app).post(`/api/pickups/${pickupNo}/cancel`).set(auth());
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const nos = (await pend()).body.map((d) => d.docketNo);
      assert.ok(nos.includes('TP001') && nos.includes('TP002'));
      const again = await request(app).post(`/api/pickups/${pickupNo}/cancel`).set(auth());
      assert.equal(again.status, 409);
    });
  });

  describe('manifest', () => {
    const auth = () => ({ Authorization: `Bearer ${emp}` });
    const pend = (q = {}) => request(app).get('/api/manifests/pending-dockets').set(auth())
      .query({ destination: 'B1002', from: today, to: today, ...q });
    const base = { manifestDate: today, manifestTime: '12:00', freightType: 'SUNDRY', destination: 'B1002' };
    const pendingOf = async (no) => (await query('select pending_package from grn_docket_charge where Docket_No = @d', { d: no }))[0].pending_package;

    before(async () => {
      for (const no of ['TM001', 'TM002']) {
        const r = await request(app).post('/api/dockets').set(auth()).send(docket(no));
        assert.equal(r.status, 201, JSON.stringify(r.body));
      }
    });

    test('pending dockets filtered by destination', async () => {
      const res = await pend();
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const nos = res.body.map((d) => d.docketNo);
      assert.ok(nos.includes('TM001') && nos.includes('TM002'));
      const other = await pend({ destination: 'B1003' });
      assert.ok(!other.body.some((d) => d.docketNo === 'TM001'));
    });

    let manifestNo;
    test('create: full + partial dockets, generated number, pending reduced', async () => {
      const res = await request(app).post('/api/manifests').set(auth()).send({
        ...base,
        dockets: [
          { docketNo: 'TM001', packages: 3, weight: 45, freight: 513 },
          { docketNo: 'TM002', packages: 1, weight: 15, freight: 171 },
        ],
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      manifestNo = res.body.manifestNo;
      assert.match(manifestNo, /^MEDEL\d{4}\d{6}$/);
      const rows = await query('select docket_no, package from Manifest_grn where Manifest_no = @m order by docket_no', { m: manifestNo });
      assert.deepEqual(rows.map((r) => [r.docket_no, r.package]), [['TM001', 3], ['TM002', 1]]);
      assert.equal(await pendingOf('TM001'), 0);
      assert.equal(await pendingOf('TM002'), 2);
      const nos = (await pend()).body.map((d) => d.docketNo);
      assert.ok(!nos.includes('TM001') && nos.includes('TM002'));
    });

    test('create: validation', async () => {
      const over = await request(app).post('/api/manifests').set(auth())
        .send({ ...base, dockets: [{ docketNo: 'TM002', packages: 3, weight: 1, freight: 1 }] });
      assert.equal(over.status, 422);
      assert.match(JSON.stringify(over.body), /only 2 package/);
      const same = await request(app).post('/api/manifests').set(auth())
        .send({ ...base, destination: 'B1001', dockets: [{ docketNo: 'TM002', packages: 1, weight: 1, freight: 1 }] });
      assert.equal(same.status, 400);
      const ftlColoader = await request(app).post('/api/manifests').set(auth())
        .send({ ...base, freightType: 'FTL', transportedBy: 'COLOADER', coloaderName: 'FTL Coloader', dockets: [{ docketNo: 'TM002', packages: 1, weight: 1, freight: 1 }] });
      assert.equal(ftlColoader.status, 400);
    });

    test('manifesting marks the docket as manifested (read by the pickup-cancel guard)', async () => {
      const [g] = await query("select manifest_status from grn_master where docket_no = 'TM001'");
      assert.equal(g.manifest_status, 'generated');
    });

    test('view + list', async () => {
      const one = await request(app).get(`/api/manifests/${manifestNo}`).set(auth());
      assert.equal(one.status, 200);
      assert.equal(one.body.dockets.length, 2);
      assert.equal(one.body.destination, 'MUMBAI');
      const list = await request(app).get('/api/manifests').set(auth()).query({ from: today, to: today });
      const row = list.body.find((m) => m.manifestNo === manifestNo);
      assert.ok(row);
      assert.equal(row.packages, 4);
    });

    test('cancel is blocked once a challan exists', async () => {
      await query("update mainfest_entry set challan_no = 'TCH001' where mainfest_no = @m", { m: manifestNo });
      const res = await request(app).post(`/api/manifests/${manifestNo}/cancel`).set(auth());
      assert.equal(res.status, 409);
      assert.match(res.body.error, /TCH001/);
      await query('update mainfest_entry set challan_no = null where mainfest_no = @m', { m: manifestNo });
    });

    test('cancel restores pending packages', async () => {
      const res = await request(app).post(`/api/manifests/${manifestNo}/cancel`).set(auth());
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(await pendingOf('TM001'), 3);
      assert.equal(await pendingOf('TM002'), 3);
      const [g] = await query("select manifest_status from grn_master where docket_no = 'TM001'");
      assert.ok(!g.manifest_status);
      const again = await request(app).post(`/api/manifests/${manifestNo}/cancel`).set(auth());
      assert.equal(again.status, 409);
    });
  });

  describe('manifest bagging (courier) and the TMS bypass', () => {
    const auth = () => ({ Authorization: `Bearer ${emp}` });
    const base = { manifestDate: today, manifestTime: '12:00', freightType: 'SUNDRY', destination: 'B1002' };
    const dockets = ['TBG01', 'TBG02', 'TBG03'].map((d) => ({ docketNo: d, packages: 3, weight: 45, freight: 513 }));
    // grouped by hand: 2 dockets → bag B1 (as packet P1), 1 docket → bag B2, both bags → master bag M1
    const tree = [
      { key: 'M1', level: 'MASTER' },
      { key: 'B1', level: 'BAG', parent: 'M1' },
      { key: 'P1', level: 'PACKET', parent: 'B1', dockets: ['TBG01', 'TBG02'] },
      { key: 'B2', level: 'BAG', parent: 'M1', dockets: ['TBG03'] },
    ];
    let tms;

    before(async () => {
      for (const no of ['TBG01', 'TBG02', 'TBG03']) {
        const r = await request(app).post('/api/dockets').set(auth()).send(docket(no));
        assert.equal(r.status, 201, JSON.stringify(r.body));
      }
      tms = await login({ username: 'admin', password: 'admin123', divCode: 'DIV1003' });   // FTL = TMS division
    });

    test('courier division bags, TMS division does not', async () => {
      const c = await request(app).get('/api/manifests/options').set(auth());
      assert.equal(c.body.bagging.enabled, true);
      assert.ok(c.body.bagging.limits.docketsPerPacket >= 1);
      const t = await request(app).get('/api/manifests/options').set({ Authorization: `Bearer ${tms}` });
      assert.equal(t.body.bagging.enabled, false);
      const p = await request(app).get('/api/business/profile').set({ Authorization: `Bearer ${tms}` });
      assert.equal(p.body.tms, true);
      // TMS: one entry for the whole docket — bags are refused
      const refused = await request(app).post('/api/manifests').set({ Authorization: `Bearer ${tms}` }).send({ ...base, dockets, bags: tree });
      assert.equal(refused.status, 400, JSON.stringify(refused.body));
      assert.match(refused.body.error, /whole dockets/);
    });

    test('each docket once, smaller containers inside bigger ones, nothing empty; loose dockets allowed', async () => {
      const { planBags } = await import('../src/modules/manifest/manifest.service.js');
      const ds = dockets;
      assert.deepEqual(planBags(tree, ds).problems, []);
      // TBG03 left out of every bag: it goes loose
      assert.deepEqual(planBags(tree.slice(0, 3), ds).problems, []);
      // a docket straight in a master bag is fine too
      assert.deepEqual(planBags([{ key: 'M1', level: 'MASTER', dockets: ['TBG03'] }, { key: 'B1', level: 'BAG', parent: 'M1', dockets: ['TBG01'] }], ds).problems, []);
      assert.match(planBags([...tree, { key: 'P3', level: 'PACKET', parent: 'B1', dockets: ['TBG01'] }], ds).problems.join(' '), /TBG01 is in P1 and P3/);
      assert.match(planBags([{ key: 'P1', level: 'PACKET', dockets: ['TBG01'] }, { key: 'B1', level: 'BAG', parent: 'P1', dockets: ['TBG02'] }], ds).problems.join(' '),
        /cannot go into a packet/);
      assert.match(planBags([{ key: 'B9', level: 'BAG' }], ds).problems.join(' '), /B9 is empty/);
      assert.match(planBags([{ key: 'B1', level: 'BAG', dockets: ['TX999'] }], ds).problems.join(' '), /not on this manifest/);
      const empty = await request(app).post('/api/manifests').set(auth()).send({ ...base, dockets, bags: [...tree, { key: 'B9', level: 'BAG' }] });
      assert.equal(empty.status, 422);
    });

    let manifestNo;
    let masterNo;
    test('one save: manifest + packets + bag + master bag, numbered, with totals', async () => {
      const res = await request(app).post('/api/manifests').set(auth()).send({ ...base, dockets, bags: tree });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      manifestNo = res.body.manifestNo;
      assert.match(res.body.message, /in 1 master bag, 2 bags, 1 packet/);
      const no = Object.fromEntries(res.body.bags.map((b) => [b.key, b.bagNo]));
      assert.match(no.M1, /^MBDEL\d{4}\d{6}$/);
      assert.match(no.B1, /^BGDEL\d{4}\d{6}$/);
      assert.match(no.P1, /^PKDEL\d{4}\d{6}$/);
      masterNo = no.M1;

      const m = await request(app).get(`/api/manifests/${manifestNo}`).set(auth());
      assert.equal(m.body.bags.length, 4);
      const master = m.body.bags.find((b) => b.level === 'MASTER');
      assert.deepEqual([master.dockets, master.packages, master.weight], [3, 9, 135]);
      const b2 = m.body.bags.find((b) => b.bagNo === no.B2);
      assert.deepEqual(b2.docketNos, ['TBG03']);
      assert.equal(b2.parent, no.M1);
      assert.equal(m.body.bags.find((b) => b.bagNo === no.P1).parent, no.B1);

      // scanning the master bag finds every docket inside it
      const scan = await request(app).get(`/api/manifests/bags/${masterNo.toLowerCase()}`).set(auth());
      assert.equal(scan.status, 200, JSON.stringify(scan.body));
      assert.deepEqual(scan.body.docketNos.sort(), ['TBG01', 'TBG02', 'TBG03']);
      assert.equal(scan.body.manifestNo, manifestNo);
      assert.equal((await request(app).get('/api/manifests/bags/NOSUCHBAG').set(auth())).status, 404);
    });

    test('cancelling the manifest cancels its bags', async () => {
      const res = await request(app).post(`/api/manifests/${manifestNo}/cancel`).set(auth());
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const rows = await query('select IsCancelled from tblManifestBag where ManifestNo = @m', { m: manifestNo });
      assert.ok(rows.length === 4 && rows.every((r) => r.IsCancelled));
    });

    test('without bags a courier manifest still works (whole dockets)', async () => {
      const res = await request(app).post('/api/manifests').set(auth()).send({ ...base, dockets });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.deepEqual(res.body.bags, []);
      await request(app).post(`/api/manifests/${res.body.manifestNo}/cancel`).set(auth());
    });
  });

  describe('international docket (export / import)', () => {
    const auth = () => ({ Authorization: `Bearer ${emp}` });
    const exp = {
      shipmentType: 'EXPORT', destinationCountry: 'AE', destinationPort: 'DXB', carrierCode: 'EK', mawbNo: '176-12345675',
      currency: 'USD', invoiceValueFc: 1000, hsCode: '610910', iecNo: 'abcde12345', incoterm: 'FOB',
      overseasName: 'AL MANAR TRADING LLC', overseasCity: 'DUBAI', overseasZip: '00000',
    };

    test('an export docket keeps its details; INR value from the currency rate', async () => {
      const res = await request(app).post('/api/dockets').set(auth()).send(docket('TIN01', { international: exp }));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const got = await request(app).get('/api/dockets/TIN01').set(auth());
      const x = got.body.international;
      assert.equal(x.shipmentType, 'EXPORT');
      assert.equal(x.originCountry, 'IN');
      assert.equal(x.iecNo, 'ABCDE12345');
      const [{ RateToINR }] = await query("select RateToINR from tblCurrency where CurrencyCode = 'USD'");
      assert.equal(x.invoiceValueInr, Math.round(1000 * Number(RateToINR) * 100) / 100);
    });

    test('missing / unknown export data is refused; domestic stays plain', async () => {
      const noCur = await request(app).post('/api/dockets').set(auth()).send(docket('TIN02', { international: { ...exp, currency: '' } }));
      assert.equal(noCur.status, 400);
      assert.match(JSON.stringify(noCur.body), /currency/);
      const badCountry = await request(app).post('/api/dockets').set(auth()).send(docket('TIN02', { international: { ...exp, destinationCountry: 'ZZ' } }));
      assert.equal(badCountry.status, 400);
      assert.match(badCountry.body.error, /Unknown destination country/);
      assert.equal((await query("select count(*) as n from grn_master where docket_no = 'TIN02'"))[0].n, 0);   // rolled back

      const opts = await request(app).get('/api/dockets/lookup/international').set(auth());
      assert.ok(opts.body.countries.some((c) => c.value === 'AE') && opts.body.currencies.some((c) => c.value === 'USD' && c.rate > 0));

      // TIN01 has exactly one export row; an ordinary docket has none
      assert.equal((await query("select count(*) as n from docket_international where docket_no = 'TIN01'"))[0].n, 1);
      const plain = await request(app).get('/api/dockets/TBG01').set(auth());
      assert.equal(plain.body.international.shipmentType, 'DOMESTIC');
    });

    test('a division without international (FTL / TMS) refuses an export docket', async () => {
      const tms = await login({ username: 'admin', password: 'admin123', divCode: 'DIV1003' });
      const res = await request(app).post('/api/dockets').set({ Authorization: `Bearer ${tms}` }).send(docket('TIN03', { international: exp }));
      assert.equal(res.status, 400, JSON.stringify(res.body));
      assert.match(res.body.error, /domestic dockets only/);
    });
  });

  describe('loading sheet', () => {
    const auth = () => ({ Authorization: `Bearer ${emp}` });
    const pend = () => request(app).get('/api/loading-sheets/pending-dockets').set(auth()).query({ from: today, to: today });
    const mPend = (q = {}) => request(app).get('/api/manifests/pending-dockets').set(auth())
      .query({ destination: 'B1002', from: today, to: today, ...q });
    let lsNo;

    before(async () => {
      for (const no of ['TL001', 'TL002', 'TL003']) {
        const r = await request(app).post('/api/dockets').set(auth()).send(docket(no));
        assert.equal(r.status, 201, JSON.stringify(r.body));
      }
    });

    test('create: numbered, dockets leave the pending list, checks', async () => {
      const before = (await pend()).body.map((d) => d.docketNo);
      assert.ok(['TL001', 'TL002', 'TL003'].every((d) => before.includes(d)));
      const future = await request(app).post('/api/loading-sheets').set(auth())
        .send({ loadingDate: '2999-01-01', dockets: ['TL001'] });
      assert.equal(future.status, 400);
      const res = await request(app).post('/api/loading-sheets').set(auth()).send({ loadingDate: today, dockets: ['TL001', 'TL002'] });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      lsNo = res.body.lsNo;
      assert.match(lsNo, /^LS.+\d{6}$/);
      const after = (await pend()).body.map((d) => d.docketNo);
      assert.ok(!after.includes('TL001') && !after.includes('TL002') && after.includes('TL003'));
      const twice = await request(app).post('/api/loading-sheets').set(auth()).send({ loadingDate: today, dockets: ['TL001'] });
      assert.equal(twice.status, 422);
    });

    test('list + view', async () => {
      const list = await request(app).get('/api/loading-sheets').set(auth()).query({ open: 'true' });
      const row = list.body.find((l) => l.lsNo === lsNo);
      assert.ok(row);
      assert.equal(row.dockets, 2);
      const one = await request(app).get(`/api/loading-sheets/${lsNo}`).set(auth());
      assert.deepEqual(one.body.dockets.map((d) => d.docketNo), ['TL001', 'TL002']);
    });

    test('manual cancel / undo of one docket', async () => {
      const rows = (await request(app).get('/api/loading-sheets/docket/TL002').set(auth())).body;
      assert.equal(rows.length, 1);
      const off = await request(app).patch(`/api/loading-sheets/rows/${rows[0].id}`).set(auth()).send({ cancelled: true });
      assert.equal(off.status, 200, JSON.stringify(off.body));
      assert.ok((await pend()).body.some((d) => d.docketNo === 'TL002'));
      const back = await request(app).patch(`/api/loading-sheets/rows/${rows[0].id}`).set(auth()).send({ cancelled: false });
      assert.equal(back.status, 200);
      assert.ok(!(await pend()).body.some((d) => d.docketNo === 'TL002'));
    });

    let manifestNo;
    test('manifest from the loading sheet: only its dockets, sheet marked manifested', async () => {
      const p = await mPend({ loadingSheet: lsNo });
      assert.equal(p.status, 200, JSON.stringify(p.body));
      assert.deepEqual(p.body.map((d) => d.docketNo).sort(), ['TL001', 'TL002']);
      const base = { manifestDate: today, manifestTime: '12:00', freightType: 'SUNDRY', destination: 'B1002', loadingSheetNo: lsNo };
      const off = await request(app).post('/api/manifests').set(auth())
        .send({ ...base, dockets: [{ docketNo: 'TL003', packages: 3, weight: 45, freight: 1 }] });
      assert.equal(off.status, 400);
      assert.match(off.body.error, /TL003/);
      const res = await request(app).post('/api/manifests').set(auth()).send({ ...base, dockets: [
        { docketNo: 'TL001', packages: 3, weight: 45, freight: 1 }, { docketNo: 'TL002', packages: 3, weight: 45, freight: 1 }] });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      manifestNo = res.body.manifestNo;
      const one = await request(app).get(`/api/loading-sheets/${lsNo}`).set(auth());
      assert.ok(one.body.manifested);
      assert.equal(one.body.manifestNo, manifestNo);
      assert.equal(one.body.dockets[0].manifestNo, manifestNo);
      const cancel = await request(app).post(`/api/loading-sheets/${lsNo}/cancel`).set(auth());
      assert.equal(cancel.status, 409);
      assert.equal((await mPend({ loadingSheet: lsNo })).status, 409);
    });

    test('manifest cancel opens the sheet again; then the sheet can be cancelled', async () => {
      const mc = await request(app).post(`/api/manifests/${manifestNo}/cancel`).set(auth());
      assert.equal(mc.status, 200, JSON.stringify(mc.body));
      const one = await request(app).get(`/api/loading-sheets/${lsNo}`).set(auth());
      assert.ok(!one.body.manifested && !one.body.dockets[0].manifestNo);
      const c = await request(app).post(`/api/loading-sheets/${lsNo}/cancel`).set(auth());
      assert.equal(c.status, 200, JSON.stringify(c.body));
      assert.equal((await request(app).post(`/api/loading-sheets/${lsNo}/cancel`).set(auth())).status, 409);
      assert.ok((await pend()).body.some((d) => d.docketNo === 'TL001'));
    });
  });
  describe('challan (vehicle dispatch)', () => {
    const auth = () => ({ Authorization: `Bearer ${emp}` });
    const manifests = {};
    const base = (extra = {}) => ({
      challanDate: today, challanTime: '21:00', deliveryDate: today, vendorType: 'Vendor', vendorCode: 'V001',
      truckNo: 'DL01AB1234', freightType: 'SUNDRY', destType: 'BRANCH', routeType: 'DIRECT', routeCode: 'R001', routeTime: '21:00',
      driverName: 'RAMESH SINGH', driverMobile: '9811100010', sealNo: 'S-1',
      hireCharge: 20000, labourCharge: 500, otherCharge: 100, deductionAmt: 600, advance: 5000,
      manifests: [manifests.TC001], ...extra,
    });
    const pend = () => request(app).get('/api/challans/pending-manifests').set(auth())
      .query({ from: today, to: today, freightType: 'SUNDRY', destType: 'BRANCH', routeCode: 'R001' });

    before(async () => {
      for (const no of ['TC001', 'TC002']) {
        const d = await request(app).post('/api/dockets').set(auth()).send(docket(no));
        assert.equal(d.status, 201, JSON.stringify(d.body));
        const m = await request(app).post('/api/manifests').set(auth()).send({
          manifestDate: today, manifestTime: '12:00', freightType: 'SUNDRY', destination: 'B1002',
          dockets: [{ docketNo: no, packages: 3, weight: 45, freight: 513 }],
        });
        assert.equal(m.status, 201, JSON.stringify(m.body));
        manifests[no] = m.body.manifestNo;
      }
    });

    test('lookups: vendors, vehicles, route, pending manifests', async () => {
      const v = await request(app).get('/api/challans/vendors').set(auth()).query({ vendorType: 'Vendor' });
      assert.deepEqual(v.body.find((x) => x.code === 'V001'), { code: 'V001', name: 'SHARMA ROADWAYS', tdsPercent: 1 });
      const market = await request(app).get('/api/challans/vendors').set(auth()).query({ vendorType: 'Market Vendor' });
      assert.ok(market.body.some((x) => x.code === 'VT001'));
      const veh = await request(app).get('/api/challans/vehicles').set(auth()).query({ vendorCode: 'V001' });
      assert.ok(veh.body.some((x) => x.truckNo === 'DL01AB1234' && x.capacity === 9000));
      const r = await request(app).get('/api/challans/routes/R001').set(auth());
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.destination.code, 'B1002');
      assert.deepEqual(r.body.times, ['21:00', '23:30']);
      const p = await pend();
      assert.equal(p.status, 200, JSON.stringify(p.body));
      const nos = p.body.map((m) => m.manifestNo);
      assert.ok(nos.includes(manifests.TC001) && nos.includes(manifests.TC002));
      assert.equal(p.body.find((m) => m.manifestNo === manifests.TC001).weight, 45);
    });

    test('create: validation (advance, vehicle, overload, driver, ledgers, cash balance)', async () => {
      const post = (extra) => request(app).post('/api/challans').set(auth()).send(base(extra));
      const adv = await post({ advance: 999999 });
      assert.equal(adv.status, 422);
      assert.match(adv.body.error, /advance/i);
      const wrongTruck = await post({ truckNo: 'DL01CD5678' });
      assert.equal(wrongTruck.status, 400);
      const overload = await post({ vendorType: 'Market Vendor', vendorCode: 'VT001', truckNo: 'HR55X1234', capacity: 10 });
      assert.equal(overload.status, 422);
      assert.match(overload.body.error, /overload/i);
      const notOver = await post({ isOverload: true });
      assert.equal(notOver.status, 422);
      const noDriver = await post({ vendorType: 'Self', vendorCode: 'V002', truckNo: 'DL01CD5678', driverName: '', advance: 0 });
      assert.equal(noDriver.status, 400);
      const cash = await post({ vendorType: 'Self', vendorCode: 'V002', truckNo: 'DL01CD5678', advance: 60000 });
      assert.equal(cash.status, 422);
      assert.match(cash.body.error, /CASH HEAD OFFICE balance is 50000/);
      await query("update tblAccountLedger set IsActive = 0 where LedgerName = 'TDS PAYABLE'");
      try {
        const noLedger = await post();
        assert.equal(noLedger.status, 422);
        assert.match(noLedger.body.error, /TDS PAYABLE/);
      } finally {
        await query("update tblAccountLedger set IsActive = 1 where LedgerName = 'TDS PAYABLE'");
      }
      const [{ c }] = await query('select count(*) as c from dispatch_master where manifest_no = @m', { m: manifests.TC001 });
      assert.equal(c, 0);
    });

    let challanNo;
    test('create: server-computed amounts, balanced voucher, manifest dispatched', async () => {
      const res = await request(app).post('/api/challans').set(auth()).send({ ...base(), totalFreight: 1, tds: 0, balance: 0 });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      challanNo = res.body.challanNo;
      assert.match(challanNo, /^CTHDEL2526\d{6}$/);
      // 20000 + 500 + 100 - 600 = 20000; TDS 1% = 200; balance 20000 - 5000
      assert.equal(res.body.totals.freight, 20000);
      assert.equal(res.body.totals.tds, 200);
      assert.equal(res.body.totals.balance, 15000);
      const [d] = await query('select total_freight, bal_amount, total_weight, total_price, tobcode from dispatch_master where challan_no = @c', { c: challanNo });
      assert.deepEqual([Number(d.total_freight), Number(d.bal_amount), Number(d.total_weight), Number(d.total_price), d.tobcode], [20000, 15000, 45, 3, 'B1002']);
      const lines = await query('select Dr, Cr from tblAccountTrasaction where VoucherNo = @c', { c: challanNo });
      assert.equal(lines.length, 3);
      const sum = (k) => lines.reduce((t, l) => t + Number(l[k]), 0);
      assert.equal(sum('Dr'), 20000);
      assert.equal(sum('Cr'), 20000);
      const [m] = await query('select challan_no, Dispatch_Status from mainfest_entry where mainfest_no = @m', { m: manifests.TC001 });
      assert.deepEqual([m.challan_no, m.Dispatch_Status], [challanNo, 'IsActive']);
      const nos = (await pend()).body.map((x) => x.manifestNo);
      assert.ok(!nos.includes(manifests.TC001) && nos.includes(manifests.TC002));
    });

    test('create: an already-dispatched manifest is refused', async () => {
      const res = await request(app).post('/api/challans').set(auth()).send(base());
      assert.equal(res.status, 422);
      assert.match(JSON.stringify(res.body), /already dispatched/);
    });

    test('the manifest cannot be cancelled while the challan is active', async () => {
      const res = await request(app).post(`/api/manifests/${manifests.TC001}/cancel`).set(auth());
      assert.equal(res.status, 409);
    });

    test('view + list', async () => {
      const one = await request(app).get(`/api/challans/${challanNo}`).set(auth());
      assert.equal(one.status, 200, JSON.stringify(one.body));
      assert.equal(one.body.manifests.length, 1);
      assert.equal(one.body.vendor, 'SHARMA ROADWAYS');
      assert.equal(one.body.amounts.freight, 20000);
      const list = await request(app).get('/api/challans').set(auth()).query({ from: today, to: today });
      const row = list.body.find((c) => c.challanNo === challanNo);
      assert.ok(row);
      assert.equal(row.truckNo, 'DL01AB1234');
    });

    test('cancel: blocked after arrival, then releases the manifest and reverses the voucher', async () => {
      await query("insert into Arrival_entry(ArrivalNo, challan_no, IsCancelled) values ('T' + @c, @c, 0)", { c: challanNo });
      const blocked = await request(app).post(`/api/challans/${challanNo}/cancel`).set(auth());
      assert.equal(blocked.status, 409);
      assert.match(blocked.body.error, /arrival/i);
      await query('delete from Arrival_entry where challan_no = @c', { c: challanNo });

      const res = await request(app).post(`/api/challans/${challanNo}/cancel`).set(auth());
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const [m] = await query('select challan_no from mainfest_entry where mainfest_no = @m', { m: manifests.TC001 });
      assert.equal(m.challan_no, null);
      const live = await query('select 1 as x from tblAccountTrasaction where VoucherNo = @c and IsCancelled = 0', { c: challanNo });
      assert.equal(live.length, 0);
      assert.ok((await pend()).body.some((x) => x.manifestNo === manifests.TC001));
      const again = await request(app).post(`/api/challans/${challanNo}/cancel`).set(auth());
      assert.equal(again.status, 409);
    });
  });

  describe('arrival', () => {
    let bom; let challanNo; let manifestNo; let arrivalNo;
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const pending = (tok) => request(app).get('/api/arrivals/pending-challans').set(at(tok)).query({ from: today, to: today });
    const body = (extra = {}) => ({
      challanNo, receiveDate: today, receiveTime: '09:30', message: 'one box short',
      dockets: [
        { manifestNo, docketNo: 'TA001', packages: 3 },
        { manifestNo, docketNo: 'TA002', packages: 2, remarks: '1 box missing' },
      ],
      ...extra,
    });
    const chargeAt = async (no, branch) => (await query(
      'select pending_package from grn_docket_charge where Docket_No = @d and branch = @b', { d: no, b: branch }))[0]?.pending_package;

    before(async () => {
      for (const no of ['TA001', 'TA002']) {
        const d = await request(app).post('/api/dockets').set(at(emp)).send(docket(no));
        assert.equal(d.status, 201, JSON.stringify(d.body));
      }
      const m = await request(app).post('/api/manifests').set(at(emp)).send({
        manifestDate: today, manifestTime: '12:00', freightType: 'SUNDRY', destination: 'B1002',
        dockets: ['TA001', 'TA002'].map((no) => ({ docketNo: no, packages: 3, weight: 45, freight: 513 })),
      });
      assert.equal(m.status, 201, JSON.stringify(m.body));
      manifestNo = m.body.manifestNo;
      const c = await request(app).post('/api/challans').set(at(emp)).send({
        challanDate: today, challanTime: '21:00', deliveryDate: today, vendorType: 'Vendor', vendorCode: 'V001',
        truckNo: 'DL01AB1234', freightType: 'SUNDRY', destType: 'BRANCH', routeType: 'DIRECT', routeCode: 'R001', routeTime: '21:00',
        driverName: 'RAMESH SINGH', driverMobile: '9811100010', hireCharge: 1000, manifests: [manifestNo],
      });
      assert.equal(c.status, 201, JSON.stringify(c.body));
      challanNo = c.body.challanNo;
      const sw = await request(app).post('/api/auth/switch-branch').set(at(emp)).send({ branchCode: 'B1002' });
      assert.equal(sw.status, 200, JSON.stringify(sw.body));
      bom = sw.body.token;
    });

    test('pending challans: listed at the destination, not at the origin', async () => {
      const res = await pending(bom);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const row = res.body.find((c) => c.challanNo === challanNo);
      assert.ok(row);
      assert.deepEqual([row.manifests, row.packages, row.weight], [1, 6, 90]);
      assert.ok(!(await pending(emp)).body.some((c) => c.challanNo === challanNo));
      const detail = await request(app).get(`/api/arrivals/challans/${challanNo}`).set(at(bom));
      assert.equal(detail.status, 200, JSON.stringify(detail.body));
      assert.equal(detail.body.dockets.length, 2);
      assert.equal(detail.body.openingKm, 0);
    });

    test('create: validation', async () => {
      const post = (extra) => request(app).post('/api/arrivals').set(at(bom)).send(body(extra));
      assert.equal((await post({ receiveDate: '2999-01-01' })).status, 400);
      const over = await post({ dockets: [{ manifestNo, docketNo: 'TA001', packages: 4 }] });
      assert.equal(over.status, 422);
      assert.match(JSON.stringify(over.body), /cannot be greater than manifested/);
      const noRemark = await post({ message: '' });
      assert.equal(noRemark.status, 400);
      assert.match(noRemark.body.error, /Remarks are required/);
      const stranger = await post({ dockets: [{ manifestNo, docketNo: 'T0001', packages: 1 }] });
      assert.equal(stranger.status, 422);
      const [{ c }] = await query('select count(*) as c from Arrival_entry where challan_no = @c', { c: challanNo });
      assert.equal(c, 0);
    });

    test('create: one transaction — arrival no., prorated weight, docket now lies at this branch', async () => {
      const res = await request(app).post('/api/arrivals').set(at(bom)).send(body({
        dockets: [
          { manifestNo, docketNo: 'TA001', packages: 3, weight: 999 }, // weight corrected on the scale
          { manifestNo, docketNo: 'TA002', packages: 2 },              // one packet short
        ],
      }));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      arrivalNo = res.body.arrivalNo;
      assert.match(arrivalNo, /^AEBOM2526\d{6}$/);
      // TA001 weight corrected to 999 by the user; TA002 2 of 3 packets -> 30 kg prorated
      assert.deepEqual(res.body.totals, { actualWeight: 90, inwardWeight: 1029, difference: -939, packages: 5 });
      assert.equal(await chargeAt('TA002', 'B1002'), 2);
      const [p] = await query("select freight from Arrival_Packg where docket_no = 'TA002' and ArrivalNo = @a", { a: arrivalNo });
      assert.equal(Number(p.freight), 342);
      const [g] = await query("select current_branch, Arrived_status from grn_master where docket_no = 'TA001'");
      assert.deepEqual([g.current_branch, g.Arrived_status], ['B1002', 'generated']);
      assert.ok(!(await pending(bom)).body.some((c) => c.challanNo === challanNo));
    });

    test('a received challan cannot be received again or cancelled at the origin', async () => {
      const again = await request(app).post('/api/arrivals').set(at(bom)).send(body());
      assert.equal(again.status, 404);
      const cancelChallan = await request(app).post(`/api/challans/${challanNo}/cancel`).set(at(emp));
      assert.equal(cancelChallan.status, 409);
      assert.match(cancelChallan.body.error, /arrival/i);
    });

    test('view + list', async () => {
      const one = await request(app).get(`/api/arrivals/${arrivalNo}`).set(at(bom));
      assert.equal(one.status, 200, JSON.stringify(one.body));
      assert.equal(one.body.dockets.length, 2);
      assert.equal(one.body.difference, -939);
      const list = await request(app).get('/api/arrivals').set(at(bom)).query({ from: today, to: today });
      assert.ok(list.body.some((a) => a.arrivalNo === arrivalNo && a.packages === 5));
    });

    test('cancel: blocked by a DRS, then undoes the arrival', async () => {
      await query("insert into drs_entry_details(drs_no, Financial_Year, IsCancelled) values ('TDRS1', '2025-2026', 0)");
      await query("update Arrival_Packg set drs_no = 'TDRS1' where ArrivalNo = @a and docket_no = 'TA001'", { a: arrivalNo });
      const blocked = await request(app).post(`/api/arrivals/${arrivalNo}/cancel`).set(at(bom));
      assert.equal(blocked.status, 409);
      assert.match(blocked.body.error, /DRS/);
      await query("update Arrival_Packg set drs_no = null where ArrivalNo = @a", { a: arrivalNo });

      const res = await request(app).post(`/api/arrivals/${arrivalNo}/cancel`).set(at(bom));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(await chargeAt('TA002', 'B1002'), undefined);
      assert.ok((await pending(bom)).body.some((c) => c.challanNo === challanNo));
      const again = await request(app).post(`/api/arrivals/${arrivalNo}/cancel`).set(at(bom));
      assert.equal(again.status, 409);
    });
  });

  describe('arrival: excess dockets', () => {
    // challan A carries manifest A (TX001); challan B carries manifest B (TX002, TX003). TX002 / TX003 come on truck A.
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const ch = {}; const mf = {}; let bom; let arrivalNo;
    const pending = () => request(app).get('/api/arrivals/pending-challans').set(at(bom)).query({ from: today, to: today });
    const excessOf = (no) => request(app).get(`/api/arrivals/challans/${ch.A}/excess/${no}`).set(at(bom));

    before(async () => {
      for (const no of ['TX001', 'TX002', 'TX003']) {
        const d = await request(app).post('/api/dockets').set(at(emp)).send(docket(no));
        assert.equal(d.status, 201, JSON.stringify(d.body));
      }
      for (const [k, nos, truck] of [['A', ['TX001'], 'DL01AB1234'], ['B', ['TX002', 'TX003'], 'DL01AB1234']]) {
        const m = await request(app).post('/api/manifests').set(at(emp)).send({
          manifestDate: today, manifestTime: '12:00', freightType: 'SUNDRY', destination: 'B1002',
          dockets: nos.map((no) => ({ docketNo: no, packages: 3, weight: 45, freight: 513 })),
        });
        assert.equal(m.status, 201, JSON.stringify(m.body));
        mf[k] = m.body.manifestNo;
        const c = await request(app).post('/api/challans').set(at(emp)).send({
          challanDate: today, challanTime: '21:00', deliveryDate: today, vendorType: 'Vendor', vendorCode: 'V001',
          truckNo: truck, freightType: 'SUNDRY', destType: 'BRANCH', routeType: 'DIRECT', routeCode: 'R001', routeTime: '21:00',
          driverName: 'RAMESH SINGH', driverMobile: '9811100010', hireCharge: 1000, manifests: [mf[k]],
        });
        assert.equal(c.status, 201, JSON.stringify(c.body));
        ch[k] = c.body.challanNo;
      }
      bom = (await request(app).post('/api/auth/switch-branch').set(at(emp)).send({ branchCode: 'B1002' })).body.token;
    });

    test('lookup: a docket of another challan\'s manifest; refused for this challan\'s or an unknown docket', async () => {
      const ok = await excessOf('TX002');
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.deepEqual([ok.body.manifestNo, ok.body.challanNo, ok.body.packages, ok.body.excess], [mf.B, ch.B, 3, true]);
      assert.equal((await excessOf('TX001')).status, 400);
      assert.equal((await excessOf('T0001')).status, 404);
    });

    test('create: excess dockets received in full, their manifest closed when all have arrived', async () => {
      const res = await request(app).post('/api/arrivals').set(at(bom)).send({
        challanNo: ch.A, receiveDate: today, receiveTime: '09:30',
        dockets: [{ manifestNo: mf.A, docketNo: 'TX001', packages: 3 }],
        excess: [{ docketNo: 'TX002', weight: 50, remarks: 'came on truck A' }, { docketNo: 'TX003' }],
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      arrivalNo = res.body.arrivalNo;
      assert.equal(res.body.excess, 2);
      assert.equal(res.body.totals.difference, 0);          // the weight check is for challan A's manifest only
      const rows = await query('select docket_no, manifest_no, package, weight, IsExcessArrival from Arrival_Packg where ArrivalNo = @a order by docket_no', { a: arrivalNo });
      assert.deepEqual(rows.map((r) => [r.docket_no, r.manifest_no, r.package, Number(r.weight), Boolean(r.IsExcessArrival)]),
        [['TX001', mf.A, 3, 45, false], ['TX002', mf.B, 3, 50, true], ['TX003', mf.B, 3, 45, true]]);
      const [m] = await query('select Arrived_status from mainfest_entry where mainfest_no = @m', { m: mf.B });
      assert.equal(m.Arrived_status, 'IsActive');
      assert.ok(!(await pending()).body.some((c) => c.challanNo === ch.B));
      const one = await request(app).get(`/api/arrivals/${arrivalNo}`).set(at(bom));
      assert.deepEqual(one.body.dockets.filter((d) => d.excess).map((d) => d.docketNo), ['TX002', 'TX003']);
      assert.equal((await excessOf('TX002')).status, 404);  // already received
    });

    test('cancel: the excess dockets go back on their own manifest', async () => {
      const res = await request(app).post(`/api/arrivals/${arrivalNo}/cancel`).set(at(bom));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const [m] = await query('select Arrived_status from mainfest_entry where mainfest_no = @m', { m: mf.B });
      assert.equal(m.Arrived_status, null);
      const b = await request(app).get(`/api/arrivals/challans/${ch.B}`).set(at(bom));
      assert.deepEqual(b.body.dockets.map((d) => d.docketNo), ['TX002', 'TX003']);
    });
  });

  describe('client bill (GST)', () => {
    // dockets TB001..TB003 are billed at B1002 to ACME TEXTILES (CL001), IGST, 943.67 each; TB003's total is tampered
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0);
    let bom; let billNo;
    const pend = (q = {}) => request(app).get('/api/client-bills/pending-dockets').set(at(bom))
      .query({ clientCode: 'CL001', from: today, to: today, taxType: 'IGST', ...q });
    const base = { clientCode: 'CL001', billDate: today, serviceType: 'Courier', taxType: 'IGST', from: today, to: today };

    before(async () => {
      for (const no of ['TB001', 'TB002', 'TB003']) {
        const d = await request(app).post('/api/dockets').set(at(emp)).send(docket(no));
        assert.equal(d.status, 201, JSON.stringify(d.body));
      }
      await query("update grn_docket_charge set charges = charges + 50 where Docket_No = 'TB003' and isnull(rate_on, '') <> ''");
      const fyEmp = await fyLogin();
      bom = (await request(app).post('/api/auth/switch-branch').set(at(fyEmp)).send({ branchCode: 'B1002' })).body.token;
    });

    test('lookups: the branch client with its tax type, the pending dockets with their checks', async () => {
      const c = await request(app).get('/api/client-bills/clients').set(at(bom)).query({ q: 'ACME' });
      assert.equal(c.status, 200, JSON.stringify(c.body));
      assert.deepEqual([c.body[0].code, c.body[0].taxType], ['CL001', 'GST']);
      const p = await pend();
      assert.equal(p.status, 200, JSON.stringify(p.body));
      const byNo = Object.fromEntries(p.body.map((d) => [d.docketNo, d]));
      assert.ok(byNo.TB001 && byNo.TB002 && byNo.TB003);
      assert.deepEqual([byNo.TB001.total, byNo.TB001.igst, byNo.TB001.afterTax, byNo.TB001.problems.length], [943.67, 139.37, 30, 0]);
      assert.match(byNo.TB003.problems[0], /mismatch/);
      assert.ok(!(await pend({ taxType: 'GST' })).body.some((d) => d.docketNo === 'TB001'));
      const atDelhi = await request(app).get('/api/client-bills/pending-dockets').set(at(emp))
        .query({ clientCode: 'CL001', from: today, to: today, taxType: 'IGST' });
      assert.ok(!atDelhi.body.some((d) => d.docketNo === 'TB001'));   // billed at Mumbai
    });

    test('create: checks, then one bill with the server totals; the dockets are billed', async () => {
      const post = (b) => request(app).post('/api/client-bills').set(at(bom)).send({ ...base, ...b });
      assert.equal((await post({ dockets: ['TB001'], billDate: '2999-01-01' })).status, 400);
      const bad = await post({ dockets: ['TB001', 'TB003'] });
      assert.equal(bad.status, 422);
      assert.match(JSON.stringify(bad.body), /TB003: amount mismatch/);
      const res = await post({ dockets: ['TB001', 'TB002'], remarks: 'TST bill' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      billNo = res.body.billNo;
      assert.match(billNo, /^BL.+\d{6}$/);
      assert.equal(res.body.totalAmount, 1887.34);
      const [g] = await query("select Invoice_status, bill_no from grn_master where docket_no = 'TB001'");
      assert.deepEqual([g.Invoice_status, g.bill_no], ['invoicegenerated', billNo]);
      assert.ok(!(await pend()).body.some((d) => d.docketNo === 'TB001'));
      assert.equal((await post({ dockets: ['TB002'] })).status, 422);
    });

    test('view + list', async () => {
      const one = await request(app).get(`/api/client-bills/${billNo}`).set(at(bom));
      assert.equal(one.status, 200, JSON.stringify(one.body));
      assert.deepEqual([one.body.status, one.body.dockets.length, one.body.totals.igst, one.body.totals.total, one.body.sacCode],
        ['Generated', 2, 278.74, 1887.34, '996812']);
      const list = await request(app).get('/api/client-bills').set(at(bom)).query({ from: today, to: today });
      assert.ok(list.body.some((b) => b.billNo === billNo && b.clientCode === 'CL001' && b.dockets === 2));
    });

    test('cancel: refused once submitted, then frees the dockets', async () => {
      const cancel = (b = { remarks: 'TST wrong client' }) => request(app).post(`/api/client-bills/${billNo}/cancel`).set(at(bom)).send(b);
      assert.equal((await cancel({ remarks: '' })).status, 400);
      await query("update client_bill set ClientBill_Summation_status = 'Active' where bill_no = @b", { b: billNo });
      assert.equal((await cancel()).status, 409);
      await query('update client_bill set ClientBill_Summation_status = null where bill_no = @b', { b: billNo });
      const res = await cancel();
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.ok((await pend()).body.some((d) => d.docketNo === 'TB001'));
      const cancelled = await request(app).get('/api/client-bills').set(at(bom)).query({ from: today, to: today, status: 'cancelled' });
      assert.ok(cancelled.body.some((b) => b.billNo === billNo && b.status === 'Cancelled'));
      assert.equal((await cancel()).status, 409);
    });
  });
  describe('bill submission and finalize', () => {
    // TK001 / TK002 billed at B1002 to ACME TEXTILES (submitted and billed at B1002); 943.67 each
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0);
    let bom; let billNo;
    const list = (path, q = {}) => request(app).get(`/api/client-bills/${path}`).set(at(bom)).query(q);
    const statusOf = async () => (await request(app).get(`/api/client-bills/${billNo}`).set(at(bom))).body.status;

    before(async () => {
      for (const no of ['TK001', 'TK002']) {
        const d = await request(app).post('/api/dockets').set(at(emp)).send(docket(no));
        assert.equal(d.status, 201, JSON.stringify(d.body));
      }
      const fyEmp = await fyLogin();
      bom = (await request(app).post('/api/auth/switch-branch').set(at(fyEmp)).send({ branchCode: 'B1002' })).body.token;
      const b = await request(app).post('/api/client-bills').set(at(bom)).send({
        clientCode: 'CL001', billDate: today, serviceType: 'Courier', taxType: 'IGST', from: today, to: today, dockets: ['TK001', 'TK002'],
      });
      assert.equal(b.status, 201, JSON.stringify(b.body));
      billNo = b.body.billNo;
    });

    test('submission: only pending bills of this submission branch; receiver required', async () => {
      assert.ok((await list('submission')).body.some((b) => b.billNo === billNo));
      const delhi = await request(app).get('/api/client-bills/submission').set(at(emp));
      assert.ok(!delhi.body.some((b) => b.billNo === billNo));
      const post = (b) => request(app).post('/api/client-bills/submission').set(at(bom)).send({ bills: [billNo], date: today, receiverName: 'TST RECEIVER', ...b });
      assert.equal((await post({ receiverName: '' })).status, 400);
      assert.equal((await post({ date: '2999-01-01' })).status, 400);
      const ok = await post({ receiverPhone: '9800000000' });
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(await statusOf(), 'Submitted');
      assert.equal((await post()).status, 422);
      assert.equal((await request(app).post(`/api/client-bills/${billNo}/cancel`).set(at(bom)).send({ remarks: 'TST no' })).status, 409);
    });

    test('finalize: voucher Dr BILLED / Cr OUTPUT GST + FREIGHT INCOME, then unfinalize (refused once paid) and unsubmit', async () => {
      assert.ok((await list('finalize')).body.some((b) => b.billNo === billNo));
      const fin = await request(app).post('/api/client-bills/finalize').set(at(bom)).send({ bills: [billNo], date: today });
      assert.equal(fin.status, 200, JSON.stringify(fin.body));
      assert.equal(await statusOf(), 'Finalized');
      const lines = await query(
        `select l.LedgerName, t.Dr, t.Cr from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
          where t.VoucherNo = @b and t.IsCancelled = 0 order by t.Dr desc`, { b: billNo });
      assert.deepEqual([lines[0].LedgerName.endsWith(':BILLED'), Number(lines[0].Dr), Number(lines[0].Cr)], [true, 1887.34, 0]);
      assertSale(lines.slice(1).map((r) => [r.LedgerName, Number(r.Dr), Number(r.Cr)]), 1887.34);
      assert.equal((await request(app).post(`/api/client-bills/${billNo}/unsubmit`).set(at(bom))).status, 409);
      assert.ok((await list('finalize', { stage: 'done' })).body.some((b) => b.billNo === billNo));

      await query('update client_bill set Payment_Status = 1 where bill_no = @b', { b: billNo });
      assert.equal((await request(app).post(`/api/client-bills/${billNo}/unfinalize`).set(at(bom))).status, 409);
      await query('update client_bill set Payment_Status = 0 where bill_no = @b', { b: billNo });
      const un = await request(app).post(`/api/client-bills/${billNo}/unfinalize`).set(at(bom));
      assert.equal(un.status, 200, JSON.stringify(un.body));
      const live = await query('select 1 as x from tblAccountTrasaction where VoucherNo = @b and IsCancelled = 0', { b: billNo });
      assert.equal(live.length, 0);
      assert.equal(await statusOf(), 'Submitted');
      const back = await request(app).post(`/api/client-bills/${billNo}/unsubmit`).set(at(bom));
      assert.equal(back.status, 200, JSON.stringify(back.body));
      assert.equal(await statusOf(), 'Generated');
    });
  });
  describe('bill receipt', () => {
    // TQ001 / TQ002 → bill 1887.34 at B1002, submitted and finalized; received in two parts
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0);
    let bom; let billNo; let br2;
    const outstanding = async () => (await request(app).get('/api/bill-receipts/pending-bills').set(at(bom)).query({ clientCode: 'CL001' }))
      .body.find((b) => b.billNo === billNo)?.outstanding;
    const statusOf = async () => (await request(app).get(`/api/client-bills/${billNo}`).set(at(bom))).body.status;
    const receive = (bills, extra = {}) => request(app).post('/api/bill-receipts').set(at(bom))
      .send({ clientCode: 'CL001', receiveDate: today, mode: 'Cash', bills, ...extra });

    before(async () => {
      for (const no of ['TQ001', 'TQ002']) {
        const d = await request(app).post('/api/dockets').set(at(emp)).send(docket(no));
        assert.equal(d.status, 201, JSON.stringify(d.body));
      }
      const fyEmp = await fyLogin();
      bom = (await request(app).post('/api/auth/switch-branch').set(at(fyEmp)).send({ branchCode: 'B1002' })).body.token;
      const b = await request(app).post('/api/client-bills').set(at(bom)).send({
        clientCode: 'CL001', billDate: today, serviceType: 'Courier', taxType: 'IGST', from: today, to: today, dockets: ['TQ001', 'TQ002'],
      });
      assert.equal(b.status, 201, JSON.stringify(b.body));
      billNo = b.body.billNo;
      assert.equal((await request(app).post('/api/client-bills/submission').set(at(bom)).send({ bills: [billNo], date: today, receiverName: 'TST' })).status, 200);
      assert.equal((await request(app).post('/api/client-bills/finalize').set(at(bom)).send({ bills: [billNo], date: today })).status, 200);
    });

    test('lookups: options, the client with its outstanding', async () => {
      const o = await request(app).get('/api/bill-receipts/options').set(at(bom));
      assert.equal(o.status, 200, JSON.stringify(o.body));
      assert.deepEqual([o.body.cash.name, o.body.cash.exists], ['CASH MUMBAI', true]);
      assert.ok(o.body.banks.some((b) => b.label === 'HDFC BANK CURRENT A/C'));
      const c = await request(app).get('/api/bill-receipts/clients').set(at(bom)).query({ q: 'ACME' });
      assert.ok(c.body.some((x) => x.code === 'CL001' && x.outstanding >= 1887.34));
      assert.equal(await outstanding(), 1887.34);
    });

    test('part receipt with TDS: balanced voucher, bill part paid, finalize cannot be undone', async () => {
      assert.equal((await receive([{ billNo, received: 1000 }], { mode: 'Bank' })).status, 400);   // no bank picked
      const over = await receive([{ billNo, received: 2000 }]);
      assert.equal(over.status, 422);
      assert.match(JSON.stringify(over.body), /outstanding/);
      const res = await receive([{ billNo, received: 1000, tds: 50 }], { remarks: 'TST part' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.match(res.body.brNo, /^BR.+\d{6}$/);
      const one = await request(app).get(`/api/bill-receipts/${res.body.brNo}`).set(at(bom));
      const v = Object.fromEntries(one.body.voucher.map((l) => [l.ledger.endsWith(':BILLED') ? 'client' : l.ledger, [l.dr, l.cr]]));
      assert.deepEqual(v, { 'CASH MUMBAI': [1000, 0], 'TDS Receivable': [50, 0], client: [0, 1050] });
      assert.equal(await outstanding(), 837.34);
      assert.equal(await statusOf(), 'Part paid');
      assert.equal((await request(app).post(`/api/client-bills/${billNo}/unfinalize`).set(at(bom))).status, 409);
    });

    test('final receipt by bank with round-off: bill paid; cancel opens it again', async () => {
      const banks = (await request(app).get('/api/bill-receipts/options').set(at(bom))).body.banks;
      const hdfc = banks.find((b) => b.label === 'HDFC BANK CURRENT A/C').value;
      const res = await receive([{ billNo, received: 837, roundOff: 0.34 }], { mode: 'Bank', bankLedger: hdfc, payMode: 'NEFT', chequeNo: 'UTR123' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      br2 = res.body.brNo;
      assert.equal(await statusOf(), 'Paid');
      assert.equal(await outstanding(), undefined);
      const list = await request(app).get('/api/bill-receipts').set(at(bom)).query({ from: today, to: today, search: billNo });
      assert.equal(list.body.length, 2);
      const cancel = await request(app).post(`/api/bill-receipts/${br2}/cancel`).set(at(bom)).send({ remarks: 'TST bounced' });
      assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
      assert.equal(await statusOf(), 'Part paid');
      assert.equal(await outstanding(), 837.34);
      const live = await query("select 1 as x from tblAccountTrasaction where VoucherNo = @b and IsCancelled = 0", { b: br2 });
      assert.equal(live.length, 0);
    });
  });
  describe('Paid / To Pay bills', () => {
    // TV001: Paid, booked at Delhi (B1001), consignor CN002 → Paid bill at Delhi;
    // TV002: To Pay, delivered by Mumbai (B1002), consignee CN001 → To Pay bill at Mumbai. 943.67 each, IGST.
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0);
    let del; let bom; let paidBill; let topayBill;
    const bill = (tok, b) => request(app).post('/api/client-bills').set(at(tok))
      .send({ billDate: today, serviceType: 'Courier', taxType: 'IGST', from: today, to: today, ...b });
    const voucher = async (no, mode) => (await query(
      `select l.LedgerName, t.Dr, t.Cr from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
        where t.VoucherNo = @no and t.Mode = @m and t.IsCancelled = 0 order by t.Dr desc`, { no, m: mode }))
      .map((r) => [r.LedgerName, Number(r.Dr), Number(r.Cr)]);

    before(async () => {
      const d1 = await request(app).post('/api/dockets').set(at(emp)).send(docket('TV001'));
      assert.equal(d1.status, 201, JSON.stringify(d1.body));
      const d2 = await request(app).post('/api/dockets').set(at(emp)).send(docket('TV002', { bookingType: 'To Pay' }));
      assert.equal(d2.status, 201, JSON.stringify(d2.body));
      del = await fyLogin();
      bom = (await request(app).post('/api/auth/switch-branch').set(at(del)).send({ branchCode: 'B1002' })).body.token;
    });

    test('party and dockets: consignor for Paid at the booking branch, consignee for To Pay at the delivering branch', async () => {
      const p = await request(app).get('/api/client-bills/clients').set(at(del)).query({ q: 'SUNRISE', billType: 'Paid' });
      assert.equal(p.status, 200, JSON.stringify(p.body));
      assert.deepEqual([p.body[0].code, p.body[0].id, p.body[0].taxType], ['CN002', null, 'GST']);
      const pend = (tok, q) => request(app).get('/api/client-bills/pending-dockets').set(at(tok)).query({ from: today, to: today, taxType: 'IGST', ...q });
      const paid = (await pend(del, { billType: 'Paid', clientCode: 'CN002' })).body.map((d) => d.docketNo);
      assert.ok(paid.includes('TV001') && !paid.includes('TV002'));
      const topay = (await pend(bom, { billType: 'To Pay', clientCode: 'CN001' })).body.map((d) => d.docketNo);
      assert.ok(topay.includes('TV002') && !topay.includes('TV001'));
      assert.ok(!(await pend(del, { billType: 'To Pay', clientCode: 'CN001' })).body.some((d) => d.docketNo === 'TV002'));
    });

    test('Paid bill: generated, finalized without a submission (Dr pending collection / Cr GST + income), received', async () => {
      const b = await bill(del, { billType: 'Paid', clientCode: 'CN002', dockets: ['TV001'] });
      assert.equal(b.status, 201, JSON.stringify(b.body));
      paidBill = b.body.billNo;
      assert.ok(paidBill.startsWith('BP'));
      const view = await request(app).get(`/api/client-bills/${paidBill}`).set(at(del));
      assert.deepEqual([view.body.billType, view.body.client.name], ['Paid', 'SUNRISE ELECTRONICS']);
      assert.ok(!(await request(app).get('/api/client-bills/submission').set(at(del))).body.some((x) => x.billNo === paidBill));
      assert.ok((await request(app).get('/api/client-bills/finalize').set(at(del)).query({ by: 'paidtopay' })).body.some((x) => x.billNo === paidBill));
      const fin = await request(app).post('/api/client-bills/finalize').set(at(del)).send({ bills: [paidBill], date: today, by: 'paidtopay' });
      assert.equal(fin.status, 200, JSON.stringify(fin.body));
      const pv = await voucher(paidBill, 'Bill Finalized');
      assert.deepEqual(pv[0], ['PAID BOOKING PENDING COLLECTION', 943.67, 0]);
      assertSale(pv.slice(1), 943.67);

      const outstanding = (await request(app).get('/api/bill-receipts/pending-bills').set(at(del)).query({ kind: 'paidtopay', clientCode: 'CN002' })).body;
      assert.equal(outstanding.find((x) => x.billNo === paidBill)?.outstanding, 943.67);
      const r = await request(app).post('/api/bill-receipts').set(at(del)).send({
        kind: 'paidtopay', clientCode: 'CN002', receiveDate: today, mode: 'Cash', bills: [{ billNo: paidBill, received: 933.67, deduction: 10 }],
      });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      assert.deepEqual(await voucher(r.body.brNo, 'BILL RECEIVE'),
        [['CASH HEAD OFFICE', 933.67, 0], ['Booking Income Deduction', 10, 0], ['PAID BOOKING PENDING COLLECTION', 0, 943.67]]);
      assert.equal((await request(app).get(`/api/client-bills/${paidBill}`).set(at(del))).body.status, 'Paid');
    });

    test('To Pay bill at the delivering branch: TOPAY ledgers', async () => {
      const b = await bill(bom, { billType: 'To Pay', clientCode: 'CN001', dockets: ['TV002'] });
      assert.equal(b.status, 201, JSON.stringify(b.body));
      topayBill = b.body.billNo;
      assert.ok(topayBill.startsWith('BT'));
      const fin = await request(app).post('/api/client-bills/finalize').set(at(bom)).send({ bills: [topayBill], date: today, by: 'paidtopay' });
      assert.equal(fin.status, 200, JSON.stringify(fin.body));
      const tv = await voucher(topayBill, 'Bill Finalized');
      assert.deepEqual(tv[0], ['TOPAY BOOKING PENDING COLLECTION', 943.67, 0]);
      assertSale(tv.slice(1), 943.67);
      const list = await request(app).get('/api/client-bills').set(at(bom)).query({ from: today, to: today, billType: 'To Pay' });
      assert.ok(list.body.some((x) => x.billNo === topayBill && x.clientName === 'ACME TEXTILES' && x.status === 'Finalized'));
      const un = await request(app).post(`/api/client-bills/${topayBill}/unfinalize`).set(at(bom));
      assert.equal(un.status, 200, JSON.stringify(un.body));
      assert.equal((await request(app).get(`/api/client-bills/${topayBill}`).set(at(bom))).body.status, 'Generated');
    });
  });

  describe('miscellaneous / warehouse bills', () => {
    // test bills carry remarks 'TST …'; ACME TEXTILES (CL001) is a Mumbai (B1002) client, intrastate there
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0);
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const month = MONTHS[Number(today.slice(5, 7)) - 1];
    let bom; let slab18; let misc;
    const create = (kind, b) => request(app).post(`/api/other-bills/${kind}`).set(at(bom)).send({
      clientCode: 'CL001', billDate: today, month, year: today.slice(0, 4), serviceFor: 'Others', sac: '996812', slab: slab18,
      taxType: 'Intrastate', quantity: 2, rate: 500, remarks: 'TST other bill', ...b,
    });
    const act = (kind, no, what, b = {}) => request(app).post(`/api/other-bills/${kind}/${no}/${what}`).set(at(bom)).send(b);
    const view = async (kind, no) => (await request(app).get(`/api/other-bills/${kind}/${no}`).set(at(bom))).body;

    before(async () => {
      const fyEmp = await fyLogin();
      bom = (await request(app).post('/api/auth/switch-branch').set(at(fyEmp)).send({ branchCode: 'B1002' })).body.token;
      const o = await request(app).get('/api/other-bills/misc/options').set(at(bom));
      assert.equal(o.status, 200, JSON.stringify(o.body));
      slab18 = o.body.slabs.find((x) => x.label === 'GST 18%').value;
    });

    test('create: server amounts, numbering, checks', async () => {
      const c = await request(app).get('/api/other-bills/misc/clients').set(at(bom)).query({ q: 'ACME' });
      assert.deepEqual([c.body[0].code, c.body[0].taxType], ['CL001', 'Intrastate']);
      const next = MONTHS[Number(today.slice(5, 7)) % 12];
      const nextYear = today.slice(5, 7) === '12' ? String(Number(today.slice(0, 4)) + 1) : today.slice(0, 4);
      assert.equal((await create('misc', { month: next, year: nextYear })).status, 400);
      assert.equal((await create('misc', { clientCode: 'NOPE' })).status, 400);
      const res = await create('misc', {});
      assert.equal(res.status, 201, JSON.stringify(res.body));
      misc = res.body.billNo;
      assert.ok(misc.startsWith('MIS'));
      const b = await view('misc', misc);
      assert.deepEqual([b.taxable, b.cgstAmt, b.sgstAmt, b.igstAmt, b.total, b.status], [1000, 90, 90, 0, 1180, 'Generated']);
      const wh = await create('warehouse', { taxType: 'Interstate', quantity: 1, rate: 2000 });
      assert.equal(wh.status, 201, JSON.stringify(wh.body));
      assert.ok(wh.body.billNo.startsWith('WHO'));
      assert.deepEqual([(await view('warehouse', wh.body.billNo)).igstAmt, wh.body.totalAmount], [360, 2360]);
    });

    test('submit, finalize (balanced voucher), cancel rules, undo finalize', async () => {
      assert.equal((await act('misc', misc, 'submit', { date: today, receiverName: '' })).status, 400);
      assert.equal((await act('misc', misc, 'submit', { date: today, receiverName: 'TST RECEIVER' })).status, 200);
      const fin = await act('misc', misc, 'finalize', { date: today });
      assert.equal(fin.status, 200, JSON.stringify(fin.body));
      const lines = await query(
        `select l.LedgerName, t.Dr, t.Cr from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
          where t.VoucherNo = @b and t.IsCancelled = 0 order by t.Dr desc, l.LedgerName`, { b: misc });
      assert.deepEqual(lines.map((r) => [r.LedgerName.endsWith(':BILLED') ? 'client' : r.LedgerName, Number(r.Dr), Number(r.Cr)]),
        [['client', 1180, 0], ['BOOKING INCOME MISCELLANEOUS', 0, 1000], ['OUTPUT CGST', 0, 90], ['OUTPUT SGST', 0, 90]]);
      assert.equal((await act('misc', misc, 'cancel', { remarks: 'TST no' })).status, 409);
      assert.equal((await act('misc', misc, 'unfinalize')).status, 200);
      const live = await query('select 1 as x from tblAccountTrasaction where VoucherNo = @b and IsCancelled = 0', { b: misc });
      assert.equal(live.length, 0);
      assert.equal((await act('misc', misc, 'cancel', { remarks: 'TST wrong month' })).status, 200);
      assert.equal((await view('misc', misc)).status, 'Cancelled');
      const list = await request(app).get('/api/other-bills/misc').set(at(bom)).query({ from: today, to: today, status: 'Cancelled' });
      assert.ok(list.body.some((x) => x.billNo === misc));
    });
  });

  describe('octroi bills', () => {
    // TO001 / TO002 booked at Delhi (B1001) on account of ACME TEXTILES (CL001)
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0);
    let del; let billNo;
    const rows = [
      { docketNo: 'TO001', octroiAmount: 1000, otherCharges: 50, chargePercent: 10, taxPercent: 18 },
      { docketNo: 'TO002', octroiAmount: 500, chargePercent: 10, taxPercent: 18 },
    ];
    const create = (b) => request(app).post('/api/octroi-bills').set(at(del))
      .send({ clientCode: 'CL001', billDate: today, octroiNo: 'TSTOCT1', remarks: 'TST octroi', rows, ...b });

    before(async () => {
      for (const no of ['TO001', 'TO002']) {
        const d = await request(app).post('/api/dockets').set(at(emp)).send(docket(no));
        assert.equal(d.status, 201, JSON.stringify(d.body));
      }
      del = await fyLogin();
    });

    test('pending dockets, create with server amounts, octroi no. and docket checks', async () => {
      const p = await request(app).get('/api/octroi-bills/pending-dockets').set(at(del)).query({ clientCode: 'CL001', from: today, to: today });
      assert.equal(p.status, 200, JSON.stringify(p.body));
      assert.ok(['TO001', 'TO002'].every((d) => p.body.some((x) => x.docketNo === d)));
      const res = await create({});
      assert.equal(res.status, 201, JSON.stringify(res.body));
      billNo = res.body.billNo;
      assert.ok(billNo.startsWith('OB'));
      assert.equal(res.body.totalAmount, 1736);   // 1000 + 50 + 100 + 27 = 1177; 500 + 50 + 9 = 559
      const b = (await request(app).get(`/api/octroi-bills/${billNo}`).set(at(del))).body;
      assert.deepEqual(b.rows.map((r) => [r.docketNo, r.charge, r.tax, r.total]), [['TO001', 100, 27, 1177], ['TO002', 50, 9, 559]]);
      assert.equal((await create({ octroiNo: 'TSTOCT1', rows: [rows[0]] })).status, 422);   // docket already billed
      const [g] = await query("select Octroi_Status, Octroi_Bill_No from grn_master where docket_no = 'TO001'");
      assert.deepEqual([g.Octroi_Status, g.Octroi_Bill_No], ['invoicegenerated', billNo]);
    });

    test('submit, cancel frees the dockets, octroi no. reusable after cancel', async () => {
      const sub = await request(app).post(`/api/octroi-bills/${billNo}/submit`).set(at(del)).send({ date: today, receiverName: 'TST RECEIVER' });
      assert.equal(sub.status, 200, JSON.stringify(sub.body));
      const list = await request(app).get('/api/octroi-bills').set(at(del)).query({ from: today, to: today, status: 'Submitted' });
      assert.ok(list.body.some((x) => x.billNo === billNo && x.dockets === 2));
      const c = await request(app).post(`/api/octroi-bills/${billNo}/cancel`).set(at(del)).send({ remarks: 'TST wrong octroi' });
      assert.equal(c.status, 200, JSON.stringify(c.body));
      const again = await create({ rows: [rows[0]] });
      assert.equal(again.status, 201, JSON.stringify(again.body));
      assert.equal(again.body.totalAmount, 1177);
    });
  });

  describe('vendor invoices (other vendors)', () => {
    // SHARMA STATIONERY (OV001: TDS 2 %, cost centre required) and CITY ELECTRICALS (OV002: no TDS); test invoices have narration 'TST…'
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0);
    let del; let invoiceNo; const slab = {};
    const body = (b = {}) => ({
      invoiceDate: today, invoiceFor: 'Bill Entry(Other Vendors)', partType: 'Purchase', vendorLedger: 'SHARMA STATIONERY:OV001',
      vendorInvNo: 'TSTVINV1', purchaseDate: today, expenseLedger: 'PRINTING & STATIONERY', tdsLedger: 'TDS PAYABLE 194C', taxType: 'GST',
      narration: 'TST vendor invoice',
      lines: [{ itemCode: 'P001', quantity: 10, rate: 250, slab: slab[18] }, { itemCode: 'P002', quantity: 1, rate: 1000, slab: slab[12] }],
      costCentres: [{ type: 'Branch/Hub', code: 'B1001', name: 'HEAD OFFICE', amount: 2000 }, { type: 'Employee', code: 'EMP001', name: 'TEST', amount: 1500 }],
      ...b,
    });
    const create = (b) => request(app).post('/api/vendor-invoices').set(at(del)).send(body(b));
    const voucher = async (no) => (await query(
      `select l.LedgerName, t.Dr, t.Cr from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
        where t.VoucherNo = @no and t.Mode = 'PURCHASE/PAYBILL' and isnull(t.IsCancelled, 0) = 0 order by l.LedgerName`, { no }))
      .map((r) => [r.LedgerName, Number(r.Dr), Number(r.Cr)]);

    before(async () => {
      del = await fyLogin();
      for (const r of await query("select SlNo, Slab from Misc_Tax_Slab where Slab in ('GST 12%', 'GST 18%')")) slab[r.Slab.match(/\d+/)[0]] = r.SlNo;
    });

    test('lookups, checks, create with server amounts and a balanced voucher', async () => {
      const v = await request(app).get('/api/vendor-invoices/vendors').set(at(del)).query({ q: 'SHARMA' });
      assert.equal(v.status, 200, JSON.stringify(v.body));
      assert.deepEqual(v.body.find((x) => x.code === 'OV001')?.tds, 2);
      const p = await request(app).get('/api/vendor-invoices/products').set(at(del)).query({ q: 'A', partType: 'Pay Bill' });
      assert.ok(p.body.some((x) => x.code === 'S001') && !p.body.some((x) => x.code === 'P001'));
      const t = await request(app).get('/api/vendor-invoices/ledgers').set(at(del)).query({ q: 'TDS', kind: 'tds' });
      assert.ok(t.body.includes('TDS PAYABLE 194C'));
      const ct = await request(app).get('/api/vendor-invoices/cost-targets').set(at(del)).query({ type: 'Branch/Hub', q: 'MUM' });
      assert.ok(ct.body.some((x) => x.code === 'B1002'));

      assert.equal((await create({ costCentres: [] })).status, 400);                                           // vendor needs cost centres
      assert.equal((await create({ lines: [{ itemCode: 'S001', quantity: 1, rate: 10, slab: slab[18] }] })).status, 400);   // service on Purchase
      assert.equal((await create({ costCentres: [{ type: 'Employee', code: 'EMP001', name: 'TEST', amount: 9999 }] })).status, 400);
      const res = await create({});
      assert.equal(res.status, 201, JSON.stringify(res.body));
      invoiceNo = res.body.invoiceNo;
      assert.ok(invoiceNo.startsWith('OTH'));
      // 2500 + 450 (18 %) and 1000 + 120 (12 %) = 4070; TDS 2 % of 3500 = 70
      assert.deepEqual([res.body.totalAmount, res.body.payable], [4070, 4000]);
      assert.deepEqual(await voucher(invoiceNo), [
        ['INPUT CGST', 285, 0], ['INPUT SGST', 285, 0], ['PRINTING & STATIONERY', 3500, 0], ['SHARMA STATIONERY:OV001', 0, 4000],
        ['TDS PAYABLE 194C', 0, 70],
      ]);
      const dup = await create({});
      assert.equal(dup.status, 409);                                                                             // same vendor bill no.
      const one = await request(app).get(`/api/vendor-invoices/${invoiceNo}`).set(at(del));
      assert.equal(one.status, 200, JSON.stringify(one.body));
      assert.deepEqual(one.body.lines.map((l) => [l.itemCode, l.taxable, l.cgstAmt, l.tdsAmt]), [['P001', 2500, 225, 50], ['P002', 1000, 60, 20]]);
      assert.equal(one.body.costCentres.length, 2);
      assert.equal(one.body.vendorLedger, 'SHARMA STATIONERY:OV001');
    });

    test('list, cancel cancels the voucher; IGST service bill without TDS', async () => {
      const list = await request(app).get('/api/vendor-invoices').set(at(del)).query({ from: today, to: today, search: 'SHARMA' });
      assert.ok(list.body.some((x) => x.invoiceNo === invoiceNo && x.status === 'Active'));
      const c = await request(app).post(`/api/vendor-invoices/${invoiceNo}/cancel`).set(at(del)).send({ remarks: 'TST wrong bill' });
      assert.equal(c.status, 200, JSON.stringify(c.body));
      assert.deepEqual(await voucher(invoiceNo), []);
      assert.equal((await request(app).post(`/api/vendor-invoices/${invoiceNo}/cancel`).set(at(del)).send({ remarks: 'TST again' })).status, 409);
      const svcBill = await create({
        partType: 'Pay Bill', vendorLedger: 'CITY ELECTRICALS:OV002', taxType: 'IGST', expenseLedger: 'REPAIR & MAINTENANCE', tdsLedger: '',
        lines: [{ itemCode: 'S001', quantity: 1, rate: 5000, slab: slab[18], description: 'AC service' }], costCentres: [],
      });
      assert.equal(svcBill.status, 201, JSON.stringify(svcBill.body));
      assert.deepEqual(await voucher(svcBill.body.invoiceNo), [['CITY ELECTRICALS:OV002', 0, 5900], ['INPUT IGST', 900, 0], ['REPAIR & MAINTENANCE', 5000, 0]]);
    });
  });

  describe('vendor bill verification', () => {
    // challans TVC001 (balance 6000) and TVC002 (balance 3000) of SHARMA ROADWAYS (V001) at Delhi, inserted directly
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0);
    let del; let billNo;
    const challans = () => request(app).get('/api/vendor-invoices/verify/challans').set(at(del)).query({ vendorCode: 'V001', mode: 'RD', from: today, to: today });
    const verify = (rows, b = {}) => request(app).post('/api/vendor-invoices/verify').set(at(del))
      .send({ vendorCode: 'V001', mode: 'RD', billDate: today, vendorRefNo: 'SR/1', billAmount: 5500, narration: 'TST vendor bill', rows, ...b });

    before(async () => {
      del = await fyLogin();
      await query(
        `insert into Dispatch_Master(challan_no, Financial_Year, IsCancelled, mode_code, vendor_type, vendor_code, challan_date, from_branch,
           truck_no, total_freight, advance, bal_amount, div_code)
         values ('TVC001', @fy, 0, 'RD', 'Vendor', 'V001', @d, 'B1001', 'DL01AB1234', 10000, 4000, 6000, 'DIV1001'),
                ('TVC002', @fy, 0, 'RD', 'Vendor', 'V001', @d, 'B1001', 'DL01AB1234', 5000, 2000, 3000, 'DIV1001')`,
        { fy: `${y}-${y + 1}`, d: today });
    });

    test('pending challans, verify with current payments, fully paid challan closes', async () => {
      const o = await request(app).get('/api/vendor-invoices/verify/options').set(at(del));
      assert.ok(o.body.vendors.some((v) => v.value === 'V001') && o.body.modes.some((m) => m.value === 'RD'));
      const p = await challans();
      assert.equal(p.status, 200, JSON.stringify(p.body));
      assert.deepEqual(p.body.filter((c) => c.challanNo.startsWith('TVC')).map((c) => [c.challanNo, c.balance]), [['TVC001', 6000], ['TVC002', 3000]]);
      assert.equal((await verify([{ challanNo: 'TVC001', currentPayment: 7000 }])).status, 400);           // more than the balance
      const res = await verify([{ challanNo: 'TVC001', currentPayment: 2500 }, { challanNo: 'TVC002', currentPayment: 3000 }]);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      billNo = res.body.billNo;
      assert.ok(billNo.startsWith('VB') && res.body.receiptCode.startsWith('VIV'));
      assert.equal(res.body.totalPaid, 5500);
      const [d2] = await query("select IsVerified from Dispatch_Master where challan_no = 'TVC002'");
      assert.equal(d2.IsVerified, true);
      const again = await challans();
      assert.deepEqual(again.body.filter((c) => c.challanNo.startsWith('TVC')).map((c) => [c.challanNo, c.balance]), [['TVC001', 3500]]);
      assert.equal((await verify([{ challanNo: 'TVC001', currentPayment: 4000 }])).status, 400);
    });

    test('pending report, print data, cancel opens the challans again', async () => {
      const r = await request(app).get('/api/vendor-invoices/verify/report').set(at(del)).query({ from: today, to: today, pendingOnly: 'true' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual(r.body.filter((x) => x.billNo === billNo).map((x) => [x.challanNo, x.challanPending]), [['TVC001', 3500]]);
      const one = await request(app).get(`/api/vendor-invoices/verify/${billNo}`).set(at(del));
      assert.equal(one.status, 200, JSON.stringify(one.body));
      assert.equal(one.body.challans.length, 2);
      assert.equal(one.body.vendor.name, 'SHARMA ROADWAYS');
      const c = await request(app).post(`/api/vendor-invoices/verify/${billNo}/cancel`).set(at(del)).send({ remarks: 'TST wrong bill' });
      assert.equal(c.status, 200, JSON.stringify(c.body));
      const after = await challans();
      assert.deepEqual(after.body.filter((x) => x.challanNo.startsWith('TVC')).map((x) => [x.challanNo, x.balance]), [['TVC001', 6000], ['TVC002', 3000]]);
    });
  });

  describe('franchisee commission invoices', () => {
    // TFI001–3 booked at Delhi and moved to the franchisee branch B1003 (EASTERN COURIERS, FRS1001); a road commission master
    // TFCM9 (Rent 777) in force from the 1st of this month; test invoices have remarks 'TST…'
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const month = today.slice(0, 7);
    let del; let invoiceNo;
    const who = { franCode: 'FRS1001', branchCode: 'B1003', month };
    const pend = () => request(app).get('/api/franchisee-invoices/pending-dockets').set(at(del)).query(who);
    const create = (b) => request(app).post('/api/franchisee-invoices').set(at(del))
      .send({ ...who, invoiceDate: today, dockets: ['TFI001', 'TFI002', 'TFI003'], includeMonthly: true, tdsPercent: 5, remarks: 'TST franchisee invoice', ...b });
    const dropMaster = () => query(`delete from Franchisee_Commission_Master_Detail where CommId = 'TFCM9';
      delete from Franchisee_Commission_Master where Comm_Code = 'TFCM9';`);

    before(async () => {
      del = await fyLogin();
      for (const no of ['TFI001', 'TFI002', 'TFI003']) {
        const d = await request(app).post('/api/dockets').set(at(emp)).send(docket(no, { bookingType: no === 'TFI002' ? 'To Pay' : 'Paid' }));
        assert.equal(d.status, 201, JSON.stringify(d.body));
      }
      await query(`
        update grn_master set origin_branch = 'B1003', LoadType = case when docket_no = 'TFI003' then 'FTL' else 'PTL' end where docket_no like 'TFI%';
        update grn_docket_charge set FtlRate = 0, freight = case Docket_No when 'TFI001' then 1000 when 'TFI002' then 2000 else 10000 end,
          charge_weight = case Docket_No when 'TFI003' then 5000 else 50 end where Docket_No like 'TFI%';
        update docket_other_charges set handling_charge = 0, collection_charges = 0 where docket like 'TFI%';
        delete from docket_other_charges where docket = 'TFI001';
        insert into docket_other_charges(docket, handling_charge, collection_charges) values ('TFI001', 20, 30);`);
      await dropMaster();
      await query(
        `insert into Franchisee_Commission_Master(Comm_Code, Agent_Type, Rent, Mobile_Bills, Signage_Payment, Commission_Mode, Booking_Type, Mode,
           Comm_On_Base_Freight, Air_Commission, Train_Commission, Train_V_Commission, StartDate, EndDate, EffectiveDate, UserId)
         values ('TFCM9', 'Franchisee', 777, 100, 50, 'BookingType', '', 'RD', 2, 0, 0, 0, @from, dateadd(year, 1, @from), @from, 'EMP001');
         insert into Franchisee_Commission_Master_Detail(CommId, Booking_Type, Commission_1, Commission_2, Commission_3, Commission_4)
         values ('TFCM9', 'Paid', 'LTL 03 Tons', '10', 'LTL 36 Tons', '8'), ('TFCM9', 'Paid', 'FTL 36 Tons', 'TATA 407', '500', '5');`,
        { from: `${month}-01` });
    });
    after(dropMaster);

    test('pending dockets with commission by the master, create with monthly charges and TDS', async () => {
      const f = await request(app).get('/api/franchisee-invoices/franchisees').set(at(del));
      assert.ok(f.body.some((x) => x.code === 'FRS1001' && x.branchCode === 'B1003'));
      const p = await pend();
      assert.equal(p.status, 200, JSON.stringify(p.body));
      const mine = p.body.filter((d) => d.docketNo.startsWith('TFI')).map((d) => [d.docketNo, d.commission, d.total]);
      // TFI001 Paid LTL 10 % of 1000 (+ handling 20 + collection 30); TFI002 To Pay → base 2 % of 2000; TFI003 FTL 3–6 t: 500 + 5 % of 10000
      assert.deepEqual(mine, [['TFI001', 100, 150], ['TFI002', 40, 40], ['TFI003', 1000, 1000]]);
      const m = await request(app).get('/api/franchisee-invoices/monthly').set(at(del)).query(who);
      assert.deepEqual([m.body.rent, m.body.mobile, m.body.signage, m.body.alreadyOn], [777, 100, 50, '']);
      const res = await create({});
      assert.equal(res.status, 201, JSON.stringify(res.body));
      invoiceNo = res.body.invoiceNo;
      assert.ok(invoiceNo.startsWith('FINV'));
      assert.deepEqual([res.body.dockets, res.body.gross, res.body.net], [3, 2117, 2011.15]);   // 1190 + 927; TDS 5 % = 105.85
      const [g] = await query("select Franchisee_Invoice_Status, Franchisee_Invoice_No from grn_master where docket_no = 'TFI002'");
      assert.deepEqual([g.Franchisee_Invoice_Status, g.Franchisee_Invoice_No], ['Generated', invoiceNo]);
      assert.equal((await create({ dockets: ['TFI001'], includeMonthly: false })).status, 409);         // already invoiced
      assert.equal((await create({ dockets: [] })).status, 409);                                        // monthly charges already on it
    });

    test('list, print data, cancel frees the dockets and the monthly charges', async () => {
      const list = await request(app).get('/api/franchisee-invoices').set(at(del)).query({ from: today, to: today, search: 'EASTERN' });
      assert.ok(list.body.some((x) => x.invoiceNo === invoiceNo && x.dockets === 3 && x.status === 'Active'));
      const one = await request(app).get(`/api/franchisee-invoices/${invoiceNo}`).set(at(del));
      assert.equal(one.status, 200, JSON.stringify(one.body));
      assert.equal(one.body.rows.find((r) => r.docketNo === 'TFI003').commissionType, 'FTL 36 Tons: 500 + 5%');
      const c = await request(app).post(`/api/franchisee-invoices/${invoiceNo}/cancel`).set(at(del)).send({ remarks: 'TST wrong month' });
      assert.equal(c.status, 200, JSON.stringify(c.body));
      assert.equal((await request(app).post(`/api/franchisee-invoices/${invoiceNo}/cancel`).set(at(del)).send({ remarks: 'TST again' })).status, 409);
      assert.equal((await pend()).body.filter((d) => d.docketNo.startsWith('TFI')).length, 3);
      const again = await create({ dockets: ['TFI001'], tdsPercent: 0 });
      assert.equal(again.status, 201, JSON.stringify(again.body));
      assert.equal(again.body.gross, 1077);   // 150 + 927
    });
  });

  describe('analytics dashboard', () => {
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const from = new Date(Date.now() - 364 * 86400000).toISOString().slice(0, 10);
    const range = { from, to: today };
    const drill = (kind, filters, extra = {}) => request(app).get('/api/dashboard/drill').set(at(emp))
      .query({ ...range, kind, filters: JSON.stringify(filters), ...extra });

    test('every section answers with its datasets', async () => {
      const keys = {
        overview: ['kpis', 'previous', 'daily', 'stages', 'outstanding', 'insights'],
        bookings: ['daily', 'monthly', 'weekday', 'hour', 'heat', 'mixes', 'weightBands', 'freightBands', 'clients', 'lanes', 'branches', 'branchMonth'],
        operations: ['funnel', 'stages', 'outcomes', 'transit', 'ageing', 'vendors', 'hireMonthly', 'utilisation', 'pod', 'drivers'],
        billing: ['billedVsCollected', 'statuses', 'ageing', 'outstandingClients', 'modes', 'unbilled', 'lags', 'revenueMix'],
        accounts: ['expenses', 'vendorMonthly', 'franchisee', 'voucherModes', 'drcr', 'vendorBills', 'receiptsByMode', 'topLedgers'],
      };
      for (const [section, list] of Object.entries(keys)) {
        const res = await request(app).get(`/api/dashboard/${section}`).set(at(emp)).query(range);
        assert.equal(res.status, 200, `${section}: ${JSON.stringify(res.body)}`);
        for (const k of list) assert.ok(k in res.body, `${section}.${k} missing`);
      }
      assert.equal((await request(app).get('/api/dashboard/nothing').set(at(emp)).query(range)).status, 404);
      assert.equal((await request(app).get('/api/dashboard/overview').set(at(emp)).query({ from: today, to: from })).status, 400);
      assert.equal((await request(app).get('/api/dashboard/overview').query(range)).status, 401);
    });

    test('click-through returns the records the charts count', async () => {
      const ov = (await request(app).get('/api/dashboard/overview').set(at(emp)).query(range)).body;
      const delivered = await drill('dockets', { stage: 'Delivered' });
      assert.equal(delivered.status, 200, JSON.stringify(delivered.body));
      assert.equal(delivered.body.total, ov.kpis.delivered);
      assert.equal((await drill('dockets', {}, { withCancelled: 'true' })).body.total, ov.kpis.dockets);
      assert.equal((await drill('dockets', { pending: 1 })).body.total, ov.kpis.pending);
      const bk = (await request(app).get('/api/dashboard/bookings').set(at(emp)).query(range)).body;
      if (bk.lanes.length) assert.equal((await drill('dockets', { lane: bk.lanes[0].lane })).body.total, bk.lanes[0].dockets);
      if (bk.weightBands.length) assert.equal((await drill('dockets', { weight_band: bk.weightBands[0].band })).body.total, bk.weightBands[0].dockets);
      for (const kind of ['bills', 'receipts', 'challans', 'manifests', 'pickups', 'otherbills', 'vendorinvoices', 'vendorbills', 'franchisee', 'vouchers']) {
        const r = await drill(kind, {});
        assert.equal(r.status, 200, `${kind}: ${JSON.stringify(r.body)}`);
        assert.ok(Array.isArray(r.body.columns) && r.body.columns.length && Array.isArray(r.body.rows), kind);
      }
      // unknown filter columns are ignored, bad kinds / filters refused
      assert.equal((await drill('dockets', { 'docket_no; drop table x': 1 })).status, 200);
      assert.equal((await drill('nothing', {})).status, 400);
      assert.equal((await request(app).get('/api/dashboard/drill').set(at(emp)).query({ ...range, kind: 'dockets', filters: '[1]' })).status, 400);
    });
  });

  describe('docket tracking journey and problems', () => {
    // TJ001 booked by the test employee; a manifest is inserted directly with more packages than booked
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const journey = (tok, no) => request(app).get(`/api/dockets/${no}/journey`).set(at(tok));

    before(async () => {
      const d = await request(app).post('/api/dockets').set(at(emp)).send(docket('TJ001'));
      assert.equal(d.status, 201, JSON.stringify(d.body));
    });

    test('a fresh docket: booked step, summary, booking problems only', async () => {
      const r = await journey(emp, 'TJ001');
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.docket.docketNo, 'TJ001');
      assert.equal(r.body.docket.status, 'Booked');
      assert.equal(r.body.events[0].key, 'booked');
      assert.equal(r.body.steps[0].done, true);
      assert.equal(r.body.steps[1].done, false);
      assert.ok(['ok', 'warning', 'error'].includes(r.body.docket.health));
      assert.ok(r.body.issues.every((i) => i.title && i.level && i.stage));
      assert.equal((await journey(emp, 'TNOPE999')).status, 404);
    });

    test('a manifest with more packages than booked and dated before the booking is flagged on that entry', async () => {
      const [g] = await query("select pcs from grn_docket_charge where Docket_No = 'TJ001'");
      await query(
        `insert into mainfest_entry(mainfest_no, mainfest_date, mainfest_time, from_branch, to_branch, user_id, div_code, Financial_Year, IsCancelled)
         values ('TJMF001', dateadd(day, -3, cast(getdate() as date)), '10:00', 'B1001', 'B1002', 'TSTUSER', 'DIV1001', '2025-2026', '0');
         insert into Manifest_grn(docket_no, freight, package, weight, Manifest_no, Financial_Year, div_code)
         values ('TJ001', 100, @p, 10, 'TJMF001', '2025-2026', 'DIV1001');`, { p: Number(g.pcs) + 5 });
      const r = await journey(emp, 'TJ001');
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const mf = r.body.events.find((e) => e.key === 'mf-TJMF001');
      assert.ok(mf, 'manifest entry in the journey');
      const titles = (mf.issues ?? []).map((i) => i.title);
      assert.ok(titles.includes('More packages manifested than booked'), JSON.stringify(titles));
      assert.ok(titles.some((t) => /dated before booked/.test(t)), JSON.stringify(titles));
      assert.ok(mf.issues.every((i) => i.by === 'TSTUSER'));
      // the grid values of the entry, and the field each problem is about
      assert.deepEqual([mf.values.entryNo, mf.values.packages, mf.values.enteredBy], ['TJMF001', Number(g.pcs) + 5, 'TSTUSER']);
      assert.equal(mf.issues.find((i) => i.title === 'More packages manifested than booked').field, 'packages');
      assert.ok(mf.issues.some((i) => i.field === 'date'));
      assert.equal(r.body.events.find((e) => e.key === 'booked').values.packages, Number(g.pcs));
      assert.equal(r.body.docket.health, 'error');
      assert.equal(r.body.steps[1].done, true);   // manifested
    });

    test('a client sees its own docket without amounts', async () => {
      const r = await journey(client, 'TJ001');
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.docket.freight, null);
      assert.ok(!r.body.issues.some((i) => i.stage === 'Billing' || i.title === 'Freight is 0'));
    });
  });

  describe('DRS', () => {
    let bom; let drsNo;
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const pend = (q = {}) => request(app).get('/api/drs/pending-dockets').set(at(bom)).query({ from: today, to: today, ...q });
    const base = (dockets, extra = {}) => ({
      drsDate: today, drsTime: '10:00', deliveredBy: 'ANIL PATIL', deliveredByMobile: '9820000044', vehicleNo: 'mh01ab1111',
      dockets, ...extra,
    });
    const post = (b) => request(app).post('/api/drs').set(at(bom)).send(b);
    let challanNo;

    before(async () => {
      ({ bom, challanNo } = await bringToMumbai(['TD001', 'TD002']));
    });

    test('pending dockets: at the delivering branch, docket filter applied', async () => {
      const res = await pend();
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const td = res.body.filter((d) => d.docketNo.startsWith('TD'));
      assert.deepEqual(td.map((d) => [d.docketNo, d.packages, d.challanNo]), [['TD001', 3, challanNo], ['TD002', 3, challanNo]]);
      const one = await pend({ dockets: 'TD002' });
      assert.deepEqual(one.body.map((d) => d.docketNo), ['TD002']);
      const origin = await request(app).get('/api/drs/pending-dockets').set(at(emp)).query({ from: today, to: today });
      assert.ok(!origin.body.some((d) => d.docketNo.startsWith('TD')));
    });

    test('create: validation', async () => {
      const row = (no, packages = 3) => ({ docketNo: no, challanNo, packages });
      assert.equal((await post(base([row('TD001')], { drsDate: '2999-01-01' }))).status, 400);
      assert.equal((await post(base([row('TD001')], { deliveredBy: '' }))).status, 400);
      const over = await post(base([row('TD001', 4)]));
      assert.equal(over.status, 422);
      assert.match(JSON.stringify(over.body), /only 3 packet/);
      const early = await post(base([row('TD001')], { drsDate: '2020-01-01' }));
      assert.equal(early.status, 422);
      assert.match(JSON.stringify(early.body), /after the DRS date/);
      const stranger = await post(base([row('T0001')]));
      assert.equal(stranger.status, 422);
    });

    test('create: generated number, split packets prorated, remaining stays pending', async () => {
      const res = await post(base([{ docketNo: 'TD001', challanNo, packages: 3 }, { docketNo: 'TD002', challanNo, packages: 2 }]));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      drsNo = res.body.drsNo;
      assert.match(drsNo, /^DSBOM2526\d{6}$/);
      assert.deepEqual([res.body.dockets, res.body.packages, res.body.totalWeight], [2, 5, 75]);
      const [g] = await query("select freight, weight, pending_Package from drs_entry_details_grn where Drs_no = @d and docket_no = 'TD002'", { d: drsNo });
      assert.deepEqual([Number(g.freight), Number(g.weight), g.pending_Package], [342, 30, 1]);
      const [h] = await query('select docket_no, Vehicle_No from drs_entry_details where Drs_no = @d', { d: drsNo });
      assert.deepEqual([h.docket_no, h.Vehicle_No], ['TD001,TD002', 'MH01AB1111']);
      const left = (await pend()).body.filter((d) => d.docketNo.startsWith('TD'));
      assert.deepEqual(left.map((d) => [d.docketNo, d.packages]), [['TD002', 1]]);
      const again = await post(base([{ docketNo: 'TD001', challanNo, packages: 1 }]));
      assert.equal(again.status, 422);
    });

    test('the last packet goes on a second DRS', async () => {
      const res = await post(base([{ docketNo: 'TD002', challanNo, packages: 1 }]));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(Number(res.body.drsNo.slice(-6)), Number(drsNo.slice(-6)) + 1);
      assert.ok(!(await pend()).body.some((d) => d.docketNo.startsWith('TD')));
    });

    test('view + list (one row per DRS)', async () => {
      const one = await request(app).get(`/api/drs/${drsNo}`).set(at(bom));
      assert.equal(one.status, 200, JSON.stringify(one.body));
      assert.equal(one.body.dockets.length, 2);
      assert.equal(one.body.deliveredBy, 'ANIL PATIL');
      const list = await request(app).get('/api/drs').set(at(bom)).query({ from: today, to: today });
      const row = list.body.find((d) => d.drsNo === drsNo);
      assert.deepEqual([row.dockets, row.packages], [2, 5]);
      assert.equal(list.body.filter((d) => d.drsNo === drsNo).length, 1);
    });

    test('cancel: blocked by delivery status or a challan, then restores pending', async () => {
      await query("insert into delivery_status_entry_details(docket_no, pkt_status, drs_no, IsCancelled) values ('TD001', 'DLVRD', @d, 0)", { d: drsNo });
      const s1 = await request(app).post(`/api/drs/${drsNo}/cancel`).set(at(bom));
      assert.equal(s1.status, 409);
      assert.match(s1.body.error, /delivery status/);
      await query("delete from delivery_status_entry_details where drs_no = @d", { d: drsNo });
      await query("update drs_entry_details set Dispatch_Status = 'IsActive', challan_no = 'TCDS1' where Drs_no = @d", { d: drsNo });
      const s2 = await request(app).post(`/api/drs/${drsNo}/cancel`).set(at(bom));
      assert.equal(s2.status, 409);
      assert.match(s2.body.error, /TCDS1/);
      await query("update drs_entry_details set Dispatch_Status = null, challan_no = null where Drs_no = @d", { d: drsNo });

      const res = await request(app).post(`/api/drs/${drsNo}/cancel`).set(at(bom));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const back = (await pend()).body.filter((d) => d.docketNo.startsWith('TD'));
      assert.deepEqual(back.map((d) => [d.docketNo, d.packages]), [['TD001', 3], ['TD002', 2]]);
      assert.equal((await request(app).post(`/api/drs/${drsNo}/cancel`).set(at(bom))).status, 409);
    });
  });

  describe('delivery status', () => {
    let bom; let bomAdmin; let challanNo; let drsNo;
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const e = (docketNo, status, extra = {}) => ({
      docketNo, status, date: today, time: '15:00',
      ...(status === 'DLVRD' ? { receiverName: 'R. SHAH', receiverPhone: '9820011111' } : {}), ...extra,
    });
    const save = (body) => request(app).post('/api/delivery').set(at(bom)).send(body);
    const openDrs = async () => (await request(app).get('/api/delivery/drs').set(at(bom))).body.find((d) => d.drsNo === drsNo);

    before(async () => {
      ({ bom, challanNo } = await bringToMumbai(['TE001', 'TE002', 'TE003', 'TE004'], (no) => ({
        bookingType: no === 'TE001' ? 'To Pay' : 'Paid',
        deliveryMode: no === 'TE004' ? 'DM-102' : 'DM-101', // TE004 = godown delivery
      })));
      const drs = await request(app).post('/api/drs').set(at(bom)).send({
        drsDate: today, drsTime: '10:00', deliveredBy: 'ANIL PATIL',
        dockets: ['TE001', 'TE002', 'TE003'].map((no) => ({ docketNo: no, challanNo, packages: 3 })),
      });
      assert.equal(drs.status, 201, JSON.stringify(drs.body));
      drsNo = drs.body.drsNo;
      bomAdmin = (await request(app).post('/api/auth/switch-branch').set(at(admin)).send({ branchCode: 'B1002' })).body.token;
    });

    test('what is waiting: open DRS with its dockets, godown dockets', async () => {
      assert.equal((await openDrs())?.open, 3);
      const dockets = await request(app).get(`/api/delivery/drs/${drsNo}`).set(at(bom));
      assert.deepEqual(dockets.body.dockets.map((d) => d.docketNo), ['TE001', 'TE002', 'TE003']);
      const godown = await request(app).get('/api/delivery/godown').set(at(bom));
      assert.ok(godown.body.some((d) => d.docketNo === 'TE004'));
      const opts = await request(app).get('/api/delivery/options').set(at(bom));
      assert.ok(opts.body.undeliveredReasons.includes('DOOR LOCKED'));
    });

    test('validation', async () => {
      const noReceiver = await save({ drsNo, entries: [e('TE001', 'DLVRD', { receiverName: '' })] });
      assert.equal(noReceiver.status, 400);
      const noReason = await save({ drsNo, entries: [e('TE002', 'UNDELIVERED', { reason: 'WHATEVER' })] });
      assert.equal(noReason.status, 422);
      const early = await save({ drsNo, entries: [e('TE003', 'LOST', { date: '2020-01-01' })] });
      assert.equal(early.status, 422);
      assert.match(JSON.stringify(early.body), /before the DRS date/);
      assert.equal((await save({ drsNo, entries: [e('TE003', 'LOST', { date: '2999-01-01' })] })).status, 422);
      assert.equal((await save({ drsNo, entries: [e('TE004', 'LOST')] })).status, 422); // not on this DRS
      assert.equal((await save({ mode: 'GODOWN', entries: [e('TE004', 'UNDELIVERED', { reason: 'DOOR LOCKED' })] })).status, 422);
    });

    test('partial save: DRS stays open, undelivered goes back for a new DRS, To Pay billed', async () => {
      const res = await save({ drsNo, entries: [e('TE001', 'DLVRD'), e('TE002', 'UNDELIVERED', { reason: 'DOOR LOCKED' })] });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.deepEqual(res.body.counts, { DLVRD: 1, UNDELIVERED: 1 });
      assert.deepEqual(res.body.billed, ['TE001']);
      assert.equal((await query("select count(*) as c from client_bill_charge_details where docket_no = 'TE001'"))[0].c, 1);
      assert.equal((await openDrs())?.open, 1); // legacy dropped the DRS here
      const pending = await request(app).get('/api/drs/pending-dockets').set(at(bom)).query({ from: today, to: today });
      const te = pending.body.filter((d) => d.docketNo.startsWith('TE0'));
      assert.deepEqual(te.map((d) => [d.docketNo, d.packages]), [['TE002', 3]]);
      const [r] = await query("select remarks from delivery_status_entry_details where docket_no = 'TE002' and IsCancelled = 0");
      assert.equal(r.remarks, 'DOOR LOCKED');
    });

    test('last docket closes the DRS; delivered dockets cannot get another status', async () => {
      const res = await save({ drsNo, entries: [e('TE003', 'LOST', { remarks: 'not traced' })] });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(await openDrs(), undefined);
      const again = await save({ drsNo, entries: [e('TE001', 'DLVRD')] });
      assert.equal(again.status, 422);
    });

    test('godown delivery', async () => {
      const res = await save({ mode: 'GODOWN', entries: [e('TE004', 'DLVRD')] });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.deepEqual(res.body.billed, []); // Paid docket
      const godown = await request(app).get('/api/delivery/godown').set(at(bom));
      assert.ok(!godown.body.some((d) => d.docketNo === 'TE004'));
    });

    test('list', async () => {
      const list = await request(app).get('/api/delivery').set(at(bom)).query({ from: today, to: today });
      const mine = list.body.filter((r) => r.docketNo.startsWith('TE0'));
      assert.deepEqual(mine.map((r) => r.status).sort(), ['DLVRD', 'DLVRD', 'LOST', 'UNDELIVERED']);
    });

    test('cancel: admin only, blocked by POD dispatch, then reopens the DRS', async () => {
      assert.equal((await request(app).post(`/api/delivery/drs/${drsNo}/cancel`).set(at(bom))).status, 403);
      await query("insert into pod_dispatch(docket_no, IsCancelled) values ('TE001', 0)");
      const blocked = await request(app).post(`/api/delivery/drs/${drsNo}/cancel`).set(at(bomAdmin));
      assert.equal(blocked.status, 409);
      await query("delete from pod_dispatch where docket_no = 'TE001'");
      const res = await request(app).post(`/api/delivery/drs/${drsNo}/cancel`).set(at(bomAdmin));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.cancelled, 3);
      assert.equal((await openDrs())?.open, 3);
      const pending = await request(app).get('/api/drs/pending-dockets').set(at(bom)).query({ from: today, to: today });
      assert.ok(!pending.body.some((d) => d.docketNo === 'TE002')); // back on the DRS, not pending
    });
  });

  describe('POD dispatch', () => {
    let bom; let challanNo; let iomNo; let tmpDir;
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    // starts and ends like a real JPEG (SOI ... EOI)
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fake jpeg body for tests'), Buffer.from([0xff, 0xd9])]);
    const pdf = Buffer.from('%PDF-1.4\n% test pod\n');
    const b64 = (buf) => buf.toString('base64');
    const post = (dockets, extra = {}) => request(app).post('/api/pod').set(at(bom)).send({ iomDate: today, sentTo: 'B1001', dockets, ...extra });

    before(async () => {
      const os = await import('node:os');
      const fsp = await import('node:fs/promises');
      const pathMod = await import('node:path');
      tmpDir = await fsp.mkdtemp(pathMod.join(os.tmpdir(), 'ramas-pod-'));
      config.podUploadDir = tmpDir;
      ({ bom, challanNo } = await bringToMumbai(['TF001', 'TF002', 'TF003']));
      const drs = await request(app).post('/api/drs').set(at(bom)).send({
        drsDate: today, drsTime: '10:00', deliveredBy: 'ANIL PATIL',
        dockets: ['TF001', 'TF002', 'TF003'].map((no) => ({ docketNo: no, challanNo, packages: 3 })),
      });
      assert.equal(drs.status, 201, JSON.stringify(drs.body));
      const st = await request(app).post('/api/delivery').set(at(bom)).send({
        drsNo: drs.body.drsNo,
        entries: [
          { docketNo: 'TF001', status: 'DLVRD', date: today, time: '15:00', receiverName: 'A' },
          { docketNo: 'TF002', status: 'DLVRD', date: today, time: '15:00', receiverName: 'B' },
          { docketNo: 'TF003', status: 'UNDELIVERED', date: today, time: '15:00', reason: 'DOOR LOCKED' },
        ],
      });
      assert.equal(st.status, 201, JSON.stringify(st.body));
    });
    after(async () => {
      const fsp = await import('node:fs/promises');
      await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    test('eligibility: delivered, at the delivering branch', async () => {
      const ok = await request(app).get('/api/pod/check/TF001').set(at(bom));
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal(ok.body.packages, 3);
      const undelivered = await request(app).get('/api/pod/check/TF003').set(at(bom));
      assert.equal(undelivered.status, 422);
      assert.match(undelivered.body.error, /not delivered/);
      const wrongBranch = await request(app).get('/api/pod/check/TF001').set(at(emp));
      assert.equal(wrongBranch.status, 422);
      assert.match(wrongBranch.body.error, /MUMBAI : B1002/);
    });

    test('create: validation of files', async () => {
      const noImage = await post([{ docketNo: 'TF001', images: [] }]);
      assert.equal(noImage.status, 422);
      assert.match(JSON.stringify(noImage.body), /upload the POD image/);
      const notImage = await post([{ docketNo: 'TF001', images: [{ name: 'x.jpg', data: b64(Buffer.from('<html>not an image</html>')) }] }]);
      assert.equal(notImage.status, 422);
      assert.match(JSON.stringify(notImage.body), /not a JPEG image or PDF/);
      const big = await post([{ docketNo: 'TF001', images: [{ name: 'big.jpg', data: b64(Buffer.concat([jpeg, Buffer.alloc(2 * 1024 * 1024)])) }] }]);
      assert.equal(big.status, 422);
      assert.match(JSON.stringify(big.body), /larger than 2 MB/);
      // a script with a JPEG header glued on, a PDF that runs JavaScript, and data that is not base64 at all
      const cut = await post([{ docketNo: 'TF001', images: [{ name: 'cut.jpg', data: b64(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('<script>alert(1)</script>')])) }] }]);
      assert.equal(cut.status, 422);
      assert.match(JSON.stringify(cut.body), /not a complete JPEG/);
      const jsPdf = await post([{ docketNo: 'TF001', images: [{ name: 'evil.pdf', data: b64(Buffer.from('%PDF-1.4\n1 0 obj << /Type /Action /S /JavaScript /JS (app.alert(1)) >> endobj\n')) }] }]);
      assert.equal(jsPdf.status, 422);
      assert.match(JSON.stringify(jsPdf.body), /active content/);
      const notB64 = await post([{ docketNo: 'TF001', images: [{ name: 'x.jpg', data: '<svg onload=alert(1)>' }] }]);
      assert.equal(notB64.status, 400);
      const fsp = await import('node:fs/promises');
      assert.deepEqual(await fsp.readdir(tmpDir), []);
    });

    test('create: each docket keeps its own images, names are generated, IOM number assigned', async () => {
      const res = await post([
        { docketNo: 'TF001', remarks: 'signed', images: [{ name: '..\\..\\web.config.jpg', data: b64(jpeg) }, { name: 'pod.pdf', data: b64(pdf) }] },
        { docketNo: 'TF002', withoutImage: true },
      ]);
      assert.equal(res.status, 201, JSON.stringify(res.body));
      iomNo = res.body.iomNo;
      assert.match(iomNo, /^P\d{6,}$/);
      assert.deepEqual([res.body.dockets, res.body.images], [2, 2]);
      const fsp = await import('node:fs/promises');
      const files = await fsp.readdir(tmpDir);
      assert.equal(files.length, 2);
      assert.ok(files.every((f) => /^TF001-[0-9a-f-]{36}\.(jpg|pdf)$/.test(f)));
      const imgs = await query('select docket_no from pod_dispatch_image where IOM_number = @i', { i: iomNo });
      assert.deepEqual(imgs.map((r) => r.docket_no), ['TF001', 'TF001']); // legacy gave TF002 the same images
      const [c] = await query("select IOM_num from grn_docket_charge where Docket_No = 'TF001' and branch = 'B1002'");
      assert.equal(c.IOM_num, iomNo);
      const again = await post([{ docketNo: 'TF001', withoutImage: true }]);
      assert.equal(again.status, 422);
      assert.match(JSON.stringify(again.body), /already generated/);
    });

    test('view, list and the image itself (branch-restricted)', async () => {
      const one = await request(app).get(`/api/pod/${iomNo}`).set(at(bom));
      assert.equal(one.status, 200, JSON.stringify(one.body));
      const tf1 = one.body.dockets.find((d) => d.docketNo === 'TF001');
      assert.deepEqual(tf1.images.map((i) => i.type).sort(), ['image', 'pdf']);
      const imgId = tf1.images.find((i) => i.type === 'image').id;
      const img = await request(app).get(`/api/pod/images/${imgId}`).set(at(bom)).buffer(true).parse((r, cb) => {
        const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      assert.equal(img.status, 200);
      assert.match(img.headers['content-type'], /image\/jpeg/);
      assert.match(img.headers['content-security-policy'], /sandbox/);   // a stored file can never run script
      assert.equal(img.headers['x-content-type-options'], 'nosniff');
      assert.ok(Buffer.compare(img.body, jpeg) === 0);
      const otherBranch = await request(app).get(`/api/pod/images/${imgId}`).set(at(client));
      assert.equal(otherBranch.status, 403);
      const list = await request(app).get('/api/pod').set(at(bom)).query({ from: today, to: today });
      const row = list.body.find((p) => p.iomNo === iomNo);
      assert.deepEqual([row.dockets.sort(), row.images], [['TF001', 'TF002'], 2]);
    });

    test('cancel: blocked once on a courier document, then frees the dockets', async () => {
      await query("insert into POD_Dispatch_D(Doc_No, IOM_No, IsCancelled) values ('TDOC1', @i, 0)", { i: iomNo });
      const blocked = await request(app).post(`/api/pod/${iomNo}/cancel`).set(at(bom));
      assert.equal(blocked.status, 409);
      assert.match(blocked.body.error, /TDOC1/);
      await query("delete from POD_Dispatch_D where Doc_No = 'TDOC1'");
      const res = await request(app).post(`/api/pod/${iomNo}/cancel`).set(at(bom));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const ok = await request(app).get('/api/pod/check/TF001').set(at(bom));
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      assert.equal((await request(app).post(`/api/pod/${iomNo}/cancel`).set(at(bom))).status, 409);
    });
  });

  describe('POD to head office (courier + receive)', () => {
    let bom; let iom1; let iom2; let docNo;
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const courier = (body, tok = bom) => request(app).post('/api/pod-courier').set(at(tok))
      .send({ docDate: today, mode: 'COURIER', courierCode: 'C01', awbNo: 'AWB123', ...body });
    const receive = (body) => request(app).post('/api/pod-receive').set(at(emp)).send({ docNo, receiveDate: today, ...body });
    const header = async () => (await query('select Receive_Status from POD_Dispatch_H where Doc_No = @d', { d: docNo }))[0];

    before(async () => {
      let challanNo;
      ({ bom, challanNo } = await bringToMumbai(['TG001', 'TG002', 'TG003']));
      const drs = await request(app).post('/api/drs').set(at(bom)).send({
        drsDate: today, drsTime: '10:00', deliveredBy: 'ANIL PATIL',
        dockets: ['TG001', 'TG002', 'TG003'].map((no) => ({ docketNo: no, challanNo, packages: 3 })),
      });
      assert.equal(drs.status, 201, JSON.stringify(drs.body));
      const st = await request(app).post('/api/delivery').set(at(bom)).send({
        drsNo: drs.body.drsNo,
        entries: ['TG001', 'TG002', 'TG003'].map((no) => ({ docketNo: no, status: 'DLVRD', date: today, time: '15:00', receiverName: 'X' })),
      });
      assert.equal(st.status, 201, JSON.stringify(st.body));
      const p1 = await request(app).post('/api/pod').set(at(bom)).send({
        iomDate: today, sentTo: 'B1001', dockets: [{ docketNo: 'TG001', withoutImage: true }, { docketNo: 'TG002', withoutImage: true }],
      });
      const p2 = await request(app).post('/api/pod').set(at(bom)).send({ iomDate: today, sentTo: 'B1001', dockets: [{ docketNo: 'TG003', withoutImage: true }] });
      assert.equal(p1.status, 201, JSON.stringify(p1.body));
      assert.equal(p2.status, 201, JSON.stringify(p2.body));
      iom1 = p1.body.iomNo; iom2 = p2.body.iomNo;
    });

    test('pending IOMs at the dispatching branch', async () => {
      const res = await request(app).get('/api/pod-courier/pending').set(at(bom));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.find((p) => p.iomNo === iom1)?.dockets, ['TG001', 'TG002']);
      assert.ok(res.body.some((p) => p.iomNo === iom2));
    });

    test('courier: validation', async () => {
      assert.equal((await courier({ ioms: [iom1], awbNo: '' })).status, 400);
      assert.equal((await courier({ ioms: [iom1], docDate: '2020-01-01' })).status, 400);
      assert.equal((await courier({ ioms: [iom1], mode: 'SELF', personName: '' })).status, 400);
      const otherBranch = await courier({ ioms: [iom1] }, emp);
      assert.equal(otherBranch.status, 422);
    });

    test('courier: one document for both IOMs; the IOMs can no longer be cancelled', async () => {
      const res = await courier({ ioms: [iom1, iom2] });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      docNo = res.body.docNo;
      assert.match(docNo, /^PODD-\d+$/);
      const d = await query('select IOM_No, AWBill_No, MODE from POD_Dispatch_D where Doc_No = @d order by IOM_No', { d: docNo });
      assert.deepEqual(d.map((r) => [r.IOM_No, r.AWBill_No, r.MODE]), [[iom1, 'AWB123', 'C'], [iom2, 'AWB123', 'C']].sort());
      const pending = await request(app).get('/api/pod-courier/pending').set(at(bom));
      assert.ok(!pending.body.some((p) => [iom1, iom2].includes(p.iomNo)));
      assert.equal((await request(app).post(`/api/pod/${iom1}/cancel`).set(at(bom))).status, 409);
    });

    test('receive: head office only; find the document by docket', async () => {
      assert.equal((await request(app).get('/api/pod-receive/pending').set(at(bom)).query({ from: today, to: today })).status, 403);
      const pend = await request(app).get('/api/pod-receive/pending').set(at(emp)).query({ from: today, to: today });
      assert.ok(pend.body.some((d) => d.docNo === docNo));
      const byDocket = await request(app).get('/api/pod-receive/by-docket/TG002').set(at(emp));
      assert.equal(byDocket.body.docNo, docNo);
      const doc = await request(app).get(`/api/pod-receive/docs/${docNo}`).set(at(emp));
      assert.deepEqual(doc.body.dockets.map((d) => d.docketNo), ['TG001', 'TG002', 'TG003']);
    });

    test('partial receive keeps the IOM and the document open (legacy closed the IOM)', async () => {
      const res = await receive({ dockets: ['TG001'], remark: 'first lot' });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.pending, 2);
      const [d1] = await query('select ho_receive from POD_Dispatch_D where Doc_No = @d and IOM_No = @i', { d: docNo, i: iom1 });
      assert.equal(d1.ho_receive, null);
      assert.equal((await header()).Receive_Status, false);
      const [g] = await query("select PODDispatch_status from grn_master where docket_no = 'TG001'");
      assert.equal(g.PODDispatch_status, 'POD_Received_IsActive');
      assert.equal((await request(app).post(`/api/pod-courier/${docNo}/cancel`).set(at(bom))).status, 409);
      const again = await receive({ dockets: ['TG001'] });
      assert.equal(again.status, 422);
      assert.equal((await receive({ dockets: ['TG002'], receiveDate: '2999-01-01' })).status, 400);
    });

    test('receiving the rest closes the IOMs and the document', async () => {
      const res = await receive({ dockets: ['TG002', 'TG003'] });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.pending, 0);
      const d = await query('select ho_receive from POD_Dispatch_D where Doc_No = @d', { d: docNo });
      assert.ok(d.every((r) => r.ho_receive === '1'));
      assert.equal((await header()).Receive_Status, true);
      const pend = await request(app).get('/api/pod-receive/pending').set(at(emp)).query({ from: today, to: today });
      assert.ok(!pend.body.some((x) => x.docNo === docNo));
      const list = await request(app).get('/api/pod-receive').set(at(emp)).query({ from: today, to: today });
      assert.equal(list.body.filter((r) => r.docNo === docNo).length, 3);
    });

    test('cancel receive, then the courier document can be cancelled and the IOMs are pending again', async () => {
      const res = await request(app).post(`/api/pod-receive/${docNo}/cancel`).set(at(emp));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal((await header()).Receive_Status, false);
      const c = await request(app).post(`/api/pod-courier/${docNo}/cancel`).set(at(bom));
      assert.equal(c.status, 200, JSON.stringify(c.body));
      const pending = await request(app).get('/api/pod-courier/pending').set(at(bom));
      assert.ok([iom1, iom2].every((i) => pending.body.some((p) => p.iomNo === i)));
    });
  });

  describe('branch master', () => {
    let code; let child;
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const body = (extra = {}) => ({
      name: 'tst pune', shortCode: 'tpn', stateCode: 'MH', cityCode: 'PNQ', company: 'RELL', controllingBranch: 'B1001',
      address: 'fc road', contactPerson: 'amit', phone: '02040000000', email: 'pune@example.com', gstin: '27AAACR1234A1Z1', ...extra,
    });
    const ledgers = (name, div = 'DIV1001') => query(
      "select LedgerName from tblAccountLedger where LedgerName like '%' + @n + '%' and Division = @div and Financial_Year = '2025-2026' order by LedgerName",
      { n: name, div });

    test('lookups: states with GSTIN, cities, locations with the branch linked to them', async () => {
      const opts = await request(app).get('/api/branches/options').set(at(emp));
      assert.equal(opts.status, 200);
      assert.equal(opts.body.states.find((s) => s.value === 'MH').gstin, '27AAACR1234A1Z1');
      const cities = await request(app).get('/api/branches/cities').set(at(emp)).query({ state: 'MH' });
      assert.deepEqual(cities.body.map((c) => c.value).sort(), ['BOM', 'PNQ']);
      const locs = await request(app).get('/api/branches/locations').set(at(emp)).query({ city: 'DEL' });
      assert.equal(locs.body.find((l) => l.value === 'L001').linkedCode, 'B1001');
      assert.equal(locs.body.find((l) => l.value === 'L001').pinCode, '110020');
    });

    test('create: validation (short code the legacy page never checked, location, state, flags, role)', async () => {
      const post = (b, tok = emp) => request(app).post('/api/branches').set(at(tok)).send(b);
      const dupShort = await post(body({ shortCode: 'DEL' }));
      assert.equal(dupShort.status, 409);
      assert.match(dupShort.body.error, /Short code already exists \(HEAD OFFICE : B1001\)/);
      const linked = await post(body({ stateCode: 'DL', cityCode: 'DEL', location: 'L001', gstin: '' }));
      assert.equal(linked.status, 409);
      assert.match(linked.body.error, /linked to this location/);
      assert.equal((await post(body({ stateCode: 'DL' }))).status, 400); // PNQ is in MH
      assert.equal((await post(body({ controllingBranch: '' }))).status, 400);
      assert.equal((await post(body({ isHub: true, isFranchisee: true }))).status, 400);
      assert.equal((await post(body({ divisions: ['DIV1002'] }))).status, 400); // own division dropped
      assert.equal((await post(body(), client)).status, 403);
      assert.equal((await query("select count(*) as c from branch_master where branch_name like 'TST %'"))[0].c, 0);
    });

    test('create: generated code, upper-cased, ledgers bound in the same save', async () => {
      const res = await request(app).post('/api/branches').set(at(emp)).send(body());
      assert.equal(res.status, 201, JSON.stringify(res.body));
      code = res.body.code;
      assert.match(code, /^B\d{4,}$/);
      const one = await request(app).get(`/api/branches/${code}`).set(at(emp));
      assert.equal(one.status, 200, JSON.stringify(one.body));
      assert.deepEqual([one.body.name, one.body.shortCode, one.body.zoneCode, one.body.address, one.body.divisions],
        ['TST PUNE', 'TPN', 'WZ', 'FC ROAD', ['DIV1001']]);
      assert.deepEqual((await ledgers('TST PUNE')).map((r) => r.LedgerName),
        ['CASH TST PUNE', `PAID RECOVERY :TST PUNE :${code}`, `TOPAY RECOVERY :TST PUNE :${code}`, `TST PUNE :${code}`]);
      const list = await request(app).get('/api/branches').set(at(emp)).query({ q: 'tst' });
      assert.deepEqual(list.body.map((b) => b.code), [code]);
    });

    test('update: short code stays unique, new division gets its ledgers', async () => {
      const put = (b) => request(app).put(`/api/branches/${code}`).set(at(emp)).send(b);
      const dup = await put(body({ shortCode: 'BOM' }));
      assert.equal(dup.status, 409);
      const res = await put(body({ name: 'tst pune city', divisions: ['DIV1001', 'DIV1002'], isHub: true }));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const one = await request(app).get(`/api/branches/${code}`).set(at(emp));
      assert.deepEqual([one.body.name, one.body.isHub, one.body.divisions], ['TST PUNE CITY', true, ['DIV1001', 'DIV1002']]);
      assert.equal((await ledgers('TST PUNE CITY', 'DIV1002')).length, 4);
    });

    test('a controlling branch cannot be deactivated; a branch in use cannot be deleted', async () => {
      const c = await request(app).post('/api/branches').set(at(emp)).send(body({ name: 'tst pimpri', shortCode: 'TPM', controllingBranch: code }));
      assert.equal(c.status, 201, JSON.stringify(c.body));
      child = c.body.code;
      const deact = await request(app).put(`/api/branches/${code}`).set(at(emp)).send(body({ name: 'tst pune city', active: false }));
      assert.equal(deact.status, 409);
      assert.match(deact.body.error, /controlling branch of TST PIMPRI/);
      const inUse = await request(app).delete(`/api/branches/${code}`).set(at(emp));
      assert.equal(inUse.status, 409);
      assert.equal((await request(app).delete('/api/branches/B1001').set(at(emp))).status, 409);
    });

    test('delete an unused branch', async () => {
      const res = await request(app).delete(`/api/branches/${child}`).set(at(emp));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal((await request(app).get(`/api/branches/${child}`).set(at(emp))).status, 404);
      assert.equal((await request(app).delete(`/api/branches/${code}`).set(at(emp))).status, 200);
    });
  });

  describe('vendor master', () => {
    let code;
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const body = (extra = {}) => ({
      name: 'tst roadlines', vendorType: 'VENDOR', modes: ['TR', 'RD'], branch: 'B1001', address: 'sanjay gandhi transport nagar',
      stateCode: 'DL', cityCode: 'DEL', pinCode: '110042', contactPerson: 'raj', pan: 'aaapr1234k', email: 'tst@example.com',
      phone: '9811100099', approvalDate: '2025-06-01', approvedBy: 'EMP001', tdsPercent: 2, gstRegistered: true,
      gstin: '07aaapr1234k1z9', ifsc: 'hdfc0001234', accountNo: '50100012345678', divisions: ['DIV1001'], ...extra,
    });
    const ledgers = (div = 'DIV1001') => query(
      "select LedgerName, VendorOrClientCode, DrCr from tblAccountLedger where LedgerName like 'TST ROADLINES%' and Division = @div and Financial_Year = '2025-2026' order by LedgerName",
      { div });

    test('lookups: modes, approvers, vendor types', async () => {
      const opts = await request(app).get('/api/vendors/options').set(at(emp));
      assert.equal(opts.status, 200);
      assert.deepEqual(opts.body.modes.map((m) => m.value), ['RD', 'TR', 'AR']);
      assert.equal(opts.body.approvers.find((a) => a.value === 'EMP001').label, 'RAVI KUMAR :EMP001');
      assert.deepEqual(opts.body.vendorTypes.map((t) => t.value), ['VENDOR', 'SELF', 'COLOADER']);
      const cities = await request(app).get('/api/vendors/cities').set(at(emp)).query({ state: 'MH' });
      assert.deepEqual(cities.body.map((c) => c.value).sort(), ['BOM', 'PNQ']);
    });

    test('create: validation (duplicate name / GSTIN, modes, city, GST, role)', async () => {
      const post = (b, tok = emp) => request(app).post('/api/vendors').set(at(tok)).send(b);
      const dupName = await post(body({ name: 'sharma roadways' }));
      assert.equal(dupName.status, 409);
      assert.match(dupName.body.error, /SHARMA ROADWAYS : V001/);
      const dupGst = await post(body({ gstin: '07AAAPS1234K1Z2' }));
      assert.equal(dupGst.status, 409);
      assert.match(dupGst.body.error, /GSTIN 07AAAPS1234K1Z2 already exists/);
      assert.equal((await post(body({ modes: [] }))).status, 400);
      assert.equal((await post(body({ cityCode: 'BOM' }))).status, 400);         // Mumbai is not in Delhi
      assert.equal((await post(body({ gstin: '' }))).status, 400);              // registered but no GSTIN
      assert.equal((await post(body({ pan: 'ABC' }))).status, 400);
      assert.equal((await post(body({ tdsPercent: 100 }))).status, 400);
      assert.equal((await post(body({ approvedBy: 'NOBODY' }))).status, 400);
      assert.equal((await post(body({ divisions: ['DIV1002'] }))).status, 400); // own division dropped
      assert.equal((await post(body(), client)).status, 403);
      assert.equal((await query("select count(*) as c from vendors_master where Name like 'TST %'"))[0].c, 0);
    });

    test('create: generated code, modes in master order, ledger bound, visible on the challan screen', async () => {
      const res = await request(app).post('/api/vendors').set(at(emp)).send(body());
      assert.equal(res.status, 201, JSON.stringify(res.body));
      code = res.body.code;
      assert.match(code, /^V\d{4,}$/);
      const one = await request(app).get(`/api/vendors/${code}`).set(at(emp));
      assert.equal(one.status, 200, JSON.stringify(one.body));
      assert.deepEqual(
        [one.body.name, one.body.modes, one.body.pan, one.body.gstin, one.body.ifsc, one.body.approvedBy, one.body.approvedByText, one.body.tdsPercent],
        ['TST ROADLINES', ['RD', 'TR'], 'AAAPR1234K', '07AAAPR1234K1Z9', 'HDFC0001234', 'EMP001', 'RAVI KUMAR :EMP001', 2]);
      assert.deepEqual(await ledgers(), [{ LedgerName: `TST ROADLINES :${code} :HEAD OFFICE :B1001`, VendorOrClientCode: code, DrCr: 'Cr' }]);
      const [row] = await query('select CourDiv, PrclDiv, FTLDiv, IsColoader, AutoGstStatus from vendors_master where vendor_code = @c', { c: code });
      assert.deepEqual([row.CourDiv, row.PrclDiv, row.FTLDiv, row.IsColoader, row.AutoGstStatus], ['DIV1001', '', '', false, '1']);
      const challanVendors = await request(app).get('/api/challans/vendors').set(at(emp)).query({ vendorType: 'Vendor' });
      assert.equal(challanVendors.body.find((v) => v.code === code)?.tdsPercent, 2);
      const list = await request(app).get('/api/vendors').set(at(emp)).query({ q: 'tst' });
      assert.deepEqual(list.body.map((v) => v.code), [code]);
    });

    test('update: name kept, PAN / e-mail editable, new division gets its ledger, GSTIN stays unique', async () => {
      const put = (b) => request(app).put(`/api/vendors/${code}`).set(at(emp)).send(b);
      assert.equal((await put(body({ gstin: '07AAAPS1234K1Z2' }))).status, 409);
      const res = await put(body({ name: 'renamed', pan: 'aaapr9999k', email: 'new@example.com', vendorType: 'COLOADER',
        divisions: ['DIV1001', 'DIV1003'], gstRegistered: false, active: false }));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const one = await request(app).get(`/api/vendors/${code}`).set(at(emp));
      assert.deepEqual([one.body.name, one.body.pan, one.body.email, one.body.vendorType, one.body.gstin, one.body.gstRegistered, one.body.active],
        ['TST ROADLINES', 'AAAPR9999K', 'new@example.com', 'COLOADER', '', false, false]);
      assert.equal((await ledgers('DIV1003')).length, 1);
      const inactive = await request(app).get('/api/vendors').set(at(emp)).query({ q: 'tst', status: 'inactive' });
      assert.deepEqual(inactive.body.map((v) => v.code), [code]);
    });

    test('delete: refused while a vehicle belongs to the vendor, then allowed', async () => {
      await query("insert into Vechile_Master(VEHICLE_NO, VendorCodeName) values ('TST0001', @c)", { c: code });
      const inUse = await request(app).delete(`/api/vendors/${code}`).set(at(emp));
      assert.equal(inUse.status, 409);
      assert.match(inUse.body.error, /in use \(vehicles\)/);
      assert.equal((await request(app).delete('/api/vendors/V001').set(at(emp))).status, 409); // has challans / vehicles
      await query("delete from Vechile_Master where VEHICLE_NO = 'TST0001'");
      const res = await request(app).delete(`/api/vendors/${code}`).set(at(emp));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal((await request(app).get(`/api/vendors/${code}`).set(at(emp))).status, 404);
      // Its ledger stays, so the next vendor must not get the same code.
      const next = await request(app).post('/api/vendors').set(at(emp)).send(body({ name: 'tst second roadlines', gstRegistered: false }));
      assert.equal(next.status, 201, JSON.stringify(next.body));
      assert.notEqual(next.body.code, code);
    });
  });

  describe('vehicle master', () => {
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const body = (extra = {}) => ({
      vehicleNo: 'ts 99 ab 0001', vendorType: 'Vendor', vendorCode: 'V001', ownerName: 'sharma roadways', vehicleType: 'SUN',
      containerSize: '32 ft', chassisNo: 'ch-tst-1', engineNo: 'en-tst-1', make: 'TATA', model: '2024', makerId: 1,
      fuelType: 'DIESEL', tankCapacity: '350', amc: 'Silver', branch: 'B1001', routes: ['R001', 'R002'],
      dealerName: 'tst motors', invoiceNo: 'INV-77', invoiceValue: 2500000, ...extra,
    });

    test('lookups: vehicle types with capacity, makers, vendors by kind, routes', async () => {
      const opts = await request(app).get('/api/vehicles/options').set(at(emp));
      assert.equal(opts.status, 200);
      assert.equal(opts.body.vehicleTypes.find((t) => t.value === 'SUN').capacity, 9000);
      assert.ok(opts.body.makers.some((m) => m.label === 'TATA MOTORS'));
      const own = await request(app).get('/api/vehicles/vendors').set(at(emp)).query({ type: 'Self' });
      assert.deepEqual(own.body.map((v) => v.value), ['V002']);
      const market = await request(app).get('/api/vehicles/vendors').set(at(emp)).query({ type: 'MARKET' });
      assert.deepEqual(market.body.map((v) => v.value), ['VT001']);
      const routes = await request(app).get('/api/vehicles/routes').set(at(emp)).query({ q: 'mumbai' });
      assert.deepEqual(routes.body.map((r) => r.value).sort(), ['R001', 'R002']);
    });

    test('create: validation (number, duplicate, vendor kind, routes, role)', async () => {
      const post = (b, tok = emp) => request(app).post('/api/vehicles').set(at(tok)).send(b);
      assert.equal((await post(body({ vehicleNo: 'ABC' }))).status, 400);
      const dup = await post(body({ vehicleNo: 'DL01AB1234' }));
      assert.equal(dup.status, 409);
      assert.equal((await post(body({ vendorCode: 'V002' }))).status, 400);             // V002 is a Self vendor
      const same = await post(body({ routes: ['R001', 'R001'] }));
      assert.equal(same.status, 400);
      assert.match(same.body.error, /cannot be the same/);
      assert.equal((await post(body({ routes: ['R999'] }))).status, 400);
      assert.equal((await post(body({ vehicleType: 'XXX' }))).status, 400);
      assert.equal((await post(body(), client)).status, 403);
      assert.equal((await query("select count(*) as c from Vechile_Master where VEHICLE_NO like 'TS99%'"))[0].c, 0);
    });

    test('create: number normalised, capacity from the type, routes kept, ledger bound, on the challan screen', async () => {
      const res = await request(app).post('/api/vehicles').set(at(emp)).send(body());
      assert.equal(res.status, 201, JSON.stringify(res.body));
      assert.equal(res.body.vehicleNo, 'TS99AB0001');
      const one = await request(app).get('/api/vehicles/TS99AB0001').set(at(emp));
      assert.equal(one.status, 200, JSON.stringify(one.body));
      assert.deepEqual([one.body.capacity, one.body.vehicleTypeName, one.body.routes, one.body.ownerName, one.body.maker, one.body.active],
        [9000, 'SUNDRY', ['R001', 'R002'], 'SHARMA ROADWAYS', 'TATA MOTORS', true]);
      const [ledger] = await query("select LedgerName from tblAccountLedger where LedgerName = 'TS99AB0001' and Financial_Year = '2025-2026' and Division = 'DIV1001'");
      assert.ok(ledger, 'vehicle ledger created');
      const trucks = await request(app).get('/api/challans/vehicles').set(at(emp)).query({ vendorCode: 'V001' });
      assert.ok(trucks.body.some((t) => t.truckNo === 'TS99AB0001'));
    });

    test('update: a Self vehicle drops its routes; purchase details editable', async () => {
      const res = await request(app).put('/api/vehicles/TS99AB0001').set(at(emp))
        .send(body({ vendorType: 'Self', vendorCode: 'V002', ownerName: 'ramas logistics', dealerName: 'new dealer', purchaseDate: '2025-05-02' }));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const one = await request(app).get('/api/vehicles/TS99AB0001').set(at(emp));
      assert.deepEqual([one.body.vendorType, one.body.vendorCode, one.body.routes, one.body.dealerName, one.body.purchaseDate],
        ['Self', 'V002', [], 'NEW DEALER', '2025-05-02']);
    });

    test('status: an inactive vehicle leaves the challan screen', async () => {
      const off = await request(app).patch('/api/vehicles/TS99AB0001/status').set(at(emp)).send({ active: false });
      assert.equal(off.status, 200, JSON.stringify(off.body));
      const trucks = await request(app).get('/api/challans/vehicles').set(at(emp)).query({ vendorCode: 'V002' });
      assert.ok(!trucks.body.some((t) => t.truckNo === 'TS99AB0001'));
      const list = await request(app).get('/api/vehicles').set(at(emp)).query({ q: 'ts99', status: 'inactive' });
      assert.deepEqual(list.body.map((v) => v.vehicleNo), ['TS99AB0001']);
      assert.equal((await request(app).patch('/api/vehicles/TS99AB0001/status').set(at(emp)).send({ active: true })).status, 200);
    });
  });

  describe('client master', () => {
    let id; let code;
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const body = (extra = {}) => ({
      name: 'tst  sunrise   foods', branch: 'B1001', submissionLocation: 'B1001', collectionLocation: 'B1002', contactPerson: 'neha',
      address: '5 okhla phase 1', cityCode: 'DEL', pinCode: '110020', email: 'tst@example.com', phone: '01140000077', mobile: '9811177777',
      pan: 'aaacs7777q', gstRegistered: true, gstin: '07aaacs7777q1z7', placeOfSupply: 'INTRASTATE', introDate: '2025-06-01',
      creditPeriod: 15, billingCycle: '30', natureOfBusinessId: 3, contractBy: 'EMP001', ...extra,
    });
    const ledgers = (div = 'DIV1001') => query(
      "select LedgerName, VendorOrClientCode from tblAccountLedger where LedgerName like 'TST SUNRISE FOODS%' and Division = @div and Financial_Year = '2025-2026' order by LedgerName",
      { div });

    test('lookups: nature of business, contract-by employees, parent clients, cities', async () => {
      const opts = await request(app).get('/api/clients/options').set(at(emp));
      assert.equal(opts.status, 200);
      assert.ok(opts.body.natureOfBusiness.some((n) => n.label === 'FMCG'));
      assert.ok(opts.body.employees.some((e) => e.value === 'EMP001'));
      assert.ok(opts.body.parentClients.some((c) => c.value === 'CL001'));
      const cities = await request(app).get('/api/clients/cities').set(at(emp)).query({ q: 'mum' });
      assert.deepEqual(cities.body.map((c) => c.value), ['BOM']);
    });

    test('create: validation (duplicate name / GSTIN, future date, billing, transport id, role)', async () => {
      const post = (b, tok = emp) => request(app).post('/api/clients').set(at(tok)).send(b);
      const dup = await post(body({ name: 'acme textiles' }));
      assert.equal(dup.status, 409);
      assert.match(dup.body.error, /ACME TEXTILES : CL001/);
      const dupGst = await post(body({ gstin: '27AAACA1111A1Z1' }));
      assert.equal(dupGst.status, 409);
      assert.equal((await post(body({ introDate: '2999-01-01' }))).status, 400);
      assert.equal((await post(body({ billing: { sameAsClient: false } }))).status, 400);
      assert.equal((await post(body({ isPs: true }))).status, 400);                       // transport id required
      assert.equal((await post(body({ cityCode: 'XXX' }))).status, 400);
      assert.equal((await post(body({ mobile: '123' }))).status, 400);
      assert.equal((await post(body(), client)).status, 403);
      assert.equal((await query("select count(*) as c from client_Master where company_name like 'TST %'"))[0].c, 0);
    });

    test('create: generated code, name tidied, billing copied, BILLED + UNBILLED ledgers, visible to docket booking', async () => {
      const res = await request(app).post('/api/clients').set(at(emp)).send(body({ billing: { sameAsClient: true } }));
      assert.equal(res.status, 201, JSON.stringify(res.body));
      ({ id, code } = res.body);
      assert.match(code, /^C\d{4,}$/);
      const one = await request(app).get(`/api/clients/${id}`).set(at(emp));
      assert.equal(one.status, 200, JSON.stringify(one.body));
      assert.deepEqual([one.body.name, one.body.gstin, one.body.pan, one.body.contractBy, one.body.natureOfBusiness, one.body.billing.sameAsClient],
        ['TST SUNRISE FOODS', '07AAACS7777Q1Z7', 'AAACS7777Q', 'EMP001', 'FMCG', true]);
      assert.deepEqual(await ledgers(), [
        { LedgerName: `TST SUNRISE FOODS :${code}:HEAD OFFICE:B1001 :BILLED`, VendorOrClientCode: code },
        { LedgerName: `TST SUNRISE FOODS :${code}:HEAD OFFICE:B1001 :UNBILLED`, VendorOrClientCode: code },
      ]);
      const search = await request(app).get('/api/dockets/lookup/clients').set(at(emp)).query({ q: 'sunrise' });
      assert.equal(search.status, 200, JSON.stringify(search.body));
      assert.ok(search.body.some((c) => c.code === code && c.name === 'TST SUNRISE FOODS'));
    });

    test('update: name and branch kept, other details editable, GSTIN unique', async () => {
      const put = (b) => request(app).put(`/api/clients/${id}`).set(at(emp)).send(b);
      assert.equal((await put(body({ gstin: '27AAACA1111A1Z1' }))).status, 409);
      const res = await put(body({ name: 'renamed', branch: 'B1002', creditPeriod: 45, gstRegistered: false, isPs: true, transportId: 'TR-9',
        billing: { sameAsClient: false, address: 'godown 7', name: 'sunrise billing', phone: '01140000078' }, active: false, poDate: '2025-07-01' }));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const one = await request(app).get(`/api/clients/${id}`).set(at(emp));
      assert.deepEqual([one.body.name, one.body.branch, one.body.creditPeriod, one.body.gstin, one.body.transportId, one.body.billing.name,
        one.body.active, one.body.poDate], ['TST SUNRISE FOODS', 'B1001', 45, '', 'TR-9', 'SUNRISE BILLING', false, '2025-07-01']);
      const inactive = await request(app).get('/api/clients').set(at(emp)).query({ q: 'tst sunrise', status: 'inactive' });
      assert.deepEqual(inactive.body.map((c) => c.code), [code]);
    });

    test('delete: a client with dockets is refused; an unused one is removed (its code is not reused)', async () => {
      const [acme] = await query("select client_Id from client_Master where client_code = 'CL001'");
      const inUse = await request(app).delete(`/api/clients/${acme.client_Id}`).set(at(emp));
      assert.equal(inUse.status, 409);
      assert.match(inUse.body.error, /in use/);
      const res = await request(app).delete(`/api/clients/${id}`).set(at(emp));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal((await request(app).get(`/api/clients/${id}`).set(at(emp))).status, 404);
      const again = await request(app).post('/api/clients').set(at(emp)).send(body({ name: 'tst sunrise foods two', gstRegistered: false }));
      assert.equal(again.status, 201, JSON.stringify(again.body));
      assert.notEqual(again.body.code, code);
    });
  });

  describe('employee master', () => {
    let id; let code;
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const body = (extra = {}) => ({
      name: 'tst  meena   gupta', designation: 'DC-116', branch: 'B1001', location: 'L002', department: 'OPS', company: 'RELL',
      reportsTo: 'EMP001', divisions: ['DIV1001'], joiningDate: '2025-05-01', effectiveFrom: '2025-05-01', guardianType: 'Father',
      guardianName: 'ram gupta', gender: 'Female', dob: '1996-03-10', religion: 'Hindu', category: 'General', nationality: 'Indian',
      bloodGroup: 'B+', mobile: '9811155555', email: 'Meena@Example.com', presentAddress: 'kalkaji', presentCity: 'DEL',
      presentPin: '110019', permanentAddress: 'kalkaji', permanentCity: 'DEL', totalExperience: 2.5, pan: 'abcpg1234k',
      references: [{ name: 'suresh', relation: 'brother', mobile: '9811166666' }], pf: true, ...extra,
    });

    test('lookups: designations, departments, locations of a branch', async () => {
      const opts = await request(app).get('/api/employees/options').set(at(emp));
      assert.equal(opts.status, 200);
      assert.ok(opts.body.designations.some((d) => d.value === 'DC-116' && d.label === 'DELIVERY BOY'));
      assert.ok(opts.body.departments.some((d) => d.value === 'OPS'));
      const locs = await request(app).get('/api/employees/locations').set(at(emp)).query({ branch: 'B1002' });
      assert.deepEqual(locs.body.map((l) => l.value).sort(), ['L003', 'L004']);
    });

    test('create: validation (dates, location of branch, reports-to, division, role)', async () => {
      const post = (b, tok = emp) => request(app).post('/api/employees').set(at(tok)).send(b);
      const wef = await post(body({ effectiveFrom: '2025-04-01' }));
      assert.equal(wef.status, 400);
      assert.match(JSON.stringify(wef.body), /Effective-from date/);
      assert.equal((await post(body({ dob: '2025-06-01' }))).status, 400);
      assert.equal((await post(body({ location: 'L003' }))).status, 400);     // L003 is a Mumbai location
      assert.equal((await post(body({ reportsTo: 'NOBODY' }))).status, 400);
      assert.equal((await post(body({ divisions: ['DIV1002'] }))).status, 400);
      assert.equal((await post(body({ mobile: '12345' }))).status, 400);
      assert.equal((await post(body(), client)).status, 403);
      assert.equal((await query("select count(*) as c from employee_master where empname like 'TST %'"))[0].c, 0);
    });

    test('create: generated code, name tidied, ledger bound, listed for pickup (delivery boy)', async () => {
      const res = await request(app).post('/api/employees').set(at(emp)).send(body());
      assert.equal(res.status, 201, JSON.stringify(res.body));
      ({ id, code } = res.body);
      assert.match(code, /^E\d{4,}$/);
      const one = await request(app).get(`/api/employees/${id}`).set(at(emp));
      assert.equal(one.status, 200, JSON.stringify(one.body));
      assert.deepEqual([one.body.name, one.body.designationName, one.body.locationName, one.body.reportsToName, one.body.email,
        one.body.pan, one.body.totalExperience, one.body.references[0].relation, one.body.pf],
      ['TST MEENA GUPTA', 'DELIVERY BOY', 'NEHRU PLACE', 'RAVI KUMAR', 'meena@example.com', 'ABCPG1234K', 2.5, 'BROTHER', true]);
      const ledger = await query("select LedgerName, VendorOrClientCode from tblAccountLedger where LedgerName like 'TST MEENA GUPTA%' and Financial_Year = '2025-2026'");
      assert.deepEqual(ledger, [{ LedgerName: `TST MEENA GUPTA:${code}:HEAD OFFICE:B1001`, VendorOrClientCode: code }]);
      const staff = await request(app).get('/api/pickups/options').set(at(emp));
      assert.ok(JSON.stringify(staff.body).includes(code), 'new delivery boy offered as pickup staff');
    });

    test('update: details change, a rename keeps the one ledger, a new division gets one', async () => {
      const res = await request(app).put(`/api/employees/${id}`).set(at(emp))
        .send(body({ name: 'tst meena sharma', designation: 'EXE', divisions: ['DIV1001', 'DIV1002'], active: false }));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const one = await request(app).get(`/api/employees/${id}`).set(at(emp));
      assert.deepEqual([one.body.name, one.body.designation, one.body.divisions, one.body.active],
        ['TST MEENA SHARMA', 'EXE', ['DIV1001', 'DIV1002'], false]);
      const ledgers = await query("select Division from tblAccountLedger where ltrim(VendorOrClientCode) = @c and Financial_Year = '2025-2026' order by Division", { c: code });
      assert.deepEqual(ledgers.map((l) => l.Division), ['DIV1001', 'DIV1002']);
      const list = await request(app).get('/api/employees').set(at(emp)).query({ q: 'tst meena', status: 'inactive' });
      assert.deepEqual(list.body.map((e) => e.code), [code]);
    });

    test('delete: an employee with a login is refused; an unused one is removed', async () => {
      const [emp1] = await query("select empid from employee_master where empcode = 'EMP001'");
      const inUse = await request(app).delete(`/api/employees/${emp1.empid}`).set(at(emp));
      assert.equal(inUse.status, 409);
      assert.match(inUse.body.error, /in use \(a login\)/);
      const res = await request(app).delete(`/api/employees/${id}`).set(at(emp));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal((await request(app).get(`/api/employees/${id}`).set(at(emp))).status, 404);
    });
  });

  describe('client contract (city to city)', () => {
    let clientCode; let v1; let v2;
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const plusDays = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
    const rowFor = (extra = {}) => ({
      origin: 'DEL', destination: 'PNQ', mode: 'RD', deliveryMode: 'DM-101', rateOn: 'WEIGHT', rate: 20, minWeight: 10, minFreight: 300,
      expectedDays: 2, charges: { fuelPercent: 12, fov: 0.1, halting: 150, ocr: 40 }, ...extra,
    });
    const contract = (extra = {}) => ({
      client: clientCode, billingAt: 'B1001', startDate: '2025-04-01', endDate: '2027-03-31', effectiveFrom: today, rows: [rowFor()], ...extra,
    });
    const rateOn = (bookingDate) => request(app).get('/api/dockets/lookup/rate').set(at(emp)).query({
      onAccountOf: `TST RATE CLIENT:${clientCode}`, destination: 'PUNE', bookingMode: 'RD', rateOn: 'WEIGHT',
      customerType: 'Contractual Client', bookingType: 'Paid', bookingDate, deliveryMode: 'DM-101',
    });

    before(async () => {
      const c = await request(app).post('/api/clients').set(at(emp)).send({
        name: 'tst rate client', branch: 'B1001', submissionLocation: 'B1001', collectionLocation: 'B1001', address: 'x', cityCode: 'DEL',
        phone: '01140000099', mobile: '9811199999', gstRegistered: false, placeOfSupply: 'INTRASTATE', introDate: '2025-04-01',
        billingCycle: '30', natureOfBusinessId: 1,
      });
      assert.equal(c.status, 201, JSON.stringify(c.body));
      clientCode = c.body.code;
    });

    test('the ACME sample rates now come from the contract table (docket rate lookup)', async () => {
      const r = await request(app).get('/api/dockets/lookup/rate').set(at(emp)).query({
        onAccountOf: 'ACME TEXTILES:CL001', destination: 'MUMBAI', bookingMode: 'RD', rateOn: 'WEIGHT',
        customerType: 'Contractual Client', bookingType: 'Paid', bookingDate: today, deliveryMode: 'DM-101',
      });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.deepEqual([r.body.rate, r.body.minWeight, r.body.minFreight, r.body.billingAt], [12, 20, 500, 'B1002']);
    });

    test('create: validation (dates, amounts, duplicates in the list, role)', async () => {
      const post = (b, tok = emp) => request(app).post('/api/contracts').set(at(tok)).send(b);
      assert.equal((await post(contract({ effectiveFrom: '2025-05-01' }))).status, 400);                 // in the past
      assert.equal((await post(contract({ startDate: '2024-04-01' }))).status, 400);                      // outside the financial year
      assert.equal((await post(contract({ rows: [rowFor({ rate: 0 })] }))).status, 400);                 // rate should not be zero
      assert.equal((await post(contract({ rows: [rowFor(), rowFor()] }))).status, 409);                  // same rate twice in the list
      assert.equal((await post(contract({ rows: [rowFor({ rateOn: 'FTL', ftlRate: 9000 })] }))).status, 400); // FTL not for DIV1001
      assert.equal((await post(contract({ client: 'NOPE' }))).status, 400);
      assert.equal((await post(contract(), client)).status, 403);
      assert.equal((await query('select count(*) as c from client_contract_city where client_code = @c', { c: clientCode }))[0].c, 0);
    });

    test('create: version 1 today, version 2 later; the docket lookup takes the version in force', async () => {
      const r1 = await request(app).post('/api/contracts').set(at(emp)).send(contract());
      assert.equal(r1.status, 201, JSON.stringify(r1.body));
      assert.equal((await request(app).post('/api/contracts').set(at(emp)).send(contract())).status, 409);   // same effective date again
      const r2 = await request(app).post('/api/contracts').set(at(emp)).send(contract({ effectiveFrom: plusDays(10), rows: [rowFor({ rate: 25 })] }));
      assert.equal(r2.status, 201, JSON.stringify(r2.body));
      const list = await request(app).get('/api/contracts').set(at(emp)).query({ client: clientCode });
      assert.equal(list.body.length, 2);
      v2 = list.body[0]; v1 = list.body[1];                                                                  // newest first
      assert.match(v1.entRef, /^RMEC-\d+$/);
      assert.deepEqual([v1.charges.halting, v1.charges.ocr, v1.originName, v1.destinationName], [150, 40, 'DELHI', 'PUNE']);
      assert.equal((await rateOn(today)).body.rate, 20);
      assert.equal((await rateOn(plusDays(10))).body.rate, 25);
      const billing = await request(app).get('/api/dockets/lookup/billing-at').set(at(emp))
        .query({ onAccountOf: `TST RATE CLIENT:${clientCode}`, destination: 'PUNE', bookingMode: 'RD' });
      assert.deepEqual(billing.body.map((b) => b.code), ['B1001']);
    });

    test('update: amounts change, the end date only extends, a deactivated version drops out of the lookup', async () => {
      const put = (id, b) => request(app).put(`/api/contracts/CITY/${id}`).set(at(emp)).send(b);
      const base = { rate: 22, minWeight: 10, minFreight: 300, expectedDays: 2, charges: { fuelPercent: 12 }, endDate: '2027-03-31' };
      assert.equal((await put(v1.id, { ...base, endDate: '2026-12-31' })).status, 400);                   // shortening
      assert.equal((await put(v1.id, base)).status, 200);
      assert.equal((await rateOn(today)).body.rate, 22);
      assert.equal((await put(v2.id, { ...base, rate: 25, active: false })).status, 200);
      assert.equal((await rateOn(plusDays(10))).body.rate, 22);                                            // back to version 1
      const expiring = await request(app).get('/api/contracts').set(at(emp)).query({ client: clientCode, expiringInDays: 366 });
      assert.deepEqual(expiring.body.map((c) => c.id), [v1.id]);
    });

    test('state / zone / location contracts: the most specific match wins in the docket lookup', async () => {
      const lookup = (destination, extra = {}) => request(app).get('/api/dockets/lookup/rate').set(at(emp)).query({
        onAccountOf: `TST RATE CLIENT:${clientCode}`, destination, bookingMode: 'RD', rateOn: 'WEIGHT',
        customerType: 'Contractual Client', bookingType: 'Paid', bookingDate: today, deliveryMode: 'DM-101', ...extra,
      });
      const add = (type, origin, destination, rate) => request(app).post('/api/contracts').set(at(emp))
        .send(contract({ type, rows: [rowFor({ origin, destination, rate })] }));
      assert.equal((await add('STATE', 'DL', 'XX', 30)).status, 400);                       // unknown state
      const st = await add('STATE', 'DL', 'MH', 30);
      assert.equal(st.status, 201, JSON.stringify(st.body));
      assert.match(st.body.refs[0], /^RMES-\d+$/);
      assert.equal((await add('ZONE', 'NZ', 'WZ', 35)).status, 201);
      assert.equal((await add('ZONE', 'NZ', 'EZ', 40)).status, 201);
      const loc = await add('LOCATION', 'L001', 'L003', 50);
      assert.equal(loc.status, 201, JSON.stringify(loc.body));
      assert.match(loc.body.refs[0], /^RMEL-\d+$/);
      assert.equal((await lookup('MUMBAI')).body.rate, 30);                                  // state beats zone
      assert.equal((await lookup('PUNE')).body.rate, 22);                                    // city beats state (Pune is in MH)
      assert.equal((await lookup('KOLKATA')).body.rate, 40);                                 // only a zone rate
      assert.equal((await lookup('MUMBAI', { originLocation: 'L001', destinationLocation: 'L003' })).body.rate, 50);
      const list = await request(app).get('/api/contracts').set(at(emp)).query({ client: clientCode });
      assert.deepEqual([...new Set(list.body.map((c) => c.type))], ['CITY', 'LOCATION', 'STATE', 'ZONE']);
      const zone = list.body.find((c) => c.type === 'ZONE' && c.destination === 'EZ');
      assert.equal(zone.destinationName, 'EAST ZONE');
      const upd = await request(app).put(`/api/contracts/ZONE/${zone.id}`).set(at(emp))
        .send({ rate: 41, minWeight: 10, minFreight: 300, charges: {}, endDate: '2027-03-31' });
      assert.equal(upd.status, 200, JSON.stringify(upd.body));
      assert.equal((await lookup('KOLKATA')).body.rate, 41);
    });

    test('weight slabs: saved with the rate, the docket lookup takes the band holding the weight', async () => {
      const lookup = (weight) => request(app).get('/api/dockets/lookup/rate').set(at(emp)).query({
        onAccountOf: `TST RATE CLIENT:${clientCode}`, destination: 'KOLKATA', bookingMode: 'RD', rateOn: 'WEIGHT',
        customerType: 'Contractual Client', bookingType: 'Paid', bookingDate: today, deliveryMode: 'DM-101', ...(weight ? { weight } : {}),
      });
      const list = await request(app).get('/api/contracts').set(at(emp)).query({ client: clientCode, type: 'ZONE' });
      const zone = list.body.find((c) => c.destination === 'EZ');
      const put = (b) => request(app).put(`/api/contracts/ZONE/${zone.id}`).set(at(emp))
        .send({ rate: 41, minWeight: 10, minFreight: 300, charges: {}, endDate: '2027-03-31', ...b });
      const bands = [
        { from: 10.01, to: 50, rate: 45 },
        { from: 0, to: 10, rate: 50, discount: 5, approvedDiscount: 3 },
      ];
      // validation: overlapping bands, "to" not above "from", more than 10 bands
      assert.equal((await put({ slabs: [{ from: 0, to: 10, rate: 50 }, { from: 10, to: 20, rate: 45 }] })).status, 400);
      assert.equal((await put({ slabs: [{ from: 5, to: 5, rate: 50 }] })).status, 400);
      assert.equal((await put({ slabs: Array.from({ length: 11 }, (_, i) => ({ from: i * 10, to: i * 10 + 9, rate: 5 })) })).status, 400);
      const saved = await put({ slabs: bands });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));

      const one = await request(app).get(`/api/contracts/ZONE/${zone.id}`).set(at(emp));
      assert.deepEqual(one.body.slabs.map((b) => [b.from, b.to, b.rate, b.approvedDiscount]), [[0, 10, 50, 3], [10.01, 50, 45, 0]]);
      assert.equal((await request(app).get('/api/contracts').set(at(emp)).query({ client: clientCode, type: 'ZONE' })).body
        .find((c) => c.id === zone.id).hasSlabs, true);

      const light = await lookup(8);
      assert.deepEqual([light.body.rate, light.body.slabRate, light.body.discountPercent, light.body.flatRate], [50, true, 3, 41]);
      assert.equal((await lookup(20)).body.rate, 45);
      const heavy = await lookup(100);                                                          // no band: the flat rate
      assert.deepEqual([heavy.body.rate, heavy.body.slabRate], [41, false]);
      assert.equal((await lookup()).body.rate, 41);                                             // no weight given

      // an update without `slabs` keeps them; the slab status follows the contract row
      assert.equal((await put({ rate: 42 })).status, 200);
      assert.equal((await lookup(8)).body.rate, 50);
      assert.equal((await put({ active: false })).status, 200);
      const [st] = await query('select Status from ClientRate_With_Slab where EntRef = @e', { e: zone.entRef });
      assert.equal(st.Status, 'Deactive');
      assert.equal((await put({ active: true, slabs: [] })).status, 200);                       // slabs removed
      assert.equal((await query('select count(*) as c from ClientRate_With_Slab where EntRef = @e', { e: zone.entRef }))[0].c, 0);
      assert.equal((await lookup(8)).body.rate, 41);

      // a new rate saved with slabs in one go
      const created = await request(app).post('/api/contracts').set(at(emp)).send(contract({
        type: 'ZONE', effectiveFrom: plusDays(3), rows: [rowFor({ origin: 'NZ', destination: 'EZ', rate: 43, slabs: [{ from: 0, to: 25, rate: 60 }] })],
      }));
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const [slab] = await query('select Rate1, WeightTo1, Rate2, Status from ClientRate_With_Slab where EntRef = @e', { e: created.body.refs[0] });
      assert.deepEqual([Number(slab.Rate1), Number(slab.WeightTo1), slab.Rate2, slab.Status], [60, 25, null, 'Active']);
      assert.equal((await lookup(8)).body.rate, 41);                                            // not in force until its date
    });

    test('category slabs: product + package size + weight pick the docket rate', async () => {
      const opts = await request(app).get('/api/contracts/options').set(at(emp));
      assert.ok(opts.body.rateOn.some((r) => r.value === 'CATEGORY'));
      assert.ok(opts.body.items.some((i) => i.value === 'BOX'));
      const catRow = (categorySlabs, extra = {}) => rowFor({ rateOn: 'CATEGORY', rate: 100, categorySlabs, ...extra });
      const post = (row) => request(app).post('/api/contracts').set(at(emp)).send(contract({ rows: [row] }));
      assert.equal((await post(catRow([]))).status, 400);                                                 // slabs required
      assert.equal((await post(catRow([{ itemCode: 'NOPE', from: 0, to: 10, big: 5 }]))).status, 400);     // unknown product
      assert.equal((await post(catRow([{ itemCode: 'BOX', from: 0, to: 10 }]))).status, 400);             // no rate at all
      assert.equal((await post(catRow([{ itemCode: 'BOX', from: 0, to: 10, big: 5 }, { itemCode: 'BOX', from: 10, to: 20, big: 6 }]))).status, 400);
      assert.equal((await post(rowFor({ categorySlabs: [{ itemCode: 'BOX', from: 0, to: 10, big: 5 }] }))).status, 400); // not a CATEGORY rate
      const saved = await post(catRow([
        { itemCode: 'BOX', from: 0, to: 10, big: 500, medium: 300, small: 200 },
        { itemCode: 'BOX', from: 10.01, to: 50, big: 900 },
        { itemCode: 'CTN', from: 0, to: 10, big: 700 },                                                   // same weights, another product
      ]));
      assert.equal(saved.status, 201, JSON.stringify(saved.body));

      const lookup = (extra) => request(app).get('/api/dockets/lookup/rate').set(at(emp)).query({
        onAccountOf: `TST RATE CLIENT:${clientCode}`, destination: 'PUNE', bookingMode: 'RD', rateOn: 'CATEGORY',
        customerType: 'Contractual Client', bookingType: 'Paid', bookingDate: today, deliveryMode: 'DM-101', ...extra,
      });
      const medium = await lookup({ itemCode: 'BOX', pkgSize: 'MEDIUM', weight: 5 });
      assert.equal(medium.status, 200, JSON.stringify(medium.body));
      assert.deepEqual([medium.body.rate, medium.body.slabRate, medium.body.rateOn, medium.body.flatRate], [300, true, 'CATEGORY', 100]);
      assert.equal((await lookup({ itemCode: 'BOX', pkgSize: 'SMALL', weight: 5 })).body.rate, 200);
      assert.equal((await lookup({ itemCode: 'BOX', pkgSize: 'BIG', weight: 20 })).body.rate, 900);
      assert.equal((await lookup({ itemCode: 'CTN', pkgSize: 'BIG', weight: 5 })).body.rate, 700);
      const noMedium = await lookup({ itemCode: 'BOX', pkgSize: 'MEDIUM', weight: 20 });                // no medium rate in that band
      assert.deepEqual([noMedium.body.rate, noMedium.body.slabRate], [100, false]);
      assert.equal((await lookup({})).body.rate, 100);                                                    // no package details

      const list = await request(app).get('/api/contracts').set(at(emp)).query({ client: clientCode, type: 'CITY' });
      const cat = list.body.find((c) => c.rateOn === 'CATEGORY');
      assert.equal(cat.hasSlabs, true);
      const one = await request(app).get(`/api/contracts/CITY/${cat.id}`).set(at(emp));
      assert.deepEqual(one.body.categorySlabs.map((b) => [b.itemCode, b.from, b.to, b.big, b.medium, b.small]),
        [['BOX', 0, 10, 500, 300, 200], ['BOX', 10.01, 50, 900, 0, 0], ['CTN', 0, 10, 700, 0, 0]]);
      const put = (b) => request(app).put(`/api/contracts/CITY/${cat.id}`).set(at(emp))
        .send({ rate: 100, minWeight: 10, minFreight: 300, charges: {}, endDate: '2027-03-31', ...b });
      assert.equal((await put({ categorySlabs: [] })).status, 400);                                     // cannot remove them all
      assert.equal((await put({ categorySlabs: [{ itemCode: 'BOX', from: 0, to: 10, big: 500, medium: 350, small: 200 }] })).status, 200);
      assert.equal((await lookup({ itemCode: 'BOX', pkgSize: 'MEDIUM', weight: 5 })).body.rate, 350);
      assert.equal((await lookup({ itemCode: 'CTN', pkgSize: 'BIG', weight: 5 })).body.rate, 100);      // CTN band gone
      assert.equal((await put({ active: false })).status, 200);
      const [st] = await query('select Status from ClientRate_Category_Slab where EntRef = @e', { e: cat.entRef });
      assert.equal(st.Status, 'Deactive');
    });

    test('pickup / delivery charge slabs: the docket collection / delivery charge by charge weight', async () => {
      const put = (id, b) => request(app).put(`/api/contracts/CITY/${id}`).set(at(emp))
        .send({ rate: 22, minWeight: 10, minFreight: 300, expectedDays: 2, charges: { fuelPercent: 12, collection: 40 }, endDate: '2027-03-31', ...b });
      const lookup = (weight) => request(app).get('/api/dockets/lookup/rate').set(at(emp)).query({
        onAccountOf: `TST RATE CLIENT:${clientCode}`, destination: 'PUNE', bookingMode: 'RD', rateOn: 'WEIGHT',
        customerType: 'Contractual Client', bookingType: 'Paid', bookingDate: today, deliveryMode: 'DM-101', weight,
      });
      // validation: overlapping bands, not City To City, a delivery mode without pickup / delivery
      assert.equal((await put(v1.id, { chargeSlabs: { pickup: [{ from: 0, to: 10, amount: 1 }, { from: 10, to: 20, amount: 2 }] } })).status, 400);
      const zone = (await request(app).get('/api/contracts').set(at(emp)).query({ client: clientCode, type: 'ZONE' })).body[0];
      assert.equal((await request(app).put(`/api/contracts/ZONE/${zone.id}`).set(at(emp))
        .send({ rate: 41, charges: {}, endDate: '2027-03-31', chargeSlabs: { pickup: [{ from: 0, to: 10, amount: 1 }] } })).status, 400);
      const godown = await request(app).post('/api/contracts').set(at(emp)).send(contract({
        rows: [rowFor({ destination: 'BOM', deliveryMode: 'DM-102', chargeSlabs: { delivery: [{ from: 0, to: 10, amount: 90 }] } })],
      }));
      assert.equal(godown.status, 400);

      const saved = await put(v1.id, { chargeSlabs: {
        pickup: [{ from: 10.01, to: 100, amount: 250 }, { from: 0, to: 10, amount: 150 }],
        delivery: [{ from: 0, to: 50, amount: 120 }],
      } });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      const light = await lookup(5);
      assert.deepEqual([light.body.charges.collection, light.body.charges.delivery, light.body.chargeSlab], [150, 120, { collection: 150, delivery: 120 }]);
      assert.equal((await lookup(20)).body.charges.collection, 250);
      const heavy = await lookup(500);                                                          // no band: the contract's own charge
      assert.deepEqual([heavy.body.charges.collection, heavy.body.chargeSlab], [40, { collection: null, delivery: null }]);

      // they belong to the route: the other version shows them too
      const other = await request(app).get(`/api/contracts/CITY/${v2.id}`).set(at(emp));
      assert.deepEqual(other.body.chargeSlabs, { pickup: [{ from: 0, to: 10, amount: 150 }, { from: 10.01, to: 100, amount: 250 }], delivery: [{ from: 0, to: 50, amount: 120 }] });
      const list = await request(app).get('/api/contracts').set(at(emp)).query({ client: clientCode, type: 'CITY' });
      assert.equal(list.body.find((c) => c.id === v1.id).hasChargeSlabs, true);

      // removing the pickup slabs keeps the delivery ones; the older set is switched off, not lost
      assert.equal((await put(v1.id, { chargeSlabs: { pickup: [] } })).status, 200);
      const after = await lookup(5);
      assert.deepEqual([after.body.charges.collection, after.body.charges.delivery], [40, 120]);
      const [cnt] = await query("select count(*) as c from Min_chargeRate_slab where client_code = @c and Rate_type = 'PICKUP' and isactive = 0", { c: clientCode });
      assert.equal(cnt.c, 2);
    });

    test('Paid / To Pay general rates: no client, a General Client docket takes the one of its booking type', async () => {
      // tagged with notification days 999 so the clean-up finds them (they have no TST client)
      const general = (rateType, rows, extra = {}) => request(app).post('/api/contracts').set(at(emp))
        .send({ rateType, startDate: '2025-04-01', endDate: '2027-03-31', effectiveFrom: today, notificationDays: '999', rows, ...extra });
      const paid = await general('Paid', [rowFor({ rate: 30 })]);
      assert.equal(paid.status, 201, JSON.stringify(paid.body));
      assert.match(paid.body.message, /Paid \(general\)/);
      assert.equal((await general('To Pay', [rowFor({ rate: 35, charges: { topay: 50 } })])).status, 201);
      assert.equal((await general('Paid', [rowFor({ rate: 31 })])).status, 409);                     // same Paid rate, same date
      assert.equal((await general('Paid', [rowFor({ docType: '1', rate: 5 })], { effectiveFrom: plusDays(1) })).status, 400); // DIV1001 doc: slabs
      assert.equal((await general('Paid', [rowFor({ docType: '1', rate: 5, slabs: [{ from: 0, to: 1, rate: 40 }] })], { effectiveFrom: plusDays(1) })).status, 201);
      assert.equal((await general('Paid', [rowFor({ chargeSlabs: { pickup: [{ from: 0, to: 10, amount: 50 }] } })], { effectiveFrom: plusDays(2) })).status, 400);
      assert.equal((await request(app).post('/api/contracts').set(at(emp)).send(contract({ client: '' }))).status, 400); // Credit needs the client

      const saved = await query("select RateType, BookingType, client_code, billingat from client_contract_city where EntRef = @e", { e: paid.body.refs[0] });
      assert.deepEqual([saved[0].RateType, saved[0].BookingType, saved[0].client_code, saved[0].billingat], ['Paid', 'Paid', '', '']);
      const list = await request(app).get('/api/contracts').set(at(emp)).query({ rateType: 'Paid', type: 'CITY' });
      assert.ok(list.body.some((c) => c.entRef === paid.body.refs[0] && c.rateType === 'Paid' && c.clientCode === ''));
      assert.ok(list.body.every((c) => c.rateType === 'Paid'));

      const lookup = (customerType, bookingType, extra = {}) => request(app).get('/api/dockets/lookup/rate').set(at(emp)).query({
        destination: 'PUNE', bookingMode: 'RD', rateOn: 'WEIGHT', customerType, bookingType, bookingDate: today, deliveryMode: 'DM-101', ...extra,
      });
      const g1 = await lookup('General Client', 'Paid');
      assert.equal(g1.status, 200, JSON.stringify(g1.body));
      assert.equal(g1.body.rate, 30);
      const g2 = await lookup('General Client', 'To Pay');
      assert.deepEqual([g2.body.rate, g2.body.charges.topay], [35, 50]);
      assert.equal((await lookup('General Client', 'FOC')).body, null);                              // no FOC general rate
      assert.equal((await lookup('Contractual Client', 'Paid', { onAccountOf: `TST RATE CLIENT:${clientCode}` })).body.rate, 22); // own contract
      assert.equal((await lookup('Contractual Client', 'Paid')).body, null);                         // contractual without a client
    });

    test('KM rates: per-km rate x distance, not in DIV1001 or on City To City', async () => {
      const cargo = await login({ username: 'admin', password: 'admin123', divCode: 'DIV1002' });
      assert.ok((await request(app).get('/api/contracts/options').set(at(cargo))).body.rateOn.some((r) => r.value === 'KM'));
      assert.ok(!(await request(app).get('/api/contracts/options').set(at(emp))).body.rateOn.some((r) => r.value === 'KM'));
      const km = (type, row, tok = cargo) => request(app).post('/api/contracts').set(at(tok)).send({
        type, rateType: 'Paid', startDate: '2025-04-01', endDate: '2027-03-31', effectiveFrom: today, notificationDays: '999',
        rows: [{ origin: 'DL', destination: 'MH', mode: 'RD', deliveryMode: 'DM-101', rateOn: 'KM', rate: 25, distance: 1400, charges: {}, ...row }],
      });
      assert.equal((await km('STATE', {}, emp)).status, 400);                                       // DIV1001: no KM
      assert.equal((await km('CITY', { origin: 'DEL', destination: 'PNQ' })).status, 400);          // not City To City
      assert.equal((await km('STATE', { mode: 'AI' })).status, 400);                                 // road only
      assert.equal((await km('STATE', { docType: '1' })).status, 400);                               // non-document only
      assert.equal((await km('STATE', { distance: 0 })).status, 400);
      const saved = await km('STATE', {});
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
      const [row] = await query('select slno, rate, PerKMRate, totaldistance, Division from client_contract_State where EntRef = @e', { e: saved.body.refs[0] });
      assert.deepEqual([Number(row.rate), Number(row.PerKMRate), Number(row.totaldistance), row.Division], [25, 25, 1400, 'DIV1002']);

      const dist = (type, from, to) => request(app).get('/api/contracts/distance').set(at(cargo)).query({ type, from, to });
      assert.equal((await dist('LOCATION', 'L001', 'L003')).body.distance, 1420);
      assert.equal((await dist('STATE', 'DL', 'MH')).body.distance, null);

      const lookup = () => request(app).get('/api/dockets/lookup/rate').set(at(cargo)).query({
        destination: 'MUMBAI', bookingMode: 'RD', rateOn: 'KM', customerType: 'General Client', bookingType: 'Paid', bookingDate: today,
      });
      const r1 = await lookup();
      assert.equal(r1.status, 200, JSON.stringify(r1.body));
      assert.deepEqual([r1.body.rate, r1.body.distance, r1.body.rateOn], [25, 1400, 'KM']);
      const upd = await request(app).put(`/api/contracts/STATE/${row.slno}`).set(at(cargo))
        .send({ rate: 26, distance: 1500, charges: {}, endDate: '2027-03-31', notificationDays: '999' });   // keeps the clean-up tag
      assert.equal(upd.status, 200, JSON.stringify(upd.body));
      assert.deepEqual([(await lookup()).body.rate, (await lookup()).body.distance], [26, 1500]);
      assert.equal((await request(app).put(`/api/contracts/STATE/${row.slno}`).set(at(cargo))
        .send({ rate: 26, distance: 0, charges: {}, endDate: '2027-03-31' })).status, 400);
    });

    test('CARGO weight rates: km x rate per km per kg + admin %; per-box collection / delivery flags', async () => {
      const cargo = await login({ username: 'admin', password: 'admin123', divCode: 'DIV1002' });
      const post = (row) => request(app).post('/api/contracts').set(at(cargo)).send({
        type: 'CITY', rateType: 'Paid', startDate: '2025-04-01', endDate: '2027-03-31', effectiveFrom: today, notificationDays: '999',
        rows: [{ origin: 'DEL', destination: 'PNQ', mode: 'RD', deliveryMode: 'DM-101', rateOn: 'WEIGHT', charges: {}, ...row }],
      });
      assert.equal((await post({ distance: 1400, rate: 20 })).status, 400);                       // no rate per km per kg
      assert.equal((await post({ perKmPerKg: 0.01 })).status, 400);                               // no distance
      const saved = await post({ distance: 1400, perKmPerKg: 0.01, adminPercent: 10, rate: 99, collectionPerBox: true });
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
      const [row] = await query(
        `select slno, rate, basefrt, admincharge, adminchrgper, perkmperkg_rate, totaldistance, col_charge_IsPerBox, del_charge_IsPerBox
           from client_contract_city where EntRef = @e`, { e: saved.body.refs[0] });
      assert.deepEqual(
        [row.rate, row.basefrt, row.admincharge, row.adminchrgper, row.perkmperkg_rate, row.totaldistance, row.col_charge_IsPerBox, row.del_charge_IsPerBox].map(Number),
        [15.4, 14, 1.4, 10, 0.01, 1400, 1, 0]);                                                   // the typed 99 is ignored
      const one = (await request(app).get(`/api/contracts/CITY/${row.slno}`).set(at(cargo))).body;
      assert.deepEqual([one.perKmPerKg, one.adminPercent, one.baseFreight, one.collectionPerBox, one.deliveryPerBox], [0.01, 10, 14, true, false]);

      const lookup = () => request(app).get('/api/dockets/lookup/rate').set(at(cargo)).query({
        destination: 'PUNE', bookingMode: 'RD', rateOn: 'WEIGHT', customerType: 'General Client', bookingType: 'Paid', bookingDate: today,
      });
      assert.equal((await lookup()).body.rate, 15.4);
      const upd = await request(app).put(`/api/contracts/CITY/${row.slno}`).set(at(cargo)).send({
        distance: 1500, perKmPerKg: 0.01, adminPercent: 10, charges: {}, endDate: '2027-03-31', notificationDays: '999', deliveryPerBox: true,
      });
      assert.equal(upd.status, 200, JSON.stringify(upd.body));
      assert.equal((await lookup()).body.rate, 16.5);
      const after = (await request(app).get(`/api/contracts/CITY/${row.slno}`).set(at(cargo))).body;
      assert.deepEqual([after.rate, after.baseFreight, after.collectionPerBox, after.deliveryPerBox], [16.5, 15, false, true]);
      // DIV1001 weight rates are typed in as before
      const courier = await request(app).post('/api/contracts').set(at(emp)).send({
        type: 'CITY', rateType: 'Paid', startDate: '2025-04-01', endDate: '2027-03-31', effectiveFrom: plusDays(3), notificationDays: '999',
        rows: [{ origin: 'DEL', destination: 'PNQ', mode: 'RD', deliveryMode: 'DM-101', rateOn: 'WEIGHT', rate: 18, distance: 1400, perKmPerKg: 0.01, charges: {} }],
      });
      assert.equal(courier.status, 201, JSON.stringify(courier.body));
      const [c] = await query('select rate, basefrt from client_contract_city where EntRef = @e', { e: courier.body.refs[0] });
      assert.deepEqual([Number(c.rate), Number(c.basefrt)], [18, 0]);
    });

    test('General Rate Master: the standard tariff, and a client rate copies it', async () => {
      const post = (row, extra = {}) => request(app).post('/api/general-rates').set(at(emp)).send({
        type: 'CITY', startDate: '2025-04-01', endDate: '2027-03-31', effectiveFrom: today, notificationDays: '999',
        rows: [{ origin: 'DEL', destination: 'PNQ', mode: 'RD', deliveryMode: 'DM-101', rateOn: 'WEIGHT', rate: 40, minWeight: 5,
          charges: { fuelPercent: 10, fov: 0.2 }, ...row }], ...extra,
      });
      assert.equal((await post({ rateOn: 'CATEGORY', categorySlabs: [{ itemCode: 'BOX', from: 0, to: 10, big: 5 }] })).status, 400);
      assert.equal((await post({ chargeSlabs: { pickup: [{ from: 0, to: 10, amount: 50 }] } })).status, 400);
      assert.equal((await post({ slabs: [{ from: 0, to: 10, rate: 50 }, { from: 5, to: 20, rate: 45 }] })).status, 400); // overlap
      assert.equal((await request(app).post('/api/general-rates').set(at(client)).send({})).status, 403);
      const clientSlabsBefore = (await query('select count(*) as c from ClientRate_With_Slab'))[0].c;
      const saved = await post({ slabs: [{ from: 10.01, to: 50, rate: 36 }, { from: 0, to: 10, rate: 45, discount: 2 }] },
        { client: 'CL001', billingAt: 'B1001', rateType: 'Paid' });                                // no client / billing, Credit
      assert.equal((await query('select count(*) as c from ClientRate_With_Slab'))[0].c, clientSlabsBefore); // own slab table
      const [gs] = await query('select Rate1, WeightTo1, Rate2, Status from General_Rate_With_Slab where EntRef = @e', { e: saved.body.refs?.[0] ?? '' });
      assert.deepEqual([Number(gs.Rate1), Number(gs.WeightTo1), Number(gs.Rate2), gs.Status], [45, 10, 36, 'Active']);
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
      assert.match(saved.body.refs[0], /^RMEC-\d+$/);
      const [row] = await query('select slno, client_code, billingat, RateType from GenaraleRate_Master_City where EntRef = @e and notification_days = \'999\'', { e: saved.body.refs[0] });
      assert.deepEqual([row.client_code, row.billingat, row.RateType], ['', '', 'Credit']);
      assert.equal((await post({})).status, 409);                                                   // same rate, same date

      const list = await request(app).get('/api/general-rates').set(at(emp)).query({ type: 'CITY' });
      assert.ok(list.body.some((r) => r.id === Number(row.slno) && r.rate === 40));
      const upd = await request(app).put(`/api/general-rates/CITY/${row.slno}`).set(at(emp))
        .send({ rate: 42, minWeight: 5, charges: { fuelPercent: 10, fov: 0.2 }, endDate: '2027-03-31', notificationDays: '999' });
      assert.equal(upd.status, 200, JSON.stringify(upd.body));
      assert.equal((await request(app).get(`/api/general-rates/CITY/${row.slno}`).set(at(emp))).body.rate, 42);

      const copy = (q) => request(app).get('/api/contracts/general-rate').set(at(emp)).query({
        type: 'CITY', origin: 'DEL', destination: 'PNQ', mode: 'RD', rateOn: 'WEIGHT', deliveryMode: 'DM-101', ...q,
      });
      const g = await copy({});
      assert.equal(g.status, 200, JSON.stringify(g.body));
      assert.deepEqual([g.body.rate, g.body.minWeight, g.body.charges.fuelPercent, g.body.charges.fov], [42, 5, 10, 0.2]);
      assert.deepEqual(g.body.slabs.map((b) => [b.from, b.to, b.rate, b.discount]), [[0, 10, 45, 2], [10.01, 50, 36, 0]]);
      const one = await request(app).get(`/api/general-rates/CITY/${row.slno}`).set(at(emp));
      assert.equal(one.body.hasSlabs, true);
      // editing the general slabs, and switching the rate off switches its slab off
      assert.equal((await request(app).put(`/api/general-rates/CITY/${row.slno}`).set(at(emp)).send({
        rate: 42, minWeight: 5, charges: { fuelPercent: 10, fov: 0.2 }, endDate: '2027-03-31', notificationDays: '999', active: false,
        slabs: [{ from: 0, to: 25, rate: 44 }],
      })).status, 200);
      const [gs2] = await query('select Rate1, WeightTo1, Rate2, Status from General_Rate_With_Slab where EntRef = @e', { e: saved.body.refs[0] });
      assert.deepEqual([Number(gs2.Rate1), Number(gs2.WeightTo1), gs2.Rate2, gs2.Status], [44, 25, null, 'Deactive']);
      assert.equal((await copy({})).body, null);                                                    // switched off: nothing to copy
      // "Existing Rate": the client's own current rate for the route at its billing branch
      const current = (q) => request(app).get('/api/contracts/current-rate').set(at(emp)).query({
        type: 'CITY', origin: 'DEL', destination: 'PNQ', mode: 'RD', rateOn: 'WEIGHT', deliveryMode: 'DM-101',
        rateType: 'Credit', client: clientCode, billingAt: 'B1001', ...q,
      });
      const cur = await current({});
      assert.equal(cur.status, 200, JSON.stringify(cur.body));
      assert.deepEqual([cur.body.rate, cur.body.clientCode, cur.body.billingAt], [22, clientCode, 'B1001']);
      assert.equal((await current({ billingAt: 'B1002' })).body, null);                            // other billing branch
      assert.equal((await current({ client: '' })).status, 400);                                    // Credit needs the client
      assert.equal((await copy({ rateOn: 'BOX' })).body, null);                                     // nothing for that route
      assert.equal((await copy({ docType: '1' })).body, null);                                      // non-document rate only
    });
  });

  describe('user master (staff logins)', () => {
    let empCode;
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const signIn = (password) => request(app).post('/api/auth/login')
      .send({ username: empCode, password, divCode: 'DIV1001', financialYear: '2025-2026' });

    before(async () => {
      const e = await request(app).post('/api/employees').set(at(emp)).send({
        name: 'tst login person', designation: 'EXE', branch: 'B1002', location: 'L003', department: 'OPS', company: 'RELL',
        divisions: ['DIV1001'], joiningDate: '2025-05-01', effectiveFrom: '2025-05-01', guardianName: 'x', gender: 'Male',
        dob: '1995-01-01', religion: 'Hindu', category: 'General', nationality: 'Indian', bloodGroup: 'A+', mobile: '9811177770',
        email: 'login@example.com', presentAddress: 'andheri', presentCity: 'BOM', permanentAddress: 'andheri', permanentCity: 'BOM',
      });
      assert.equal(e.status, 201, JSON.stringify(e.body));
      empCode = e.body.code;
    });

    test('admin only; the new employee is offered, existing logins are not', async () => {
      assert.equal((await request(app).get('/api/users').set(at(emp))).status, 403);
      const opts = await request(app).get('/api/users/options').set(at(admin));
      assert.equal(opts.status, 200);
      assert.ok(opts.body.employees.some((e) => e.value === empCode));
      assert.ok(!opts.body.employees.some((e) => e.value === 'EMP001'));
    });

    test('create: validation, then the employee can sign in at the home branch', async () => {
      const post = (b) => request(app).post('/api/users').set(at(admin)).send(b);
      assert.equal((await post({ employee: empCode, password: '123', homeBranch: '2' })).status, 400);        // too short
      assert.equal((await post({ employee: 'EMP001', password: 'secret1', homeBranch: '1' })).status, 409);   // has a login
      assert.equal((await post({ employee: empCode, password: 'secret1', homeBranch: '99' })).status, 400);   // unknown branch
      const res = await post({ employee: empCode, password: 'secret1', homeBranch: '2', branches: ['1', '2'] });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const [row] = await query('select user_branch from users where user_id = @u', { u: empCode });
      assert.equal(row.user_branch, '2,1');                                                                  // home branch first
      const login = await signIn('secret1');
      assert.equal(login.status, 200, JSON.stringify(login.body));
      assert.equal(login.body.user.currentBranch.code, 'B1002');
      const one = await request(app).get(`/api/users/${empCode}`).set(at(admin));
      assert.equal(one.body.homeBranch, 'MUMBAI');
      assert.ok(!('password' in one.body) && !JSON.stringify(one.body).includes('secret1'), 'password never returned');
    });

    test('update: new password, inactive login is refused', async () => {
      const put = (b) => request(app).put(`/api/users/${empCode}`).set(at(admin)).send(b);
      assert.equal((await put({ homeBranch: '2', branches: ['2'], active: true, password: 'newpass9' })).status, 200);
      assert.equal((await signIn('secret1')).status, 401);
      assert.equal((await signIn('newpass9')).status, 200);
      assert.equal((await put({ homeBranch: '2', branches: ['2'], active: false })).status, 200);            // blank password = keep
      const refused = await signIn('newpass9');
      assert.equal(refused.status, 403);
      assert.match(refused.body.error, /inactive/);
      const list = await request(app).get('/api/users').set(at(admin)).query({ status: 'inactive' });
      assert.ok(list.body.some((u) => u.userId === empCode));
    });

    test('delete: the login goes, the employee stays; admin cannot be deleted', async () => {
      assert.equal((await request(app).delete('/api/users/admin').set(at(admin))).status, 400);
      const res = await request(app).delete(`/api/users/${empCode}`).set(at(admin));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal((await signIn('newpass9')).status, 401);
      assert.equal((await query('select count(*) as c from employee_master where empcode = @e', { e: empCode }))[0].c, 1);
    });
  });

  describe('ODA charge', () => {
    // test rows carry distance 777 so the clean-up finds them
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    // tomorrow in LOCAL time (the server compares with its local date; the UTC date is a day behind after midnight IST)
    const tomorrow = (() => { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    const charges = { upTo100: 100, upTo200: 150, upTo300: 200, upTo400: 250, upTo500: 300, upTo1000: 500, above1000: 800 };
    const post = (b, tok = emp) => request(app).post('/api/oda-charges').set(at(tok)).send({
      branch: 'B1001', city: 'DEL', location: 'L001', distance: 777, charges, effectiveDate: tomorrow, ...b,
    });
    const oda = (weight) => request(app).get('/api/dockets/lookup/oda').set(at(emp)).query({ location: 'L001', weight });

    test('pickers: branch → city → location', async () => {
      const cities = await request(app).get('/api/oda-charges/cities').set(at(emp)).query({ branch: 'B1001' });
      assert.ok(cities.body.some((c) => c.value === 'DEL'));
      const locs = await request(app).get('/api/oda-charges/locations').set(at(emp)).query({ city: 'DEL' });
      assert.deepEqual(locs.body.map((l) => l.value).sort(), ['L001', 'L002']);
      const odaLocs = await request(app).get('/api/dockets/lookup/oda-locations').set(at(emp)).query({ city: 'MUMBAI' });
      assert.deepEqual(odaLocs.body.map((l) => l.code).sort(), ['L003', 'L004']);
    });

    test('create: validation, version, docket lookup by weight band, switching off', async () => {
      assert.equal((await post({ effectiveDate: today })).status, 400);                    // must be after today
      assert.equal((await post({ location: 'L003' })).status, 400);                        // L003 is in Mumbai, not Delhi
      assert.equal((await post({ city: 'BOM', location: 'L003' })).status, 400);           // Mumbai is not served by B1001
      assert.equal((await post({}, client)).status, 403);
      const saved = await post({});
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
      assert.match(saved.body.code, /^ODC\d{4,}$/);
      assert.equal((await post({})).status, 409);                                          // same location and date

      const list = await request(app).get('/api/oda-charges').set(at(emp)).query({ location: 'L001' });
      const row = list.body.find((r) => r.id === saved.body.id);
      assert.deepEqual([row.upcoming, row.inForce, row.zone, row.charges.upTo200], [true, false, 'NZ', 150]);
      assert.equal((await oda(150)).body.charge, null);                                   // not in force before its date

      // bring it into force (effective dates cannot be set in the past through the API)
      await query('update ODA_Charge set Effective_Date = cast(getdate() as date) where ID = @id', { id: saved.body.id });
      assert.deepEqual([(await oda(50)).body.charge, (await oda(150)).body.charge, (await oda(1000)).body.charge, (await oda(1500)).body.charge], [100, 150, 500, 800]);
      assert.equal((await request(app).get('/api/oda-charges').set(at(emp)).query({ location: 'L001' })).body.find((r) => r.id === saved.body.id).inForce, true);

      const off = await request(app).patch(`/api/oda-charges/${saved.body.id}/status`).set(at(emp)).send({ active: false });
      assert.equal(off.status, 200, JSON.stringify(off.body));
      assert.equal((await oda(150)).body.charge, null);
    });
  });

  describe('PRS / DRS rate master', () => {
    // test rows carry 777 as their main amount (Fix_Km_Rate or Per_Kg) so the clean-up finds them
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0);
    const fyEnd = `${y + 1}-03-31`;
    let fyEmp;
    const post = (b, tok = fyEmp) => request(app).post('/api/prs-drs-rates').set(at(tok)).send({
      vendorType: 'VENDOR', vendor: 'V001', rateOn: 'Per Km', ftlType: 'PARCEL', fixKmRate: 777, effectiveDate: fyEnd, ...b,
    });

    before(async () => { fyEmp = await fyLogin(); });

    test('pickers: vendors by type, FTL types', async () => {
      const opts = await request(app).get('/api/prs-drs-rates/options').set(at(fyEmp));
      assert.ok(opts.body.ftlTypes.some((f) => f.value === 'PARCEL'));
      const v = await request(app).get('/api/prs-drs-rates/vendors').set(at(fyEmp)).query({ type: 'VENDOR' });
      assert.ok(v.body.some((x) => x.value === 'V001') && !v.body.some((x) => x.value === 'V002'));
      const self = await request(app).get('/api/prs-drs-rates/vendors').set(at(fyEmp)).query({ type: 'SELF' });
      assert.ok(self.body.some((x) => x.value === 'V002'));
    });

    test('create: per rate-on fields, FY / past date, duplicate, list', async () => {
      assert.equal((await post({ effectiveDate: '2020-01-01' })).status, 400);             // outside the FY
      assert.equal((await post({}, emp)).status, 400);                                     // FY 2025-2026 is over
      assert.equal((await post({ vendor: 'V002' })).status, 400);                          // V002 is a Self vehicle
      assert.equal((await post({ ftlType: 'NOPE' })).status, 400);
      assert.equal((await post({ rateOn: 'Per Kg', fixKmRate: 0 })).status, 400);          // per kg needs its rate
      assert.equal((await post({}, client)).status, 403);

      const km = await post({ fixKm: 50, extraKmRate: 9, perKg: 4 });
      assert.equal(km.status, 201, JSON.stringify(km.body));
      assert.equal((await post({})).status, 409);                                          // same vendor, rate on, FTL, date
      const kg = await post({ rateOn: 'Per Kg', fixKmRate: 5, perKg: 777 });
      assert.equal(kg.status, 201, JSON.stringify(kg.body));
      const rt = await post({ rateOn: 'Round Trip', vendorType: 'SELF', vendor: 'V002', fixKm: 100, extraKmRate: 12 });
      assert.equal(rt.status, 201, JSON.stringify(rt.body));

      const one = async (id) => (await request(app).get(`/api/prs-drs-rates/${id}`).set(at(fyEmp))).body;
      const [a, b, c] = [await one(km.body.id), await one(kg.body.id), await one(rt.body.id)];
      assert.deepEqual([a.fixKm, a.fixKmRate, a.extraKmRate, a.perKg], [0, 777, 0, 0]);   // unused fields forced to 0
      assert.deepEqual([b.fixKm, b.fixKmRate, b.extraKmRate, b.perKg], [0, 0, 0, 777]);
      assert.deepEqual([c.vendorType, c.fixKm, c.fixKmRate, c.extraKmRate, c.perKg], ['Self', 100, 777, 12, 0]);

      const prev = await request(app).get('/api/prs-drs-rates/previous-date').set(at(fyEmp)).query({ vendor: 'V001', rateOn: 'Per Kg' });
      assert.equal(prev.body.previousEffectiveDate >= fyEnd, true);
      const list = await request(app).get('/api/prs-drs-rates').set(at(fyEmp)).query({ vendorType: 'VENDOR' });
      const row = list.body.find((r) => r.id === km.body.id);
      assert.equal(row.vendorName, 'SHARMA ROADWAYS');
      assert.equal(row.upcoming || row.inForce, true);
      assert.ok(!list.body.some((r) => r.id === rt.body.id));                              // Self rows filtered out
    });
  });

  describe('Settings', () => {
    const at = (tok) => ({ Authorization: `Bearer ${tok}` });
    const api = (method, url, body, tok = emp) => request(app)[method](url).set(at(tok)).send(body);
    const y = Number(today.slice(0, 4)) - (today.slice(5, 7) < '04' ? 1 : 0);
    let fyEmp;
    before(async () => {
      fyEmp = await fyLogin();
      await query("insert into client_Master(client_code, company_name, client_name, is_Active, DivCode) values ('TS991', 'TST BIND CLIENT', 'TST BIND CLIENT', 1, 'DIV1001')");
    });

    test('destinations: only the division flag changes, own city stays bound, restore', async () => {
      const get = async () => (await api('get', '/api/bindings/destinations?branch=B1002&state=MH')).body;
      const before = await get();
      assert.ok(before.cities.length, JSON.stringify(before));
      const pune = before.cities.find((c) => !c.ownCity);
      const own = before.cities.find((c) => c.ownCity);
      const save = (cities) => api('put', '/api/bindings/destinations', { branch: 'B1002', state: 'MH', cities });
      const res = await save(before.cities.map((c) => ({ ...c, courier: c.city === pune.city ? true : c.courier, ftl: true, bound: false })));
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const after = await get();
      const p = after.cities.find((c) => c.city === pune.city);
      assert.deepEqual([p.bound, p.courier, p.ftl], [true, true, pune.ftl]);                   // FTL belongs to DIV1003
      if (own) assert.equal(after.cities.find((c) => c.city === own.city).bound, true);
      assert.equal((await api('put', '/api/bindings/destinations', { branch: 'B1002', state: 'MH', cities: [] }, client)).status, 403);
      // restore what was there
      await query("delete bf from Branch_bind_For_city bf join city_master c on c.city_code = bf.city_code where bf.BindTo = 'B1002' and c.state_code = 'MH'");
      for (const c of before.cities.filter((x) => x.bound)) {
        await query('insert into Branch_bind_For_city(state_code, city_code, BindTo, IsCourier, IsParcel, IsFTL, active_flag) values (\'MH\', @c, \'B1002\', @co, @pa, @ft, 1)',
          { c: c.city, co: c.courier ? 1 : 0, pa: c.parcel ? 1 : 0, ft: c.ftl ? 1 : 0 });
      }
    });

    test('franchisee ↔ branch and ↔ client', async () => {
      const list = (await api('get', '/api/bindings/franchisee-branch')).body;
      const row = list.find((r) => r.branch === 'B1003');
      assert.ok(row, JSON.stringify(list));
      assert.equal((await api('post', '/api/bindings/franchisee-branch', { type: 1, franchisee: 'FRS1001', branch: 'B1003' })).status, 409);  // already bound
      assert.equal((await api('patch', `/api/bindings/franchisee-branch/${row.id}/status`, { active: false })).status, 200);
      assert.deepEqual((await api('get', '/api/bindings/franchisee-branches?type=1&franchisee=FRS1001')).body.map((b) => b.value), ['B1003']);
      assert.equal((await api('patch', `/api/bindings/franchisee-branch/${row.id}/status`, { active: true })).status, 200);

      const fr = (await api('get', '/api/bindings/franchisee-list')).body[0].value;
      assert.equal((await api('post', '/api/bindings/franchisee-client', { franchisee: fr, clients: [] })).status, 400);
      const bound = await api('post', '/api/bindings/franchisee-client', { franchisee: fr, clients: ['TS991'] });
      assert.equal(bound.status, 201, JSON.stringify(bound.body));
      assert.equal((await api('post', '/api/bindings/franchisee-client', { franchisee: fr, clients: ['TS991'] })).status, 409);
      const view = (await api('get', '/api/bindings/franchisee-client?search=TST')).body;
      const b = view.find((v) => v.client === 'TS991');
      assert.equal(b.active, true);
      assert.equal((await api('patch', `/api/bindings/franchisee-client/${b.id}/status`, { active: false })).status, 200);
      assert.equal((await api('post', '/api/bindings/franchisee-client', { franchisee: fr, clients: ['TS991'] })).status, 201);
      assert.equal((await api('patch', `/api/bindings/franchisee-client/${b.id}/status`, { active: true })).status, 409);  // bound again elsewhere
    });

    test('docket FY: previous-year docket moves to the login year', async () => {
      await query(`update grn_master set booking_date = '${y}-03-15', Financial_Year = '${y - 1}-${y}' where docket_no = 'T0001'`);
      const p = (await api('get', '/api/docket-fy/pending?stage=bill', null, fyEmp)).body;
      assert.ok(p.dockets.some((d) => d.docketNo === 'T0001'), JSON.stringify(p));
      assert.equal((await api('post', '/api/docket-fy/move', { stage: 'bill', dockets: ['NOPE'] }, fyEmp)).status, 400);
      const m = await api('post', '/api/docket-fy/move', { stage: 'bill', dockets: ['T0001'] }, fyEmp);
      assert.equal(m.status, 200, JSON.stringify(m.body));
      const [g] = await query("select Financial_Year, Old_Financial_Year from grn_master where docket_no = 'T0001'");
      assert.deepEqual([g.Financial_Year, g.Old_Financial_Year], [`${y}-${y + 1}`, `${y - 1}-${y}`]);
      await query(`update grn_master set booking_date = cast(getdate() as date) where docket_no = 'T0001'`);
    });

    test('effective date change: PRS / DRS rate, client rate listing', async () => {
      const saved = await api('post', '/api/prs-drs-rates', { vendorType: 'VENDOR', vendor: 'V001', rateOn: 'Per Km', ftlType: 'PARCEL', fixKmRate: 777, effectiveDate: `${y + 1}-03-30` }, fyEmp);
      assert.equal(saved.status, 201, JSON.stringify(saved.body));
      const rates = (await api('get', '/api/effective-dates/vendor-rates?vendor=V001&scope=all', null, fyEmp)).body;
      assert.ok(rates.some((r) => r.id === saved.body.id));
      assert.equal((await api('put', '/api/effective-dates/vendor-rates', { ids: [saved.body.id], effectiveDate: '2019-01-01' }, fyEmp)).status, 400);
      const ch = await api('put', '/api/effective-dates/vendor-rates', { ids: [saved.body.id], effectiveDate: `${y + 1}-03-29` }, fyEmp);
      assert.equal(ch.status, 200, JSON.stringify(ch.body));
      assert.equal((await api('get', `/api/prs-drs-rates/${saved.body.id}`, null, fyEmp)).body.effectiveDate, `${y + 1}-03-29`);
      assert.equal((await api('get', '/api/effective-dates/client-rates?rateType=Credit')).status, 400);          // client needed
      assert.equal((await api('get', '/api/effective-dates/client-rates?rateType=Paid&scope=all')).status, 200);
      await query('delete from PRS_DRS_RATE_MASTER where Slno = @id', { id: saved.body.id });
    });

    test('ODA bands and configuration', async () => {
      const d1 = await api('post', '/api/oda-config/bands/distance', { from: 90000, to: 90010 });
      assert.equal(d1.status, 201, JSON.stringify(d1.body));
      assert.equal((await api('post', '/api/oda-config/bands/distance', { from: 90005, to: 90020 })).status, 409);   // overlaps
      assert.equal((await api('post', '/api/oda-config/bands/distance', { from: 90030, to: 90020 })).status, 400);
      const w1 = await api('post', '/api/oda-config/bands/weight', { from: 90000, to: 90100 });
      assert.equal(w1.status, 201);
      const rate = { distanceId: d1.body.id, weightId: w1.body.id, rate: 250, effectiveDate: today };
      assert.equal((await api('post', '/api/oda-config/rates', { rows: [rate, rate] })).status, 400);                 // twice in the list
      assert.equal((await api('post', '/api/oda-config/rates', { rows: [rate] })).status, 201);
      assert.equal((await api('post', '/api/oda-config/rates', { rows: [rate] })).status, 409);
      const cfg = (await api('get', '/api/oda-config/rates')).body.find((r) => r.distanceId === d1.body.id);
      assert.equal(cfg.distanceName, '90000 to 90010 KMS');
      assert.equal((await api('put', `/api/oda-config/rates/${cfg.id}`, { ...rate, rate: 300, active: true })).status, 200);
    });

    test('shippers: stock, issue inside stock, transfer, delete rules', async () => {
      const stock = await api('post', '/api/shippers/stock/shipper', { shipperType: 'GRN Shipper', grnType: 1, receivingDate: today, start: 990000001, end: 990000100, receivedFrom: 'HO' });
      assert.equal(stock.status, 201, JSON.stringify(stock.body));
      assert.equal((await api('post', '/api/shippers/stock/shipper', { shipperType: 'GRN Shipper', grnType: 1, receivingDate: today, start: 990000050, end: 990000150, receivedFrom: 'HO' })).status, 409);
      const issue = (b) => api('post', '/api/shippers/issues', { branch: 'B1002', shipperType: 'GRN Shipper', grnType: 1, issueDate: today, start: 990000001, end: 990000050, ...b });
      assert.equal((await issue({ grnType: 2 })).status, 400);                                                      // IBA vs manual
      assert.equal((await issue({ end: 990000200 })).status, 400);                                                  // beyond the stock
      assert.equal((await issue({ branch: 'B1003' })).status, 400);                                                 // franchisee branch
      const iss = await issue({});
      assert.equal(iss.status, 201, JSON.stringify(iss.body));
      assert.equal((await issue({ start: 990000040, end: 990000060 })).status, 409);                                // overlaps
      const fr = await api('post', '/api/shippers/issues', { franchisee: true, branch: 'B1003', shipperType: 'GRN Shipper', grnType: 1, issueDate: today, start: 990000051, end: 990000060, perShipperCharge: 5 });
      assert.equal(fr.status, 201, JSON.stringify(fr.body));
      assert.equal((await api('get', '/api/shippers/issues?franchisee=true&number=990000055')).body[0].totalCharge, 50);
      assert.equal((await api('delete', `/api/shippers/stock/shipper/${stock.body.id}`)).status, 409);               // issued from
      const t = await api('post', `/api/shippers/issues/${iss.body.id}/transfer`, { number: 990000010, toBranch: 'B1001' });
      assert.equal(t.status, 201, JSON.stringify(t.body));
      assert.equal((await api('post', `/api/shippers/issues/${iss.body.id}/transfer`, { number: 990000010, toBranch: 'B1001' })).status, 409);
      const nums = (await api('get', `/api/shippers/issues/${iss.body.id}/numbers`)).body.numbers;
      assert.match(nums.find((x) => x.number === 990000010).status, /Moved/);
      const tr = (await api('get', '/api/shippers/transfers')).body.find((x) => x.shipperNo === 'G-990000010');
      assert.equal((await api('post', `/api/shippers/transfers/${tr.id}/cancel`)).status, 200);
      assert.equal((await api('delete', `/api/shippers/issues/${iss.body.id}`)).status, 200);
      assert.equal((await api('delete', `/api/shippers/issues/${fr.body.id}`)).status, 200);
      assert.equal((await api('delete', `/api/shippers/stock/shipper/${stock.body.id}`)).status, 200);
    });

    test('docket lookups: locations / PIN, origin location, city state, client defaults, docket issue', async () => {
      const locs = (await api('get', '/api/dockets/lookup/oda-locations?city=MUMBAI')).body;
      assert.equal(locs.find((l) => l.code === 'L003').pinCode, '400053');
      assert.equal((await api('get', '/api/dockets/lookup/location-by-pin?pin=400050&city=MUMBAI')).body.code, 'L004');
      assert.equal((await api('get', '/api/dockets/lookup/location-by-pin?pin=110020&city=MUMBAI')).status, 400);   // a Delhi PIN
      assert.equal((await api('get', '/api/dockets/lookup/origin-locations')).body.default, 'L001');
      assert.ok((await api('get', '/api/dockets/lookup/city-state?city=BOM')).body.state);

      const d = (await api('get', '/api/dockets/lookup/client-defaults?onAccountOf=ACME TEXTILES:CL001&destination=MUMBAI')).body;
      assert.deepEqual([d.partyRole, d.party.name, d.party.gstin], ['consigner', 'ACME TEXTILES', '27AAACA1111A1Z1']);
      assert.ok(d.rateOns.includes('WEIGHT') && d.rateOns.includes('BOX'), JSON.stringify(d));
      assert.equal((await api('get', '/api/dockets/lookup/client-defaults?onAccountOf=NOPE:ZZ999')).status, 400);

      assert.equal((await api('get', '/api/dockets/lookup/docket-issue?docketNo=990000299')).body.issued, false);
      await api('post', '/api/shippers/stock/shipper', { shipperType: 'GRN Shipper', grnType: 1, receivingDate: today, start: 990000201, end: 990000250, receivedFrom: 'HO' });
      const iss = await api('post', '/api/shippers/issues', { branch: 'B1002', shipperType: 'GRN Shipper', grnType: 1, issueDate: today, start: 990000201, end: 990000250, client: 'CL001' });
      assert.equal(iss.status, 201, JSON.stringify(iss.body));
      const di = (await api('get', '/api/dockets/lookup/docket-issue?docketNo=990000205')).body;
      assert.deepEqual([di.issued, di.branch, di.ownBranch, di.onAccountOf], [true, 'B1002', false, 'ACME TEXTILES:CL001']);
    });

    test('operation links: franchisees on pickup / DRS, Setting vendor vehicles on the challan', async () => {
      const pk = (await api('get', '/api/pickups/options')).body;
      assert.ok(pk.franchisees.some((f) => f.value === 'FRS1001'), JSON.stringify(pk.franchisees));
      assert.ok((await api('get', '/api/drs/options')).body.franchisees.some((f) => f.value === 'FRS1001'));
      const bad = await api('post', '/api/pickups', { pickupDate: today, pickupTime: '10:00', docType: '2', franchiseeCode: 'NOPE',
        dockets: [{ docketNo: 'T0001', locationCode: 'L001', packages: 1, weight: 1, freight: 1 }] });
      assert.equal(bad.status, 400, JSON.stringify(bad.body));
      assert.equal((await api('post', '/api/drs', { drsDate: today, drsTime: '10:00', deliveredBy: 'X', franchiseeCode: 'NOPE',
        dockets: [{ docketNo: 'T0001', packages: 1 }] })).status, 400);

      const add = await api('post', '/api/vendor-vehicles', { vendorType: 'VENDOR', vendor: 'V001', mode: 'RD',
        rows: [{ vehicleName: 'TATA 407', truckNo: 'TS99XX0002', capacity: 'PARCEL', vehicleCapacity: 4000 }] });
      assert.equal(add.status, 201, JSON.stringify(add.body));
      assert.ok((await api('get', '/api/challans/vehicles?vendorCode=V001')).body.some((v) => v.truckNo === 'TS99XX0002'));
      const det = (await api('get', '/api/challans/vehicles/TS99XX0002')).body;
      assert.deepEqual([det.vendorCode, det.capacity], ['V001', 4000]);
    });

    test('vendor rates: road (and the challan hire charge), air with slabs, train', async () => {
      const fy = { startDate: `${y}-04-01`, endDate: `${y + 1}-03-31` };
      const road = (b) => api('post', '/api/vendor-rates/road', { vendorType: 'VENDOR', vendor: 'V001', origin: 'DEL', destination: 'BOM', rateMode: 'FTL',
        ftlRateType: 'FTL', ftlAmount: 777, effectiveDate: today, ...fy, ...b }, fyEmp);
      assert.equal((await road({ ftlAmount: 0 })).status, 400);
      assert.equal((await road({ destination: 'DEL' })).status, 400);                              // same city
      assert.equal((await road({ effectiveDate: '2020-01-01' })).status, 400);
      const r1 = await road({});
      assert.equal(r1.status, 201, JSON.stringify(r1.body));
      assert.equal((await road({})).status, 409);
      const r2 = await road({ rateMode: 'PKG', perKg: 777, ftlAmount: 0 });
      assert.equal(r2.status, 201, JSON.stringify(r2.body));
      const list = (await api('get', '/api/vendor-rates/road?vendor=V001&origin=DEL&destination=BOM', null, fyEmp)).body;
      assert.equal(list.find((x) => x.id === r1.body.id).inForce, true);
      const vr = (await api('get', '/api/challans/vendor-rate?vendorCode=V001&routeCode=R001&weight=10', null, fyEmp)).body;
      assert.deepEqual([vr.origin, vr.destination], ['DEL', 'BOM'], JSON.stringify(vr));
      assert.deepEqual(vr.rates.map((x) => [x.rateMode, x.hireCharge]).sort(), [['FTL', 777], ['PKG', 7770]]);

      await api('post', '/api/vendor-vehicles', { vendorType: 'VENDOR', vendor: 'V001', mode: 'AR', rows: [{ vehicleNo: 'TS99AI1', vehicleName: 'TST AIR' }] });
      const air = (b) => api('post', '/api/vendor-rates/air', { vendorType: 'VENDOR', vendor: 'V001', flight: 'TS99AI1', shift: 'Morning',
        origin: 'DEL', destination: 'BOM', ratePerKg: 777, effectiveDate: today, ...fy,
        slabs: [{ from: 0, to: 10, rate: 90 }, { from: 11, to: 50, rate: 80 }], ...b }, fyEmp);
      assert.equal((await air({ slabs: [{ from: 0, to: 10, rate: 9 }, { from: 20, to: 50, rate: 8 }] })).status, 400);   // gap
      assert.equal((await air({ flight: 'NOPE' })).status, 400);
      const a1 = await air({});
      assert.equal(a1.status, 201, JSON.stringify(a1.body));
      assert.match(a1.body.code, /^AIR\d{4,}$/);
      assert.equal((await api('get', `/api/vendor-rates/air/${a1.body.id}`, null, fyEmp)).body.slabs.length, 2);

      const train = (b) => api('post', '/api/vendor-rates/train', { vendorType: 'VENDOR', vendor: 'V001', train: '12301', origin: 'DEL',
        destination: 'BOM', rateType: '2', tripCost: 777, ddAmount: 50, effectiveDate: today, ...b }, fyEmp);
      assert.equal((await train({ tripCost: 0 })).status, 400);
      const t1 = await train({});
      assert.equal(t1.status, 201, JSON.stringify(t1.body));
      assert.equal((await api('patch', `/api/vendor-rates/train/${t1.body.id}/status`, { active: false }, fyEmp)).status, 200);
      assert.equal((await api('get', '/api/vendor-rates/train?vendor=V001', null, fyEmp)).body.find((x) => x.id === t1.body.id).active, false);
    });

    test('franchisee commission (road rows, air) and pickup / delivery rates', async () => {
      const fy = { startDate: `${y}-04-01`, endDate: `${y + 1}-03-31`, effectiveDate: `${y + 1}-03-28` };
      const opts = (await api('get', '/api/franchisee-rates/options', null, fyEmp)).body;
      assert.deepEqual([opts.vehicleTypes.ftl36.map((v) => v.value), opts.vehicleTypes.ftl916.map((v) => v.value)], [['PARCEL'], ['SUNDRY']]);
      const road = (b) => api('post', '/api/franchisee-rates/commissions', { mode: 'RD', rent: 777, mobileBills: 500, signage: 200, baseFreightPercent: 5, ...fy,
        rows: [
          { bookingType: 'Paid', category: 'LTL', upTo3Tons: 10, from3To6Tons: 8 },
          { bookingType: 'Paid', category: 'FTL36', vehicleType: 'PARCEL', perConsignment: 300, sharePercent: 4 },
          { bookingType: 'Topay', category: 'TRAILER', perConsignment: 1000, sharePercent: 2 },
        ], ...b }, fyEmp);
      assert.equal((await road({ rows: [{ bookingType: 'Paid', category: 'FTL36', vehicleType: 'SUNDRY' }] })).status, 400);   // 9 t is not 3–6 t
      assert.equal((await road({ rows: [] })).status, 400);
      const c1 = await road({});
      assert.equal(c1.status, 201, JSON.stringify(c1.body));
      assert.match(c1.body.code, /^FCM\d{4,}$/);
      assert.equal((await road({})).status, 409);                                                      // same mode and date
      const air = await api('post', '/api/franchisee-rates/commissions', { mode: 'AI', rent: 777, airPercent: 6, ...fy }, fyEmp);
      assert.equal(air.status, 201, JSON.stringify(air.body));
      const got = (await api('get', '/api/franchisee-rates/commissions', null, fyEmp)).body.find((c) => c.id === c1.body.id);
      assert.deepEqual(got.rows.map((r) => r.category), ['LTL 03 Tons', 'FTL 36 Tons', 'FTL Trailor']);
      assert.deepEqual([got.rows[0].upTo3Tons, got.rows[1].vehicleType, got.rows[2].sharePercent], [10, 'PARCEL', 2]);

      const pd = (b) => api('post', '/api/franchisee-rates/pickup-delivery', { franchisee: 'FRS1001', docType: 'NONDOC', effectiveDate: fy.effectiveDate,
        rows: [{ band: 'Up to 3 kg', pickup: 777, perConsignment: 20 }, { band: '3 to 5 kg', pickup: 777, perConsignment: 30 }], ...b }, fyEmp);
      assert.equal((await pd({ rows: [{ band: 'Up to 3 kg', pickup: 777 }, { band: 'Up to 3 kg', pickup: 777 }] })).status, 400);
      assert.equal((await pd({ franchisee: 'NOPE' })).status, 400);
      const p1 = await pd({});
      assert.equal(p1.status, 201, JSON.stringify(p1.body));
      assert.equal((await pd({})).status, 409);
      assert.equal((await pd({ docType: 'DOC', rows: [{ pickup: 777, perConsignment: 15 }] })).status, 201);
      const list = (await api('get', '/api/franchisee-rates/pickup-delivery?franchisee=FRS1001', null, fyEmp)).body;
      assert.deepEqual(list.map((r) => r.band).sort(), ['3 to 5 kg', 'Per Document', 'Up to 3 kg']);
    });

    test('special booking approval goes level by level', async () => {
      await query("update grn_docket_charge set Discount = 15 where Docket_No = 'T0001'");
      const pend = (await api('get', '/api/approvals/special-booking')).body;
      const row = pend.find((r) => r.docketNo === 'T0001');
      assert.ok(row, JSON.stringify(pend.map((r) => r.docketNo)));
      assert.equal(row.nextApprover, 'Branch Manager');
      const a1 = await api('post', '/api/approvals/special-booking/approve', { items: [{ docketNo: 'T0001', remarks: 'ok' }] });
      assert.equal(a1.status, 200, JSON.stringify(a1.body));
      assert.deepEqual([a1.body.results[0].status, a1.body.results[0].final], ['Aproved', false]);                  // 11–20 %: area manager next
      const a2 = await api('post', '/api/approvals/special-booking/approve', { items: [{ docketNo: 'T0001', remarks: 'ok' }] });
      assert.equal(a2.body.results[0].status, 'FinA');
      assert.equal((await api('post', '/api/approvals/special-booking/approve', { items: [{ docketNo: 'T0001', remarks: '' }] })).status, 409);
      assert.ok((await api('get', '/api/approvals/special-booking/decided?search=T0001')).body.some((r) => r.docketNo === 'T0001'));
      await query("update grn_docket_charge set Discount = 0 where Docket_No = 'T0001'");
    });

    test('freight margin setting and approval list', async () => {
      const old = (await api('get', '/api/approvals/freight-margin/setting')).body.minMarginPercent;
      assert.equal((await api('put', '/api/approvals/freight-margin/setting', { minMarginPercent: 100 })).status, 200);
      const pend = (await api('get', '/api/approvals/freight-margin', null, fyEmp)).body;
      assert.equal(pend.minMarginPercent, 100);
      if (pend.challans.length) {
        const c = pend.challans[0];
        const ok = await api('post', '/api/approvals/freight-margin/decide', { approve: true, items: [{ challanNo: c.challanNo, remarks: 'TST margin' }] }, fyEmp);
        assert.equal(ok.status, 200, JSON.stringify(ok.body));
        assert.equal((await api('post', '/api/approvals/freight-margin/decide', { approve: true, items: [{ challanNo: c.challanNo, remarks: 'TST margin' }] }, fyEmp)).status, 409);
      }
      await api('put', '/api/approvals/freight-margin/setting', { minMarginPercent: old });
    });

    test('vendor vehicles: road, duplicate truck, train', async () => {
      const road = { vendorType: 'VENDOR', vendor: 'V001', mode: 'RD', rows: [{ vehicleName: 'TATA 407', truckNo: 'TS99XX0001', engineNo: 'TS99E1', chassisNo: 'TS99C1', capacity: 'PARCEL' }] };
      const r1 = await api('post', '/api/vendor-vehicles', road);
      assert.equal(r1.status, 201, JSON.stringify(r1.body));
      assert.equal((await api('post', '/api/vendor-vehicles', road)).status, 409);
      assert.equal((await api('post', '/api/vendor-vehicles', { ...road, vendorType: 'SELF' })).status, 400);        // V001 is not Self
      const list = (await api('get', '/api/vendor-vehicles?search=TS99XX')).body;
      assert.equal(list[0].vehicleCapacity >= 0, true);
      assert.equal((await api('patch', `/api/vendor-vehicles/${list[0].id}/status`, { active: false })).status, 200);
      const tr = await api('post', '/api/vendor-vehicles', { vendorType: 'SELF', vendor: 'V002', mode: 'TR', rows: [{ trainCode: '12301', direction: 'UP', trainType: 'VP' }] });
      assert.equal(tr.status, 201, JSON.stringify(tr.body));
      await query("delete from vendor_vehicle_master where vendor_code = 'V002' and vehicle_no = '12301'");
    });

    test('MIS auto mail settings, e-mails, preview', async () => {
      const old = (await api('get', '/api/auto-mis/settings')).body;
      assert.equal((await api('put', '/api/auto-mis/settings', { active: true, mailTime1: '25:00', backDays: 3 })).status, 400);
      assert.equal((await api('put', '/api/auto-mis/settings', { active: true, mailTime1: '08:30', backDays: 3 })).status, 200);
      assert.equal((await api('get', '/api/auto-mis/settings')).body.backDays, 3);
      const add = await api('post', '/api/auto-mis/emails', { clients: [{ client: 'TS991', columns: [5, 8] }], emails: ['tst1@example.com'] });
      assert.equal(add.status, 201, JSON.stringify(add.body));
      assert.equal((await api('post', '/api/auto-mis/emails', { clients: [{ client: 'TS991', columns: [] }], emails: ['tst1@example.com'] })).status, 409);
      const e = (await api('get', '/api/auto-mis/emails')).body.find((x) => x.email === 'tst1@example.com');
      assert.deepEqual(e.columns, [0, 1, 5, 8]);                                                                     // docket no + date always
      const pv = await api('get', '/api/auto-mis/preview?client=CL001');
      assert.equal(pv.status, 200, JSON.stringify(pv.body));
      assert.equal((await api('post', '/api/auto-mis/header-footer', { header: 'TST header', footer: 'bye' })).status, 201);
      assert.equal((await api('delete', `/api/auto-mis/emails/${e.id}`)).status, 200);
      await api('put', '/api/auto-mis/settings', { active: old.active, mailTime1: old.mailTime1, mailTime2: old.mailTime2, effectiveDate: old.effectiveDate, backDays: old.backDays });
    });
  });

  test('docket: cancel then block further changes', async () => {
    const auth = { Authorization: `Bearer ${emp}` };
    const c = await request(app).post('/api/dockets/T0002/cancel').set(auth).send({ remark: 'test cancel' });
    assert.equal(c.status, 200);
    const again = await request(app).post('/api/dockets/T0002/cancel').set(auth).send({ remark: 'test cancel' });
    assert.equal(again.status, 409);
  });
});
