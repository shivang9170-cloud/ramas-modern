-- Masters split into two top menus (2026-10-09):
--   M001  GENERAL MASTER  places, codes and look-up lists: state, zone, city, district, location, commodity, package,
--                         department, division, container, vehicle name / maker, train, courier, product, modes, charge
--                         codes, undelivered reasons, nature of business, distance, SAC
--   M008  MASTER          business parties and their rates: branch, vendor, market vendor, vehicle, driver, client,
--                         consignor / consignee, employee, account master, all rate masters
-- The moved sub menus keep their ids; every user permission on them is moved to M008 too, so nobody loses access.
-- New masters (generic master screen, server/src/modules/masters/definitions.js) get S101.. ; users who could open
-- masters of a menu get its new masters. The menu sorts M008 right after M001 (server/src/modules/menu/menu.service.js).
-- The work is in usp_ApplyMasterMenus, run here and again at the end of 99-seed.sql (a fresh dev database seeds its
-- menu after this file). Safe to re-run.

create or alter procedure usp_ApplyMasterMenus as
begin
  set nocount on;

  update MasterMenu set MenuName = 'GENERAL MASTER' where Menuid = 'M001' and MenuName <> 'GENERAL MASTER';
  if not exists (select 1 from MasterMenu where Menuid = 'M008')
    insert into MasterMenu(Menuid, MenuName, MenuUrl, ActiveStatus) values ('M008', 'MASTER', '#', 'Y');

  -- business masters move to M008
  declare @move table (id varchar(10) primary key);
  insert into @move values ('S008'), ('S009'), ('S021'), ('S022'), ('S023'), ('S024'), ('S025'), ('S026'), ('S027'), ('S028'),
    ('S029'), ('S056'), ('S057'), ('S058'), ('S075');
  update SubMenu set Menuid = 'M008' where Menuid = 'M001' and SubMenuid in (select id from @move);
  update Sub_SubMenu set Menuid = 'M008' where Menuid = 'M001' and SubMenuid in (select id from @move);
  update Employee_Permission set MainMenuid = 'M008' where MainMenuid = 'M001' and Sub_Menuid in (select id from @move);
  update Franchisee_Permission set MainMenuid = 'M008' where MainMenuid = 'M001' and Sub_Menuid in (select id from @move);
  update Client_Permission set MainMenuid = 'M008' where MainMenuid = 'M001' and Sub_Menuid in (select id from @move);

  -- new masters (all divisions)
  declare @divs varchar(500) = isnull((select string_agg(rtrim(DivCode), ',') from DivisionMaster), 'DIV1001,DIV1002,DIV1003');
  -- batch: masters added together; see the grant below
  declare @new table (batch int, menu varchar(10), id varchar(10), name varchar(100), url varchar(200));
  insert into @new values
    (1, 'M001', 'S101', 'District Master', 'General/District_Master.aspx'),
    (1, 'M001', 'S102', 'Location Master', 'General/NewLocationMaster.aspx'),
    (1, 'M001', 'S103', 'Container / Freight Type', 'General/Container_Master.aspx'),
    (1, 'M001', 'S104', 'Vehicle Name Master', 'General/VehicleName_Master.aspx'),
    (1, 'M001', 'S105', 'Vehicle Maker Master', 'General/Vehicle_Maker_Master.aspx'),
    (1, 'M001', 'S106', 'Train Master', 'General/Train_Master.aspx'),
    (1, 'M001', 'S107', 'Courier Master', 'Master/Courier_Master.aspx'),
    (1, 'M001', 'S108', 'Product / Service Master', 'General/Product_Master.aspx'),
    (1, 'M001', 'S109', 'Booking Mode Master', 'General/Booking_Mode_Master.aspx'),
    (1, 'M001', 'S110', 'Delivery Mode Master', 'General/Delivery_Mode_Master.aspx'),
    (1, 'M001', 'S111', 'Charge Code Master', 'General/Charge_Code_Master.aspx'),
    (1, 'M001', 'S112', 'Undelivered Reason Master', 'General/Sla_Stock_Reason_Master.aspx'),
    (1, 'M001', 'S113', 'Nature Of Business Master', 'General/Nature_Of_Business_Master.aspx'),
    (1, 'M001', 'S114', 'Distance Master', 'General/Distance_Master.aspx'),
    (1, 'M001', 'S115', 'SAC Code Master', 'General/Sac_Master.aspx'),
    (1, 'M008', 'S116', 'Driver Master', 'General/Driver_Master.aspx'),
    (1, 'M008', 'S117', 'Consignor / Consignee Master', 'Master/ConsignerConsignee.aspx'),
    (1, 'M008', 'S118', 'Market / Temporary Vendor', 'Master/Temporary_Vendor_Master.aspx'),
    (2, 'M001', 'S119', 'Designation Master', 'General/Designation_Master.aspx'),
    -- international (47-business-international.sql)
    (3, 'M001', 'S120', 'Country Master', 'General/Country_Master.aspx'),
    (3, 'M001', 'S121', 'Port / Airport Master', 'General/Port_Master.aspx'),
    (3, 'M001', 'S122', 'Currency Master', 'General/Currency_Master.aspx'),
    (3, 'M001', 'S123', 'Airline / Shipping Line Master', 'General/AirLine_Master.aspx');
  insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division)
  select n.menu, n.id, n.name, n.url, 'Y', @divs from @new n where not exists (select 1 from SubMenu s where s.SubMenuid = n.id);

  -- users who could open masters of a menu get the new masters of that menu once (admin always sees every menu item);
  -- a permission an administrator later removes is not given back: a batch is granted only to users who have none of it
  insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus)
  select distinct p.Employeeid, n.menu, n.id, null, 'Y'
    from @new n
    join Employee_Permission p on p.MainMenuid = n.menu and isnull(p.ActiveStatus, 'Y') = 'Y' and p.Sub_Menuid not in (select id from @new)
   where not exists (select 1 from Employee_Permission x where x.Employeeid = p.Employeeid
                        and x.Sub_Menuid in (select id from @new b where b.batch = n.batch and b.menu = n.menu));
end
GO

exec usp_ApplyMasterMenus;
GO
