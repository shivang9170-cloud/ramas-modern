-- =============================================================================
-- DEV-ONLY: miscellaneous and warehouse bills — Invoice/Miscellaneous_Bill.aspx, Warehouse_bill.aspx and their submission /
-- finalize / cancel / report / print pages. The two pages are the same form on two tables (Miscellaneous_Bill_pal /
-- Warehouse_bill_pal: bill_no, BillDate, MonthName, YearName, client_Id, client_Code, cust_name, remarks, TaxableAmt,
-- TaxType, CGST / SGST / IGST and amounts, TotalAmount, UserId, CreateDate, CreatBranch, Financial_Year, SAC, DueDate,
-- ServiceFor, TaxModeFor, ShortCode, FinYr). See docs/SCHEMA-VERIFICATION.md "Miscellaneous and warehouse bills".
-- =============================================================================

if object_id('miscellaneous_bill') is null
  create table miscellaneous_bill (
    slno int identity primary key, Bill_No varchar(30) not null unique, BillDate date, DueDate date, MonthName varchar(15),
    YearName varchar(4), client_Id int, client_Code varchar(30), cust_name varchar(200), ServiceType varchar(20), ServiceFor varchar(60),
    SAC varchar(20), TaxModeFor varchar(30), TaxType varchar(15), Quantity decimal(18,2), Rate decimal(18,2), TaxableAmt decimal(18,2),
    CGST decimal(9,2), CGSTAmt decimal(18,2), SGST decimal(9,2), SGSTAmt decimal(18,2), IGST decimal(9,2), IGSTAmt decimal(18,2),
    TotalAmount decimal(18,2), remarks varchar(500), UserId varchar(50), CreateDate datetime default getdate(), CreatBranch varchar(20),
    Financial_Year varchar(20), Division varchar(20), ShortCode varchar(10), FinYr varchar(10),
    Summation_status varchar(20), Summation_date date, RcvName varchar(100), RcvPhNo varchar(30),
    Finalize_status varchar(20), Finalize_date date,
    Cancel_status varchar(20), Cancel_date date, Cancel_time varchar(10), Cancel_remarks varchar(500), Cancel_by varchar(50));
GO
if object_id('warehouse_bill') is null
  select top 0 * into warehouse_bill from miscellaneous_bill;
GO
if not exists (select 1 from sys.indexes where name = 'UX_warehouse_bill_no')
  create unique index UX_warehouse_bill_no on warehouse_bill(Bill_No);
GO
-- objd.SelectTax(): the GST slabs offered on the form (Slab text, CGST / SGST / IGST %)
if object_id('Misc_Tax_Slab') is null
  create table Misc_Tax_Slab (SlNo int identity primary key, Slab varchar(30), CGST decimal(9,2), SGST decimal(9,2), IGST decimal(9,2));
GO

-- the legacy finalize modes ("Miscellaneous Bill Finalized", 28 characters) do not fit the dev column (varchar(20))
if (select max_length from sys.columns where object_id = object_id('tblAccountTrasaction') and name = 'Mode') < 50
  alter table tblAccountTrasaction alter column Mode varchar(50);
GO