-- Accounts books foundation: what every account group IS (for Trial Balance / P&L / Balance Sheet), one clean set of
-- groups, freight income booked when a client bill is finalized, and one register of every voucher with its source.
--
--   tblAccountGroupInfo   GroupCode -> Section (CAPITAL, LOANS, CREDITORS, TAXES, CURR_LIAB, BRANCH, FIXED, BANK, CASH,
--                         DEBTORS, ADVANCES, CURR_ASSET, DIRECT_INC, INDIRECT_INC, DIRECT_EXP, INDIRECT_EXP). The nature
--                         (Asset / Liability / Income / Expense) comes from the section (server/src/modules/books/sections.js).
--                         Legacy tblAccountGroup is not altered.
--   vw_AccountVoucher     one row per voucher (VoucherNo + Mode) from every module's own header table: date, type,
--                         narration, party, branch, user. The Day Book joins tblAccountTrasaction to it.
--
-- Data changes (approved 2026-10-08):
--   * duplicate groups merged: "Direct Expense" -> "DIRECT EXPENSES"; empty "Cash In Hand" and "HIMANSHU" removed;
--   * standard groups added when missing: CAPITAL ACCOUNT, LOANS (LIABILITY), CURRENT LIABILITIES, FIXED ASSETS,
--     DIRECT INCOME, INDIRECT EXPENSES; BOOKING INCOME MISCELLANEOUS / WAREHOUSE moved to DIRECT INCOME;
--   * ledger FREIGHT INCOME (DIRECT INCOME) for every year + division;
--   * finalized client bills posted Dr client BILLED / Cr client UNBILLED (or PAID/TOPAY RECOVERY) - nothing ever reached
--     an income ledger. Those credit lines are re-pointed to FREIGHT INCOME (taxable) + OUTPUT CGST / SGST / IGST (tax).
-- Safe to re-run.

if object_id('tblAccountGroupInfo', 'U') is null
create table tblAccountGroupInfo (
  GroupCode varchar(20) primary key,
  Section varchar(20) not null,
  UpdatedBy varchar(50),
  UpdatedDate datetime default getdate()
);
GO

-- ---------------------------------------------------------------- merge duplicate groups
update tblAccountLedger set GroupCode = (select top 1 GroupCode from tblAccountGroup where upper(GroupName) = 'DIRECT EXPENSES')
 where GroupCode in (select GroupCode from tblAccountGroup where upper(GroupName) = 'DIRECT EXPENSE')
   and exists (select 1 from tblAccountGroup where upper(GroupName) = 'DIRECT EXPENSES');
update tblAccountLedger set GroupCode = (select top 1 GroupCode from tblAccountGroup where upper(GroupName) = 'CASH-IN-HAND')
 where GroupCode in (select GroupCode from tblAccountGroup where upper(GroupName) = 'CASH IN HAND')
   and exists (select 1 from tblAccountGroup where upper(GroupName) = 'CASH-IN-HAND');
delete g from tblAccountGroup g
 where upper(g.GroupName) in ('DIRECT EXPENSE', 'CASH IN HAND', 'HIMANSHU')
   and not exists (select 1 from tblAccountLedger l where l.GroupCode = g.GroupCode)
   and (upper(g.GroupName) <> 'DIRECT EXPENSE' or exists (select 1 from tblAccountGroup x where upper(x.GroupName) = 'DIRECT EXPENSES'))
   and (upper(g.GroupName) <> 'CASH IN HAND' or exists (select 1 from tblAccountGroup x where upper(x.GroupName) = 'CASH-IN-HAND'));
delete i from tblAccountGroupInfo i where not exists (select 1 from tblAccountGroup g where g.GroupCode = i.GroupCode);
GO

-- ---------------------------------------------------------------- standard groups (code = G + next number)
declare @names table (n varchar(100), ord int);
insert into @names values ('CAPITAL ACCOUNT', 1), ('LOANS (LIABILITY)', 2), ('CURRENT LIABILITIES', 3), ('FIXED ASSETS', 4),
  ('DIRECT INCOME', 5), ('INDIRECT EXPENSES', 6);
declare @name varchar(100), @next int;
declare c cursor local fast_forward for select n from @names where n not in (select upper(GroupName) from tblAccountGroup) order by ord;
open c; fetch next from c into @name;
while @@fetch_status = 0
begin
  select @next = isnull(max(try_cast(substring(GroupCode, 2, 20) as int)), 0) + 1 from tblAccountGroup where GroupCode like 'G[0-9]%';
  insert into tblAccountGroup(GroupCode, GroupName) values ('G' + cast(@next as varchar(10)), @name);
  fetch next from c into @name;
