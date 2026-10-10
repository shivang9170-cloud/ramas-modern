-- =============================================================================
-- DEV-ONLY: pickup / delivery charge slabs, stage 3 (Rate/Client_Contract.aspx "Pickup / Delivery charge slab").
-- Min_chargeRate_slab: one row per band — FromUnit / ToUnit (kg for WEIGHT, packets for BOX) → ChargeAmt, Rate_type
-- PICKUP or DEL — for a client + origin city + destination city + rate on. Column names from the page's DataTable and
-- the DLL (`update Min_chargeRate_slab set isactive=0 where client_code … rate_on`, sp_insMin_chargeRate_slab with
-- @client_code @origin_city @destination_city @rate_on @FromUnit @ToUnit @ChargeAmt @Rate_type @EntRef).
-- The docket reads it with sp_GetMinChargeRate (OperationDAL.Get_MinChargeRate): the result's MinChargeAmt fills the
-- collection (PICKUP) or delivery (DEL) charge. Procedure bodies are not in the source — these are stand-ins.
-- See docs/SCHEMA-VERIFICATION.md.
-- =============================================================================

create table Min_chargeRate_slab (
  slno int identity primary key, client_code varchar(50), origin_city varchar(20), destination_city varchar(20), rate_on varchar(20),
  FromUnit decimal(18,2), ToUnit decimal(18,2), ChargeAmt decimal(18,2), Rate_type varchar(10), EntRef varchar(20),
  isactive bit default 1, created_date datetime default getdate());
GO
create index IX_Min_chargeRate_slab_key on Min_chargeRate_slab(client_code, origin_city, destination_city, rate_on, Rate_type);
GO

create procedure sp_insMin_chargeRate_slab @client_code varchar(50), @origin_city varchar(20), @destination_city varchar(20),
  @rate_on varchar(20), @FromUnit decimal(18,2), @ToUnit decimal(18,2), @ChargeAmt decimal(18,2), @Rate_type varchar(10), @EntRef varchar(20)
as
  insert into Min_chargeRate_slab(client_code, origin_city, destination_city, rate_on, FromUnit, ToUnit, ChargeAmt, Rate_type, EntRef, isactive)
  values (@client_code, @origin_city, @destination_city, @rate_on, @FromUnit, @ToUnit, @ChargeAmt, @Rate_type, @EntRef, 1);
GO

-- Docket: the band of the active slab holding the unit (charge weight / packets). @destination_city is the destination
-- city *name* on the docket (txtdestination); a code is accepted too. @delivery_mode is not used by the stand-in.
create procedure sp_GetMinChargeRate @client_code varchar(50), @origin_city varchar(20), @destination_city varchar(100),
  @rate_on varchar(20), @Rate_Type varchar(10), @delivery_mode varchar(20), @Unit varchar(20)
as
begin
  set nocount on;
  declare @u decimal(18,2) = isnull(try_cast(@Unit as decimal(18,2)), 0);
  select top 1 m.client_code, m.ChargeAmt as MinChargeAmt, m.FromUnit, m.ToUnit
    from Min_chargeRate_slab m
   where m.client_code = @client_code and m.origin_city = @origin_city and upper(m.rate_on) = upper(@rate_on)
     and m.Rate_type = @Rate_Type and m.isactive = 1
     and (m.destination_city = @destination_city
          or m.destination_city in (select city_code from city_master where city_name = @destination_city))
     and @u between m.FromUnit and m.ToUnit
   order by m.FromUnit, m.slno desc;
end
GO
