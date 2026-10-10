-- =============================================================================
-- DEV-ONLY: client bill (GST) — Invoice/Client_Bill_GST.aspx, Client_Bill_Cancel.aspx and the bill views / prints.
-- Columns from ClientBill_dal (bin/ClassLibrary.dll): sp_insert_Client_Bill_Bulk parameters, the client_bill_charge_details
-- insert, the summation / finalize / cancel updates and the report selects. See docs/SCHEMA-VERIFICATION.md "Client bill".
-- =============================================================================

if object_id('client_bill') is null
  create table client_bill (
    slno int identity primary key, bill_no varchar(30) not null unique, bill_date date, DueDate date,
    client_Id int, client_code varchar(30), docket_no varchar(max), Invoice_no varchar(max),
    totalfreight decimal(18,2), Total_docket_charge decimal(18,2), Total_other_charge decimal(18,2),
    Furelcharge_Amount decimal(18,2), Furelcharge_Per decimal(18,2), totalstax decimal(18,2), TotCGST decimal(18,2),
    TotSGST decimal(18,2), TotIGST decimal(18,2), TotAfterTax decimal(18,2), totalamount decimal(18,2),
    booking_mode varchar(100), address varchar(500), origin_branch varchar(20), Financial_Year varchar(20), user_id varchar(50),
    ShortCode varchar(10), FinYr varchar(10), manual_bill_no varchar(50), remarks varchar(500), division varchar(20),
    docs_enclosed varchar(200), client_type int, RateOn varchar(30), BillType int, StaxRemark varchar(10),
    FromDate date, ToDate date, SacCode varchar(20), ServiceType varchar(50),
    client_bill_status varchar(20), CancelBy varchar(50), CancelDate datetime,
    ClientBill_Summation_status varchar(20), Summation_date date, Summation_remarks varchar(500), RcvName varchar(100), RcvPhNo varchar(30),
    ClientBill_Finalize_status varchar(20), ClientBill_Finalize_date date, Payment_Status int not null default 0,
    mr_status varchar(30), mr_no varchar(30), Bill_Type varchar(20) default 'To Be Billed', CollectionLocation varchar(20),
    created_date datetime default getdate());
GO

-- the table existed with (id, bill_no, docket_no, amount); the bill's docket rows
if col_length('client_bill_charge_details', 'booking_date') is null
  alter table client_bill_charge_details add
    booking_date date, package int, weight decimal(18,2), rate decimal(18,4), RateOn varchar(30), Invoice_no varchar(500),
    freight_charges decimal(18,2), docket_charge decimal(18,2), other_charges decimal(18,2), Furelcharge_Amount decimal(18,2),
    Furelcharge_Per decimal(18,2), stax decimal(18,2), CGST_Tax decimal(18,4), CGST_Amt decimal(18,2), SGST_Tax decimal(18,4),
    SGST_Amt decimal(18,2), IGST_Tax decimal(18,4), IGST_Amt decimal(18,2), after_tax decimal(18,2), grand_total decimal(18,2),
    Taxtype varchar(10), client_bill_status varchar(20);
GO

if object_id('client_bill_cancel') is null
  create table client_bill_cancel (
    slno int identity primary key, cancel_bill_no varchar(30), cancel_bill_date date, cancel_bill_time varchar(10),
    client_Id int, totalamount decimal(18,2), docket_no varchar(max), CancelBy varchar(50), billCancel_Remarks varchar(500),
    origin_branch varchar(20), division varchar(20), Financial_Year varchar(20), created_date datetime default getdate());
GO

-- SAC code per service type (Bind_Sac_Details: select Sac_Code, SubServiceType from Sac_Master where ServiceType = …)
if object_id('Sac_Master') is null
  create table Sac_Master (id int identity primary key, ServiceType varchar(50), SubServiceType varchar(200), Sac_Code varchar(20));
GO
