-- =============================================================================
-- DEV-ONLY: loading sheets (Operation/Loading_Sheet.aspx, Loading_Sheet_Cancel / _View / _Edit,
-- Manual_Loading_Sheet_Cancel_Uncancel). A loading sheet lists the dockets lying at a branch that are put on the
-- dock for loading; a manifest can then be made "from the loading sheet" (menifest.aspx rdManifestType).
-- Columns from the DLL's inserts / selects (Loading_dal); see docs/SCHEMA-VERIFICATION.md "Loading sheets".
-- =============================================================================

if object_id('Loading_Sheet') is null
  create table Loading_Sheet (
    Ls_no varchar(30) primary key, loading_date date, entered_by varchar(50), Loading_Branch varchar(20), Financial_Year varchar(20),
    ShortCode varchar(10), FinYr varchar(10), LoadType varchar(10), Division varchar(20), IsCancel bit not null default 0,
    Cancelled_By varchar(50), Cancelled_Date datetime, manifest_status varchar(20), ManifestNo varchar(30),
    Created_Date datetime default getdate());
if object_id('Loading_Sheet_Details') is null
  create table Loading_Sheet_Details (
    slno int identity primary key, Ls_no varchar(30) not null, loading_date date, Entered_by varchar(50), docket_no varchar(30) not null,
    Booking_date date, from_branch varchar(20), to_branch varchar(20), Consigner_name varchar(200), weight decimal(18,2),
    pices int, IsCancel bit not null default 0, Division varchar(20), Manifest_No varchar(30));
GO
