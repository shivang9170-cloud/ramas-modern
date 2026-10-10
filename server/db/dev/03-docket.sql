-- =============================================================================
-- DEV-ONLY docket (GRN) tables + stand-in procedures.
-- Parameter names mirror grn_class/DAL/OperationDAL.cs exactly, so the API can be
-- exercised end-to-end locally. Production uses its real procedures unchanged.
-- =============================================================================

alter table grn_master add
  computerise_grn varchar(50), booking_date date, ExpectedDate varchar(20), booking_mode varchar(10),
  customer_type varchar(30), booking_type varchar(30), delivery_mode varchar(20), LoadType varchar(5),
  DocsNoneDocs varchar(2), origin_branch varchar(20), originBindCity varchar(20), destination varchar(100),
  destination_branch varchar(20), destinationLocation varchar(60), PinCode varchar(10), ODA_Location varchar(60),
  on_account_of varchar(260), billing_at varchar(20), remarks varchar(500), E_WayBill varchar(30),
  gstPaidBy varchar(20), ManualDocketNo varchar(30), ItemDescription varchar(500), PkgSize varchar(10),
  consigner_code varchar(60), consigner_name varchar(200), consigner_address varchar(500), consigner_city varchar(60),
  consigner_state varchar(60), consigner_pin varchar(10), consigner_phone varchar(30), consigner_gstin varchar(20),
  consignee_code varchar(60), consignee_name varchar(200), consignee_address varchar(500), consignee_city varchar(60),
  consignee_state varchar(60), consignee_pin varchar(10), consignee_phone varchar(30), consignee_gstin varchar(20),
  user_id varchar(50), DivCode varchar(20), Financial_Year varchar(20), created_date datetime,
  manifest_status varchar(10), Arrived_status varchar(10), drs_status varchar(10), bill_no varchar(30),
  grn_cancel_status varchar(10), CancelRemark varchar(300), cancelled_by varchar(50), IsNextStep varchar(2) default '0',
  StaxBy varchar(10), Consigner_BillingAt varchar(20), Consignee_BillingAt varchar(20), OriginLocation varchar(60),
  Division varchar(20), created_by varchar(50), IsCancel varchar(2) default '0';
GO

create table grn_docket_charge (Docket_No varchar(50) primary key, freight_type varchar(30), rate_on varchar(20), pcs decimal(18,2), actual_weight decimal(18,2), charge_weight decimal(18,2),
  freight decimal(18,2), docket_charge decimal(18,2), other_charge decimal(18,2), service_tax decimal(18,4), charges decimal(18,2), docket_rate decimal(18,4), s_tax decimal(18,4),
  FtlRate decimal(18,2), RateID varchar(30), minWeight decimal(18,2), minFreight decimal(18,2), CGST_Tax decimal(18,4), CGST_Amt decimal(18,4), SGST_Tax decimal(18,4), SGST_Amt decimal(18,4),
  Discount decimal(18,2), DiscountAmt decimal(18,2), Basefrt decimal(18,2), IsGta varchar(5), IsCourier varchar(5), IsReg varchar(5));
create table docket_other_charges (docket varchar(50) primary key, risk_charge decimal(18,2), handling_charge decimal(18,2), dod_dac_charge decimal(18,2), service_charge decimal(18,2), ocs decimal(18,2),
  oda decimal(18,2), dly decimal(18,2), collection_charges decimal(18,2), Logistic_charges decimal(18,2), sour_charge decimal(18,2), fov decimal(18,2), HaltingChrg decimal(18,2), Stationary decimal(18,2),
  LoadingCharges decimal(18,2), UnLoadingCharges decimal(18,2), TopayCharge decimal(18,2), hamali_charge decimal(18,2), StatisticalCharges decimal(18,2), LocalCartage decimal(18,2), PFCharges decimal(18,2),
  FuelChargePercent decimal(18,2), FOVPercent decimal(18,2), InvoiceValueMin decimal(18,2), InvoiceValueMax decimal(18,2), FovFlatRate decimal(18,2), hamali_Rate decimal(18,2));
create table docket_invoice (id int identity primary key, docketNo varchar(50), invoice_no varchar(60), invoice_date date, invoice_value decimal(18,2), net_invoice_value decimal(18,2), part_no varchar(60),
  item_description varchar(200), invpct decimal(18,2), Quantity decimal(18,2), EWayBill varchar(30), EWayBillDate varchar(20), EWayBillValidDate varchar(20));
create table docket_insurance (id int identity primary key, docketNo varchar(50), Risk_at varchar(30), Policy_no varchar(60), Policy_date date, Ins_company varchar(100), Private_mark varchar(100), Ins_Value decimal(18,2));
create table docket_dimension (id int identity primary key, docket_no varchar(50), packet decimal(18,2), lenght decimal(18,2), width decimal(18,2), height decimal(18,2), total_cft decimal(18,2), percft decimal(18,2),
  packet_chargeweight decimal(18,2), actual_weight decimal(18,2), freight_type varchar(30), rate_on varchar(20), WtType varchar(20));
