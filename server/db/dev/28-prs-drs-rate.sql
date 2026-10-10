-- =============================================================================
-- DEV-ONLY: PRS / DRS rate master (Rate/PRS_and_DRS_Rate_Master.aspx, PRS_and_DRS_RATE_MASTER_DAL).
-- What a pickup (PRS) / delivery (DRS) vendor or own vehicle is paid: per km, per kg, or a round trip (fixed km for a
-- fixed amount plus a rate per extra km), by vehicle (FTL) type, from an effective date. Columns from the DLL's
-- `select PDrate.Slno, PDrate.Vendor_Type, PDrate.Vendor_Code, … Rate_On, Fix_Km, Fix_Km_Rate, Extra_Km_Rate,
-- Effective_Date from PRS_DRS_RATE_MASTER`; saved by Sp_Insert_Prs_and_Drs_Rate (@Vend_Type, @Vend_Code, @Rat_On,
-- @Fix_Km, @Fix_Km_rate, @Extra_Km_Rate, @Per_Kg, … — the last parameters are not in the DLL: see
-- docs/SCHEMA-VERIFICATION.md). The PRS / DRS challan (Operation/Prs_Drs_Challan, not ported yet) reads it.
-- =============================================================================

if object_id('PRS_DRS_RATE_MASTER') is null
  create table PRS_DRS_RATE_MASTER (
    Slno int identity primary key, Vendor_Type varchar(20), Vendor_Code varchar(20), Rate_On varchar(20),
    Fix_Km decimal(18,2) default 0, Fix_Km_Rate decimal(18,2) default 0, Extra_Km_Rate decimal(18,2) default 0,
    Per_Kg decimal(18,2) default 0, FTL_Type varchar(50), Effective_Date date, Created_By varchar(50),
    Created_Date datetime default getdate());
GO

create or alter procedure Sp_Insert_Prs_and_Drs_Rate @Vend_Type varchar(20), @Vend_Code varchar(20), @Rat_On varchar(20),
  @Fix_Km decimal(18,2), @Fix_Km_rate decimal(18,2), @Extra_Km_Rate decimal(18,2), @Per_Kg decimal(18,2),
  @Effective_Date date, @Created_By varchar(50), @FTL_Type varchar(50)
as
begin
  set nocount on;
  insert into PRS_DRS_RATE_MASTER(Vendor_Type, Vendor_Code, Rate_On, Fix_Km, Fix_Km_Rate, Extra_Km_Rate, Per_Kg, FTL_Type, Effective_Date, Created_By)
  values (@Vend_Type, @Vend_Code, @Rat_On, @Fix_Km, @Fix_Km_rate, @Extra_Km_Rate, @Per_Kg, @FTL_Type, @Effective_Date, @Created_By);
  select cast(scope_identity() as int) as Slno;
end
GO
