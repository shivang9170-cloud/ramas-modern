-- DEV-ONLY seed data. Logins (plain text, as in the legacy schema):
--   admin   / admin123   (Division DIV1001)
--   EMP001  / emp123     employee with access to Masters + Docket entry/view
--   FRS1001 / fran123    franchisee
--   CL001   / client123  client

insert into CompanyMster(CName, CCode, Division) values ('RAMAS LOGISTICS PVT LTD', 'RELL', 'DIV1001');
insert into DivisionMaster(DivCode, DivName, Domain, CompanyCode, IsActive) values
  ('DIV1001', 'COURIER', 'courier.local', '1', 1),
  ('DIV1002', 'CARGO', 'cargo.local', '1', 1),
  ('DIV1003', 'FTL', 'ftl.local', '1', 1);
insert into Financial_Year(Financial_Year, Status) values ('2025-2026', 'true'), ('2026-2027', 'true');

insert into state_master(state_code, state_name, StateCode, Gstin_No, active_flag) values
  ('DL', 'DELHI', '07', '07AAACR1234A1Z5', 'Active'),
  ('MH', 'MAHARASHTRA', '27', '27AAACR1234A1Z1', 'Active'),
  ('WB', 'WEST BENGAL', '19', '', 'Active');
insert into zone_master(zone_code, zone_name, zone_description, active_flag) values
  ('NZ', 'NORTH ZONE', 'Delhi NCR, Punjab, Haryana', 'Active'),
  ('WZ', 'WEST ZONE', 'Maharashtra, Gujarat', 'Active'),
  ('EZ', 'EAST ZONE', 'West Bengal, Odisha', 'Active');
insert into DistrictMaster(DistrictCode, DistrictName, DistrictState, status) values
  ('D001', 'NEW DELHI', 'DL', 'Active'), ('D002', 'MUMBAI SUBURBAN', 'MH', 'Active'), ('D003', 'KOLKATA', 'WB', 'Active');
insert into city_master(city_code, city_name, state_code, zone_code, Districtcode, oda, oda_km, active_flag) values
  ('DEL', 'DELHI', 'DL', 'NZ', 'D001', 'no', 0, 'Active'),
  ('BOM', 'MUMBAI', 'MH', 'WZ', 'D002', 'no', 0, 'Active'),
  ('CCU', 'KOLKATA', 'WB', 'EZ', 'D003', 'no', 0, 'Active'),
  ('PNQ', 'PUNE', 'MH', 'WZ', null, 'yes', 25, 'Active');

insert into branch_master(branch_code, branch_name, city_code, state_code, zone_code, status, IsFranchisee, IsMasterFranchisee, company, ControllingBranch) values
  ('B1001', 'HEAD OFFICE', 'DEL', 'DL', 'NZ', 'Active', 'false', 'false', '1', 'B1001'),
  ('B1002', 'MUMBAI', 'BOM', 'MH', 'WZ', 'Active', 'false', 'false', '1', 'B1001'),
  ('B1003', 'KOLKATA FRANCHISE', 'CCU', 'WB', 'EZ', 'Active', 'true', 'false', '1', 'B1001');

insert into employee_master(empcode, empname, DivCode, branch) values
  ('EMP001', 'RAVI KUMAR', 'DIV1001', 'B1001'),
  ('EMP002', 'PRIYA SHARMA', 'DIV1001', 'B1002');
insert into users(user_id, user_password, user_type, user_emp_type, user_branch, DivCode) values
  ('admin', 'admin123', 'admin', 'Admin', '', null),
  ('EMP001', 'emp123', 'employee', 'Employee', '1,2', 'DIV1001'),
  ('EMP002', 'emp123', 'employee', 'Employee', '2', 'DIV1001');
insert into Franchise_Master(FranCode, FranName, State, Zone, city) values ('FRS1001', 'EASTERN COURIERS', 'WB', 'EZ', 'CCU');
insert into Franchisee_Users(user_id, user_password, user_branch) values ('FRS1001', 'fran123', '3');
insert into Bind_Franch_Branch(Franchise_Code, Branch_Code) values ('FRS1001', 'B1003');
insert into client_Master(client_code, client_name, city) values ('CL001', 'ACME TEXTILES', 'BOM');
insert into ClientLogin_Users(user_id, user_password, client_name, user_branch, home_branch, branch_code, DivCode) values
  ('CL001', 'client123', 'ACME TEXTILES', '2', 'MUMBAI', 'B1002', 'DIV1001');

insert into Commodity_master(Commodity_code, Commodity_name, active_flag) values ('C001', 'TEXTILES', 'Active'), ('C002', 'ELECTRONICS', 'Active');
insert into item_master(item_code, item_name, active_flag) values ('BOX', 'BOX', 'Active'), ('BAG', 'BAG', 'Active'), ('CTN', 'CARTON', 'Active');
insert into HeadOfficeDepartmentMaster(DepartmentCode, DepartmentName) values ('OPS', 'OPERATIONS'), ('ACC', 'ACCOUNTS');

