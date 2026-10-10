-- =============================================================================
-- DEV-ONLY: client contract rates, stage 2 — Location / State / Zone (Rate/Client_Contract.aspx).
-- Same columns as client_contract_city (18-contract.sql) except the origin / destination columns, as the page's
-- inline INSERTs name them (client_contract_location, client_contract_State, client_contract_zone). EntRef prefixes:
-- RMEL- (location), RMEZ- (zone) from the DLL; RMES- (state) is not in the DLL — see docs/SCHEMA-VERIFICATION.md.
-- =============================================================================

create table client_contract_location (
  slno int identity primary key, EntRef varchar(20), contract_type varchar(30), RateType varchar(20), BookingType varchar(20),
  DocsType varchar(2), Division varchar(20), client_id varchar(50), client_code varchar(50), billingat varchar(20),
  origin_location varchar(20), destination_location varchar(20), mode_id varchar(10), delivery_mode varchar(20), rate_on varchar(20),
  ftl_type varchar(20), LoadType varchar(10), rate decimal(18,3) default 0, FtlRate decimal(18,2) default 0, frt decimal(18,2) default 0,
  minchargewt decimal(18,2) default 0, minchargebox decimal(18,2) default 0, minFreight decimal(18,2) default 0,
  VolumetricWeight decimal(18,2) default 0, Expected_Days int default 0, sour_charge decimal(18,2) default 0,
  FuleCharge decimal(18,2) default 0, state decimal(18,2) default 0, fov decimal(18,2) default 0, FovFlatRate varchar(20),
  oda decimal(18,2) default 0, ocr decimal(18,2) default 0, dly decimal(18,2) default 0, collection_charge decimal(18,2) default 0,
  Min_Collection_Charge decimal(18,2) default 0, Min_Delivery_Charge decimal(18,2) default 0, logistic_charge decimal(18,2) default 0,
  dod decimal(18,2) default 0, risk_charge decimal(18,2) default 0, handling_charge decimal(18,2) default 0,
  Service_charge decimal(18,2) default 0, ocs decimal(18,2) default 0, halthing_charge decimal(18,2) default 0,
  hamali_charge decimal(18,2) default 0, TopayCharge decimal(18,2) default 0, LoadingCharge varchar(20), MinLoadingCharge varchar(20),
  UnLoadingCharge varchar(20), MinUnLoadingCharge varchar(20), InvoiceValueMin varchar(20), InvoiceValueMax varchar(20),
  totaldistance varchar(20), perkmperkg_rate decimal(18,3) default 0, Hike varchar(20), Discount decimal(18,2) default 0,
  discount_type varchar(10), admincharge decimal(18,2) default 0, adminchrgper decimal(18,2) default 0, basefrt decimal(18,2) default 0,
  col_charge_IsPerBox bit default 0, del_charge_IsPerBox bit default 0, notification_days varchar(10),
  start_date date, end_date date, effective_from date, status varchar(10) default 'Active', User_Id varchar(50),
  created_date datetime default getdate(), Edit_By varchar(50), Edit_Date datetime);
GO

create table client_contract_State (
  slno int identity primary key, EntRef varchar(20), contract_type varchar(30), RateType varchar(20), BookingType varchar(20),
  DocsType varchar(2), Division varchar(20), client_id varchar(50), client_code varchar(50), billingat varchar(20),
  origin_State varchar(20), destination_State varchar(20), mode_id varchar(10), delivery_mode varchar(20), rate_on varchar(20),
  ftl_type varchar(20), LoadType varchar(10), rate decimal(18,3) default 0, FtlRate decimal(18,2) default 0, frt decimal(18,2) default 0,
  minchargewt decimal(18,2) default 0, minchargebox decimal(18,2) default 0, minFreight decimal(18,2) default 0,
  VolumetricWeight decimal(18,2) default 0, Expected_Days int default 0, sour_charge decimal(18,2) default 0,
  FuleCharge decimal(18,2) default 0, state decimal(18,2) default 0, fov decimal(18,2) default 0, FovFlatRate varchar(20),
  oda decimal(18,2) default 0, ocr decimal(18,2) default 0, dly decimal(18,2) default 0, collection_charge decimal(18,2) default 0,
  Min_Collection_Charge decimal(18,2) default 0, Min_Delivery_Charge decimal(18,2) default 0, logistic_charge decimal(18,2) default 0,
  dod decimal(18,2) default 0, risk_charge decimal(18,2) default 0, handling_charge decimal(18,2) default 0,
  Service_charge decimal(18,2) default 0, ocs decimal(18,2) default 0, halthing_charge decimal(18,2) default 0,
  hamali_charge decimal(18,2) default 0, TopayCharge decimal(18,2) default 0, LoadingCharge varchar(20), MinLoadingCharge varchar(20),
  UnLoadingCharge varchar(20), MinUnLoadingCharge varchar(20), InvoiceValueMin varchar(20), InvoiceValueMax varchar(20),
  totaldistance varchar(20), perkmperkg_rate decimal(18,3) default 0, Hike varchar(20), Discount decimal(18,2) default 0,
  discount_type varchar(10), admincharge decimal(18,2) default 0, adminchrgper decimal(18,2) default 0, basefrt decimal(18,2) default 0,
  col_charge_IsPerBox bit default 0, del_charge_IsPerBox bit default 0, notification_days varchar(10),
  start_date date, end_date date, effective_from date, status varchar(10) default 'Active', User_Id varchar(50),
  created_date datetime default getdate(), Edit_By varchar(50), Edit_Date datetime);
