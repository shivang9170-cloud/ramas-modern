-- =============================================================================
-- DEV-ONLY: vendor master (Master/Vendor_Entry.aspx) columns and stand-in procedures.
-- The ClassLibrary source has no vendor_master_dal.cs; procedure names come from the deployed
-- bin/ClassLibrary.dll (insert_Vendor_Master, sp_Update_Vendor_Master_Details, sp_Delete_Vendor_Master,
-- usp_select_vendors_masterALL, usp_CheckValidateGstinNo). Parameter names are guesses from the page's
-- vendor_master_pal properties and the DLL's own SELECTs — see docs/SCHEMA-VERIFICATION.md.
-- =============================================================================

alter table vendors_master add
  Branch varchar(20), address varchar(500), state varchar(10), vendor_city varchar(10), pin_code varchar(10),
  ContactPrsnName varchar(100), pan_no varchar(20), email varchar(100), service_tax_no varchar(50),
  vendor_phone_no varchar(20), approvalDate date, Fax varchar(50), ApprovBy varchar(150), ConfLetterNo varchar(50),
  remarks varchar(500), sap_code varchar(20), manual_no varchar(20), CourDiv varchar(20), PrclDiv varchar(20),
  FTLDiv varchar(20), Gstin_No varchar(15), AutoGstStatus varchar(1), IsFastTag bit default 0, IFCCode varchar(11),
  AccountNo varchar(30), IsColoader bit default 0, IsCostProfit bit default 0, created_by varchar(50),
  created_date datetime default getdate(), Edit_By varchar(50), Edit_Date datetime;
GO

create table mode_master (slno int identity primary key, mode_code varchar(10) unique, mode_name varchar(50));
create table vendor_vehicle_master (
  slno int identity primary key, vendor_code varchar(20), mode_code varchar(10), vehicle_no varchar(20), vehicle_name varchar(50));
create table vendor_road_rate_master (slno int identity primary key, vendor_type varchar(20), vendor_name varchar(20));
GO

-- vendor_master_bal.select_mode (the page reads columns [1] = code, [2] = name).
create procedure sp_select_Mode_Master as
  select slno, mode_code, mode_name from mode_master order by slno;
GO

-- GeneralMethods.CheckValidateGstinNo: @retval = the GSTIN when any party already has it.
-- (The real procedure presumably also looks at clients / consignors; the dev one checks vendors.)
create procedure usp_CheckValidateGstinNo @Gstin_No varchar(15), @retval varchar(20) output
as
begin
  set nocount on;
  set @retval = (select top 1 Gstin_No from vendors_master where Gstin_No = @Gstin_No and isnull(@Gstin_No, '') <> '');
end
GO

create procedure insert_Vendor_Master
  @vendor_code varchar(20), @name varchar(100), @vendor_type varchar(20), @vendor_Mode varchar(20), @Branch varchar(20),
  @address varchar(500), @state varchar(10), @vendor_city varchar(10), @pin_code varchar(10), @ContactPrsnName varchar(100),
  @pan_no varchar(20), @email varchar(100), @service_tax_no varchar(50), @vendor_phone_no varchar(20), @approvalDate date,
  @Fax varchar(50), @ApprovBy varchar(150), @ConfLetterNo varchar(50), @remarks varchar(500), @TDS decimal(5,2),
  @sap_code varchar(20), @manual_code varchar(20), @DivCode varchar(100), @CourDiv varchar(20), @PrclDiv varchar(20),
  @FTLDiv varchar(20), @Gstin_No varchar(15), @AutoGstStatus varchar(1), @IsFastTag bit, @IFCCode varchar(11),
  @AccountNo varchar(30), @active_flag bit, @IsCoLoader bit, @created_by varchar(50),
  @retval varchar(20) output
