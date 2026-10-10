-- =============================================================================
-- DEV-ONLY: vendor rate masters (Rate/Vendor_Road_Rate_Master, Vendor_Air_Rate_Master, Vendor_Train_Rate_Master).
-- What we pay a vendor to carry our load: by road (FTL lump sum / FTL per km, per kg, per km), by air (per kg with weight
-- slabs, or the airline charges for our own consignments) and by train (per kg or a full-container trip cost).
-- Columns from the pages' grids, PAL fields and inline SQL; see docs/SCHEMA-VERIFICATION.md "Vendor rates".
-- =============================================================================

-- the dev table had only (slno, vendor_type, vendor_name)
if col_length('vendor_road_rate_master', 'origin') is null
  alter table vendor_road_rate_master add vehicle_type varchar(50), rate_mode varchar(20), capacity varchar(50),
    origin varchar(20), destination varchar(20), ftl_amount decimal(18,2) default 0, ftl_pkg decimal(18,2) default 0,
    ftl_pkm decimal(18,2) default 0, Route_Code varchar(20), Route_Name varchar(100), Effective_Date date, StartDate date,
    EndDate date, FTL_Rate_Type varchar(20), Is_Self bit default 0, IsActive bit not null default 1, created_by varchar(50),
    created_date datetime default getdate();
GO

if object_id('Vendor_Air_RateMaster') is null
  create table Vendor_Air_RateMaster (
    Slno int identity primary key, Air_Rate_Code varchar(20) not null, Is_Slab_Rate varchar(20), Vendor_type varchar(20),
    vendor_code varchar(20), Flight_shift varchar(20), Origin_city varchar(20), Destination_city varchar(20),
    Airline_Code varchar(30), Airline_Name varchar(100), upto_weight decimal(18,2) default 0, upto_wt_charge decimal(18,2) default 0,
    Rate_pkg decimal(18,2) default 0, AWBDO decimal(18,2) default 0, FSC_Pkg decimal(18,2) default 0, Unit_Pkg decimal(18,2) default 0,
    MinUnit_Charge decimal(18,2) default 0, Xray_Pkg decimal(18,2) default 0, MinXray_Charge decimal(18,2) default 0,
    TSPOut_Pkg decimal(18,2) default 0, MinTsp_Charge decimal(18,2) default 0, TSPIN_Charge decimal(18,2) default 0,
    MinTSPIn_Charge decimal(18,2) default 0, STax decimal(18,2) default 0, Effective_Date date, Start_Date date, End_Date date,
    IsActive bit not null default 1, Created_By varchar(50), Created_Date datetime default getdate());
if object_id('Vendor_Air_Slab_Rate') is null
  create table Vendor_Air_Slab_Rate (
    Slno int identity primary key, Air_Rate_Code varchar(20) not null, From_Weight decimal(18,2), To_Weight decimal(18,2),
    Rate decimal(18,2), Created_By varchar(50), Created_Date datetime default getdate());
GO

if object_id('Vendor_Train_Rate') is null
  create table Vendor_Train_Rate (
    slno int identity primary key, vendor_type varchar(20), vendor_name varchar(20), traintype varchar(20), train_no varchar(20),
    origin varchar(20), destination varchar(20), dd_amount decimal(18,2) default 0, rate decimal(18,2) default 0,
    ratetype varchar(5), TripCost decimal(18,2) default 0, Effective_Date date, IsActive bit not null default 1,
    User_Id varchar(50), LastUpdate datetime default getdate());
GO