create table docket_charge_entry (id int identity primary key, Docket_No varchar(50), Charge_Name varchar(100), NoofDays decimal(18,2), Charge_Amount decimal(18,2), Chargeid varchar(20), IsTax bit);
create table docket_franchisee_comm (id int identity primary key, Docket_No varchar(50), FranchiseeCode varchar(50), BookingComm decimal(18,2), BookingPercentage decimal(18,2));
create table docket_tracking (id int identity primary key, docket_no varchar(50), Operation varchar(100), Status varchar(100), EntryDate datetime, UserLog varchar(50), Origin varchar(100), Destination varchar(100));
create table booking_mode (mode_code varchar(10) primary key, mode_name varchar(50));
create table delivery_mode_master (mode_code varchar(20) primary key, mode_name varchar(50));
create table charge_code_master (mode_code varchar(20) primary key, mode_name varchar(50), is_tax bit);
create table consigner_master (id int identity primary key, consigner_code varchar(60), company_name varchar(200), address varchar(500), city varchar(60), state varchar(60), pin_code varchar(10), phone varchar(30), GSTIN_No varchar(20), IsTemp varchar(5) default 'false');
create table client_rate (slno int identity primary key, client_code varchar(50), origin_branch varchar(20), destination varchar(100), mode_id varchar(10), rate_on varchar(20), rate decimal(18,4),
  minchargewt decimal(18,2), minFreight decimal(18,2), sour_charge decimal(18,2), fov decimal(18,2), oda decimal(18,2), dly decimal(18,2), billingat varchar(20), DisPrc decimal(18,2), Expected_Days int);
GO

-- ------------------------------------------------------------------ dropdown sources
create procedure Get_BookingMode as select mode_code, mode_name from booking_mode order by mode_name;
GO
create procedure Get_DeliveryModeMaster as select mode_code, mode_name from delivery_mode_master order by mode_code;
GO
create procedure Get_ItemMaster as select item_code, item_name from item_master where active_flag = 'Active' order by item_name;
GO
create procedure Get_ChargeCode as select mode_code, mode_name from charge_code_master where is_tax = 0 order by mode_name;
GO
create procedure Get_TaxChargeCode as select mode_code, mode_name from charge_code_master where is_tax = 1 order by mode_name;
GO

-- ------------------------------------------------------------------ lookups
create procedure Get_CityMasterByCityName @city_name varchar(100)
as select top 20 city_code, city_name from city_master where active_flag = 'Active' and city_name like @city_name + '%' order by city_name;
GO
create procedure usp_Get_CityExist @city_name varchar(100)
as
  select b.branch_code, b.branch_name, c.city_code
    from city_master c join branch_master b on b.city_code = c.city_code and b.status = 'Active'
   where c.city_name = @city_name;
GO
create procedure Get_Consigner @company_name varchar(200), @consigner_code varchar(60), @IsTemp varchar(5), @CityCode varchar(20)
as select top 20 * from consigner_master where company_name like '%' + @company_name + '%' order by company_name;
GO
create procedure Get_BillingAt @origin varchar(20), @destination varchar(100), @mode_id varchar(10), @ClientCode varchar(50), @OLocation varchar(60), @DLocation varchar(60), @BranchCode varchar(20), @DivCode varchar(20)
as
  select distinct r.billingat, b.branch_name as branch_Name
    from client_rate r join branch_master b on b.branch_code = r.billingat
   where r.client_code = @ClientCode;
GO
create procedure sp_Select_Rate @OBranch varchar(20), @DBranch_Name varchar(100), @Booking_Mode varchar(10), @Client_Code varchar(50), @Rate_On varchar(20), @customer_type varchar(30),
  @FreightType varchar(30), @BookingDate varchar(20), @Booking_Type varchar(30), @DivCode varchar(20), @OLocation varchar(60), @DLocation varchar(60), @DocumentType varchar(2), @LoadType varchar(5), @delivery_mode varchar(20)
as
  select top 1 r.slno, r.billingat, b.branch_name as branch_Name, r.mode_id, '' as slr, '' as payment_basis, '' as start_date, '' as end_date, '' as effective_from, 'Active' as status,
         r.client_code as client_id, @delivery_mode as delivery_mode, '' as state, r.client_code, '' as vp, r.origin_branch as origin_city, r.destination as destination_city,
         r.rate_on, '' as box_size, r.rate, r.fov, r.oda, 0 as ocr, r.dly, 0 as frt, 'Contract' as contract_type, r.minchargewt, r.sour_charge, 0 as collection_charge, 0 as logistic_charge,
         0 as dod, 0 as risk_charge, 0 as handling_charge, 0 as Service_charge, 0 as ocs, '' as ftl_type, 0 as FtlRate, 0 as halthing_charge, r.minFreight, 0 as LoadingCharge, 0 as UnLoadingCharge,
         0 as MinLoadingCharge, 0 as MinUnLoadingCharge, 0 as InvoiceValueMin, 0 as InvoiceValueMax, 0 as FovFlatRate, 0 as TopayCharge, r.DisPrc, 0 as VolumetricWeight, 0 as ApproveDiscPrc,
         0 as min_Collection_Charge, 0 as min_Delivery_Charge, 0 as IsCollection, 0 as IsDelivery, '' as Discount_Type, 0 as basefrt, 0 as adminchrgper, 0 as hamali_charge, r.Expected_Days
    from client_rate r left join branch_master b on b.branch_code = r.billingat
   where r.client_code = @Client_Code and r.origin_branch = @OBranch and r.destination = @DBranch_Name
     and r.mode_id = @Booking_Mode and upper(r.rate_on) = upper(@Rate_On);
