-- =============================================================================
-- DEV-ONLY: vendor invoices.
--  * Invoice/VendorInvoice.aspx ("Other vendor invoice"): a bill from an other vendor (stationery, repairs, services) with
--    product lines, GST, TDS and a cost-centre split; posts a PURCHASE/PAYBILL voucher. OthVndInvoiceDetails.aspx shows
--    the cost-centre rows, OtherVendorPrint.aspx prints it.
--  * Invoice/Vendor_Invoice_For_Varification.aspx: a transport vendor's bill checked against its CHT challans
--    (current payment per challan); VendorPendingInvoiceReport.aspx and Vendor_Invoice_Print.aspx read it back.
-- Names from the DLL: Sp_InsertOtherVendorInvoice (@StockEntryNo, @dtCurrentTableOtherVendorInv,
-- @dtCurrentTableOtherVendorInvCostProfit, @InvoiceFor, @TotTDS, @AfterTDSAmt ...), OtherVendorInvoice, OtherVendorInvoiceCostProfit,
-- VOtherVendorInvoice, ProductMaster (usp_InsertProductMaster), Other_Vendor_Master (insert_Other_Vendor_Master), TaxSlab,
-- sp_insert_vendor_invoice_verification (@Vendor_Receipt_Code, @dtVendor_invoice_verify_detail ...), Vendor_Invoice_Verify,
-- Dispatch_Master.IsVerified. The line table name is ours (the DLL passes the lines as a table type).
-- See docs/SCHEMA-VERIFICATION.md "Vendor invoices".
-- =============================================================================

if object_id('Other_Vendor_Master') is null
  create table Other_Vendor_Master (
    slno int identity primary key, vendor_code varchar(20) not null unique, name varchar(200) not null, vendor_type varchar(50),
    vendor_Mode varchar(20), Branch varchar(20), address varchar(500), vendor_city varchar(20), state varchar(20), pin_code varchar(10),
    vendor_phone_no varchar(30), email varchar(100), pan_no varchar(20), Gstin_No varchar(20), TDS decimal(9,2) default 0,
    IsCostProfit bit default 0, IsOctroi bit default 0, active_flag bit default 1, FTLDiv varchar(20), created_by varchar(50),
    created_date datetime default getdate());
GO
if object_id('ProductMaster') is null
  create table ProductMaster (
    SrNo int identity primary key, ProductCode varchar(20) not null unique, ProductName varchar(200) not null,
    IsSacHsn bit default 0, SacHSN varchar(20), UOM varchar(20), Status bit default 1, created_date datetime default getdate());
GO
if object_id('OtherVendorInvoice') is null
  create table OtherVendorInvoice (
    slno int identity primary key, InvoiceNo varchar(30) not null unique, InvoiceDate date, InvoiceFor varchar(60), PartsType varchar(20),
    VendorCode varchar(20), VendorLedger varchar(30), VendorInvNo varchar(50), PurchaseDate date, ExpenseLedger varchar(30),
    TDSLedger varchar(30), TaxType varchar(10), Qty decimal(18,3), TaxableAmt decimal(18,2), CGSTAmt decimal(18,2), SGSTAmt decimal(18,2),
    IGSTAmt decimal(18,2), BillAmt decimal(18,2), TDS decimal(9,2), TotTDS decimal(18,2), AfterTDSAmt decimal(18,2), Narration varchar(1000),
    IsAllocation bit default 0, Branch_Code varchar(20), ShortCode varchar(10), FinYr varchar(10), Financial_Year varchar(20),
    Division varchar(20), UserId varchar(50), CreateDate datetime default getdate(),
    IsCancelled bit not null default 0, CancelBy varchar(50), CancelDate datetime, CancelRemarks varchar(500));
GO
if object_id('OtherVendorInvoice_Details') is null
  create table OtherVendorInvoice_Details (
    id int identity primary key, InvoiceNo varchar(30) not null, ItemCode varchar(20), ItemSrNo varchar(20), Quantity decimal(18,3),
    Rate decimal(18,2), TaxableAmt decimal(18,2), TaxModeFor int, TaxType varchar(10), CGST decimal(9,2), CGSTAmt decimal(18,2),
    SGST decimal(9,2), SGSTAmt decimal(18,2), IGST decimal(9,2), IGSTAmt decimal(18,2), TotalAmount decimal(18,2),
    ITDescription varchar(500), TDSPrc decimal(9,2), TDSAmt decimal(18,2), AfterTDSAmt decimal(18,2), PayableAmt decimal(18,2));
GO
if object_id('OtherVendorInvoiceCostProfit') is null
  create table OtherVendorInvoiceCostProfit (
    id int identity primary key, InvoiceNo varchar(30) not null, CostProfit varchar(30), Code varchar(30), Name varchar(200),
    Amount decimal(18,2));
GO
if object_id('Vendor_Invoice_Verify') is null
  create table Vendor_Invoice_Verify (
    SlNo int identity primary key, Vendor_Receipt_Code varchar(20) not null unique, Vendor_Code varchar(20), Vendor_Mode varchar(10),
    Vendor_Bill_No varchar(30) not null unique, Vendor_Ref_No varchar(50), Vendor_Bill_Date date, Bill_Amount decimal(18,2),
    Deduction decimal(18,2), Narration varchar(1000), Challan_amount decimal(18,2), Balance_Amount decimal(18,2), verify_status bit,
    challan_type int, Branch_Code varchar(20), ShortCode varchar(10), FinYr varchar(10), Financial_Year varchar(20), division varchar(20),
    user_id varchar(50), created_date datetime default getdate(),
    IsCancelled bit not null default 0, CancelBy varchar(50), CancelDate datetime, CancelRemarks varchar(500));
GO
if object_id('Vendor_Invoice_Verify_Details') is null
  create table Vendor_Invoice_Verify_Details (
    id int identity primary key, Vendor_Bill_No varchar(30) not null, challan_no varchar(30) not null, vehicle_freight decimal(18,2),
    advance decimal(18,2), CurrentPayment decimal(18,2), Balance_Amount decimal(18,2), CurrentPaymentDate date,
    IsCancelled bit not null default 0);
GO
if col_length('Dispatch_Master', 'IsVerified') is null
  alter table Dispatch_Master add IsVerified bit not null default 0;
GO