-- ---------------------------------------------------------------- menu (legacy URLs, unchanged)
insert into MasterMenu(Menuid, MenuName, MenuUrl, ActiveStatus) values
  ('M001', 'MASTER', '#', 'Y'),
  ('M002', 'OPERATION', '#', 'Y'),
  ('M003', 'REPORT', '#', 'Y'),
  ('M004', 'ADMIN', '#', 'Y');
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M001', 'S001', 'State Master', 'General/State_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M001', 'S002', 'Zone Master', 'General/Zone_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M001', 'S003', 'City Master', 'General/City_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M001', 'S004', 'Commodity Master', 'General/Commodity_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M001', 'S005', 'Package Master', 'General/Item_master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M001', 'S006', 'Department Master', 'General/DepartmentMaster.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M001', 'S007', 'Division Master', 'General/Division_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M001', 'S008', 'Branch Master', 'Master/Branch_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M002', 'S010', 'Docket', '#', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M002', 'S011', 'Tracking', 'Tracking.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M002', 'S012', 'Arrival Entry', 'Operation/Arrival_Entry.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M003', 'S020', 'Docket Booking Register', 'Report/Docket_Booking_Register.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M004', 'S030', 'User Access Rights', 'User/UserAccessRights.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M004', 'S031', 'Change Password', 'User/Change_Password.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Sub_SubMenu(SubSubMenuId, Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('SS01', 'M002', 'S010', 'Docket Entry', 'Operation/GrnEntry.aspx?x=0', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('SS02', 'M002', 'S010', 'Docket View / Modify', 'Operation/GrnEntry.aspx?x=1', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('SS03', 'M002', 'S010', 'Docket Cancel', 'Operation/GrnEntry.aspx?x=2', 'Y', 'DIV1001,DIV1002,DIV1003');

insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M001', 'S001', null, 'Y'),
  ('EMP001', 'M001', 'S002', null, 'Y'),
  ('EMP001', 'M001', 'S003', null, 'Y'),
  ('EMP001', 'M002', 'S010', 'SS01', 'Y'),
  ('EMP001', 'M002', 'S010', 'SS02', 'Y'),
  ('EMP001', 'M002', 'S011', null, 'Y'),
  ('EMP001', 'M003', 'S020', null, 'Y'),
  ('EMP001', 'M004', 'S031', null, 'Y');
insert into Franchisee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('FRS1001', 'M002', 'S010', 'SS01', 'Y'),
  ('FRS1001', 'M002', 'S011', null, 'Y');
