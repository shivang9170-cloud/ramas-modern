-- =============================================================================
-- DEV-ONLY: client master (Master/Client_Master.aspx) columns and stand-in procedures.
-- Procedure names come from the deployed bin/ClassLibrary.dll (insert_Client_Master_Details, sp_Update_Client_Master,
-- delete_Client_Master_With_Details, GET_NATURE_OF_BUSINESS_MASTER); parameter names follow Client_Master_Pal
-- and the DLL's strings — see docs/SCHEMA-VERIFICATION.md.
-- =============================================================================

-- The page's grid key is client_Id. The page's Client_Name is the existing client_name column (names are case-insensitive).
if col_length('client_Master', 'id') is not null exec sp_rename 'client_Master.id', 'client_Id', 'COLUMN';
GO

alter table client_Master add
  company_name varchar(200), contact_person varchar(100), address varchar(500), place varchar(100), pin_code varchar(10),
  email varchar(100), phone varchar(20), Mobile varchar(15), fax varchar(50), pan_no varchar(15), service_tax_no varchar(50),
  tin varchar(50), intro_date date, is_Active bit default 1, is_stax_notapplicable bit default 0, credit_period int default 0,
  IsThirdPartyBilling bit default 0, IsWalkingClient bit default 0, remarks varchar(500),
  Branch_Code varchar(20), Billing_Cycle varchar(5), Gstin_No varchar(15), AutoGstStatus varchar(1), BillingLocation varchar(20),
  SubmissionLocation varchar(20), CollectionLocation varchar(20), CustType int default 0, RegUnreg int default 0, RegNO varchar(50),
  PlaceofSupply varchar(20), PO_No varchar(50), PO_Date varchar(20), CIN_NO varchar(30), DivCode varchar(100), divcourier varchar(20),
  divparcel varchar(20), divftl varchar(20), billing_address varchar(500), billing_client_name varchar(200),
  billing_client_phone varchar(20), billing_client_GSTIN varchar(15), Credit_Type varchar(20), IsPs varchar(5), Trans_no varchar(50),
  ShowKMOnPrint int default 0, nature_of_business_id int, IsDiscount int default 0, IsGstReg int default 0, print_as varchar(200),
  Contract_By varchar(50), Under_client varchar(50), sap_code varchar(20), manual_no varchar(20), created_by varchar(50),
  created_date datetime default getdate(), billed_ledger_name varchar(300), unbilled_ledger_name varchar(300);
GO

create table nature_of_business_master (ID int identity primary key, nob_name varchar(100), IsActive bit default 1);
GO
create procedure GET_NATURE_OF_BUSINESS_MASTER as
  select ID, nob_name from nature_of_business_master where isnull(IsActive, 1) = 1 order by nob_name;
GO

create procedure insert_Client_Master_Details
  @client_code varchar(50), @company_name varchar(200), @contact_person varchar(100), @address varchar(500), @city varchar(10),
  @place varchar(100), @pin_code varchar(10), @email varchar(100), @phone varchar(20), @fax varchar(50), @pan_no varchar(15),
  @service_tax_no varchar(50), @intro_date date, @is_Active bit, @credit_period int, @is_tax_notapplicable bit, @remarks varchar(500),
  @Client_Name varchar(200), @IsThirdPartyBilling bit, @Mobile varchar(15), @Tin varchar(50), @Branch_Code varchar(20),
  @billed_ledger_name varchar(300), @unbilled_ledger_name varchar(300), @created_by varchar(50), @IsWalkingClient bit,
  @Billing_Cycle varchar(5), @Gstin_No varchar(15), @AutoGstStatus varchar(1), @BillingLocation varchar(20),
  @SubmissionLocation varchar(20), @CollectionLocation varchar(20), @CustType int, @RegUnreg int, @RegNo varchar(50),
  @PlaceofSupply varchar(20), @PO_No varchar(50), @PO_Date varchar(20), @CIN_No varchar(30), @Division varchar(100),
  @divcourier varchar(20), @divparcel varchar(20), @divftl varchar(20), @billing_address varchar(500),
  @billing_client_name varchar(200), @billing_client_phone varchar(20), @billing_client_gstin varchar(15), @Credit_Type varchar(20),
  @IsPs varchar(5), @Trans_no varchar(50), @ShowKMOnPrint int, @nature_of_business_id int, @IsDiscount int, @IsGstReg int,
  @print_as varchar(200), @Contract_By varchar(50), @under_client varchar(50), @sap_code varchar(20), @manual_code varchar(20)
