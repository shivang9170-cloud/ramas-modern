-- =============================================================================
-- DEV-ONLY: ODA charges (Rate/ODA_Charge.aspx, ODA_Charge_bal / _dal).
-- One row per location and effective date: the distance and the ODA charge for each weight band — Till_1H_Kg (0–100 kg),
-- Till_2H_Kg (101–200), Till_3H_Kg (201–300), Till_4H_Kg (301–400), Till_5H_Kg (401–500), Till_1T_Kg (501–1000),
-- Above_1T_Kg (over 1000). Columns from the DLL's `insert into ODA_Charge(ODA_Code, Branch_Code, City_Code,
-- Location_Code, Zone_Code, Distance, Till_1H_Kg, …)` and `… od.status = 1`. The docket reads the charge with
-- usp_Get_OdaRate @LocationCode, @Weight → odaRate (OperationDAL.Get_OdaRate); its body is not in the source.
-- See docs/SCHEMA-VERIFICATION.md.
-- =============================================================================

if object_id('ODA_Charge') is null
  create table ODA_Charge (
    ID int identity primary key, ODA_Code varchar(20), Branch_Code varchar(20), City_Code varchar(20), Location_Code varchar(20),
    Zone_Code varchar(20), Distance decimal(18,2) default 0,
    Till_1H_Kg decimal(18,2) default 0, Till_2H_Kg decimal(18,2) default 0, Till_3H_Kg decimal(18,2) default 0,
    Till_4H_Kg decimal(18,2) default 0, Till_5H_Kg decimal(18,2) default 0, Till_1T_Kg decimal(18,2) default 0,
    Above_1T_Kg decimal(18,2) default 0, Effective_Date date, Status bit default 1, Login_User varchar(50),
    Created_Date datetime default getdate());
GO

-- The ODA charge of the location's rate in force on the booking day (latest effective date on or before today among
-- the active rows), for the band holding the weight.
create or alter procedure usp_Get_OdaRate @LocationCode varchar(20), @Weight varchar(20)
as
begin
  set nocount on;
  declare @w decimal(18,2) = isnull(try_cast(@Weight as decimal(18,2)), 0);
  select top 1
    case when @w <= 100 then Till_1H_Kg when @w <= 200 then Till_2H_Kg when @w <= 300 then Till_3H_Kg
         when @w <= 400 then Till_4H_Kg when @w <= 500 then Till_5H_Kg when @w <= 1000 then Till_1T_Kg else Above_1T_Kg end as odaRate
    from ODA_Charge
   where Location_Code = @LocationCode and Status = 1 and Effective_Date <= cast(getdate() as date)
   order by Effective_Date desc, ID desc;
end
GO
