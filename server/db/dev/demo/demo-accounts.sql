-- Demo data only (run after demo-data.sql and 45-accounts-books.sql). Removed with demo-remove.sql (VoucherNo like 'DMO%').
-- Safe to re-run.
--  1. The DMO challans were inserted without the voucher a real challan posts (sp_insert_Dispatch_Master: Dr TRUCK HIRE
--     CHARGE FOR <freight type> / Cr the vendor's ledger) - add it so the books show truck hire.
--  2. Some DMO voucher lines sit on the other year's ledger (e.g. a 2026 receipt on the 2025-2026 BILLED ledger), which
--     breaks every year's Trial Balance. Each line is moved to the same-named ledger of the year its date falls in.
insert into tblAccountTrasaction(LedgerCode, Dr, Cr, CreatedDate, VoucherNo, Mode, Entry, Financial_Year, Division, IsCancelled)
select v.L, v.Dr, v.Cr, d.challan_date, d.challan_no, 'CHALLAN', 'Ledger', d.Financial_Year, d.div_code, isnull(d.IsCancelled, 0)
  from dispatch_master d
 cross apply (select top 1 LedgerCode from tblAccountLedger l where l.LedgerName = 'TRUCK HIRE CHARGE FOR ' + isnull(d.frt_type, 'SUNDRY')
                and l.Financial_Year = d.Financial_Year and l.Division = d.div_code) h
 cross apply (select top 1 LedgerCode from tblAccountLedger l where l.VendorOrClientCode = d.vendor_code
                and l.Financial_Year = d.Financial_Year and l.Division = d.div_code) vl
 cross apply (values (h.LedgerCode, d.total_freight, 0), (vl.LedgerCode, 0, d.total_freight)) v(L, Dr, Cr)
 where d.challan_no like 'DMO%' and isnull(d.total_freight, 0) > 0
   and not exists (select 1 from tblAccountTrasaction t where t.VoucherNo = d.challan_no and t.Mode = 'CHALLAN');
GO

with x as (
  select t.SlNo, t.Division, l.LedgerName, l.Financial_Year as lfy, t.Financial_Year as tfy,
         case when month(t.CreatedDate) >= 4 then cast(year(t.CreatedDate) as varchar(4)) + '-' + cast(year(t.CreatedDate) + 1 as varchar(4))
              else cast(year(t.CreatedDate) - 1 as varchar(4)) + '-' + cast(year(t.CreatedDate) as varchar(4)) end as dfy
    from tblAccountTrasaction t join tblAccountLedger l on l.LedgerCode = t.LedgerCode
   where t.VoucherNo like 'DMO%')
update t set LedgerCode = n.LedgerCode, Financial_Year = x.dfy
  from tblAccountTrasaction t join x on x.SlNo = t.SlNo
 cross apply (select top 1 l2.LedgerCode from tblAccountLedger l2
               where l2.LedgerName = x.LedgerName and l2.Financial_Year = x.dfy and l2.Division = x.Division) n
 where x.lfy <> x.dfy or isnull(x.tfy, '') <> x.dfy;
GO
