-- =============================================================================
-- DEV-ONLY: bill receipt — Invoice/Bill_Receive.aspx (money received against finalized client bills).
-- Columns from Account_Bill_Receive_pal (insert_Bill_Receive) and the page's bill grid (dt_bill_Details: Bill_no, Bill_Amount,
-- Cr = received, TDS, Deduction, OtherIncome, RoundedAmt, Trans_Type). See docs/SCHEMA-VERIFICATION.md "Bill receipt".
-- =============================================================================

if object_id('Bill_Receive') is null
  create table Bill_Receive (
    slno int identity primary key, BR_No varchar(30) not null unique, Receive_Date date, Client_Code varchar(30), client_Id int,
    Receive_mode varchar(10), CashLedger varchar(20), BankLedger varchar(20), Paymentmode varchar(20), ChequeNo varchar(50),
    ChequeDate date, ClientBank varchar(100), BRMANUALNo varchar(50), Receive_Amount decimal(18,2), TDS decimal(18,2),
    Deduction decimal(18,2), RoundedAmt decimal(18,2), OtherIncome decimal(18,2), Remarks varchar(500), Narration varchar(1000),
    Branch varchar(20), Financial_Year varchar(20), Division varchar(20), User_id varchar(50), ShortCode varchar(10), FinYr varchar(10),
    IsCancelled bit not null default 0, Cancelled_By varchar(50), Cancelled_Date datetime, Cancel_Remarks varchar(500),
    Created_Date datetime default getdate());
GO
if object_id('Bill_Receive_Details') is null
  create table Bill_Receive_Details (
    slno int identity primary key, BR_No varchar(30) not null, Bill_no varchar(30) not null, Bill_Amount decimal(18,2),
    Received decimal(18,2), TDS decimal(18,2), Deduction decimal(18,2), RoundedAmt decimal(18,2), Settled decimal(18,2),
    Trans_Type varchar(20) default 'Client_Bill', IsCancelled bit not null default 0);
GO