as
begin
  set nocount on;
  insert into vendors_master(vendor_code, Name, vendor_type, vendor_Mode, Branch, address, state, vendor_city, pin_code,
    ContactPrsnName, pan_no, email, service_tax_no, vendor_phone_no, approvalDate, Fax, ApprovBy, ConfLetterNo, remarks, TDS,
    sap_code, manual_no, DivCode, CourDiv, PrclDiv, FTLDiv, Gstin_No, AutoGstStatus, IsFastTag, IFCCode, AccountNo,
    active_flag, IsColoader, created_by)
  values (@vendor_code, @name, @vendor_type, @vendor_Mode, @Branch, @address, @state, @vendor_city, @pin_code,
    @ContactPrsnName, @pan_no, @email, @service_tax_no, @vendor_phone_no, @approvalDate, @Fax, @ApprovBy, @ConfLetterNo, @remarks, @TDS,
    @sap_code, @manual_code, @DivCode, @CourDiv, @PrclDiv, @FTLDiv, @Gstin_No, @AutoGstStatus, @IsFastTag, @IFCCode, @AccountNo,
    @active_flag, @IsCoLoader, @created_by);
  set @retval = @vendor_code;
end
GO

-- The page's edit popup has no PIN / PAN / e-mail / fax / letter / remarks fields, so neither has this procedure.
create procedure sp_Update_Vendor_Master_Details
  @vendor_code varchar(20), @name varchar(100), @vendor_type varchar(20), @vendor_Mode varchar(20), @Branch varchar(20),
  @vendor_phone_no varchar(20), @state varchar(10), @vendor_city varchar(10), @approvalDate date, @ApprovBy varchar(150),
  @address varchar(500), @ContactPrsnName varchar(100), @TDS decimal(5,2), @sap_code varchar(20), @manual_code varchar(20),
  @DivCode varchar(100), @CourDiv varchar(20), @PrclDiv varchar(20), @FTLDiv varchar(20), @Gstin_No varchar(15),
  @AutoGstStatus varchar(1), @IsFastTag bit, @IFCCode varchar(11), @AccountNo varchar(30), @active_flag bit,
  @IsCoLoader bit, @Edit_By varchar(50)
as
  update vendors_master set Name = @name, vendor_type = @vendor_type, vendor_Mode = @vendor_Mode, Branch = @Branch,
    vendor_phone_no = @vendor_phone_no, state = @state, vendor_city = @vendor_city, approvalDate = @approvalDate,
    ApprovBy = @ApprovBy, address = @address, ContactPrsnName = @ContactPrsnName, TDS = @TDS, sap_code = @sap_code,
    manual_no = @manual_code, DivCode = @DivCode, CourDiv = @CourDiv, PrclDiv = @PrclDiv, FTLDiv = @FTLDiv,
    Gstin_No = @Gstin_No, AutoGstStatus = @AutoGstStatus, IsFastTag = @IsFastTag, IFCCode = @IFCCode, AccountNo = @AccountNo,
    active_flag = @active_flag, IsColoader = @IsCoLoader, Edit_By = @Edit_By, Edit_Date = getdate()
  where vendor_code = @vendor_code;
GO

create procedure sp_Delete_Vendor_Master @vendor_code varchar(20)
as
  delete from vendors_master where vendor_code = @vendor_code;
GO

-- vendor_master_bal.select_vendors_masterALL(divcode): the page's grid columns.
create procedure usp_select_vendors_masterALL @DivCode varchar(20)
as
  select vm.vendor_code, vm.name, vm.vendor_type, vm.vendor_Mode as mode_name, vm.vendor_phone_no, vm.Branch,
         bm.branch_name, vm.ContactPrsnName, convert(varchar(10), vm.approvalDate, 103) as approvedDate, vm.ApprovBy,
         case when vm.active_flag = 1 then 'Active' else 'Inactive' end as Status, vm.TDS, vm.Gstin_No,
         case when vm.IsFastTag = 1 then 'Yes' else 'No' end as IsFastTag, vm.IFCCode, vm.AccountNo, vm.DivCode,
         vm.CourDiv, vm.PrclDiv, vm.FTLDiv, vm.sap_code, vm.manual_no, vm.address, vm.state, sm.state_name,
         vm.vendor_city, cm.city_name, vm.IsColoader
    from vendors_master vm
    left join branch_master bm on bm.branch_code = vm.Branch
    left join state_master sm on sm.state_code = vm.state
    left join city_master cm on cm.city_code = vm.vendor_city
   where vm.DivCode like '%' + @DivCode + '%'
   order by vm.vendor_code;
GO