GO
-- IGST when origin and destination are in different states, otherwise CGST+SGST ("GST").
create procedure ups_Get_TaxType @OrginCode varchar(20), @Destination varchar(100), @TaxSelect varchar(20)
as
  select case when ob.state_code = dc.state_code then 'GST' else 'IGST' end as TaxType
    from branch_master ob, city_master dc
   where ob.branch_code = @OrginCode and dc.city_name = @Destination;
GO
create procedure Get_GstTaxDetails @BookingMode varchar(10), @BookingDate varchar(20), @Division varchar(20)
as select cast(9 as decimal(5,2)) as cgst, cast(9 as decimal(5,2)) as sgst;
GO
create procedure sp_getExpectedDate_grn @from_city varchar(20), @to_city varchar(20), @booking_date varchar(20)
as select dateadd(day, case when @from_city = @to_city then 1 else 3 end, cast(@booking_date as date)) as ExpectedDate;
GO
create procedure SP_GET_max_docket @branchCode varchar(20)
as select cast(isnull(max(try_cast(docket_no as bigint)), 100000000) + 1 as varchar(30)) as docket_no from grn_master;
GO
create procedure Get_IsThirdPartyBilling @Accountof varchar(50), @Consigner varchar(60), @Consignee varchar(60), @BranchCode varchar(20)
as select '0' as Status;
GO

-- ------------------------------------------------------------------ save chain
create procedure Save_GrnEntry
  @sln int output, @computeriseno varchar(50) output, @docketNo varchar(30), @BookingDate varchar(20), @Destination_branch varchar(20), @CustomerType varchar(30),
  @BookingMode varchar(10), @Origin varchar(20), @OriginBindCity varchar(20), @OnAccountof varchar(260), @BillingAt varchar(20), @BookingType varchar(30),
  @DeliveryMode varchar(20), @TopayType varchar(30), @Amount varchar(20), @ConsignerCode varchar(60), @ConsigneeCode varchar(60), @ConsignerName varchar(200),
  @ConsigneeName varchar(200), @Consigneraddress varchar(500), @ConsignerCity varchar(60), @ConsignerState varchar(60), @ConsignerPinCode varchar(10),
  @ConsignerPhone varchar(30), @Consigneeaddress varchar(500), @ConsigneeCity varchar(60), @ConsigneeState varchar(60), @ConsigneePinCode varchar(10),
  @ConsigneePhone varchar(30), @TypeofPkts varchar(20), @StaxBy varchar(10), @Consignee_BillingAt varchar(20), @Consigner_BillingAt varchar(20),
  @destination varchar(100), @ExpectedDate varchar(20), @Remarks varchar(500), @user varchar(50), @created_date datetime, @ODA_Location varchar(60),
  @Financial_Year varchar(20), @E_WayBill varchar(30), @docsNoneDocs varchar(2), @PinCode varchar(10), @DestinationLocation varchar(60), @DivCode varchar(20),
  @Consigner_GSTIN_No varchar(20), @Consignee_GSTIN_No varchar(20), @ManualDocketNo varchar(30), @LoadType varchar(5), @IsRTO varchar(2), @OriginLocation varchar(60),
  @Vehicleno varchar(20), @document_date varchar(20), @tripshtNo varchar(30), @transporter_document_number varchar(30), @vehicle_number_update_date varchar(20),
  @psno varchar(30), @textiletype varchar(30), @SenderID varchar(30), @ReceiverID varchar(30), @Vehicle varchar(20), @PartyShiperNo varchar(30), @LoadNo varchar(30),
  @Distance varchar(20), @gstPaidBy varchar(20), @MeatingDate varchar(20), @Vendor_code varchar(30), @Vendor_docket varchar(30), @PkgSize varchar(10), @PM varchar(10),
  @cc_attached varchar(10), @ItemDescription varchar(500), @isDockeOpen bit
