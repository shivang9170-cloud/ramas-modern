-- =============================================================================
-- DEV-ONLY schema for local testing of the pilot modules.
--
-- Inferred from the legacy C# code (column names used in SQL / DataRow access).
-- It is NOT the production schema. Once the real "Generate Scripts" output is
-- available, point the API at a restored copy of the real DB instead.
-- =============================================================================

-- ---------------------------------------------------------------- login lookups
create table DivisionMaster (Id int identity primary key, DivCode varchar(20) not null unique, DivName varchar(100), Domain varchar(100), CompanyCode varchar(20), IsActive bit default 1);
create table CompanyMster (SlNo int identity primary key, CName varchar(200), CCode varchar(20), Division varchar(20), LogoPath varchar(300));
create table Financial_Year (ID int identity primary key, Financial_Year varchar(20), Status varchar(10));

-- ---------------------------------------------------------------- users
create table users (id int identity primary key, user_id varchar(50) not null unique, user_password varchar(100), user_type varchar(20), user_emp_type varchar(50), user_branch varchar(500), DivCode varchar(20));
create table Franchisee_Users (id int identity primary key, user_id varchar(50) not null unique, user_password varchar(100), user_branch varchar(500));
create table ClientLogin_Users (id int identity primary key, user_id varchar(50) not null unique, user_password varchar(100), client_name varchar(200), user_branch varchar(500), home_branch varchar(100), branch_code varchar(20), DivCode varchar(20));
create table employee_master (empid int identity primary key, empcode varchar(50) not null unique, empname varchar(200), DivCode varchar(20), IsActive bit default 1, branch varchar(20));

-- ---------------------------------------------------------------- geography
create table state_master (id int identity primary key, state_code varchar(10) not null unique, state_name varchar(100), StateCode varchar(5), Gstin_No varchar(20), active_flag varchar(10));
create table zone_master (slno int identity primary key, zone_code varchar(10) not null unique, zone_name varchar(100), zone_description varchar(250), active_flag varchar(10));
create table DistrictMaster (id int identity primary key, DistrictCode varchar(20) unique, DistrictName varchar(100), DistrictState varchar(10), status varchar(10));
create table city_master (id int identity primary key, city_code varchar(10) not null unique, city_name varchar(100), state_code varchar(10), zone_code varchar(10), Districtcode varchar(20), oda varchar(5) default 'no', oda_km int default 0, permit varchar(5), active_flag varchar(10), BindTo varchar(20));
create table New_Location_master (id int identity primary key, Location_Code varchar(20), City_Code varchar(10), State_code varchar(10));

-- ---------------------------------------------------------------- branches / franchise / clients
create table branch_master (branchid int identity primary key, branch_code varchar(20) not null unique, branch_name varchar(100), city_code varchar(10), state_code varchar(10), zone_code varchar(10), status varchar(10), IsFranchisee varchar(5), IsMasterFranchisee varchar(5), short_code varchar(10), company varchar(20), ControllingBranch varchar(20));
create table Bind_Franch_Branch (id int identity primary key, Franchise_Code varchar(50), Branch_Code varchar(20));
create table MasterFranchise (id int identity primary key, FranCode varchar(50), FranName varchar(200), State varchar(10), Zone varchar(10), city varchar(10));
create table Franchise_Master (id int identity primary key, FranCode varchar(50), FranName varchar(200), State varchar(10), Zone varchar(10), city varchar(10));
create table client_Master (id int identity primary key, client_code varchar(50), client_name varchar(200), city varchar(10));

-- ---------------------------------------------------------------- menu + permissions
create table MasterMenu (Menuid varchar(10) primary key, MenuName varchar(100), MenuUrl varchar(300), ActiveStatus char(1));
create table SubMenu (Menuid varchar(10), SubMenuid varchar(10) primary key, SubMenuName varchar(100), SubMenuUrl varchar(300), ActiveStatus char(1), division varchar(200));
create table Sub_SubMenu (SubSubMenuId varchar(10) primary key, Menuid varchar(10), SubMenuid varchar(10), SubMenuName varchar(100), SubMenuUrl varchar(300), ActiveStatus char(1), division varchar(200));
create table Employee_Permission (id int identity primary key, Employeeid varchar(50), MainMenuid varchar(10), Sub_Menuid varchar(10), Sub_SubMenuid varchar(10), ActiveStatus char(1));
create table Franchisee_Permission (id int identity primary key, Employeeid varchar(50), MainMenuid varchar(10), Sub_Menuid varchar(10), Sub_SubMenuid varchar(10), ActiveStatus char(1));
create table Client_Permission (id int identity primary key, ClientId varchar(50), MainMenuid varchar(10), Sub_Menuid varchar(10), Sub_SubMenuid varchar(10), ActiveStatus char(1));
create table MainDashboard_Access (id int identity primary key, empCode varchar(50), MenuName varchar(50), isActive bit);

-- ---------------------------------------------------------------- simple masters
create table Commodity_master (slno int identity primary key, Commodity_code varchar(20) not null unique, Commodity_name varchar(100), active_flag varchar(10));
create table item_master (slno int identity primary key, item_code varchar(20) not null unique, item_name varchar(100), active_flag varchar(10));
create table HeadOfficeDepartmentMaster (id int identity primary key, DepartmentCode varchar(20) not null unique, DepartmentName varchar(100));

-- docket header (minimal: only what the masters' in-use checks touch; the
-- docket module adds its own columns in 03-docket.sql)
create table grn_master (id int identity primary key, docket_no varchar(30), item_content varchar(20));
