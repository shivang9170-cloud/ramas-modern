-- =============================================================================
-- DEV-ONLY: client contract category slabs, stage 3 (Rate/Client_Contract.aspx, rate on CATEGORY, "Is category slab").
-- ClientRate_Category_Slab: up to 10 bands of weight from / to + product (item_master.item_code) with a rate per package
-- size — RateN = BIG, RateMedN = MEDIUM, RateSmallN = SMALL — linked to a CATEGORY contract row by EntRef (the page's
-- inline INSERT in ClassLibrary.dll). The docket lookup usp_Get_OnAccountSlabRateWeight_Category is a real procedure
-- whose body is not in the source; the stand-in below takes the contract row sp_Select_Rate would take and returns the
-- band of the product holding the weight, the rate of the package size in a column named "rate".
-- See docs/SCHEMA-VERIFICATION.md.
-- =============================================================================

create table ClientRate_Category_Slab (
  slno int identity primary key, billingat varchar(20), origin_city varchar(20), destination_city varchar(20), mode_id varchar(10),
  rate_on varchar(20), client_id varchar(50), contract_type varchar(30),
  WeightFrom1 decimal(18,2), WeightTo1 decimal(18,2), Rate1 decimal(18,2), DisPrc1 decimal(18,2), ApproveDiscPrc1 decimal(18,2), Item_code1 varchar(20), RateMed1 decimal(18,2), RateSmall1 decimal(18,2),
  WeightFrom2 decimal(18,2), WeightTo2 decimal(18,2), Rate2 decimal(18,2), DisPrc2 decimal(18,2), ApproveDiscPrc2 decimal(18,2), Item_code2 varchar(20), RateMed2 decimal(18,2), RateSmall2 decimal(18,2),
  WeightFrom3 decimal(18,2), WeightTo3 decimal(18,2), Rate3 decimal(18,2), DisPrc3 decimal(18,2), ApproveDiscPrc3 decimal(18,2), Item_code3 varchar(20), RateMed3 decimal(18,2), RateSmall3 decimal(18,2),
  WeightFrom4 decimal(18,2), WeightTo4 decimal(18,2), Rate4 decimal(18,2), DisPrc4 decimal(18,2), ApproveDiscPrc4 decimal(18,2), Item_code4 varchar(20), RateMed4 decimal(18,2), RateSmall4 decimal(18,2),
  WeightFrom5 decimal(18,2), WeightTo5 decimal(18,2), Rate5 decimal(18,2), DisPrc5 decimal(18,2), ApproveDiscPrc5 decimal(18,2), Item_code5 varchar(20), RateMed5 decimal(18,2), RateSmall5 decimal(18,2),
  WeightFrom6 decimal(18,2), WeightTo6 decimal(18,2), Rate6 decimal(18,2), DisPrc6 decimal(18,2), ApproveDiscPrc6 decimal(18,2), Item_code6 varchar(20), RateMed6 decimal(18,2), RateSmall6 decimal(18,2),
  WeightFrom7 decimal(18,2), WeightTo7 decimal(18,2), Rate7 decimal(18,2), DisPrc7 decimal(18,2), ApproveDiscPrc7 decimal(18,2), Item_code7 varchar(20), RateMed7 decimal(18,2), RateSmall7 decimal(18,2),
  WeightFrom8 decimal(18,2), WeightTo8 decimal(18,2), Rate8 decimal(18,2), DisPrc8 decimal(18,2), ApproveDiscPrc8 decimal(18,2), Item_code8 varchar(20), RateMed8 decimal(18,2), RateSmall8 decimal(18,2),
  WeightFrom9 decimal(18,2), WeightTo9 decimal(18,2), Rate9 decimal(18,2), DisPrc9 decimal(18,2), ApproveDiscPrc9 decimal(18,2), Item_code9 varchar(20), RateMed9 decimal(18,2), RateSmall9 decimal(18,2),
  WeightFrom10 decimal(18,2), WeightTo10 decimal(18,2), Rate10 decimal(18,2), DisPrc10 decimal(18,2), ApproveDiscPrc10 decimal(18,2), Item_code10 varchar(20), RateMed10 decimal(18,2), RateSmall10 decimal(18,2),
  RateType varchar(20), EntRef varchar(20), delivery_mode varchar(20), Status varchar(10) default 'Active',
  created_date datetime default getdate());
GO
create index IX_ClientRate_Category_Slab_EntRef on ClientRate_Category_Slab(EntRef);
GO

-- The EntRef of the contract row a docket would use (same precedence as sp_Select_Rate in 19-contract-types.sql).
create function dbo.dev_ClientContractRef(@origin varchar(20), @destination varchar(100), @mode_id varchar(10), @ClientCode varchar(50),
  @BookingDate varchar(20), @OLocation varchar(60), @DLocation varchar(60), @DivCode varchar(20), @Rateon varchar(20))
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
      from client_contract_zone x cross join p where x.origin_zone = p.oz and x.destination_zone = p.dz)
  select top 1 u.EntRef from u cross join p
   where u.client_code = @ClientCode and u.mode_id = @mode_id and upper(u.rate_on) = upper(@Rateon) and u.status = 'Active'
     and isnull(u.Division, @DivCode) = @DivCode
     and u.effective_from <= p.dt and (u.start_date is null or u.start_date <= p.dt) and (u.end_date is null or u.end_date >= p.dt)
   order by u.pri, u.effective_from desc, u.slno desc);
GO

create procedure usp_Get_OnAccountSlabRateWeight_Category @origin varchar(20), @destination varchar(100), @mode_id varchar(10),
  @ClientCode varchar(50), @Weight float, @CustomerType varchar(30), @BookingDate varchar(20), @BookingType varchar(30),
  @OLocation varchar(60), @DLocation varchar(60), @DivCode varchar(20), @DocType varchar(10), @Rateon varchar(20),
  @PkgSize varchar(20), @Item_code varchar(20)
as
  select top 1 b.rate
    from dbo.dev_ClientContractRef(@origin, @destination, @mode_id, @ClientCode, @BookingDate, @OLocation, @DLocation, @DivCode, @Rateon) c
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
