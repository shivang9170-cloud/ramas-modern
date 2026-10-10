-- =============================================================================
-- DEV-ONLY: the Setting folder (Setting/*.aspx). Tables the pages use that the dev database did not have yet, the
-- columns they add to existing ones, and stand-ins for the procedures whose bodies are not in the source. Column names
-- are from the pages' inline SQL, grid DataFields and PAL fields; see docs/SCHEMA-VERIFICATION.md "Settings".
-- =============================================================================

-- ------------------------------------------------------------------ Bind_Destinationtobranch: cities a branch delivers
if object_id('Branch_bind_For_city') is null
  create table Branch_bind_For_city (
    slno int identity primary key, state_code varchar(20), city_code varchar(20), BindTo varchar(20),
    IsCourier bit default 0, IsParcel bit default 0, IsFTL bit default 0, active_flag bit default 1,
    FranchiseeType int default 0, created_by varchar(50), created_date datetime default getdate());
GO

-- ------------------------------------------------------------------ Franchisee_Bind_Branch: franchisee ↔ branch
if col_length('Bind_Franch_Branch', 'Status') is null alter table Bind_Franch_Branch add Status bit not null default 1;
if col_length('Bind_Franch_Branch', 'Franchise_Type') is null alter table Bind_Franch_Branch add Franchise_Type int not null default 1;
if col_length('Bind_Franch_Branch', 'Created_by') is null alter table Bind_Franch_Branch add Created_by varchar(50), Created_Date datetime default getdate();
if col_length('Franchise_Master', 'busslocation') is null alter table Franchise_Master add busslocation varchar(20);
if col_length('MasterFranchise', 'newlocation') is null alter table MasterFranchise add newlocation varchar(20);
GO

-- ------------------------------------------------------------------ Bind_Franchisee_to_Client / Franchisee_to_Client_View
if object_id('Bind_Franchisee_To_Client') is null
  create table Bind_Franchisee_To_Client (
    UniqueNo int identity primary key, FranchiseeID int not null, ClientID varchar(20) not null, IsActive bit not null default 1,
    Created_By varchar(50), Created_Date datetime default getdate(), Modified_By varchar(50), Modified_Date datetime);
GO

-- ------------------------------------------------------------------ ChangeDocket_FY
if col_length('grn_master', 'Old_Financial_Year') is null alter table grn_master add Old_Financial_Year varchar(20);
if col_length('grn_master', 'Invoice_status') is null alter table grn_master add Invoice_status varchar(50);
if col_length('grn_docket_charge', 'Financial_Year') is null alter table grn_docket_charge add Financial_Year varchar(20);
GO
-- body not in the source: the docket's own account entries move to the new financial year
create or alter procedure usp_Update_DocketFinancial_Year @docket varchar(30), @Financial_Year varchar(20)
as
begin
  set nocount on;
  update tblAccountTrasaction set Financial_Year = @Financial_Year where VoucherNo = @docket and isnull(IsCancelled, 0) = 0;
end
GO

-- ------------------------------------------------------------------ ODA_Master_And_Configuration
if object_id('ODA_Distance_Master') is null
  create table ODA_Distance_Master (
    ID int identity primary key, from_distance int not null, to_distance int not null, distance_name varchar(60),
    IsActive bit not null default 1, created_by varchar(50), created_date datetime default getdate(), modified_by varchar(50), modified_date datetime);
if object_id('ODA_Weight_Master') is null
  create table ODA_Weight_Master (
    ID int identity primary key, from_weight int not null, to_weight int not null, weight_name varchar(60),
    IsActive bit not null default 1, created_by varchar(50), created_date datetime default getdate(), modified_by varchar(50), modified_date datetime);
if object_id('ODA_Configuration_Master') is null
  create table ODA_Configuration_Master (
    ID int identity primary key, ODA_Distance_ID int not null, ODA_Weight_ID int not null, ODA_Rate decimal(18,2) not null,
    Effective_Date date not null, IsActive bit not null default 1, created_by varchar(50), created_date datetime default getdate(),
    modified_by varchar(50), modified_date datetime);
GO

-- ------------------------------------------------------------------ Shiper_Master / GatePassShiper_Master / issues
if object_id('shipper_master') is null
  create table shipper_master (
    id int identity primary key, shipper_type varchar(50), receving_date date, starting_series varchar(30), End_series varchar(30),
    Total_quantity int, received_from varchar(100), type varchar(20), GRN_Type varchar(5), Division varchar(20),
    BookLet_Series varchar(30), BookLet_Series_Status varchar(30), created_by varchar(50), created_date datetime default getdate());
if object_id('GatePasshipper_master') is null
  create table GatePasshipper_master (
    id int identity primary key, shipper_type varchar(50), receving_date date, starting_series varchar(30), End_series varchar(30),
    Total_quantity int, received_from varchar(100), type varchar(20), GRN_Type varchar(5), Division varchar(20),
    BookLet_Series varchar(30), BookLet_Series_Status varchar(30), created_by varchar(50), created_date datetime default getdate());
if object_id('shiper_issue_to_branch') is null
  create table shiper_issue_to_branch (
    slno int identity primary key, shipper_type varchar(50), branch_code varchar(20), starting_series varchar(30), endseries varchar(30),
    total_quantity int, issue_date date, GRN_Type varchar(5), DivCode varchar(20), Client_Code varchar(20), type varchar(20),
    IsFranchisee bit not null default 0, UserId varchar(50), PerShiperCharge decimal(18,2) default 0, TotalShiperCharge decimal(18,2) default 0,
    created_date datetime default getdate());
if object_id('Shipper_issue_frombranch_tobranch') is null
  create table Shipper_issue_frombranch_tobranch (
    id int identity primary key, shipper_type varchar(50), issue_from_branch varchar(20), issue_to_branch varchar(20),
    shippers_issued_id int, shipper_no varchar(30), issue_date datetime, division varchar(20), user_id varchar(50),
    isCancel bit not null default 0, Cancel_by varchar(50), Cancel_date datetime);
GO

-- ------------------------------------------------------------------ Special_Booking_Approval
if object_id('grn_master_splapl') is null
  create table grn_master_splapl (
    slno int identity primary key, docket_no varchar(30) not null, originbranch varchar(100), destinationbranch varchar(100),
    Consigner_Name varchar(200), consignee_name varchar(200), pcs int, actual_weight decimal(18,2), charge_weight decimal(18,2),
    freight decimal(18,2), Rate decimal(18,2), Discount decimal(18,2), spldiscount decimal(18,2), Division varchar(20),
    booking_type varchar(30), booking_date date, on_account_of varchar(200), Approve_status varchar(20), User_Id varchar(50),
    approval_date datetime, second_approval varchar(50), sec_app_date datetime, third_approval varchar(50), thrdapprovaldate datetime,
    final_approval varchar(50), finalapprovaldate datetime, rejected varchar(50), rejected_date datetime, remarks varchar(500));
GO

-- ------------------------------------------------------------------ Freight_THC_Margin_Approval
if object_id('Freight_THC_Margin_Approval_Details') is null
  create table Freight_THC_Margin_Approval_Details (
    ID int identity primary key, challan_no varchar(30) not null, branch_code varchar(20), div_code varchar(20),
    docket_freight decimal(18,2), thc_freight decimal(18,2), margin decimal(18,2), margin_per decimal(18,2),
    IsApprove bit not null, remarks varchar(500), approved_by varchar(50), approved_date datetime default getdate());
if object_id('Freight_Margin_Setting') is null
  create table Freight_Margin_Setting (id int primary key, Min_Margin_Per decimal(18,2) not null, modified_by varchar(50), modified_date datetime);
if not exists (select 1 from Freight_Margin_Setting) insert into Freight_Margin_Setting(id, Min_Margin_Per) values (1, 10);
GO

-- ------------------------------------------------------------------ Vendor_and_vehicle
if col_length('vendor_vehicle_master', 'engine_no') is null
  alter table vendor_vehicle_master add engine_no varchar(50), truck_no varchar(30), chasis_no varchar(50), model varchar(50),
    make varchar(50), validity varchar(20), capacity varchar(50), of_state varchar(50), train_type varchar(30),
    Vehicle_Capacity int default 0, Container_Size varchar(30), Direction varchar(10), Status bit not null default 1,
    created_by varchar(50), created_date datetime default getdate();
if object_id('Train_Master') is null
  create table Train_Master (TrainCode varchar(20) primary key, TrainName varchar(100), Directions varchar(10), active_flag varchar(10) default 'Active');
if object_id('VehicleName_Master') is null
  create table VehicleName_Master (no int identity primary key, vehicle_name varchar(100), active_flag varchar(10) default 'Active');
GO

-- ------------------------------------------------------------------ MIS_Report_Auto
if object_id('AutoMis_setting') is null
  create table AutoMis_setting (isActive bit, MailTime1 varchar(10), MailTime2 varchar(10), ActiveDeactive_date date, FromBackDays int,
    modified_by varchar(50), modified_date datetime);
if object_id('Client_email') is null
  create table Client_email (id int identity primary key, client_code varchar(20), email varchar(200), selectd_column varchar(200),
    isCancel bit not null default 0, created_by varchar(50), created_date datetime default getdate());
if object_id('Auto_MIS_Column_Master') is null
  create table Auto_MIS_Column_Master (index_id int primary key, column_Name varchar(100), field varchar(60), isActive bit default 1);
if object_id('Auto_MIS_Header_footer') is null
  create table Auto_MIS_Header_footer (id int identity primary key, Header varchar(max), footer varchar(max), created_by varchar(50),
    created_date datetime default getdate());
if object_id('MIS_Report') is null
  create table MIS_Report (id int identity primary key, Docket_No varchar(30), Send_Date varchar(30), Delivery_Status varchar(50),
    Delivery_date date, Email_Id varchar(200));
GO