end
close c; deallocate c;
GO

-- ---------------------------------------------------------------- section of every group (only where not set by a user)
insert into tblAccountGroupInfo(GroupCode, Section, UpdatedBy)
select g.GroupCode,
       case
         when u like '%CAPITAL%' then 'CAPITAL'
         when u like 'LOANS (LIABILITY)%' or u like 'SECURED LOAN%' or u like 'UNSECURED LOAN%' then 'LOANS'
         when u like '%SUNDRY CREDITOR%' then 'CREDITORS'
         when u like '%DUTIES%' or u like '%TAXES%' then 'TAXES'
         when u like '%CURRENT LIABILIT%' or u like '%PROVISION%' then 'CURR_LIAB'
         when u like '%BRANCH%' or u like '%DIVISION%' then 'BRANCH'
         when u like '%FIXED ASSET%' then 'FIXED'
         when u like '%BANK%' then 'BANK'
         when u like '%CASH%' then 'CASH'
         when u like '%SUNDRY DEBTOR%' then 'DEBTORS'
         when u like '%ADVANCE%' then 'ADVANCES'
         when u like '%CURRENT ASSET%' or u like '%RECOVERY%' or u like '%DEPOSIT%' then 'CURR_ASSET'
         when u like 'INDIRECT INCOME%' or u like '%OTHER INCOME%' then 'INDIRECT_INC'
         when u like '%INCOME%' or u like '%SALES%' then 'DIRECT_INC'
         when u like 'DIRECT EXPENSE%' or u like '%PURCHASE%' then 'DIRECT_EXP'
         when u like '%EXPENSE%' or u like '%SALARY%' then 'INDIRECT_EXP'
       end, 'setup'
  from (select GroupCode, upper(GroupName) as u from tblAccountGroup) g
 where not exists (select 1 from tblAccountGroupInfo i where i.GroupCode = g.GroupCode)
   and (u like '%CAPITAL%' or u like '%LOAN%' or u like '%CREDITOR%' or u like '%DUTIES%' or u like '%TAXES%' or u like '%LIABILIT%'
     or u like '%PROVISION%' or u like '%BRANCH%' or u like '%DIVISION%' or u like '%ASSET%' or u like '%BANK%' or u like '%CASH%'
     or u like '%DEBTOR%' or u like '%ADVANCE%' or u like '%RECOVERY%' or u like '%DEPOSIT%' or u like '%INCOME%' or u like '%SALES%'
     or u like '%EXPENSE%' or u like '%PURCHASE%' or u like '%SALARY%');
GO

-- booking income (miscellaneous / warehouse bills) is operating income
update l set GroupCode = (select top 1 GroupCode from tblAccountGroup where upper(GroupName) = 'DIRECT INCOME')
  from tblAccountLedger l
 where upper(l.LedgerName) in ('BOOKING INCOME MISCELLANEOUS', 'BOOKING INCOME WAREHOUSE')
   and l.GroupCode in (select GroupCode from tblAccountGroup where upper(GroupName) = 'INDIRECT INCOME');
GO

-- ---------------------------------------------------------------- FREIGHT INCOME ledger for every year + division
insert into tblAccountLedger(LedgerCode, LedgerName, GroupCode, Ledger_Type, OpeningBal, ClosingBal, VendorOrClientCode, DrCr, Financial_Year, Division, IsActive)
select 'LFRT' + right(y.Division, 4) + '-' + left(y.Financial_Year, 4), 'FREIGHT INCOME',
       (select top 1 GroupCode from tblAccountGroup where upper(GroupName) = 'DIRECT INCOME'), 'Income', 0, 0, null, 'CR',
       y.Financial_Year, y.Division, 1
  from (select distinct Financial_Year, Division from tblAccountLedger where Financial_Year is not null and Division is not null) y
 where not exists (select 1 from tblAccountLedger l where l.LedgerName = 'FREIGHT INCOME' and l.Financial_Year = y.Financial_Year and l.Division = y.Division)
   and not exists (select 1 from tblAccountLedger l where l.LedgerCode = 'LFRT' + right(y.Division, 4) + '-' + left(y.Financial_Year, 4));
GO