GO

create table client_contract_zone (
  slno int identity primary key, EntRef varchar(20), contract_type varchar(30), RateType varchar(20), BookingType varchar(20),
  DocsType varchar(2), Division varchar(20), client_id varchar(50), client_code varchar(50), billingat varchar(20),
  origin_zone varchar(20), destination_zone varchar(20), mode_id varchar(10), delivery_mode varchar(20), rate_on varchar(20),
  ftl_type varchar(20), LoadType varchar(10), rate decimal(18,3) default 0, FtlRate decimal(18,2) default 0, frt decimal(18,2) default 0,
  minchargewt decimal(18,2) default 0, minchargebox decimal(18,2) default 0, minFreight decimal(18,2) default 0,
  VolumetricWeight decimal(18,2) default 0, Expected_Days int default 0, sour_charge decimal(18,2) default 0,
  FuleCharge decimal(18,2) default 0, state decimal(18,2) default 0, fov decimal(18,2) default 0, FovFlatRate varchar(20),
  oda decimal(18,2) default 0, ocr decimal(18,2) default 0, dly decimal(18,2) default 0, collection_charge decimal(18,2) default 0,
  Min_Collection_Charge decimal(18,2) default 0, Min_Delivery_Charge decimal(18,2) default 0, logistic_charge decimal(18,2) default 0,
  dod decimal(18,2) default 0, risk_charge decimal(18,2) default 0, handling_charge decimal(18,2) default 0,
  Service_charge decimal(18,2) default 0, ocs decimal(18,2) default 0, halthing_charge decimal(18,2) default 0,
  hamali_charge decimal(18,2) default 0, TopayCharge decimal(18,2) default 0, LoadingCharge varchar(20), MinLoadingCharge varchar(20),
  UnLoadingCharge varchar(20), MinUnLoadingCharge varchar(20), InvoiceValueMin varchar(20), InvoiceValueMax varchar(20),
  totaldistance varchar(20), perkmperkg_rate decimal(18,3) default 0, Hike varchar(20), Discount decimal(18,2) default 0,
  discount_type varchar(10), admincharge decimal(18,2) default 0, adminchrgper decimal(18,2) default 0, basefrt decimal(18,2) default 0,
  col_charge_IsPerBox bit default 0, del_charge_IsPerBox bit default 0, notification_days varchar(10),
  start_date date, end_date date, effective_from date, status varchar(10) default 'Active', User_Id varchar(50),
  created_date datetime default getdate(), Edit_By varchar(50), Edit_Date datetime);
GO


-- Billing branches with any contract for the client.
alter procedure Get_BillingAt @origin varchar(20), @destination varchar(100), @mode_id varchar(10), @ClientCode varchar(50),
  @OLocation varchar(60), @DLocation varchar(60), @BranchCode varchar(20), @DivCode varchar(20)
as
  select distinct u.billingat, b.branch_name as branch_Name
    from (select billingat, client_code, status, Division from client_contract_city
          union all select billingat, client_code, status, Division from client_contract_location
          union all select billingat, client_code, status, Division from client_contract_State
          union all select billingat, client_code, status, Division from client_contract_zone) u
    join branch_master b on b.branch_code = u.billingat
   where u.client_code = @ClientCode and u.status = 'Active' and isnull(u.Division, @DivCode) = @DivCode;
