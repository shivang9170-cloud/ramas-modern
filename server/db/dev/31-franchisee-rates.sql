-- =============================================================================
-- DEV-ONLY: franchisee rates (Rate/Franchisee_Commission_Master.aspx, Rate/Franchisees_Pickup_Delivery.aspx).
--   * Franchisee_Commission_Master (+ _Detail): what franchisees earn — monthly rent / mobile / signage, commission on the
--     base freight and, by mode: road rows per booking type (LTL up to 3 t / 3–6 t %, FTL 3–6 t and 9–16 t per vehicle
--     type: per consignment + share %, FTL trailer per vehicle + share %), train (% and per rail), air (%).
--     Columns from the DLL's inserts.
--   * FranchiseeCommissionMaster: a franchisee's pickup charge and delivery commission per consignment, by document type
--     (per document) or weight band (non document), from an effective date. Columns from the DLL's select.
-- =============================================================================

if object_id('Franchisee_Commission_Master') is null
  create table Franchisee_Commission_Master (
    CommId int identity primary key, Comm_Code varchar(20) not null, Agent_Type varchar(30), Rent decimal(18,2) default 0,
    Mobile_Bills decimal(18,2) default 0, Signage_Payment decimal(18,2) default 0, Commission_Mode varchar(20), Booking_Type varchar(20),
    Mode varchar(5), Comm_On_Base_Freight decimal(18,2) default 0, Air_Commission decimal(18,2) default 0,
    Train_Commission decimal(18,2) default 0, Train_V_Commission decimal(18,2) default 0, StartDate date, EndDate date,
    EffectiveDate date, UserId varchar(50), Created_Date datetime default getdate());
if object_id('Franchisee_Commission_Master_Detail') is null
  create table Franchisee_Commission_Master_Detail (
    id int identity primary key, CommId varchar(20) not null, Booking_Type varchar(20), Commission_1 varchar(60),
    Commission_2 varchar(60), Commission_3 varchar(60), Commission_4 varchar(60));
GO

if object_id('FranchiseeCommissionMaster') is null
  create table FranchiseeCommissionMaster (
    id int identity primary key, FranchiseeCode varchar(20) not null, Pickup decimal(18,2) default 0, PerCon decimal(18,2) default 0,
    PreDocument varchar(30), NonDockname varchar(30), Effective_Date date, User_Id varchar(50), Financial_Year varchar(20),
    Created_Date datetime default getdate());
GO
