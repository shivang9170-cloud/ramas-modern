-- =============================================================================
-- DEV-ONLY: octroi bills — Invoice/Octroi_Bills.aspx (octroi paid on a client's dockets billed back with a service charge),
-- Octroi_Bill_Summation, Octroi_Bill_Cancel, Octroi_Bill_Report, Octroi_Bill_Print (OctroBillFinalise.aspx is empty).
-- Columns from octroiBill_pal (insert_in_client_bill / insert_into_Client_Bill_Charge_Details) and the DLL's octroi_bill updates
-- (OctroiBill_Summation_status, Summation_date, OctroiBill_Cancel_status, mr_status, mr_no; grn_master Octroi_Status, Octroi_Bill_No).
-- See docs/SCHEMA-VERIFICATION.md "Octroi bills".
-- =============================================================================

if object_id('octroi_bill') is null
  create table octroi_bill (
    slno int identity primary key, bill_no varchar(30) not null unique, bill_date date, client_Id int, client_code varchar(30),
    client_name varchar(200), docket_no varchar(max), booking_mode varchar(10), address varchar(500), octroi_no varchar(50),
    totalamount decimal(18,2), remarks varchar(500), origin_branch varchar(20), billing_at varchar(20), Financial_Year varchar(20),
    Division varchar(20), user_id varchar(50), ShortCode varchar(10), FinYr varchar(10), created_date datetime default getdate(),
    OctroiBill_Summation_status varchar(20), Summation_date date, RcvName varchar(100), RcvPhNo varchar(30),
    OctroiBill_Cancel_status varchar(20), Cancel_date datetime, Cancel_by varchar(50), Cancel_remarks varchar(500),
    mr_status varchar(30), mr_no varchar(30));
GO
if object_id('octroi_bill_charge_details') is null
  create table octroi_bill_charge_details (
    id int identity primary key, bill_no varchar(30) not null, docket_no varchar(30) not null, booking_date date, Invoice_no varchar(500),
    package int, weight decimal(18,2), OctroiAmount decimal(18,2), OtherCharges decimal(18,2), OctroiCharges_Per decimal(9,2),
    OctroiCharges_Amount decimal(18,2), Service_Tax decimal(9,2), ServiceTax_Amount decimal(18,2), totalamount decimal(18,2),
    octroi_no varchar(50), client_bill_status varchar(20));
GO
if col_length('grn_master', 'Octroi_Bill_No') is null
  alter table grn_master add Octroi_Status varchar(30), Octroi_Bill_No varchar(30);
GO
