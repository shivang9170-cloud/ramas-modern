-- =============================================================================
-- DEV-ONLY: franchisee commission invoices — Invoice/Franchisee_Commission_Invoice.aspx and Franchisee_Invoice_Cancel.aspx.
-- A monthly invoice of what a franchisee earned on the dockets booked at its branch.
-- Columns from Franchisee_Comm_Invoice_Dal (bin/ClassLibrary.dll): insert into Franchisee_Invoice(Fran_Code, F_Invoice_No,
-- Branch_Code, Invoice_Date, From_Date, To_Date, Month, Created_By), Franchisee_Invoice_Detail(F_Invoice_No, Docket_No, Booking_Date,
-- Origin_Branch_Code, Destination_Branch_Code, Packet, Weight, Basic_Freight, Franchisee_Rate, Commaission_Type, Franchisee_Amount,
-- Handling_Charge_Rate, Handling_Charge_Amount, Collection_Charge, Total_Amount, Created_By), the cancel's IsCancel / Cancel_by /
-- Cancel_Date and grn_master.Franchisee_Invoice_Status. Totals, rent / mobile / signage, TDS and the docket's invoice no. are ours.
-- See docs/SCHEMA-VERIFICATION.md "Franchisee commission invoices".
-- =============================================================================

if object_id('Franchisee_Invoice') is null
  create table Franchisee_Invoice (
    Slno int identity primary key, F_Invoice_No varchar(30) not null unique, Fran_Code varchar(20) not null, Fran_Branch varchar(20),
    Branch_Code varchar(20), Invoice_Date date, From_Date date, To_Date date, Month varchar(20), Rent decimal(18,2) default 0,
    Mobile_Bills decimal(18,2) default 0, Signage decimal(18,2) default 0, Commission_Total decimal(18,2), Handling_Total decimal(18,2),
    Collection_Total decimal(18,2), Gross_Amount decimal(18,2), TDS_Percent decimal(9,2) default 0, TDS_Amount decimal(18,2) default 0,
    Net_Amount decimal(18,2), Remarks varchar(500), Financial_Year varchar(20), Division varchar(20), ShortCode varchar(10),
    FinYr varchar(10), Created_By varchar(50), Created_Date datetime default getdate(),
    IsCancel bit not null default 0, Cancel_by varchar(50), Cancel_Date datetime, Cancel_Remarks varchar(500));
GO
if object_id('Franchisee_Invoice_Detail') is null
  create table Franchisee_Invoice_Detail (
    Slno int identity primary key, F_Invoice_No varchar(30) not null, Docket_No varchar(30) not null, Booking_Date date,
    Booking_Type varchar(20), Booking_Mode varchar(10), Origin_Branch_Code varchar(20), Destination_Branch_Code varchar(20), Packet int,
    Weight decimal(18,2), Basic_Freight decimal(18,2), Franchisee_Rate decimal(18,2), Commaission_Type varchar(40),
    Franchisee_Amount decimal(18,2), Handling_Charge_Rate decimal(18,2), Handling_Charge_Amount decimal(18,2),
    Collection_Charge decimal(18,2), Total_Amount decimal(18,2), Created_By varchar(50), Created_Date datetime default getdate());
GO
if col_length('grn_master', 'Franchisee_Invoice_Status') is null
  alter table grn_master add Franchisee_Invoice_Status varchar(20), Franchisee_Invoice_No varchar(30);
GO
