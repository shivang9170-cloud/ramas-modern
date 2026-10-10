-- Account Master (ledgers + account groups) — modern take on Accounts/LedgerBind_Add.aspx.
-- No new tables: it manages the existing tblAccountGroup / tblAccountLedger (06-challan.sql).
-- This file only wires the menu entry, and is written to be safe to re-run on an already-seeded dev DB.

if not exists (select 1 from SubMenu where Menuid = 'M001' and SubMenuid = 'S075')
  insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division)
  values ('M001', 'S075', 'Account Master', 'Accounts/LedgerBind_Add.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');

if not exists (select 1 from Employee_Permission where Employeeid = 'EMP001' and MainMenuid = 'M001' and Sub_Menuid = 'S075')
  insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus)
  values ('EMP001', 'M001', 'S075', null, 'Y');
GO
