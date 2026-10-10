-- =============================================================================
-- DEV-ONLY: client contract slab rates, stage 3 (Rate/Client_Contract.aspx "Is slab rate").
-- ClientRate_With_Slab: up to 10 weight bands for one contract row, linked to it by EntRef (the page's inline
-- INSERT in ClassLibrary.dll). Status follows the contract row (the page's "update clientrate_with_slab set Status").
-- The docket lookups (usp_Get_OnAccountSlab*Weight_Curier) are real procedures whose bodies are not in the source; the
-- stand-ins below take the contract row sp_Select_Rate would take and return the band that holds the weight, with
-- the value in a column named "rate" as OperationDAL reads it. See docs/SCHEMA-VERIFICATION.md.
-- =============================================================================

create table ClientRate_With_Slab (
  slno int identity primary key, billingat varchar(20), origin_city varchar(20), destination_city varchar(20), mode_id varchar(10),
  rate_on varchar(20), client_id varchar(50), contract_type varchar(30),
  WeightFrom1 decimal(18,2), WeightTo1 decimal(18,2), Rate1 decimal(18,2), DisPrc1 decimal(18,2), ApproveDiscPrc1 decimal(18,2),
  WeightFrom2 decimal(18,2), WeightTo2 decimal(18,2), Rate2 decimal(18,2), DisPrc2 decimal(18,2), ApproveDiscPrc2 decimal(18,2),
  WeightFrom3 decimal(18,2), WeightTo3 decimal(18,2), Rate3 decimal(18,2), DisPrc3 decimal(18,2), ApproveDiscPrc3 decimal(18,2),
  WeightFrom4 decimal(18,2), WeightTo4 decimal(18,2), Rate4 decimal(18,2), DisPrc4 decimal(18,2), ApproveDiscPrc4 decimal(18,2),
  WeightFrom5 decimal(18,2), WeightTo5 decimal(18,2), Rate5 decimal(18,2), DisPrc5 decimal(18,2), ApproveDiscPrc5 decimal(18,2),
  WeightFrom6 decimal(18,2), WeightTo6 decimal(18,2), Rate6 decimal(18,2), DisPrc6 decimal(18,2), ApproveDiscPrc6 decimal(18,2),
  WeightFrom7 decimal(18,2), WeightTo7 decimal(18,2), Rate7 decimal(18,2), DisPrc7 decimal(18,2), ApproveDiscPrc7 decimal(18,2),
  WeightFrom8 decimal(18,2), WeightTo8 decimal(18,2), Rate8 decimal(18,2), DisPrc8 decimal(18,2), ApproveDiscPrc8 decimal(18,2),
  WeightFrom9 decimal(18,2), WeightTo9 decimal(18,2), Rate9 decimal(18,2), DisPrc9 decimal(18,2), ApproveDiscPrc9 decimal(18,2),
  WeightFrom10 decimal(18,2), WeightTo10 decimal(18,2), Rate10 decimal(18,2), DisPrc10 decimal(18,2), ApproveDiscPrc10 decimal(18,2),
  RateType varchar(20), EntRef varchar(20), delivery_mode varchar(20), Status varchar(10) default 'Active',
  created_date datetime default getdate());
GO
create index IX_ClientRate_With_Slab_EntRef on ClientRate_With_Slab(EntRef);
GO

-- The weight band of the contract row a docket would use (same precedence as sp_Select_Rate in 19-contract-types.sql).
create function dbo.dev_ClientSlabBand(@origin varchar(20), @destination varchar(100), @mode_id varchar(10), @ClientCode varchar(50),
  @Weight float, @BookingDate varchar(20), @OLocation varchar(60), @DLocation varchar(60), @DivCode varchar(20), @Rateon varchar(20))
returns table as return (
  with p as (
    select isnull(try_convert(date, @BookingDate), cast(getdate() as date)) as dt,
           o.city_code as oc, o.state_code as os, o.zone_code as oz, d.city_code as dc, d.state_code as ds, d.zone_code as dz
      from (select 1 as one) x
      left join city_master o on o.city_code = @origin
      outer apply (select top 1 city_code, state_code, zone_code from city_master where city_name = @destination) d),
  u as (
    select 2 as pri, x.slno, x.EntRef, x.client_code, x.mode_id, x.rate_on, x.status, x.Division, x.effective_from, x.start_date, x.end_date
      from client_contract_city x cross join p where x.origin_city = p.oc and x.destination_city = p.dc
    union all
    select 1, x.slno, x.EntRef, x.client_code, x.mode_id, x.rate_on, x.status, x.Division, x.effective_from, x.start_date, x.end_date
      from client_contract_location x
     where isnull(@OLocation, '') <> '' and isnull(@DLocation, '') <> '' and x.origin_location = @OLocation and x.destination_location = @DLocation
    union all
    select 3, x.slno, x.EntRef, x.client_code, x.mode_id, x.rate_on, x.status, x.Division, x.effective_from, x.start_date, x.end_date
      from client_contract_State x cross join p where x.origin_State = p.os and x.destination_State = p.ds
    union all
    select 4, x.slno, x.EntRef, x.client_code, x.mode_id, x.rate_on, x.status, x.Division, x.effective_from, x.start_date, x.end_date
      from client_contract_zone x cross join p where x.origin_zone = p.oz and x.destination_zone = p.dz),
  c as (
    select top 1 u.EntRef from u cross join p
     where u.client_code = @ClientCode and u.mode_id = @mode_id and upper(u.rate_on) = upper(@Rateon) and u.status = 'Active'
       and isnull(u.Division, @DivCode) = @DivCode
       and u.effective_from <= p.dt and (u.start_date is null or u.start_date <= p.dt) and (u.end_date is null or u.end_date >= p.dt)
     order by u.pri, u.effective_from desc, u.slno desc)
  select top 1 b.Rate, b.DisPrc, b.ApproveDiscPrc
    from c
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
  select Rate as rate from dbo.dev_ClientSlabBand(@origin, @destination, @mode_id, @ClientCode, @Weight, @BookingDate, @OLocation, @DLocation, @DivCode, @Rateon);
GO

create procedure usp_Get_OnAccountSlabDiscountWeight_Curier @origin varchar(20), @destination varchar(100), @mode_id varchar(10),
  @ClientCode varchar(50), @Weight float, @CustomerType varchar(30), @BookingDate varchar(20), @BookingType varchar(30),
  @OLocation varchar(60), @DLocation varchar(60), @DivCode varchar(20), @DocType varchar(10), @Rateon varchar(20)
as
  select DisPrc as rate from dbo.dev_ClientSlabBand(@origin, @destination, @mode_id, @ClientCode, @Weight, @BookingDate, @OLocation, @DLocation, @DivCode, @Rateon);
GO

create procedure usp_Get_OnAccountSlabApprovedDiscountWeight_Curier @origin varchar(20), @destination varchar(100), @mode_id varchar(10),
  @ClientCode varchar(50), @Weight float, @CustomerType varchar(30), @BookingDate varchar(20), @BookingType varchar(30),
  @OLocation varchar(60), @DLocation varchar(60), @DivCode varchar(20), @DocType varchar(10), @Rateon varchar(20)
as
  select ApproveDiscPrc as rate from dbo.dev_ClientSlabBand(@origin, @destination, @mode_id, @ClientCode, @Weight, @BookingDate, @OLocation, @DLocation, @DivCode, @Rateon);
GO