-- ---------------------------------------------------------------- finalized client bills: credit income + output GST
-- the old credit line (UNBILLED / RECOVERY ledger) becomes FREIGHT INCOME for the taxable part; tax goes to OUTPUT xGST
-- when that year's ledger exists (else it stays in income so the voucher still balances).
declare @fix table (SlNo int primary key, VoucherNo varchar(50), Amt decimal(18,2), FY varchar(20), Div varchar(20), CDate datetime,
  Cgst decimal(18,2), Sgst decimal(18,2), Igst decimal(18,2), Income varchar(20), LC varchar(20), LS varchar(20), LI varchar(20));
insert into @fix
select t.SlNo, t.VoucherNo, t.Cr, t.Financial_Year, t.Division, t.CreatedDate,
       isnull(cb.TotCGST, 0), isnull(cb.TotSGST, 0), isnull(cb.TotIGST, 0),
       (select top 1 LedgerCode from tblAccountLedger x where x.LedgerName = 'FREIGHT INCOME' and x.Financial_Year = t.Financial_Year and x.Division = t.Division),
       (select top 1 LedgerCode from tblAccountLedger x where x.LedgerName = 'OUTPUT CGST' and x.Financial_Year = t.Financial_Year and x.Division = t.Division),
       (select top 1 LedgerCode from tblAccountLedger x where x.LedgerName = 'OUTPUT SGST' and x.Financial_Year = t.Financial_Year and x.Division = t.Division),
       (select top 1 LedgerCode from tblAccountLedger x where x.LedgerName = 'OUTPUT IGST' and x.Financial_Year = t.Financial_Year and x.Division = t.Division)
  from tblAccountTrasaction t
  join client_bill cb on cb.bill_no = t.VoucherNo
  join tblAccountLedger l on l.LedgerCode = t.LedgerCode
 where t.Mode = 'Bill Finalized' and isnull(t.Cr, 0) > 0
   and l.LedgerName <> 'FREIGHT INCOME' and l.LedgerName not like 'OUTPUT %GST'
   and not exists (select 1 from tblAccountTrasaction t2 join tblAccountLedger l2 on l2.LedgerCode = t2.LedgerCode
                    where t2.VoucherNo = t.VoucherNo and t2.Mode = 'Bill Finalized' and l2.LedgerName = 'FREIGHT INCOME');
-- tax goes to GST only when every needed ledger exists and the tax fits inside the amount
update @fix set Cgst = 0, Sgst = 0, Igst = 0
 where (Cgst > 0 and LC is null) or (Sgst > 0 and LS is null) or (Igst > 0 and LI is null) or Cgst + Sgst + Igst > Amt;
delete from @fix where Income is null;

insert into tblAccountTrasaction(LedgerCode, Dr, Cr, CreatedDate, VoucherNo, Mode, Entry, Financial_Year, Division, IsCancelled)
select v.L, 0, v.A, f.CDate, f.VoucherNo, 'Bill Finalized', 'Ledger', f.FY, f.Div, t.IsCancelled
  from @fix f join tblAccountTrasaction t on t.SlNo = f.SlNo
 cross apply (values (f.LC, f.Cgst), (f.LS, f.Sgst), (f.LI, f.Igst)) v(L, A)
 where v.A > 0;
update t set LedgerCode = f.Income, Cr = f.Amt - f.Cgst - f.Sgst - f.Igst
  from tblAccountTrasaction t join @fix f on f.SlNo = t.SlNo;
GO

-- ---------------------------------------------------------------- one register of every voucher
create or alter view vw_AccountVoucher as
select p.Payment_No as VoucherNo, 'Payment Note' as Mode,
       case when p.PaymentType = 'ADV_ADJUST' then 'Journal' else 'Payment' end as VoucherType,
       cast(p.Payment_Date as date) as VoucherDate, p.Narration,
       coalesce(nullif(p.PersonName, ''), tl.LedgerName) as Party,
       case p.PaymentType when 'EXPENSE' then 'Expense payment' when 'ADVANCE' then 'Advance payment'
         when 'ADV_ADJUST' then 'Advance adjustment'
         else case when exists (select 1 from tbl_payment_detail d where d.Payment_No = p.Payment_No and d.LineType = 'BILL')
                   then 'Payment against bills' else 'Payment' end end as Source,
       p.Branch, p.User_id as CreatedBy, isnull(p.IsCancelled, 0) as IsCancelled, p.Financial_Year, p.Division
  from tbl_payment p left join tblAccountLedger tl on tl.LedgerCode = p.PayTo_Ledger
