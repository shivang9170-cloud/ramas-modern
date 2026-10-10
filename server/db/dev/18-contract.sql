-- =============================================================================
-- DEV-ONLY: client contract rates, City To City (Rate/Client_Contract.aspx, stage 1).
-- The page wrote client_contract_city with an inline INSERT (column list read from bin/ClassLibrary.dll, middle part
-- reconstructed from client_contract_branch_pal — see docs/SCHEMA-VERIFICATION.md). EntRef = 'RMEC-' + number.
-- The docket rate lookups (Get_BillingAt, sp_Select_Rate) now read this table, like the real procedures appear to
-- (their result columns are this table's columns); the old dev-only client_rate table is no longer used.
-- =============================================================================

create table client_contract_city (
  slno int identity primary key, EntRef varchar(20), contract_type varchar(30), RateType varchar(20), BookingType varchar(20),
  DocsType varchar(2), Division varchar(20), client_id varchar(50), client_code varchar(50), billingat varchar(20),
  origin_city varchar(20), destination_city varchar(20), mode_id varchar(10), delivery_mode varchar(20), rate_on varchar(20),
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

-- Billing branches with a contract for the client (first choice on the docket form).
alter procedure Get_BillingAt @origin varchar(20), @destination varchar(100), @mode_id varchar(10), @ClientCode varchar(50),
  @OLocation varchar(60), @DLocation varchar(60), @BranchCode varchar(20), @DivCode varchar(20)
as
  select distinct c.billingat, b.branch_name as branch_Name
    from client_contract_city c join branch_master b on b.branch_code = c.billingat
   where c.client_code = @ClientCode and c.status = 'Active' and isnull(c.Division, @DivCode) = @DivCode;
GO

-- The contract rate for a docket: origin = the booking branch's city, destination = city name; the latest version
-- effective on the booking date and inside its start / end dates.
alter procedure sp_Select_Rate @OBranch varchar(20), @DBranch_Name varchar(100), @Booking_Mode varchar(10), @Client_Code varchar(50),
  @Rate_On varchar(20), @customer_type varchar(30), @FreightType varchar(30), @BookingDate varchar(20), @Booking_Type varchar(30),
  @DivCode varchar(20), @OLocation varchar(60), @DLocation varchar(60), @DocumentType varchar(2), @LoadType varchar(5), @delivery_mode varchar(20)
as
begin
  set nocount on;
  declare @on date = isnull(try_convert(date, @BookingDate), cast(getdate() as date));
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
    from client_contract_city c
    join branch_master ob on ob.branch_code = @OBranch and ob.city_code = c.origin_city
    join city_master dc on dc.city_code = c.destination_city and dc.city_name = @DBranch_Name
    left join branch_master b on b.branch_code = c.billingat
   where c.client_code = @Client_Code and c.mode_id = @Booking_Mode and upper(c.rate_on) = upper(@Rate_On) and c.status = 'Active'
     and isnull(c.Division, @DivCode) = @DivCode
     and c.effective_from <= @on and (c.start_date is null or c.start_date <= @on) and (c.end_date is null or c.end_date >= @on)
     and (@delivery_mode = '' or isnull(c.delivery_mode, '') in ('', @delivery_mode))
   order by c.effective_from desc, c.slno desc;
end
GO