as
begin
  set nocount on;
  if exists (select 1 from grn_master where docket_no = @docketNo) begin set @sln = 0; set @computeriseno = ''; return; end
  if cast(@BookingDate as date) > cast(getdate() as date) begin set @sln = -3; set @computeriseno = ''; return; end
  insert into grn_master(docket_no, computerise_grn, booking_date, ExpectedDate, booking_mode, customer_type, booking_type, delivery_mode, LoadType, DocsNoneDocs,
    origin_branch, originBindCity, destination, destination_branch, destinationLocation, PinCode, ODA_Location, on_account_of, billing_at, item_content, remarks, E_WayBill,
    gstPaidBy, ManualDocketNo, ItemDescription, PkgSize,
    consigner_code, consigner_name, consigner_address, consigner_city, consigner_state, consigner_pin, consigner_phone, consigner_gstin,
    consignee_code, consignee_name, consignee_address, consignee_city, consignee_state, consignee_pin, consignee_phone, consignee_gstin,
    user_id, created_by, DivCode, Division, Financial_Year, created_date, IsNextStep, IsCancel, StaxBy, Consigner_BillingAt, Consignee_BillingAt, OriginLocation)
  values (@docketNo, @docketNo, @BookingDate, @ExpectedDate, @BookingMode, @CustomerType, @BookingType, @DeliveryMode, @LoadType, @docsNoneDocs,
    @Origin, @OriginBindCity, @destination, @Destination_branch, @DestinationLocation, @PinCode, @ODA_Location, @OnAccountof, @BillingAt, @TypeofPkts, @Remarks, @E_WayBill,
    @gstPaidBy, @ManualDocketNo, @ItemDescription, @PkgSize,
    @ConsignerCode, @ConsignerName, @Consigneraddress, @ConsignerCity, @ConsignerState, @ConsignerPinCode, @ConsignerPhone, @Consigner_GSTIN_No,
    @ConsigneeCode, @ConsigneeName, @Consigneeaddress, @ConsigneeCity, @ConsigneeState, @ConsigneePinCode, @ConsigneePhone, @Consignee_GSTIN_No,
    @user, @user, @DivCode, @DivCode, @Financial_Year, @created_date, '0', '0', @StaxBy, @Consigner_BillingAt, @Consignee_BillingAt, @OriginLocation);
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog, Origin, Destination)
  values (@docketNo, 'BOOKING', 'Booked', getdate(), @user, @Origin, @destination);
  set @sln = scope_identity();
  set @computeriseno = @docketNo;
end
GO

create procedure Save_DocketCharges
  @sln int output, @docket varchar(50), @freight_type varchar(30), @rate_on varchar(20), @pcs decimal(18,2), @actual_weight decimal(18,2), @charge_weight decimal(18,2),
  @freight decimal(18,2), @docket_charge decimal(18,2), @other_charge decimal(18,2), @service_tax decimal(18,4), @charges decimal(18,2), @acharges decimal(18,2),
  @docket_rate decimal(18,4), @s_tax decimal(18,4), @FtlRate decimal(18,2), @RateID varchar(30), @minWeight decimal(18,2), @BookingDate varchar(20), @Financial_Year varchar(20),
  @IsGta varchar(5), @IsCourier varchar(5), @IsReg varchar(5), @CGST_Tax decimal(18,4), @CGST_Amt decimal(18,4), @SGST_Tax decimal(18,4), @SGST_Amt decimal(18,4),
  @minFreight decimal(18,2), @DivCode varchar(20), @Discount decimal(18,2), @SpecialDiscount decimal(18,2), @discounttype varchar(10), @DiscountAmt decimal(18,2),
  @Basefrt decimal(18,2), @adminCper decimal(18,2)
as
begin
  set nocount on;
  -- dev-only test hook: simulate "ledger not found" so rollback can be tested
  if @RateID = 'TEST-NO-LEDGER' begin set @sln = -1; return; end
  insert into grn_docket_charge (Docket_No, freight_type, rate_on, pcs, actual_weight, charge_weight, freight, docket_charge, other_charge, service_tax, charges, docket_rate, s_tax, FtlRate, RateID, minWeight, minFreight, CGST_Tax, CGST_Amt, SGST_Tax, SGST_Amt, Discount, DiscountAmt, Basefrt, IsGta, IsCourier, IsReg) values (@docket, @freight_type, @rate_on, @pcs, @actual_weight, @charge_weight, @freight, @docket_charge, @other_charge, @service_tax, @charges,
    @docket_rate, @s_tax, @FtlRate, @RateID, @minWeight, @minFreight, @CGST_Tax, @CGST_Amt, @SGST_Tax, @SGST_Amt, @Discount, @DiscountAmt, @Basefrt, @IsGta, @IsCourier, @IsReg);
  set @sln = 1;
end
GO