union all
select c.Contra_No, 'Contra Note', 'Contra', cast(c.Contra_Date as date), c.Narration, null, 'Contra (cash / bank transfer)',
       c.Branch, c.User_id, isnull(c.IsCancelled, 0), c.Financial_Year, c.Division
  from tbl_contra c
union all
select r.BR_No, 'BILL RECEIVE', 'Receipt', cast(r.Receive_Date as date), r.Narration, cm.company_name, 'Bill receipt',
       r.Branch, r.User_id, isnull(r.IsCancelled, 0), r.Financial_Year, r.Division
  from Bill_Receive r left join client_Master cm on cm.client_Id = r.client_Id
union all
select cb.bill_no, 'Bill Finalized', 'Sales', cast(cb.ClientBill_Finalize_date as date),
       'Client bill ' + cb.bill_no + ' finalized' + isnull(' (' + cb.Bill_Type + ')', ''), coalesce(cm.company_name, cb.client_code),
       'Client bill', cb.origin_branch, cb.user_id, case when cb.client_bill_status is null then 0 else 1 end, cb.Financial_Year, cb.division
  from client_bill cb left join client_Master cm on cm.client_Id = cb.client_Id
 where cb.ClientBill_Finalize_status = 'Finalized' or exists (select 1 from tblAccountTrasaction t where t.VoucherNo = cb.bill_no and t.Mode = 'Bill Finalized')
union all
select m.Bill_No, 'Miscellaneous Bill Finalized', 'Sales', cast(m.Finalize_date as date),
       'Miscellaneous bill ' + m.Bill_No + isnull(' - ' + m.ServiceFor, ''), m.cust_name, 'Miscellaneous bill',
       m.CreatBranch, m.UserId, case when m.Cancel_status is null then 0 else 1 end, m.Financial_Year, m.Division
  from miscellaneous_bill m where m.Finalize_date is not null
union all
select w.Bill_No, 'Warehouse Bill Finalized', 'Sales', cast(w.Finalize_date as date),
       'Warehouse bill ' + w.Bill_No + isnull(' - ' + w.ServiceFor, ''), w.cust_name, 'Warehouse bill',
       w.CreatBranch, w.UserId, case when w.Cancel_status is null then 0 else 1 end, w.Financial_Year, w.Division
  from warehouse_bill w where w.Finalize_date is not null
union all
select v.InvoiceNo, 'PURCHASE/PAYBILL', 'Purchase', cast(v.InvoiceDate as date), v.Narration, vl.LedgerName,
       'Vendor invoice' + isnull(' ' + nullif(v.VendorInvNo, ''), ''), v.Branch_Code, v.UserId, isnull(v.IsCancelled, 0), v.Financial_Year, v.Division
  from OtherVendorInvoice v left join tblAccountLedger vl on vl.LedgerCode = v.VendorLedger
union all
select d.challan_no, 'CHALLAN', 'Purchase', cast(d.challan_date as date),
       'Truck hire - challan ' + d.challan_no + isnull(', truck ' + nullif(d.truck_no, ''), '') + isnull(' (' + d.frt_type + ')', ''),
       coalesce(nullif(d.market_vendor_name, ''), vl.LedgerName, d.vendor_code), 'Challan (truck hire)',
       d.from_branch, d.user_id, isnull(d.IsCancelled, 0), d.Financial_Year, d.div_code
  from dispatch_master d
  outer apply (select top 1 l.LedgerName from tblAccountLedger l where l.VendorOrClientCode = d.vendor_code and l.Financial_Year = d.Financial_Year) vl;
GO

-- ---------------------------------------------------------------- menu: ACCOUNTS > Books & Reports
if not exists (select 1 from MasterMenu where Menuid = 'M007')
  insert into MasterMenu(Menuid, MenuName, MenuUrl, ActiveStatus) values ('M007', 'ACCOUNTS', '#', 'Y');
if not exists (select 1 from SubMenu where Menuid = 'M007' and SubMenuid = 'S080')
  insert into SubMenu(Menuid, SubMenuid, SubMenuName, SubMenuUrl, ActiveStatus, division)
  values ('M007', 'S080', 'Books & Reports', 'Accounts/Books.aspx', 'Y', 'DIV1001,DIV1002,DIV1003');
if not exists (select 1 from Employee_Permission where Employeeid = 'EMP001' and MainMenuid = 'M007' and Sub_Menuid = 'S080')
  insert into Employee_Permission(Employeeid, MainMenuid, Sub_Menuid, Sub_SubMenuid, ActiveStatus) values ('EMP001', 'M007', 'S080', null, 'Y');
GO
