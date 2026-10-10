-- Payment Entry: one detail table for every kind of payment, so all reports read one place.
--   PaymentType on tbl_payment: EXPENSE (main ledger -> sub-ledger), ADVANCE (driver / employee advance sub-ledger),
--   GENERAL (any other ledger), ADV_ADJUST (journal: advance spent on an expense - no cash moves).
--   tbl_payment_detail: one row per ledger debited. Purpose / BillType / BillNo are currently unused (kept for later).
-- Safe to re-run.

if col_length('tbl_payment', 'PaymentType') is null
  alter table tbl_payment add PaymentType varchar(20) not null default 'GENERAL', PersonType varchar(10), PersonId varchar(30),
    PersonName varchar(150);
GO

if object_id('tbl_payment_detail', 'U') is null
create table tbl_payment_detail (
  id int identity primary key,
  Payment_No varchar(30) not null,
  LineType varchar(20) not null,          -- GENERAL / EXPENSE / ADVANCE / ADV_ADJUST / BILL
  Purpose varchar(20),                    -- FOOD / DIESEL / TOLL / REPAIR / PARKING / LOADING / OTHER
  PersonType varchar(10),                 -- DRIVER / EMPLOYEE
  PersonId varchar(30),
  PersonName varchar(150),
  BillType varchar(10),                   -- OVI (vendor invoice) / TVB (transport vendor bill) / CHALLAN (hire balance)
  BillNo varchar(30),
  LedgerCode varchar(20),                 -- the ledger debited for this line
  Amount decimal(18,2) not null,
  IsCancelled bit not null default 0
);
GO
if not exists (select 1 from sys.indexes where name = 'IX_tbl_payment_detail_bill')
  create index IX_tbl_payment_detail_bill on tbl_payment_detail(BillType, BillNo) include (Amount, IsCancelled);
if not exists (select 1 from sys.indexes where name = 'IX_tbl_payment_detail_no')
  create index IX_tbl_payment_detail_no on tbl_payment_detail(Payment_No);
GO

-- payments saved before this file: one GENERAL line each, so reports see them too
insert into tbl_payment_detail(Payment_No, LineType, LedgerCode, Amount, IsCancelled)
select p.Payment_No, 'GENERAL', p.PayTo_Ledger, p.Amount, isnull(p.IsCancelled, 0)
  from tbl_payment p
 where not exists (select 1 from tbl_payment_detail d where d.Payment_No = p.Payment_No);
GO