as
  insert into client_Master(client_code, client_name, company_name, contact_person, address, city, place, pin_code, email, phone,
    fax, pan_no, service_tax_no, intro_date, is_Active, credit_period, is_stax_notapplicable, remarks, IsThirdPartyBilling,
    Mobile, tin, Branch_Code, billed_ledger_name, unbilled_ledger_name, created_by, IsWalkingClient, Billing_Cycle, Gstin_No,
    AutoGstStatus, BillingLocation, SubmissionLocation, CollectionLocation, CustType, RegUnreg, RegNO, PlaceofSupply, PO_No, PO_Date,
    CIN_NO, DivCode, divcourier, divparcel, divftl, billing_address, billing_client_name, billing_client_phone, billing_client_GSTIN,
    Credit_Type, IsPs, Trans_no, ShowKMOnPrint, nature_of_business_id, IsDiscount, IsGstReg, print_as, Contract_By, Under_client,
    sap_code, manual_no)
  values (@client_code, @Client_Name, @company_name, @contact_person, @address, @city, @place, @pin_code, @email, @phone,
    @fax, @pan_no, @service_tax_no, @intro_date, @is_Active, @credit_period, @is_tax_notapplicable, @remarks, @IsThirdPartyBilling,
    @Mobile, @Tin, @Branch_Code, @billed_ledger_name, @unbilled_ledger_name, @created_by, @IsWalkingClient, @Billing_Cycle, @Gstin_No,
    @AutoGstStatus, @BillingLocation, @SubmissionLocation, @CollectionLocation, @CustType, @RegUnreg, @RegNo, @PlaceofSupply, @PO_No, @PO_Date,
    @CIN_No, @Division, @divcourier, @divparcel, @divftl, @billing_address, @billing_client_name, @billing_client_phone, @billing_client_gstin,
    @Credit_Type, @IsPs, @Trans_no, @ShowKMOnPrint, @nature_of_business_id, @IsDiscount, @IsGstReg, @print_as, @Contract_By, @under_client,
    @sap_code, @manual_code);
GO

create procedure sp_Update_Client_Master
  @client_Id int, @clinet_code varchar(50), @company_name varchar(200), @contact_person varchar(100), @address varchar(500),
  @city varchar(10), @place varchar(100), @pin_code varchar(10), @email varchar(100), @phone varchar(20), @fax varchar(50),
  @pan_no varchar(15), @service_tax_no varchar(50), @intro_date date, @is_Active bit, @credit_period int, @is_tax_notapplicable bit,
  @remarks varchar(500), @Client_Name varchar(200), @IsThirdPartyBilling bit, @Mobile varchar(15), @Tin_Number varchar(50),
  @Branch_Code varchar(20), @billed_code varchar(50), @unbilled_code varchar(50), @IsWalkingClient bit, @Billing_Cycle varchar(5),
  @Gstin_No varchar(15), @AutoGstStatus varchar(1), @BillingLocation varchar(20), @SubmissionLocation varchar(20),
  @CollectionLocation varchar(20), @PlaceofSupply varchar(20), @PO_No varchar(50), @CIN_No varchar(30), @Division varchar(100),
  @divcourier varchar(20), @divparcel varchar(20), @divftl varchar(20), @billing_address varchar(500),
  @billing_client_name varchar(200), @billing_client_phone varchar(20), @billing_client_gstin varchar(15), @Credit_Type varchar(20),
  @IsPs varchar(5), @Trans_no varchar(50), @ShowKMOnPrint int, @nature_of_business_id int, @IsDiscount int, @IsGstReg int,
  @print_as varchar(200), @Contract_By varchar(50), @under_client varchar(50), @sap_code varchar(20), @manual_code varchar(20)
as
  update client_Master set company_name = @company_name, client_name = @Client_Name,
    contact_person = @contact_person, address = @address, city = @city, place = @place, pin_code = @pin_code, email = @email,
    phone = @phone, fax = @fax, pan_no = @pan_no, service_tax_no = @service_tax_no, intro_date = @intro_date, is_Active = @is_Active,
    credit_period = @credit_period, is_stax_notapplicable = @is_tax_notapplicable, remarks = @remarks,
    IsThirdPartyBilling = @IsThirdPartyBilling, Mobile = @Mobile, tin = @Tin_Number, Branch_Code = @Branch_Code,
    IsWalkingClient = @IsWalkingClient, Billing_Cycle = @Billing_Cycle, Gstin_No = @Gstin_No, AutoGstStatus = @AutoGstStatus,
    BillingLocation = @BillingLocation, SubmissionLocation = @SubmissionLocation, CollectionLocation = @CollectionLocation,
    PlaceofSupply = @PlaceofSupply, PO_No = @PO_No, CIN_NO = @CIN_No, DivCode = @Division, divcourier = @divcourier,
    divparcel = @divparcel, divftl = @divftl, billing_address = @billing_address, billing_client_name = @billing_client_name,
    billing_client_phone = @billing_client_phone, billing_client_GSTIN = @billing_client_gstin, Credit_Type = @Credit_Type,
    IsPs = @IsPs, Trans_no = @Trans_no, ShowKMOnPrint = @ShowKMOnPrint, nature_of_business_id = @nature_of_business_id,
    IsDiscount = @IsDiscount, IsGstReg = @IsGstReg, print_as = @print_as, Contract_By = @Contract_By, Under_client = @under_client,
    sap_code = @sap_code, manual_no = @manual_code
  where client_Id = @client_Id and client_code = @clinet_code;
GO

create procedure delete_Client_Master_With_Details @client_Id int
as
  delete from client_Master where client_Id = @client_Id;
GO