create procedure Save_OtherCharges
  @docket varchar(50), @risk_charge decimal(18,2), @handling_charge decimal(18,2), @dod_dac_charge decimal(18,2), @service_charge decimal(18,2), @ocs decimal(18,2), @oda decimal(18,2),
  @dly decimal(18,2), @collection_charges decimal(18,2), @Logistic_charges decimal(18,2), @sour_charge decimal(18,2), @fov decimal(18,2), @HaltingChrg decimal(18,2),
  @Stationary decimal(18,2), @FOVPercent decimal(18,2), @FuelChargePercent decimal(18,2), @LoadingCharges decimal(18,2), @UnLoadingCharges decimal(18,2),
  @InvoiceValueMin decimal(18,2), @InvoiceValueMax decimal(18,2), @FovFlatRate decimal(18,2), @TopayCharge decimal(18,2), @Isocs varchar(5), @Isdly varchar(5),
  @Iscollection_charges varchar(5), @hamali_Rate decimal(18,2), @hamali_charge decimal(18,2), @StatisticalCharges decimal(18,2), @LocalCartage decimal(18,2), @PFCharges decimal(18,2)
as
  insert into docket_other_charges (docket, risk_charge, handling_charge, dod_dac_charge, service_charge, ocs, oda, dly, collection_charges, Logistic_charges, sour_charge, fov, HaltingChrg, Stationary, LoadingCharges, UnLoadingCharges, TopayCharge, hamali_charge, StatisticalCharges, LocalCartage, PFCharges, FuelChargePercent, FOVPercent, InvoiceValueMin, InvoiceValueMax, FovFlatRate, hamali_Rate) values (@docket, @risk_charge, @handling_charge, @dod_dac_charge, @service_charge, @ocs, @oda, @dly, @collection_charges, @Logistic_charges,
    @sour_charge, @fov, @HaltingChrg, @Stationary, @LoadingCharges, @UnLoadingCharges, @TopayCharge, @hamali_charge, @StatisticalCharges, @LocalCartage, @PFCharges, @FuelChargePercent,
    @FOVPercent, @InvoiceValueMin, @InvoiceValueMax, @FovFlatRate, @hamali_Rate);
GO

create procedure Save_InvoiceEntry @invoice_no varchar(60), @invoice_date varchar(20), @invoice_value decimal(18,2), @net_invoice_value decimal(18,2), @part_no varchar(60),
  @item_description varchar(200), @invpct decimal(18,2), @Quantity decimal(18,2), @docketNo varchar(50), @EWayBill varchar(30), @EWayBillDate varchar(20), @EWayBillValidDate varchar(20)
as insert into docket_invoice(docketNo, invoice_no, invoice_date, invoice_value, net_invoice_value, part_no, item_description, invpct, Quantity, EWayBill, EWayBillDate, EWayBillValidDate)
   values (@docketNo, @invoice_no, @invoice_date, @invoice_value, @net_invoice_value, @part_no, @item_description, @invpct, @Quantity, @EWayBill, @EWayBillDate, @EWayBillValidDate);
GO
create procedure Save_InsuranceEntry @docketNo varchar(50), @Risk_at varchar(30), @Policy_no varchar(60), @Policy_date varchar(20), @Ins_company varchar(100), @Private_mark varchar(100), @Ins_Value decimal(18,2)
as insert into docket_insurance(docketNo, Risk_at, Policy_no, Policy_date, Ins_company, Private_mark, Ins_Value) values (@docketNo, @Risk_at, @Policy_no, @Policy_date, @Ins_company, @Private_mark, @Ins_Value);
GO
create procedure Save_DimentionEntry @docket_no varchar(50), @packet decimal(18,2), @lenght decimal(18,2), @width decimal(18,2), @height decimal(18,2), @total_cft decimal(18,2), @percft decimal(18,2),
  @packet_chargeweight decimal(18,2), @actual_weight decimal(18,2), @freight_type varchar(30), @rate_on varchar(20), @WtType varchar(20)
as insert into docket_dimension(docket_no, packet, lenght, width, height, total_cft, percft, packet_chargeweight, actual_weight, freight_type, rate_on, WtType)
   values (@docket_no, @packet, @lenght, @width, @height, @total_cft, @percft, @packet_chargeweight, @actual_weight, @freight_type, @rate_on, @WtType);
GO
create procedure Save_ChargeEntry @Docket_No varchar(50), @Charge_Name varchar(100), @NoofDays decimal(18,2), @Charge_Amount decimal(18,2), @Chargeid varchar(20)
as insert into docket_charge_entry(Docket_No, Charge_Name, NoofDays, Charge_Amount, Chargeid, IsTax) values (@Docket_No, @Charge_Name, @NoofDays, @Charge_Amount, @Chargeid, 0);
GO
create procedure Save_ChargeEntryTax @Docket_No varchar(50), @Charge_Name varchar(100), @NoofDays decimal(18,2), @Charge_Amount decimal(18,2), @Chargeid varchar(20)
as insert into docket_charge_entry(Docket_No, Charge_Name, NoofDays, Charge_Amount, Chargeid, IsTax) values (@Docket_No, @Charge_Name, @NoofDays, @Charge_Amount, @Chargeid, 1);
GO
create procedure Save_FranchiseeComm @Docket_No varchar(50), @FranchiseeCode varchar(50), @BookingComm decimal(18,2), @BookingPercentage decimal(18,2)
as insert into docket_franchisee_comm(Docket_No, FranchiseeCode, BookingComm, BookingPercentage) values (@Docket_No, @FranchiseeCode, @BookingComm, @BookingPercentage);
GO

