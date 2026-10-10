-- =============================================================================
-- DEV-ONLY: Paid / To Pay general rates, stage 3 (Rate/Client_Contract.aspx with ddlRateType = Paid / To Pay).
-- They are rows of the same four contract tables with RateType / BookingType 'Paid' or 'To Pay', no client
-- (client_id = client_code = '') and no billing branch (billingat = ''), as the page saved them. A docket for a
-- General Client (the page's ddlbookingtypegeneral: Paid / To Pay) takes these; a contractual client keeps its own
-- rates. This file teaches the dev stand-ins (sp_Select_Rate and the slab lookups of 20 / 21) that rule; the real
-- procedures' handling of general clients is not in the source — see docs/SCHEMA-VERIFICATION.md.
-- =============================================================================

-- Contract rows a docket may use: the client's own for a contractual client, the general Paid / To Pay rates (no client,
-- RateType = booking type) for a General Client.
create function dbo.dev_ContractRowMatches(@CustomerType varchar(30), @BookingType varchar(30), @ClientCode varchar(50),
  @rowClient varchar(50), @rowRateType varchar(20))
returns bit as
begin
  return case
    when @CustomerType = 'General Client'
      then case when isnull(@rowClient, '') = '' and isnull(@rowRateType, '') = @BookingType then 1 else 0 end
    else case when @rowClient = @ClientCode then 1 else 0 end
  end;
end
GO

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
         c.adminchrgper, c.hamali_charge, c.Expected_Days, c.RateType
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

-- The slab lookups: the same contract-row choice, now with the customer / booking type.
drop procedure usp_Get_OnAccountSlabRateWeight_Curier;
drop procedure usp_Get_OnAccountSlabDiscountWeight_Curier;
drop procedure usp_Get_OnAccountSlabApprovedDiscountWeight_Curier;
drop procedure usp_Get_OnAccountSlabRateWeight_Category;
drop function dbo.dev_ClientSlabBand;
drop function dbo.dev_ClientContractRef;
GO

create function dbo.dev_ClientContractRef(@origin varchar(20), @destination varchar(100), @mode_id varchar(10), @ClientCode varchar(50),
  @BookingDate varchar(20), @OLocation varchar(60), @DLocation varchar(60), @DivCode varchar(20), @Rateon varchar(20),
  @CustomerType varchar(30), @BookingType varchar(30))
returns table as return (
  with p as (
    select isnull(try_convert(date, @BookingDate), cast(getdate() as date)) as dt,
           o.city_code as oc, o.state_code as os, o.zone_code as oz, d.city_code as dc, d.state_code as ds, d.zone_code as dz
      from (select 1 as one) x
      left join city_master o on o.city_code = @origin
      outer apply (select top 1 city_code, state_code, zone_code from city_master where city_name = @destination) d),
  u as (
    select 2 as pri, x.slno, x.EntRef, x.client_code, x.RateType, x.mode_id, x.rate_on, x.status, x.Division, x.effective_from, x.start_date, x.end_date
      from client_contract_city x cross join p where x.origin_city = p.oc and x.destination_city = p.dc
    union all
    select 1, x.slno, x.EntRef, x.client_code, x.RateType, x.mode_id, x.rate_on, x.status, x.Division, x.effective_from, x.start_date, x.end_date
      from client_contract_location x
     where isnull(@OLocation, '') <> '' and isnull(@DLocation, '') <> '' and x.origin_location = @OLocation and x.destination_location = @DLocation
    union all
    select 3, x.slno, x.EntRef, x.client_code, x.RateType, x.mode_id, x.rate_on, x.status, x.Division, x.effective_from, x.start_date, x.end_date
      from client_contract_State x cross join p where x.origin_State = p.os and x.destination_State = p.ds
    union all
    select 4, x.slno, x.EntRef, x.client_code, x.RateType, x.mode_id, x.rate_on, x.status, x.Division, x.effective_from, x.start_date, x.end_date
      from client_contract_zone x cross join p where x.origin_zone = p.oz and x.destination_zone = p.dz)
  select top 1 u.EntRef from u cross join p
   where dbo.dev_ContractRowMatches(@CustomerType, @BookingType, @ClientCode, u.client_code, u.RateType) = 1
     and u.mode_id = @mode_id and upper(u.rate_on) = upper(@Rateon) and u.status = 'Active'
     and isnull(u.Division, @DivCode) = @DivCode
     and u.effective_from <= p.dt and (u.start_date is null or u.start_date <= p.dt) and (u.end_date is null or u.end_date >= p.dt)
   order by u.pri, u.effective_from desc, u.slno desc);
