-- Contra Entry — port of Accounts/Contra_Entry.aspx: a transfer between the firm's own Cash / Bank ledgers
-- (money moved bank→cash, cash→bank, bank→bank). One voucher = balanced Dr and Cr lines; the lines post to
-- tblAccountTrasaction (Mode 'Contra Note', VoucherNo = Contra_No). This header table replaces the legacy tbl_contra.
-- Safe to re-run on an already-seeded dev DB.

if object_id('tbl_contra', 'U') is null
create table tbl_contra (
  Contra_No varchar(30) primary key,
  Contra_Date date,
  Ref_No varchar(50),
  ChequeNo varchar(50),
  Narration varchar(500),
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

-- New top-level ACCOUNTS menu (the Accounts folder: contra, and later payment / receipt / journal / day book).
if not exists (select 1 from MasterMenu where Menuid = 'M007')
  insert into MasterMenu(Menuid, MenuName, MenuUrl, ActiveStatus) values ('M007', 'ACCOUNTS', '#', 'Y');

if not exists (select 1 from SubMenu where Menuid = 'M007' and SubMenuid = 'S076')
  insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division)
  values ('M007', 'S076', 'Contra Entry', 'Accounts/Contra_Entry.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
if not exists (select 1 from SubMenu where Menuid = 'M007' and SubMenuid = 'S077')
  insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division)
  values ('M007', 'S077', 'Contra Entry View / Cancel', 'Accounts/Contra_Entry_Cancel.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');

if not exists (select 1 from Employee_Permission where Employeeid = 'EMP001' and MainMenuid = 'M007' and Sub_Menuid = 'S076')
  insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M007', 'S076', null, 'Y');
if not exists (select 1 from Employee_Permission where Employeeid = 'EMP001' and MainMenuid = 'M007' and Sub_Menuid = 'S077')
  insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M007', 'S077', null, 'Y');
GO