-- ------------------------------------------------------------------ update chain
create procedure Update_GrnEntry_New
  @sln int output, @docketNo varchar(30), @BookingDate varchar(20), @Destination_branch varchar(20), @CustomerType varchar(30), @BookingMode varchar(10), @Origin varchar(20),
  @OriginBindCity varchar(20), @OnAccountof varchar(260), @BillingAt varchar(20), @BookingType varchar(30), @DeliveryMode varchar(20), @TopayType varchar(30), @Amount varchar(20),
  @ConsignerCode varchar(60), @ConsigneeCode varchar(60), @ConsignerName varchar(200), @ConsigneeName varchar(200), @Consigneraddress varchar(500), @ConsignerCity varchar(60),
  @ConsignerState varchar(60), @ConsignerPinCode varchar(10), @ConsignerPhone varchar(30), @Consigneeaddress varchar(500), @ConsigneeCity varchar(60), @ConsigneeState varchar(60),
  @ConsigneePinCode varchar(10), @ConsigneePhone varchar(30), @TypeofPkts varchar(20), @StaxBy varchar(10), @Consignee_BillingAt varchar(20), @Consigner_BillingAt varchar(20),
  @destination varchar(100), @ExpectedDate varchar(20), @Remarks varchar(500), @ODA_Location varchar(60), @Financial_Year varchar(20), @E_WayBill varchar(30),
  @Consigner_GSTIN_No varchar(20), @Consignee_GSTIN_No varchar(20), @LoadType varchar(5), @PinCode varchar(10), @DestinationLocation varchar(60), @OriginLocation varchar(60),
  @psno varchar(30), @textiletype varchar(30), @SenderID varchar(30), @ReceiverID varchar(30), @ManualDocketNo varchar(30), @gstPaidBy varchar(20), @MeatingDate varchar(20),
  @Vendor_code varchar(30), @Vendor_docket varchar(30), @PkgSize varchar(10), @PM varchar(10), @cc_attached varchar(10), @ItemDescription varchar(500)
as
begin
  set nocount on;
  if cast(@BookingDate as date) > cast(getdate() as date) begin set @sln = -3; return; end
  update grn_master set booking_date = @BookingDate, ExpectedDate = @ExpectedDate, booking_mode = @BookingMode, customer_type = @CustomerType, booking_type = @BookingType,
    delivery_mode = @DeliveryMode, LoadType = @LoadType, originBindCity = @OriginBindCity, destination = @destination, destination_branch = @Destination_branch,
    destinationLocation = @DestinationLocation, PinCode = @PinCode, ODA_Location = @ODA_Location, on_account_of = @OnAccountof, billing_at = @BillingAt, item_content = @TypeofPkts,
    remarks = @Remarks, E_WayBill = @E_WayBill, gstPaidBy = @gstPaidBy, ManualDocketNo = @ManualDocketNo, ItemDescription = @ItemDescription, PkgSize = @PkgSize,
    consigner_code = @ConsignerCode, consigner_name = @ConsignerName, consigner_address = @Consigneraddress, consigner_city = @ConsignerCity, consigner_state = @ConsignerState,
    consigner_pin = @ConsignerPinCode, consigner_phone = @ConsignerPhone, consigner_gstin = @Consigner_GSTIN_No,
    consignee_code = @ConsigneeCode, consignee_name = @ConsigneeName, consignee_address = @Consigneeaddress, consignee_city = @ConsigneeCity, consignee_state = @ConsigneeState,
    consignee_pin = @ConsigneePinCode, consignee_phone = @ConsigneePhone, consignee_gstin = @Consignee_GSTIN_No,
    StaxBy = @StaxBy, Consigner_BillingAt = @Consigner_BillingAt, Consignee_BillingAt = @Consignee_BillingAt, OriginLocation = @OriginLocation
   where docket_no = @docketNo;
  set @sln = @@rowcount;
end
GO
create procedure Update_DocketCharges
  @sln int output, @docket varchar(50), @freight_type varchar(30), @rate_on varchar(20), @pcs decimal(18,2), @actual_weight decimal(18,2), @charge_weight decimal(18,2),
  @freight decimal(18,2), @docket_charge decimal(18,2), @other_charge decimal(18,2), @service_tax decimal(18,4), @charges decimal(18,2), @acharges decimal(18,2),
  @docket_rate decimal(18,4), @s_tax decimal(18,4), @FtlRate decimal(18,2), @RateID varchar(30), @minWeight decimal(18,2), @BookingDate varchar(20), @Financial_Year varchar(20),
  @IsGta varchar(5), @IsCourier varchar(5), @IsReg varchar(5), @CGST_Tax decimal(18,4), @CGST_Amt decimal(18,4), @SGST_Tax decimal(18,4), @SGST_Amt decimal(18,4),
  @minFreight decimal(18,2), @Discount decimal(18,2), @SpecialDiscount decimal(18,2), @discounttype varchar(10), @DiscountAmt decimal(18,2), @Basefrt decimal(18,2), @adminCper decimal(18,2)