insert into Client_Permission(ClientId, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('CL001', 'M002', 'S011', null, 'Y');
insert into MainDashboard_Access(empCode, MenuName, isActive) values ('EMP001', 'TMS', 1), ('EMP001', 'HRM', 0);

-- ---------------------------------------------------------------- docket booking
insert into booking_mode(mode_code, mode_name) values ('RD', 'ROAD'), ('AI', 'AIR'), ('EX', 'EXPRESS'), ('TR', 'TRAIN');
insert into delivery_mode_master(mode_code, mode_name) values ('DM-101', 'DOOR DELIVERY'), ('DM-102', 'GODOWN DELIVERY');
insert into charge_code_master(mode_code, mode_name, is_tax) values ('CH01', 'GREEN TAX', 0), ('CH02', 'OCTROI', 0), ('TX01', 'COD CHARGES', 1);
insert into consigner_master(consigner_code, company_name, address, city, state, pin_code, phone, GSTIN_No) values
  ('CN001', 'ACME TEXTILES', '12 MG ROAD', 'MUMBAI', 'MAHARASHTRA', '400001', '9820000001', '27AAACA1111A1Z1'),
  ('CN002', 'SUNRISE ELECTRONICS', '44 NEHRU PLACE', 'DELHI', 'DELHI', '110019', '9810000002', '07AAACS2222B1Z2'),
  ('CN003', 'EAST INDIA TRADERS', '7 PARK STREET', 'KOLKATA', 'WEST BENGAL', '700016', '9830000003', '19AAACE3333C1Z3');
insert into client_rate(client_code, origin_branch, destination, mode_id, rate_on, rate, minchargewt, minFreight, sour_charge, fov, oda, dly, billingat, DisPrc, Expected_Days) values
  ('CL001', 'B1001', 'MUMBAI', 'RD', 'WEIGHT', 12, 20, 500, 10, 0, 0, 0, 'B1002', 0, 3),
  ('CL001', 'B1001', 'KOLKATA', 'RD', 'WEIGHT', 14, 20, 600, 10, 0, 0, 0, 'B1002', 5, 4),
  ('CL001', 'B1001', 'MUMBAI', 'RD', 'BOX', 150, 0, 500, 10, 0, 0, 0, 'B1002', 0, 3);

-- ---------------------------------------------------------------- pickup (PRS)
insert into freight_master(container_code, freight_name) values ('SUN', 'SUNDRY'), ('PAR', 'PARCEL'), ('C20', '20 FT CONTAINER');
update branch_master set short_code = 'DEL' where branch_code = 'B1001';
update branch_master set short_code = 'BOM' where branch_code = 'B1002';
update branch_master set short_code = 'CCU' where branch_code = 'B1003';
insert into New_Location_master(Location_Code, Location_Name, City_Code, State_code, branch_code) values
  ('L001', 'OKHLA', 'DEL', 'DL', 'B1001'), ('L002', 'NEHRU PLACE', 'DEL', 'DL', 'B1001'), ('L003', 'ANDHERI', 'BOM', 'MH', 'B1002');
insert into employee_master(empcode, empname, DivCode, branch, emptype, mobileno, Department) values
  ('EMP003', 'SURESH YADAV', 'DIV1001', 'B1001', 'DC-116', '9811100003', 'DEPT-101');
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M002', 'S013', 'Pickup', '#', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Sub_SubMenu(SubSubMenuId, Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('SS04', 'M002', 'S013', 'Pickup Entry', 'Operation/pickup_entry.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('SS05', 'M002', 'S013', 'Pickup View / Cancel', 'Operation/Pickup_Entry_Cancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M002', 'S013', 'SS04', 'Y'),
  ('EMP001', 'M002', 'S013', 'SS05', 'Y');

-- ---------------------------------------------------------------- manifest
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M002', 'S014', 'Manifest', '#', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Sub_SubMenu(SubSubMenuId, Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('SS06', 'M002', 'S014', 'Manifest Entry', 'Operation/menifest.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('SS07', 'M002', 'S014', 'Manifest View / Cancel', 'Operation/manifest_Cancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M002', 'S014', 'SS06', 'Y'),
  ('EMP001', 'M002', 'S014', 'SS07', 'Y');

-- ---------------------------------------------------------------- challan (vehicle dispatch)
insert into vendors_master(vendor_code, Name, vendor_type, vendor_Mode, DivCode, active_flag, TDS) values
  ('V001', 'SHARMA ROADWAYS', 'Vendor', 'RD', 'DIV1001,DIV1002', 1, 1),
  ('V002', 'RAMAS OWN FLEET', 'Self', 'RD', 'DIV1001,DIV1002', 1, 0);
insert into temp_vendors_master(vendor_code, Name, vendor_mode, FTLDIVISION, active_flag, TDS) values
  ('VT001', 'MARKET TRUCK SUPPLIERS', 'RD', 'DIV1001,DIV1003', 1, 2);
insert into Vechile_Master(VEHICLE_NO, VendorCodeName, Vechile_Type_Code, ENGINE_NO, CHASSIS_NO, MODEL, MAKE, Vechile_Capacity) values
  ('DL01AB1234', 'V001', '32 FT MXL', 'EN-77120', 'CH-88213', '2021', 'TATA', 9000),
  ('DL01CD5678', 'V002', '20 FT SXL', 'EN-55001', 'CH-55002', '2023', 'ASHOK LEYLAND', 7000);
insert into Driver_master(Drivername, branch, mobile_no, IsActive) values ('RAMESH SINGH', 'HEAD OFFICE', '9811100010', 1);
insert into route(route_code, route_name, from_route_code, To_Route_Code, route_type, total_km) values
  ('R001', 'DELHI - MUMBAI DIRECT', 'B1001', 'B1002', 'DIRECT', 1400),
  ('R002', 'DELHI - MUMBAI VIA KOLKATA', 'B1001', 'B1002', 'VIA', 2900);
insert into routedetail(route_code, from_station, to_station) values
  ('R001', 'B1001', 'B1002'), ('R002', 'B1001', 'B1003'), ('R002', 'B1001', 'B1002');
insert into Route_SetTime(route_code, Set_Time1) values ('R001', '21:00'), ('R001', '23:30'), ('R002', '20:00');

insert into tblAccountGroup(GroupCode, GroupName) values
  ('G01', 'SUNDRY CREDITORS'), ('G02', 'DIRECT EXPENSES'), ('G03', 'DUTIES & TAXES'), ('G04', 'CASH-IN-HAND');
insert into tblAccountLedger(LedgerCode, LedgerName, GroupCode, Ledger_Type, OpeningBal, VendorOrClientCode, DrCr, Financial_Year, Division, IsActive)
select l.code + '-' + left(fy.Financial_Year, 4), l.name, l.grp, l.typ, l.opening, l.party, l.drcr, fy.Financial_Year, 'DIV1001', 1
  from (values
    ('LV001', 'SHARMA ROADWAYS', 'G01', 'Vendor', 0, 'V001', 'CR'),
    ('LV002', 'RAMAS OWN FLEET', 'G01', 'Vendor', 0, 'V002', 'CR'),
    ('LVT001', 'MARKET TRUCK SUPPLIERS', 'G01', 'Vendor', 0, 'VT001', 'CR'),
    ('LTHS', 'TRUCK HIRE CHARGE FOR SUNDRY', 'G02', 'Expense', 0, null, 'DR'),
    ('LTHF', 'TRUCK HIRE CHARGE FOR FTL', 'G02', 'Expense', 0, null, 'DR'),
    ('LTDS', 'TDS PAYABLE', 'G03', 'Liability', 0, null, 'CR'),
    ('LCASH1', 'CASH HEAD OFFICE', 'G04', 'Cash', 50000, null, 'DR')
  ) as l(code, name, grp, typ, opening, party, drcr)
  cross join Financial_Year fy;

insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M002', 'S015', 'Challan', '#', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Sub_SubMenu(SubSubMenuId, Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('SS08', 'M002', 'S015', 'Challan Entry', 'Operation/dispatchentry_fleet.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('SS09', 'M002', 'S015', 'Challan View / Cancel', 'Operation/dispatchentry_fleet_Cancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M002', 'S015', 'SS08', 'Y'),
  ('EMP001', 'M002', 'S015', 'SS09', 'Y');

-- ---------------------------------------------------------------- arrival (S012 "Arrival Entry" is above)
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M002', 'S016', 'Arrival View / Cancel', 'Operation/Arrival_Entry_Cancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M002', 'S012', null, 'Y'),
  ('EMP001', 'M002', 'S016', null, 'Y');

-- ---------------------------------------------------------------- DRS
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M002', 'S017', 'DRS', '#', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Sub_SubMenu(SubSubMenuId, Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('SS10', 'M002', 'S017', 'DRS Entry', 'Operation/Drs_Entry.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('SS11', 'M002', 'S017', 'DRS View / Cancel', 'Operation/Drs_Entry_Cancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M002', 'S017', 'SS10', 'Y'),
  ('EMP001', 'M002', 'S017', 'SS11', 'Y');
insert into employee_master(empcode, empname, DivCode, branch, emptype, mobileno, Department) values
  ('EMP004', 'ANIL PATIL', 'DIV1001', 'B1002', 'DC-116', '9820000044', 'DEPT-101');
insert into New_Location_master(Location_Code, Location_Name, City_Code, State_code, branch_code) values ('L004', 'BANDRA', 'BOM', 'MH', 'B1002');

-- ---------------------------------------------------------------- delivery status
insert into Drs_status_reason(status_reason) values
  ('CONSIGNEE NOT AVAILABLE'), ('ADDRESS NOT FOUND'), ('DOOR LOCKED'), ('REFUSED BY CONSIGNEE'), ('PAYMENT NOT READY');
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M002', 'S018', 'Delivery Status', '#', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Sub_SubMenu(SubSubMenuId, Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('SS12', 'M002', 'S018', 'Delivery Status Entry', 'Operation/deliverystatusentry.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('SS13', 'M002', 'S018', 'Delivery Status View / Cancel', 'Operation/deliverystatusentry_Cancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M002', 'S018', 'SS12', 'Y'),
  ('EMP001', 'M002', 'S018', 'SS13', 'Y');

-- ---------------------------------------------------------------- POD dispatch
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M002', 'S019', 'POD', '#', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Sub_SubMenu(SubSubMenuId, Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('SS14', 'M002', 'S019', 'POD Dispatch', 'Operation/Pod_Dispatch.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('SS15', 'M002', 'S019', 'POD Dispatch View / Cancel', 'Operation/POD_Dispatch_Cancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M002', 'S019', 'SS14', 'Y'),
  ('EMP001', 'M002', 'S019', 'SS15', 'Y');

-- ---------------------------------------------------------------- POD courier to HO + receive at HO
insert into Courier(CCode, CName) values ('C01', 'BLUE DART'), ('C02', 'DTDC'), ('C03', 'INDIA POST');
insert into Sub_SubMenu(SubSubMenuId, Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('SS16', 'M002', 'S019', 'POD Courier to HO', 'Operation/POD_Dispatch_To_Head_Office.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('SS17', 'M002', 'S019', 'POD Courier View / Cancel', 'Operation/POD_Courier_Cancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('SS18', 'M002', 'S019', 'POD Receive (HO)', 'Operation/podreceive.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('SS19', 'M002', 'S019', 'POD Received View / Cancel', 'Operation/POD_Received_Cancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M002', 'S019', 'SS16', 'Y'), ('EMP001', 'M002', 'S019', 'SS17', 'Y'),
  ('EMP001', 'M002', 'S019', 'SS18', 'Y'), ('EMP001', 'M002', 'S019', 'SS19', 'Y');

-- ---------------------------------------------------------------- branch master (12-branch.sql columns)
update branch_master set Division = 'DIV1001,DIV1002,DIV1003', IsHub = 0, isDocketAutoInc = 0 where Division is null;
update branch_master set contact_person = 'OPS DESK', address = 'OKHLA PHASE 2', phone = '01140000000', location = 'L001', Branch_Gstin_no = '07AAACR1234A1Z5' where branch_code = 'B1001';
update branch_master set location = 'L003' where branch_code = 'B1002';
update New_Location_master set Pin_Code = case Location_Code when 'L001' then '110020' when 'L002' then '110019' when 'L003' then '400053' when 'L004' then '400050' end;
update branch_master set company = 'RELL';   -- the page binds CompanyMster.CCode
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M001', 'S008', null, 'Y');

-- ---------------------------------------------------------------- vendor master (13-vendor.sql columns)
insert into mode_master(mode_code, mode_name) values ('RD', 'ROAD'), ('TR', 'TRAIN'), ('AR', 'AIR');
update vendors_master set Branch = 'B1001', state = 'DL', vendor_city = 'DEL', address = 'TRANSPORT NAGAR', ContactPrsnName = 'VIJAY SHARMA',
  vendor_phone_no = '9811122233', approvalDate = '2025-04-01', ApprovBy = 'RAVI KUMAR :EMP001', CourDiv = 'DIV1001', PrclDiv = 'DIV1002',
  Gstin_No = case vendor_code when 'V001' then '07AAAPS1234K1Z2' end, AutoGstStatus = case vendor_code when 'V001' then '1' else '0' end,
  IsFastTag = 1, IsColoader = 0
 where vendor_code in ('V001', 'V002');
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M001', 'S009', 'Vendor Master', 'Master/Vendor_Entry.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M001', 'S009', null, 'Y');

-- ---------------------------------------------------------------- vehicle master (14-vehicle.sql columns)
insert into Vehicle_master(vehicle_name, active_flag) values ('TATA MOTORS', 'Active'), ('ASHOK LEYLAND', 'Active'), ('EICHER', 'Active');
update freight_master set active_flag = 'Active', VehicleMode = 'ROAD',
  container_Capacity = case container_code when 'SUN' then 9000 when 'PAR' then 5000 else 20000 end,
  ContainerSize = case container_code when 'SUN' then '32 FT' else '20 FT' end,
  Container_Type = case container_code when 'SUN' then 'OPEN' when 'PAR' then 'CLOSED' else 'CONTAINER' end,
  Bodys = case container_code when 'SUN' then 'OPEN BODY' else 'CONTAINER' end,
  NoOfWheel = case container_code when 'SUN' then 10 when 'PAR' then 6 else 12 end;
update route set isStatus = 1;
update Vechile_Master set Vechile_Status = 'Active', VehicelType = 'SUN', Created_Branch = 'B1001', Home_Branch = 'B1001', currentloc = 'B1001',
  division = 'DIV1001', fuel_type = 'DIESEL', tank_capacity = '300', ContainerSize = '32 FT',
  VenderType = case VendorCodeName when 'V002' then 'Self' else 'Vendor' end,
  OwnerName = case VendorCodeName when 'V002' then 'RAMAS LOGISTICS PVT LTD' else 'SHARMA ROADWAYS' end,
  VehicleName_id_fk = case MAKE when 'TATA' then 1 else 2 end,
  veh_route = case VendorCodeName when 'V001' then 'R001' end;
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M001', 'S021', 'Vehicle Master', 'Master/View_Vechile_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M001', 'S021', null, 'Y');

-- ---------------------------------------------------------------- client master (15-client.sql columns)
insert into nature_of_business_master(nob_name) values ('TEXTILES'), ('ELECTRONICS'), ('FMCG'), ('PHARMA'), ('AUTOMOBILE');
update client_Master set company_name = client_name, contact_person = 'SANJAY MEHTA', address = '12 MG ROAD',
  place = 'FORT', pin_code = '400001', email = 'accounts@acme.example', phone = '02240000001', Mobile = '9820000001',
  Gstin_No = '27AAACA1111A1Z1', AutoGstStatus = '1', IsGstReg = 1, intro_date = '2025-04-01', is_Active = 1, credit_period = 30,
  Branch_Code = 'B1002', BillingLocation = 'B1002', SubmissionLocation = 'B1002', CollectionLocation = 'B1002', PlaceofSupply = 'INTERSTATE',
  DivCode = 'DIV1001', divcourier = 'DIV1001', Credit_Type = 'Consigner', IsPs = 'No', ShowKMOnPrint = 0, nature_of_business_id = 1,
  billing_address = '12 MG ROAD', billing_client_name = client_name, billing_client_phone = '02240000001', billing_client_GSTIN = '27AAACA1111A1Z1',
  billed_ledger_name = 'ACME TEXTILES :CL001:MUMBAI:B1002 :BILLED', unbilled_ledger_name = 'ACME TEXTILES :CL001:MUMBAI:B1002 :UNBILLED'
 where client_code = 'CL001';
insert into tblAccountGroup(GroupCode, GroupName) values ('G05', 'SUNDRY DEBTORS');
insert into tblAccountLedger(LedgerCode, LedgerName, GroupCode, Ledger_Type, OpeningBal, VendorOrClientCode, DrCr, Financial_Year, Division, IsActive)
select l.code + '-' + left(fy.Financial_Year, 4), l.name, 'G05', 'CLIENT', 0, 'CL001', 'DR', fy.Financial_Year, 'DIV1001', 1
  from (values ('LCB001', 'ACME TEXTILES :CL001:MUMBAI:B1002 :BILLED'), ('LCU001', 'ACME TEXTILES :CL001:MUMBAI:B1002 :UNBILLED')) as l(code, name)
  cross join Financial_Year fy;
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M001', 'S022', 'Client Master', 'Master/Client_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M001', 'S022', null, 'Y');

-- ---------------------------------------------------------------- employee master (16-employee.sql columns)
insert into emp_type_master(emp_type_code, emp_type_name) values
  ('DC-116', 'DELIVERY BOY'), ('EXE', 'EXECUTIVE'), ('MGR', 'BRANCH MANAGER'), ('ACCT', 'ACCOUNTANT');
update employee_master set emptype = isnull(emptype, 'EXE'), Department = case when isnull(Department, '') in ('', 'DEPT-101') then 'OPS' else Department end,
  Company = 'RELL', dateofjoining = '2024-04-01', dt_WithEff_Date = '2024-04-01', dt_DOB_Date = '1990-01-15', vc_Gender = 'Male',
  vc_Type = 'OnRole', vc_Joining_Type = '1', vc_Guardian_Type = 'Father', vc_Guardian_Name = 'NOT RECORDED', vc_Maritial_Status = '1',
  vc_Religion = 'Hindu', vc_Category = 'General', vc_Nationality = 'Indian', vc_Blood_Group = 'O+',
  mobileno = isnull(mobileno, '9811100001'), EmailId = lower(empcode) + '@example.com',
  presentaddress = 'NOT RECORDED', permanentaddress = 'NOT RECORDED',
  PresentCity = case branch when 'B1002' then 'BOM' else 'DEL' end, PermanentCity = case branch when 'B1002' then 'BOM' else 'DEL' end,
  vc_Location_Code = case branch when 'B1002' then 'L003' else 'L001' end, IsActive = isnull(IsActive, 1), IsAuthorized = 1;
update employee_master set vc_Guardian_Type = 'Husband', vc_Gender = 'Female' where empcode = 'EMP002';
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M001', 'S023', 'Employee Master', 'Master/Employee_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M001', 'S023', null, 'Y');

-- ---------------------------------------------------------------- user master (17-users.sql columns)
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M004', 'S032', 'User Master', 'User/User_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');

-- ---------------------------------------------------------------- client contract, City To City (18-contract.sql)
-- ACME's sample rates, moved from the old dev-only client_rate table with the same values.
insert into client_contract_city(EntRef, contract_type, RateType, BookingType, DocsType, Division, client_id, client_code, billingat,
  origin_city, destination_city, mode_id, delivery_mode, rate_on, rate, minchargewt, minFreight, sour_charge, FuleCharge, fov, oda, dly,
  Discount, discount_type, Expected_Days, start_date, end_date, effective_from, status, User_Id)
select 'RMEC-' + cast(100000 + row_number() over (order by r.slno) as varchar(10)), 'City To City', 'Credit', 'Credit', '2', 'DIV1001',
       r.client_code, r.client_code, r.billingat, 'DEL', c.city_code, r.mode_id, 'DM-101', r.rate_on, r.rate, r.minchargewt, r.minFreight,
       r.sour_charge, r.sour_charge, r.fov, r.oda, r.dly, r.DisPrc, 'P', r.Expected_Days, '2025-04-01', '2027-03-31', '2025-04-01', 'Active', 'admin'
  from client_rate r join city_master c on c.city_name = r.destination;
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M001', 'S024', 'Client Contract', 'Rate/Client_Contract.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M001', 'S024', null, 'Y');

-- ---------------------------------------------------------------- KM rates (24-contract-km.sql): sample distances
insert into Distance_Master(from_city_code, to_city_code, distance, distance_status) values ('DEL', 'BOM', 1415, 'True');
insert into Distance_Location_Master(from_Location_code, from_location, to_Location_code, to_location, distance, distance_status)
  values ('L001', 'OKHLA', 'L003', 'ANDHERI', 1420, 'True');
-- ---------------------------------------------------------------- General Rate Master (25-general-rate.sql)
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M001', 'S025', 'General Rate Master', 'Rate/General_Rate_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M001', 'S025', null, 'Y');
-- ---------------------------------------------------------------- ODA Charge (27-oda-charge.sql)
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M001', 'S026', 'ODA Charge', 'Rate/ODA_Charge.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M001', 'S026', null, 'Y');
-- ---------------------------------------------------------------- PRS / DRS Rate Master (28-prs-drs-rate.sql)
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M001', 'S027', 'PRS / DRS Rate Master', 'Rate/PRS_and_DRS_Rate_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M001', 'S027', null, 'Y');
-- ---------------------------------------------------------------- Settings (29-settings.sql): menu, trains, vehicle names, MIS columns
insert into MasterMenu(Menuid, MenuName, MenuUrl, ActiveStatus) values ('M005', 'SETTING', '#', 'Y');
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M005', 'S040', 'Bind Destination To Branch', 'Setting/Bind_Destinationtobranch.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S041', 'Franchisee Bind Branch', 'Setting/Franchisee_Bind_Branch.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S042', 'Bind Franchisee To Client', 'Setting/Bind_Franchisee_to_Client.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S043', 'Franchisee To Client View', 'Setting/Franchisee_to_Client_View.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S044', 'Change Docket FY', 'Setting/ChangeDocket_FY.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S045', 'Effective Date Change', 'Setting/EffectiveDateChange.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S046', 'Rate Effective Date Modification', 'Setting/ClientRateMasterEffectiveDateMmodification.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S047', 'ODA Master And Configuration', 'Setting/ODA_Master_And_Configuration.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S048', 'Shipper Master', 'Setting/Shiper_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S049', 'Gate Pass Shipper Master', 'Setting/GatePassShiper_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S050', 'Shipper Issue To Branch', 'Setting/Shiper_Issue_Details.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S051', 'Shipper Issue To Franchisee', 'Setting/shiper_issue_details_to_Franchisee.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S052', 'Special Booking Approval', 'Setting/Special_Booking_Approval.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S053', 'Freight THC Margin Approval', 'Setting/Freight_THC_Margin_Approval.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S054', 'Vendor And Vehicle', 'Setting/Vendor_and_vehicle.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M005', 'S055', 'MIS Auto Mail', 'Setting/MIS_Report_Auto.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus)
  select 'EMP001', 'M005', SubMenuid, null, 'Y' from SubMenu where Menuid = 'M005';
insert into Train_Master(TrainCode, TrainName, Directions) values ('12301', 'HOWRAH RAJDHANI', 'UP'), ('12302', 'NEW DELHI RAJDHANI', 'DOWN'), ('12951', 'MUMBAI RAJDHANI', 'UP');
insert into VehicleName_Master(vehicle_name) values ('TATA 407'), ('EICHER 14 FT'), ('TATA ACE');
insert into Auto_MIS_Column_Master(index_id, column_Name, field) values
  (0, 'Docket No', 'docketNo'), (1, 'Booking Date', 'bookingDate'), (2, 'Origin', 'origin'), (3, 'Destination', 'destination'),
  (4, 'Consignor', 'consignor'), (5, 'Consignee', 'consignee'), (6, 'Packages', 'packages'), (7, 'Weight', 'weight'),
  (8, 'Status', 'status'), (9, 'Status Date', 'statusDate');
-- ---------------------------------------------------------------- Vendor rate masters (30-vendor-rates.sql)
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M001', 'S028', 'Vendor Road Rate Master', 'Rate/Vendor_Road_Rate_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M001', 'S029', 'Vendor Air Rate Master', 'Rate/Vendor_Air_Rate_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M001', 'S056', 'Vendor Train Rate Master', 'Rate/Vendor_Train_Rate_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M001', 'S028', null, 'Y'), ('EMP001', 'M001', 'S029', null, 'Y'), ('EMP001', 'M001', 'S056', null, 'Y');
-- ---------------------------------------------------------------- Franchisee rates (31-franchisee-rates.sql)
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M001', 'S057', 'Franchisee Commission Master', 'Rate/Franchisee_Commission_Master.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M001', 'S058', 'Franchisees Pickup Delivery', 'Rate/Franchisees_Pickup_Delivery.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M001', 'S057', null, 'Y'), ('EMP001', 'M001', 'S058', null, 'Y');

-- ---------------------------------------------------------------- loading sheet
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M002', 'S059', 'Loading Sheet', '#', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Sub_SubMenu(SubSubMenuId, Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('SS20', 'M002', 'S059', 'Loading Sheet Entry', 'Operation/Loading_Sheet.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('SS21', 'M002', 'S059', 'Loading Sheet View / Cancel', 'Operation/Loading_Sheet_Cancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('SS22', 'M002', 'S059', 'Manual Loading Sheet Cancel / Uncancel', 'Operation/Manual_Loading_Sheet_Cancel_Uncancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M002', 'S059', 'SS20', 'Y'),
  ('EMP001', 'M002', 'S059', 'SS21', 'Y'),
  ('EMP001', 'M002', 'S059', 'SS22', 'Y');

-- ---------------------------------------------------------------- Invoice: client bill (33-client-bill.sql); SAC codes are dev values
insert into MasterMenu(Menuid, MenuName, MenuUrl, ActiveStatus) values ('M006', 'INVOICE', '#', 'Y');
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M006', 'S060', 'Client Bill (GST)', 'Invoice/Client_Bill_GST.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M006', 'S061', 'Client Bill View / Cancel', 'Invoice/Client_Bill_Cancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus)
  select 'EMP001', 'M006', SubMenuid, null, 'Y' from SubMenu where Menuid = 'M006';
insert into Sac_Master(ServiceType, SubServiceType, Sac_Code) values
  ('Courier', 'Courier Service', '996812'),
  ('GTA', 'Goods Transport Agency Services for Road Transport', '996791'),
  ('Air', 'Air Cargo', '996531'),
  ('Train', 'Train', '996511'),
  ('Multimodal', 'Multimodel Transportation of Goods', '9965');
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M006', 'S062', 'Bill Submission', 'Invoice/Client_Bill_Summation.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M006', 'S063', 'Bill Finalize', 'Invoice/Bill_Finalized.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M006', 'S062', null, 'Y'), ('EMP001', 'M006', 'S063', null, 'Y');

-- ---------------------------------------------------------------- Bill receipt (34-bill-receive.sql): menu, ledgers it posts to
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M006', 'S064', 'Bill Receive', 'Invoice/Bill_Receive.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M006', 'S064', null, 'Y');
insert into tblAccountGroup(GroupCode, GroupName) values ('G012', 'BANK ACCOUNTS'), ('G013', 'INDIRECT INCOME'), ('G014', 'CURRENT ASSETS');
insert into tblAccountLedger(LedgerCode, LedgerName, GroupCode, Ledger_Type, OpeningBal, VendorOrClientCode, DrCr, Financial_Year, Division, IsActive)
select l.code + '-' + left(fy.Financial_Year, 4), l.name, l.grp, l.typ, l.opening, null, l.drcr, fy.Financial_Year, 'DIV1001', 1
  from (values
    ('LCASH2', 'CASH MUMBAI', 'G04', 'Cash', 20000, 'DR'),
    ('LBANK1', 'HDFC BANK CURRENT A/C', 'G012', 'Bank', 100000, 'DR'),
    ('LTDSR', 'TDS Receivable', 'G014', 'Asset', 0, 'DR'),
    ('LFID', 'Freight Income Deduction', 'G02', 'Expense', 0, 'DR'),
    ('LOTHI', 'Other Income', 'G013', 'Income', 0, 'CR'),
    ('LROFF', 'ROUND OFF', 'G02', 'Expense', 0, 'DR')
  ) as l(code, name, grp, typ, opening, drcr)
  cross join Financial_Year fy;

-- ---------------------------------------------------------------- Paid / To Pay bills: finalize and receipt ledgers
insert into tblAccountLedger(LedgerCode, LedgerName, GroupCode, Ledger_Type, OpeningBal, VendorOrClientCode, DrCr, Financial_Year, Division, IsActive)
select l.code + '-' + left(fy.Financial_Year, 4), l.name, l.grp, l.typ, 0, null, l.drcr, fy.Financial_Year, 'DIV1001', 1
  from (values
    ('LPR1', 'PAID RECOVERY :HEAD OFFICE :B1001', 'G007', 'Branch', 'DR'),
    ('LTR1', 'TOPAY RECOVERY :HEAD OFFICE :B1001', 'G006', 'Branch', 'DR'),
    ('LPR2', 'PAID RECOVERY :MUMBAI :B1002', 'G007', 'Branch', 'DR'),
    ('LTR2', 'TOPAY RECOVERY :MUMBAI :B1002', 'G006', 'Branch', 'DR'),
    ('LPPC', 'PAID BOOKING PENDING COLLECTION', 'G05', 'Asset', 'DR'),
    ('LTPC', 'TOPAY BOOKING PENDING COLLECTION', 'G05', 'Asset', 'DR'),
    ('LBID', 'Booking Income Deduction', 'G02', 'Expense', 'DR')
  ) as l(code, name, grp, typ, drcr)
  cross join Financial_Year fy
 where not exists (select 1 from tblAccountLedger x where x.LedgerName = l.name and x.Financial_Year = fy.Financial_Year);
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M006', 'S065', 'Paid / To Pay Bill', 'Invoice/client_topay_paid_bill.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M006', 'S066', 'Paid / To Pay Bill Finalize', 'Invoice/PaidAndTopayBill_Finalized.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M006', 'S065', null, 'Y'), ('EMP001', 'M006', 'S066', null, 'Y');

-- ---------------------------------------------------------------- Miscellaneous / warehouse bills (35-other-bills.sql): menu, tax slabs, ledgers
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M006', 'S067', 'Miscellaneous Bill', 'Invoice/Miscellaneous_Bill.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M006', 'S068', 'Warehouse Bill', 'Invoice/Warehouse_bill.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M006', 'S067', null, 'Y'), ('EMP001', 'M006', 'S068', null, 'Y');
insert into Misc_Tax_Slab(Slab, CGST, SGST, IGST) values ('NIL', 0, 0, 0), ('GST 5%', 2.5, 2.5, 5), ('GST 12%', 6, 6, 12), ('GST 18%', 9, 9, 18);
insert into tblAccountLedger(LedgerCode, LedgerName, GroupCode, Ledger_Type, OpeningBal, VendorOrClientCode, DrCr, Financial_Year, Division, IsActive)
select l.code + '-' + left(fy.Financial_Year, 4), l.name, l.grp, l.typ, 0, null, l.drcr, fy.Financial_Year, 'DIV1001', 1
  from (values
    ('LOCGST', 'OUTPUT CGST', 'G03', 'Liability', 'CR'), ('LOSGST', 'OUTPUT SGST', 'G03', 'Liability', 'CR'),
    ('LOIGST', 'OUTPUT IGST', 'G03', 'Liability', 'CR'),
    ('LBIMIS', 'BOOKING INCOME MISCELLANEOUS', 'G013', 'Income', 'CR'), ('LBIWH', 'BOOKING INCOME WAREHOUSE', 'G013', 'Income', 'CR')
  ) as l(code, name, grp, typ, drcr)
  cross join Financial_Year fy
 where not exists (select 1 from tblAccountLedger x where x.LedgerName = l.name and x.Financial_Year = fy.Financial_Year);

-- ---------------------------------------------------------------- Octroi bills (36-octroi-bill.sql)
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M006', 'S069', 'Octroi Bill', 'Invoice/Octroi_Bills.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M006', 'S069', null, 'Y');
-- ---------------------------------------------------------------- Vendor invoices (37-vendor-invoice.sql): menu, other vendors, products, ledgers
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M006', 'S070', 'Vendor Invoice', 'Invoice/VendorInvoice.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M006', 'S071', 'Vendor Invoice Verification', 'Invoice/Vendor_Invoice_For_Varification.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M006', 'S072', 'Vendor Pending Invoice Report', 'Invoice/VendorPendingInvoiceReport.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M006', 'S070', null, 'Y'), ('EMP001', 'M006', 'S071', null, 'Y'), ('EMP001', 'M006', 'S072', null, 'Y');
insert into Other_Vendor_Master(vendor_code, name, vendor_type, vendor_Mode, Branch, address, pin_code, vendor_phone_no, pan_no, Gstin_No, TDS, IsCostProfit, FTLDiv)
values ('OV001', 'SHARMA STATIONERY', 'Supplier', 'RD', 'B1002', 'Shop 4, Andheri East, Mumbai', '400069', '9800000001', 'AAAPS0000A', '27AAAPS0000A1Z5', 2, 1, 'DIV1001'),
       ('OV002', 'CITY ELECTRICALS', 'Service', 'RD', 'B1002', 'Plot 9, Kurla West, Mumbai', '400070', '9800000002', 'AAAPC0000B', '27AAAPC0000B1Z3', 0, 0, 'DIV1001');
insert into ProductMaster(ProductCode, ProductName, IsSacHsn, SacHSN, UOM) values
  ('P001', 'A4 PAPER REAM', 0, '4802', 'REAM'), ('P002', 'TONER CARTRIDGE', 0, '8443', 'PCS'),
  ('S001', 'AC REPAIR SERVICE', 1, '998719', 'JOB'), ('S002', 'HOUSEKEEPING SERVICE', 1, '998533', 'MONTH');
insert into tblAccountLedger(LedgerCode, LedgerName, GroupCode, Ledger_Type, OpeningBal, VendorOrClientCode, DrCr, Financial_Year, Division, IsActive)
select l.code + '-' + left(fy.Financial_Year, 4), l.name, l.grp, l.typ, 0, l.vnd, l.drcr, fy.Financial_Year, 'DIV1001', 1
  from (values
    ('LVOV001', 'SHARMA STATIONERY:OV001', 'G01', 'Vendor', 'CR', 'OV001'), ('LVOV002', 'CITY ELECTRICALS:OV002', 'G01', 'Vendor', 'CR', 'OV002'),
    ('LICGST', 'INPUT CGST', 'G03', 'Asset', 'DR', null), ('LISGST', 'INPUT SGST', 'G03', 'Asset', 'DR', null),
    ('LIIGST', 'INPUT IGST', 'G03', 'Asset', 'DR', null),
    ('LTDSP', 'TDS PAYABLE', 'G03', 'Liability', 'CR', null), ('LTDS194C', 'TDS PAYABLE 194C', 'G03', 'Liability', 'CR', null),
    ('LTDS194J', 'TDS PAYABLE 194J', 'G03', 'Liability', 'CR', null),
    ('LEXOFF', 'OFFICE EXPENSES', 'G009', 'Expense', 'DR', null), ('LEXPRN', 'PRINTING & STATIONERY', 'G009', 'Expense', 'DR', null),
    ('LEXRPM', 'REPAIR & MAINTENANCE', 'G009', 'Expense', 'DR', null)
  ) as l(code, name, grp, typ, drcr, vnd)
  cross join Financial_Year fy
 where not exists (select 1 from tblAccountLedger x where x.LedgerName = l.name and x.Financial_Year = fy.Financial_Year);


-- ---------------------------------------------------------------- Franchisee commission invoices (38-franchisee-invoice.sql)
insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division) values
  ('M006', 'S073', 'Franchisee Commission Invoice', 'Invoice/Franchisee_Commission_Invoice.aspx', 'Y', 'DIV1001,DIV1002,DIV1003'),
  ('M006', 'S074', 'Franchisee Invoice Cancel', 'Invoice/Franchisee_Invoice_Cancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values
  ('EMP001', 'M006', 'S073', null, 'Y'), ('EMP001', 'M006', 'S074', null, 'Y');

-- Account Master (S075), the ACCOUNTS menu M007 with Contra (S076/S077) and Payment (S078/S079) are inserted by
-- 39-account-master.sql, 40-contra-entry.sql and 41-payment-entry.sql (idempotent; they run before this file).

-- ---------------------------------------------------------------- GENERAL MASTER / MASTER split (46-master-menus.sql)
-- 46 runs before this file on a fresh database: apply its menu split now that the seeded menu rows exist.
exec usp_ApplyMasterMenus;
