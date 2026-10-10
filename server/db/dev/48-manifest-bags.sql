-- Manifest bagging (2026-10-10): inside a manifest, dockets go into PACKETS, packets into BAGS, bags into MASTER BAGS
-- (any level may be left out). Only divisions with tblDivisionProfile.UseBagging = 1 (courier) use it; TMS divisions
-- (cargo / FTL) manifest whole dockets in one entry and never touch these tables.
--   tblManifestBag        one row per packet / bag / master bag: its number (PK.. / BG.. / MB.. + branch short code +
--                         FY + serial), level, parent, seal no., totals; cancelled with the manifest
--   tblManifestBagDocket  the dockets in the lowest level used (a packet, else a bag, else a master bag)
-- Safe to re-run.

if object_id('tblManifestBag', 'U') is null
create table tblManifestBag (
  BagNo varchar(30) primary key,
  ManifestNo varchar(30) not null,
  BagLevel varchar(10) not null,          -- PACKET | BAG | MASTER
  ParentBagNo varchar(30) null,
  SealNo varchar(30),
  Dockets int not null default 0,
  Packages int not null default 0,
  Weight decimal(18, 2) not null default 0,
  FromBranch varchar(20),
  ToBranch varchar(20),
  Financial_Year varchar(20),
  DivCode varchar(20),
  CreatedBy varchar(50),
  CreatedDate datetime default getdate(),
  IsCancelled bit not null default 0
);
GO
if not exists (select 1 from sys.indexes where name = 'IX_tblManifestBag_Manifest')
  create index IX_tblManifestBag_Manifest on tblManifestBag(ManifestNo);
GO

if object_id('tblManifestBagDocket', 'U') is null
create table tblManifestBagDocket (
  id int identity primary key,
  BagNo varchar(30) not null,
  ManifestNo varchar(30) not null,
  DocketNo varchar(50) not null,
  Packages int not null default 0,
  Weight decimal(18, 2) not null default 0
);
GO
if not exists (select 1 from sys.indexes where name = 'IX_tblManifestBagDocket_Manifest')
  create index IX_tblManifestBagDocket_Manifest on tblManifestBagDocket(ManifestNo);
if not exists (select 1 from sys.indexes where name = 'IX_tblManifestBagDocket_Docket')
  create index IX_tblManifestBagDocket_Docket on tblManifestBagDocket(DocketNo);
GO