as
begin
  set nocount on;
  delete from grn_docket_charge where Docket_No = @docket;
  insert into grn_docket_charge (Docket_No, freight_type, rate_on, pcs, actual_weight, charge_weight, freight, docket_charge, other_charge, service_tax, charges, docket_rate, s_tax, FtlRate, RateID, minWeight, minFreight, CGST_Tax, CGST_Amt, SGST_Tax, SGST_Amt, Discount, DiscountAmt, Basefrt, IsGta, IsCourier, IsReg) values (@docket, @freight_type, @rate_on, @pcs, @actual_weight, @charge_weight, @freight, @docket_charge, @other_charge, @service_tax, @charges,
    @docket_rate, @s_tax, @FtlRate, @RateID, @minWeight, @minFreight, @CGST_Tax, @CGST_Amt, @SGST_Tax, @SGST_Amt, @Discount, @DiscountAmt, @Basefrt, @IsGta, @IsCourier, @IsReg);
  set @sln = 1;
end
GO
create procedure Update_OtherCharges
  @docket varchar(50), @risk_charge decimal(18,2), @handling_charge decimal(18,2), @dod_dac_charge decimal(18,2), @service_charge decimal(18,2), @ocs decimal(18,2), @oda decimal(18,2),
  @dly decimal(18,2), @collection_charges decimal(18,2), @Logistic_charges decimal(18,2), @sour_charge decimal(18,2), @fov decimal(18,2), @HaltingChrg decimal(18,2),
  @Stationary decimal(18,2), @FOVPercent decimal(18,2), @FuelChargePercent decimal(18,2), @LoadingCharges decimal(18,2), @UnLoadingCharges decimal(18,2),
  @InvoiceValueMin decimal(18,2), @InvoiceValueMax decimal(18,2), @FovFlatRate decimal(18,2), @ToPayCharge decimal(18,2), @hamali_Rate decimal(18,2), @hamali_charge decimal(18,2),
  @StatisticalCharges decimal(18,2), @LocalCartage decimal(18,2), @PFCharges decimal(18,2)
as
begin
  delete from docket_other_charges where docket = @docket;
  insert into docket_other_charges (docket, risk_charge, handling_charge, dod_dac_charge, service_charge, ocs, oda, dly, collection_charges, Logistic_charges, sour_charge, fov, HaltingChrg, Stationary, LoadingCharges, UnLoadingCharges, TopayCharge, hamali_charge, StatisticalCharges, LocalCartage, PFCharges, FuelChargePercent, FOVPercent, InvoiceValueMin, InvoiceValueMax, FovFlatRate, hamali_Rate) values (@docket, @risk_charge, @handling_charge, @dod_dac_charge, @service_charge, @ocs, @oda, @dly, @collection_charges, @Logistic_charges,
    @sour_charge, @fov, @HaltingChrg, @Stationary, @LoadingCharges, @UnLoadingCharges, @ToPayCharge, @hamali_charge, @StatisticalCharges, @LocalCartage, @PFCharges, @FuelChargePercent,
    @FOVPercent, @InvoiceValueMin, @InvoiceValueMax, @FovFlatRate, @hamali_Rate);
end
GO
create procedure Delete_InvoiceEntry @docketNo varchar(50) as delete from docket_invoice where docketNo = @docketNo;
GO
create procedure Delete_Insurance @docketNo varchar(50) as delete from docket_insurance where docketNo = @docketNo;
GO
create procedure Delete_Dimention @docketNo varchar(50) as delete from docket_dimension where docket_no = @docketNo;
GO
create procedure Delete_Charge @docketNo varchar(50) as delete from docket_charge_entry where Docket_No = @docketNo and IsTax = 0;
GO
create procedure Delete_ChargeTax @docketNo varchar(50) as delete from docket_charge_entry where Docket_No = @docketNo and IsTax = 1;
GO
create procedure Cancel_GrnEntry @docketNo varchar(50), @CancelRemark varchar(300), @user varchar(50)
as
begin
  update grn_master set grn_cancel_status = 'yes', IsCancel = '1', CancelRemark = @CancelRemark, cancelled_by = @user where docket_no = @docketNo;
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog) values (@docketNo, 'CANCEL', 'Cancelled: ' + @CancelRemark, getdate(), @user);
end
GO

