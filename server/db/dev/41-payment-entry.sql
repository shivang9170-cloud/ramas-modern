-- Payment Entry — port of Accounts/Payment_Entry.aspx: pay money to a party / expense from a Cash / Bank account.
-- Automated: one payment = Dr the party you pay, Cr the cash/bank you pay from (no manual Dr/Cr). Lines post to
-- tblAccountTrasaction (Mode 'Payment Note', VoucherNo = Payment_No); this header table replaces the legacy tbl_payment.
-- Safe to re-run on an already-seeded dev DB.

if object_id('tbl_payment', 'U') is null
create table tbl_payment (
  Payment_No varchar(30) primary key,
  Payment_Date date,
  Ref_No varchar(50),
  ChequeNo varchar(50),
  Narration varchar(500),
  PayTo_Ledger varchar(20),
  PayFrom_Ledger varchar(20),
  Amount decimal(18,2),
  Branch varchar(20),
  Financial_Year varchar(20),
  Division varchar(20),
  User_id varchar(50),
  CreatedDate datetime default getdate(),
  IsCancelled bit default 0,
  Cancelled_By varchar(50),
  Cancelled_Date datetime,
  Cancel_Remarks varchar(300)
);
GO

-- Menu under the ACCOUNTS folder (M007, created in 40-contra-entry.sql)
if not exists (select 1 from MasterMenu where Menuid = 'M007')
  insert into MasterMenu(Menuid, MenuName, MenuUrl, ActiveStatus) values ('M007', 'ACCOUNTS', '#', 'Y');
if not exists (select 1 from SubMenu where Menuid = 'M007' and SubMenuid = 'S078')
  insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division)
  values ('M007', 'S078', 'Payment Entry', 'Accounts/Payment_Entry.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
if not exists (select 1 from SubMenu where Menuid = 'M007' and SubMenuid = 'S079')
  insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division)
  values ('M007', 'S079', 'Payment Entry View / Cancel', 'Accounts/Payment_Entry_Cancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
if not exists (select 1 from Employee_Permission where Employeeid = 'EMP001' and MainMenuid = 'M007' and Sub_Menuid = 'S078')
  insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M007', 'S078', null, 'Y');
if not exists (select 1 from Employee_Permission where Employeeid = 'EMP001' and MainMenuid = 'M007' and Sub_Menuid = 'S079')
  insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M007', 'S079', null, 'Y');
GO