GO

create function dbo.dev_ClientSlabBand(@origin varchar(20), @destination varchar(100), @mode_id varchar(10), @ClientCode varchar(50),
  @Weight float, @BookingDate varchar(20), @OLocation varchar(60), @DLocation varchar(60), @DivCode varchar(20), @Rateon varchar(20),
  @CustomerType varchar(30), @BookingType varchar(30))
returns table as return (
  select top 1 b.Rate, b.DisPrc, b.ApproveDiscPrc
    from dbo.dev_ClientContractRef(@origin, @destination, @mode_id, @ClientCode, @BookingDate, @OLocation, @DLocation, @DivCode, @Rateon, @CustomerType, @BookingType) c
    join ClientRate_With_Slab s on s.EntRef = c.EntRef and isnull(s.Status, 'Active') = 'Active'
    cross apply (values
      (s.WeightFrom1, s.WeightTo1, s.Rate1, s.DisPrc1, s.ApproveDiscPrc1), (s.WeightFrom2, s.WeightTo2, s.Rate2, s.DisPrc2, s.ApproveDiscPrc2),
      (s.WeightFrom3, s.WeightTo3, s.Rate3, s.DisPrc3, s.ApproveDiscPrc3), (s.WeightFrom4, s.WeightTo4, s.Rate4, s.DisPrc4, s.ApproveDiscPrc4),
      (s.WeightFrom5, s.WeightTo5, s.Rate5, s.DisPrc5, s.ApproveDiscPrc5), (s.WeightFrom6, s.WeightTo6, s.Rate6, s.DisPrc6, s.ApproveDiscPrc6),
      (s.WeightFrom7, s.WeightTo7, s.Rate7, s.DisPrc7, s.ApproveDiscPrc7), (s.WeightFrom8, s.WeightTo8, s.Rate8, s.DisPrc8, s.ApproveDiscPrc8),
      (s.WeightFrom9, s.WeightTo9, s.Rate9, s.DisPrc9, s.ApproveDiscPrc9), (s.WeightFrom10, s.WeightTo10, s.Rate10, s.DisPrc10, s.ApproveDiscPrc10)
    ) b(WFrom, WTo, Rate, DisPrc, ApproveDiscPrc)
   where b.WFrom is not null and b.WTo is not null and b.Rate > 0 and @Weight between b.WFrom and b.WTo
   order by b.WFrom, s.slno desc);
GO

create procedure usp_Get_OnAccountSlabRateWeight_Curier @origin varchar(20), @destination varchar(100), @mode_id varchar(10),
  @ClientCode varchar(50), @Weight float, @CustomerType varchar(30), @BookingDate varchar(20), @BookingType varchar(30),
  @OLocation varchar(60), @DLocation varchar(60), @DivCode varchar(20), @DocType varchar(10), @Rateon varchar(20)
as
  select Rate as rate from dbo.dev_ClientSlabBand(@origin, @destination, @mode_id, @ClientCode, @Weight, @BookingDate, @OLocation, @DLocation, @DivCode, @Rateon, @CustomerType, @BookingType);
GO

