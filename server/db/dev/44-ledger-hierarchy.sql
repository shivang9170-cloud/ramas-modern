-- Sub-ledgers (one level): a MAIN ledger only shows the total of its sub-ledgers; entries (Dr/Cr) go only to sub-ledgers.
-- Kept in its own table so the legacy tblAccountLedger is not altered.
--   IsMain = 1                  this ledger is a main ledger (no postings allowed, balance = sum of its subs)
--   ParentLedgerCode = <main>   this ledger is a sub-ledger of that main ledger
-- Rules (enforced by the API): one level only (a main has no parent, a sub is never a main), a ledger with entries cannot
-- become a main. Safe to re-run.

if object_id('tblLedgerHierarchy', 'U') is null
create table tblLedgerHierarchy (
  LedgerCode varchar(20) not null primary key,
  ParentLedgerCode varchar(20) null,
  IsMain bit not null default 0,
  UpdatedBy varchar(50),
  UpdatedDate datetime default getdate()
);
GO
if not exists (select 1 from sys.indexes where name = 'IX_tblLedgerHierarchy_parent')
  create index IX_tblLedgerHierarchy_parent on tblLedgerHierarchy(ParentLedgerCode);
GO
