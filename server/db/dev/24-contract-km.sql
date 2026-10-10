-- =============================================================================
-- DEV-ONLY: KM rates, stage 3 (Rate/Client_Contract.aspx, rate on KM).
-- A KM rate is a per-km rate (`rate`, also written to the per-km column: perkmperkg_rate, PerKMRate on the state
-- table as the page's State INSERT / UPDATE name it) with the route's distance (`totaldistance`); the docket's
-- freight is rate x distance. Distances come from Distance_Master (cities) / Distance_Location_Master (locations) —
-- the page's BindDistance / BindLocDis (`select distance from Distance_Location_Master where from_Location_code = …`).
-- See docs/SCHEMA-VERIFICATION.md.
-- =============================================================================

-- The state table's per-km column is PerKMRate (the page's State INSERT / UPDATE); renamed in place so the four tables
-- keep the same column order (sp_Select_Rate unions them by position).
if col_length('client_contract_State', 'PerKMRate') is null and col_length('client_contract_State', 'perkmperkg_rate') is not null
  exec sp_rename 'client_contract_State.perkmperkg_rate', 'PerKMRate', 'COLUMN';
GO

if object_id('Distance_Master') is null
  create table Distance_Master (
    slno int identity primary key, from_city_code varchar(20), to_city_code varchar(20), distance decimal(18,2),
    distance_status varchar(10) default 'True');
GO

if object_id('Distance_Location_Master') is null
  create table Distance_Location_Master (
    slno int identity primary key, from_Location_code varchar(20), from_location varchar(100), to_Location_code varchar(20),
    to_location varchar(100), distance decimal(18,2), distance_status varchar(10) default 'True');
GO

-- sp_Select_Rate also returns the KM rate's distance (the page read it from DisPrc — see SCHEMA-VERIFICATION.md).
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
         c.adminchrgper, c.hamali_charge, c.Expected_Days, c.RateType,
         try_cast(c.totaldistance as decimal(18,2)) as totaldistance
    from u c
    left join branch_master b on b.branch_code = c.billingat
   where dbo.dev_ContractRowMatches(@customer_type, @Booking_Type, @Client_Code, c.client_code, c.RateType) = 1
     and c.mode_id = @Booking_Mode and upper(c.rate_on) = upper(@Rate_On) and c.status = 'Active'
     and isnull(c.Division, @DivCode) = @DivCode
     and c.effective_from <= @on and (c.start_date is null or c.start_date <= @on) and (c.end_date is null or c.end_date >= @on)
     and (@delivery_mode = '' or isnull(c.delivery_mode, '') in ('', @delivery_mode))
   order by c.pri, c.effective_from desc, c.slno desc;
end
GO