create procedure usp_Get_OnAccountSlabDiscountWeight_Curier @origin varchar(20), @destination varchar(100), @mode_id varchar(10),
  @ClientCode varchar(50), @Weight float, @CustomerType varchar(30), @BookingDate varchar(20), @BookingType varchar(30),
  @OLocation varchar(60), @DLocation varchar(60), @DivCode varchar(20), @DocType varchar(10), @Rateon varchar(20)
as
  select DisPrc as rate from dbo.dev_ClientSlabBand(@origin, @destination, @mode_id, @ClientCode, @Weight, @BookingDate, @OLocation, @DLocation, @DivCode, @Rateon, @CustomerType, @BookingType);
GO

create procedure usp_Get_OnAccountSlabApprovedDiscountWeight_Curier @origin varchar(20), @destination varchar(100), @mode_id varchar(10),
  @ClientCode varchar(50), @Weight float, @CustomerType varchar(30), @BookingDate varchar(20), @BookingType varchar(30),
  @OLocation varchar(60), @DLocation varchar(60), @DivCode varchar(20), @DocType varchar(10), @Rateon varchar(20)
as
  select ApproveDiscPrc as rate from dbo.dev_ClientSlabBand(@origin, @destination, @mode_id, @ClientCode, @Weight, @BookingDate, @OLocation, @DLocation, @DivCode, @Rateon, @CustomerType, @BookingType);
GO

create procedure usp_Get_OnAccountSlabRateWeight_Category @origin varchar(20), @destination varchar(100), @mode_id varchar(10),
  @ClientCode varchar(50), @Weight float, @CustomerType varchar(30), @BookingDate varchar(20), @BookingType varchar(30),
  @OLocation varchar(60), @DLocation varchar(60), @DivCode varchar(20), @DocType varchar(10), @Rateon varchar(20),
  @PkgSize varchar(20), @Item_code varchar(20)
as
  select top 1 b.rate
    from dbo.dev_ClientContractRef(@origin, @destination, @mode_id, @ClientCode, @BookingDate, @OLocation, @DLocation, @DivCode, @Rateon, @CustomerType, @BookingType) c
    join ClientRate_Category_Slab s on s.EntRef = c.EntRef and isnull(s.Status, 'Active') = 'Active'
    cross apply (values
      (s.WeightFrom1, s.WeightTo1, s.Item_code1, s.Rate1, s.RateMed1, s.RateSmall1), (s.WeightFrom2, s.WeightTo2, s.Item_code2, s.Rate2, s.RateMed2, s.RateSmall2),
      (s.WeightFrom3, s.WeightTo3, s.Item_code3, s.Rate3, s.RateMed3, s.RateSmall3), (s.WeightFrom4, s.WeightTo4, s.Item_code4, s.Rate4, s.RateMed4, s.RateSmall4),
      (s.WeightFrom5, s.WeightTo5, s.Item_code5, s.Rate5, s.RateMed5, s.RateSmall5), (s.WeightFrom6, s.WeightTo6, s.Item_code6, s.Rate6, s.RateMed6, s.RateSmall6),
      (s.WeightFrom7, s.WeightTo7, s.Item_code7, s.Rate7, s.RateMed7, s.RateSmall7), (s.WeightFrom8, s.WeightTo8, s.Item_code8, s.Rate8, s.RateMed8, s.RateSmall8),
      (s.WeightFrom9, s.WeightTo9, s.Item_code9, s.Rate9, s.RateMed9, s.RateSmall9), (s.WeightFrom10, s.WeightTo10, s.Item_code10, s.Rate10, s.RateMed10, s.RateSmall10)
    ) v(WFrom, WTo, Item, RateBig, RateMed, RateSmall)
    cross apply (select case upper(@PkgSize) when 'BIG' then v.RateBig when 'MEDIUM' then v.RateMed when 'SMALL' then v.RateSmall end as rate) b
   where v.Item = @Item_code and v.WFrom is not null and v.WTo is not null and @Weight between v.WFrom and v.WTo and b.rate > 0
   order by v.WFrom, s.slno desc;
GO