GO

-- The contract rate for a docket. All four contract tables have the same column order, so they are unioned by position;
-- the most specific match wins: location (only when the docket sends locations), then city, state, zone; within a
-- type the latest version effective on the booking date.
alter procedure sp_Select_Rate @OBranch varchar(20), @DBranch_Name varchar(100), @Booking_Mode varchar(10), @Client_Code varchar(50),
  @Rate_On varchar(20), @customer_type varchar(30), @FreightType varchar(30), @BookingDate varchar(20), @Booking_Type varchar(30),
  @DivCode varchar(20), @OLocation varchar(60), @DLocation varchar(60), @DocumentType varchar(2), @LoadType varchar(5), @delivery_mode varchar(20)
as
begin
  set nocount on;
  declare @on date = isnull(try_convert(date, @BookingDate), cast(getdate() as date));
  declare @oCity varchar(20), @oState varchar(20), @oZone varchar(20), @dCity varchar(20), @dState varchar(20), @dZone varchar(20);
  select @oCity = b.city_code, @oState = isnull(b.state_code, c.state_code), @oZone = isnull(b.zone_code, c.zone_code)
    from branch_master b left join city_master c on c.city_code = b.city_code where b.branch_code = @OBranch;
  select top 1 @dCity = city_code, @dState = state_code, @dZone = zone_code from city_master where city_name = @DBranch_Name;

  with u as (
    -- city first: a union takes its column names (origin_city, destination_city) from the first select
    select 2 as pri, x.* from client_contract_city x where x.origin_city = @oCity and x.destination_city = @dCity
    union all select 1, x.* from client_contract_location x
     where isnull(@OLocation, '') <> '' and isnull(@DLocation, '') <> '' and x.origin_location = @OLocation and x.destination_location = @DLocation
    union all select 3, x.* from client_contract_State x where x.origin_State = @oState and x.destination_State = @dState
    union all select 4, x.* from client_contract_zone x where x.origin_zone = @oZone and x.destination_zone = @dZone
  )
  select top 1 c.slno, c.billingat, b.branch_name as branch_Name, c.mode_id, '' as slr, '' as payment_basis, c.start_date, c.end_date,
         c.effective_from, c.status, c.client_id, c.delivery_mode, c.state, c.client_code, '' as vp, c.origin_city, c.destination_city,
         c.rate_on, '' as box_size, c.rate, c.fov, c.oda, c.ocr, c.dly, c.frt, c.contract_type, c.minchargewt, c.sour_charge,
         c.collection_charge, c.logistic_charge, c.dod, c.risk_charge, c.handling_charge, c.Service_charge, c.ocs, c.ftl_type, c.FtlRate,
         c.halthing_charge, c.minFreight, try_cast(c.LoadingCharge as decimal(18,2)) as LoadingCharge,
         try_cast(c.UnLoadingCharge as decimal(18,2)) as UnLoadingCharge, try_cast(c.MinLoadingCharge as decimal(18,2)) as MinLoadingCharge,
         try_cast(c.MinUnLoadingCharge as decimal(18,2)) as MinUnLoadingCharge, try_cast(c.InvoiceValueMin as decimal(18,2)) as InvoiceValueMin,
         try_cast(c.InvoiceValueMax as decimal(18,2)) as InvoiceValueMax, try_cast(c.FovFlatRate as decimal(18,2)) as FovFlatRate,
         c.TopayCharge, c.Discount as DisPrc, c.VolumetricWeight, 0 as ApproveDiscPrc, c.Min_Collection_Charge as min_Collection_Charge,
         c.Min_Delivery_Charge as min_Delivery_Charge, 0 as IsCollection, 0 as IsDelivery, c.discount_type as Discount_Type, c.basefrt,
         c.adminchrgper, c.hamali_charge, c.Expected_Days
    from u c
    left join branch_master b on b.branch_code = c.billingat
   where c.client_code = @Client_Code and c.mode_id = @Booking_Mode and upper(c.rate_on) = upper(@Rate_On) and c.status = 'Active'
     and isnull(c.Division, @DivCode) = @DivCode
     and c.effective_from <= @on and (c.start_date is null or c.start_date <= @on) and (c.end_date is null or c.end_date >= @on)
     and (@delivery_mode = '' or isnull(c.delivery_mode, '') in ('', @delivery_mode))
   order by c.pri, c.effective_from desc, c.slno desc;
end
GO