-- ------------------------------------------------------------------ read
-- Column aliases reproduce what the legacy DAL expects, including its
-- consignor/consignee cross-mapping (consigner data is read from consignee_* columns).
create procedure Get_DocketDetails @DocketNo varchar(50), @Origin varchar(20), @DivCode varchar(20), @IsRTO varchar(2)
as
begin
  set nocount on;
  if not exists (select 1 from grn_master where docket_no = @DocketNo and (origin_branch = @Origin or @Origin = 'B1001'))
  begin select 'Docket No does not exist for this branch.' as Status; return; end
  select '' as Status, g.id as slno, g.docket_no, g.computerise_grn, g.booking_date, g.ExpectedDate, g.booking_mode, g.customer_type, g.booking_type, g.delivery_mode,
         g.LoadType, g.DocsNoneDocs, g.origin_branch, g.originBindCity, g.destination, g.destination as city_name, g.destination_branch, g.destinationLocation, g.PinCode,
         g.on_account_of, g.billing_at, g.item_content, g.remarks, g.E_WayBill, g.gstPaidBy, g.ManualDocketNo,
         g.consigner_code as consignee_id, g.consigner_name as Consigner_Name, g.consigner_address as consignee_address, g.consigner_city as consignee_city,
         g.consigner_state as consignee_state, g.consigner_pin as consignee_pin_code, g.consigner_phone as consignee_phone, g.consigner_gstin as Gstin_No,
         g.consignee_code as consigner_id, g.consignee_name, g.consignee_address as address, g.consignee_city as city, g.consignee_state as state,
         g.consignee_pin as pin_code, g.consignee_phone as phone, g.consignee_gstin as ConsigneeGstin_No,
         g.StaxBy as STaxRemark, g.Consigner_BillingAt, g.Consignee_BillingAt, g.OriginLocation, g.ItemDescription, g.PkgSize,
         c.freight_type, c.rate_on, c.docket_rate, c.RateID, c.pcs, c.actual_weight, c.charge_weight, c.minWeight, c.minFreight, c.FtlRate, c.freight, c.other_charge,
         c.docket_charge, c.service_tax, c.charges, c.s_tax, c.CGST_Tax, c.CGST_Amt, c.SGST_Tax, c.SGST_Amt, c.Discount, c.Discount as SpecialDiscount, c.DiscountAmt as discountamt,
         c.IsGta, c.IsCourier, c.IsReg,
         o.risk_charge, o.handling_charge, o.dod_dac_charge, o.service_charge, o.ocs, o.oda, o.dly, o.collection_charges, o.Logistic_charges, o.sour_charge, o.fov,
         o.HaltingChrg, o.Stationary, o.TopayCharge, o.LoadingCharges as LoadingCharge, o.UnLoadingCharges as UnLoadingCharge, o.hamali_charge, o.StatisticalCharges,
         o.LocalCartage, o.PFCharges, o.FuelChargePercent, o.FOVPercent, o.InvoiceValueMin, o.InvoiceValueMax, o.FovFlatRate, o.hamali_Rate,
         g.manifest_status, g.Arrived_status, g.drs_status, g.bill_no, g.grn_cancel_status, g.IsNextStep
    from grn_master g
    left join grn_docket_charge c on c.Docket_No = g.docket_no
    left join docket_other_charges o on o.docket = g.docket_no
   where g.docket_no = @DocketNo;
end
GO
create procedure Get_InvoiceDetails @DocketNo varchar(50)
as select invoice_no as InvoiceNo, invoice_date as InvoiceDate, invoice_value as InvoiceValue, net_invoice_value as NetInoviceValue, part_no as PartNo,
          item_description as ItemDescription, invpct as Packet, Quantity, EWayBill, EWayBillDate, EWayBillValidDate from docket_invoice where docketNo = @DocketNo;
GO
create procedure Get_InsuranceDetails @DocketNo varchar(50)
as select Risk_at, Policy_no, Policy_date, Ins_company, Private_mark, Ins_Value as InsValue from docket_insurance where docketNo = @DocketNo;
GO
create procedure Get_DimentionDetails @DocketNo varchar(50)
as select id as slno, docket_no as computerise_grn, docket_no, packet, lenght, width, height, total_cft, percft, packet_chargeweight, actual_weight, freight_type, rate_on, '' as Item_Name, WtType
     from docket_dimension where docket_no = @DocketNo;
GO
create procedure Get_AdditionalDetails @DocketNo varchar(50)
as select Charge_Name as charge_name, Charge_Amount as charge_amount, Chargeid as chargeid, NoofDays as noofdays from docket_charge_entry where Docket_No = @DocketNo and IsTax = 0;
GO
create procedure Get_AdditionalDetailsTax @DocketNo varchar(50)
as select Charge_Name as charge_name, Charge_Amount as charge_amount, Chargeid as chargeid, NoofDays as noofdays from docket_charge_entry where Docket_No = @DocketNo and IsTax = 1;
GO
create procedure Get_TrackingDetails @DocketNo varchar(50), @Division varchar(20)
as select id as SrNo, Operation, Status, EntryDate, UserLog, Origin, Destination from docket_tracking where docket_no = @DocketNo order by EntryDate, id;
GO
