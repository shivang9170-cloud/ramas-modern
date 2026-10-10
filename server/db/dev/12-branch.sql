-- =============================================================================
-- DEV-ONLY: Branch Master (Master/Branch_Master.aspx) + ledger auto-bind.
-- Names follow ClassLibrary/dal/Branch_Master_Dal.cs and App_Code/GeneralMethods.AutoBindLedger.
-- =============================================================================

alter table branch_master add
  contact_person varchar(100), address varchar(500), email varchar(100), phone varchar(50), fax varchar(50), remarks varchar(500),
  IsHub bit default 0, Branch_Gstin_no varchar(20), location varchar(20), SapCode varchar(30), Manual_code varchar(30),
  place varchar(100), maxlimit varchar(20), Division varchar(100), isDocketAutoInc bit default 0, primary_address varchar(500),
  User_ID varchar(50), LastUpdate datetime, Edit_By varchar(50), Edit_Date date;
alter table New_Location_master add Pin_Code varchar(10), IsActinve_Flag varchar(10) default 'Active';
GO
update branch_master set Division = 'DIV1001,DIV1002,DIV1003', IsHub = 0, isDocketAutoInc = 0;
update New_Location_master set IsActinve_Flag = 'Active';
GO

create procedure sp_insert_Branch_master_details
  @branchid int, @branch_code varchar(20), @branch_name varchar(100), @contactperson varchar(100), @address varchar(500),
  @state_code varchar(10), @city_code varchar(10), @zone_code varchar(10), @email varchar(100), @phone varchar(50), @fax varchar(50),
  @remarks varchar(500), @Ishub bit, @status varchar(10), @Company varchar(20), @ControllingBranch varchar(20), @IsWarehouse bit,
  @IsFranchisee bit, @User_ID varchar(50), @LastUpdate datetime, @retval int output, @Branch_Gstin_no varchar(20), @location varchar(20),
  @ShortCode varchar(10), @SapCode varchar(30), @ManualCode varchar(30), @primary_address varchar(500), @place varchar(100),
  @maxlimit varchar(20), @Division varchar(100), @isDocketAutoInc bit
as
begin
  set nocount on;
  if exists (select 1 from branch_master where branch_code = @branch_code) begin set @retval = 0; return; end
  insert into branch_master(branch_code, branch_name, contact_person, address, state_code, city_code, zone_code, email, phone, fax, remarks,
    IsHub, status, company, ControllingBranch, IsMasterFranchisee, IsFranchisee, User_ID, LastUpdate, Branch_Gstin_no, location,
    short_code, SapCode, Manual_code, primary_address, place, maxlimit, Division, isDocketAutoInc)
  values (@branch_code, @branch_name, @contactperson, @address, @state_code, @city_code, @zone_code, @email, @phone, @fax, @remarks,
    @Ishub, @status, @Company, @ControllingBranch, case when @IsWarehouse = 1 then 'true' else 'false' end,
    case when @IsFranchisee = 1 then 'true' else 'false' end, @User_ID, @LastUpdate, @Branch_Gstin_no, @location,
    @ShortCode, @SapCode, @ManualCode, @primary_address, @place, @maxlimit, @Division, @isDocketAutoInc);
  set @retval = 1;
end
GO

create procedure sp_Update_Branch_Master_Details
  @branch_code varchar(20), @branch_name varchar(100), @contactperson varchar(100), @address varchar(500), @state_code varchar(10),
  @city_code varchar(10), @zone_code varchar(10), @email varchar(100), @phone varchar(50), @fax varchar(50), @remarks varchar(500),
  @ishub bit, @IsWarehouse bit, @IsFranchisee bit, @status varchar(10), @Company varchar(20), @ControllingBranch varchar(20),
  @Edit_By varchar(50), @Edit_Date date, @Branch_Gstin_No varchar(20), @Short_Code varchar(10), @SapCode varchar(30),
  @ManualCode varchar(30), @location varchar(20), @primary_address varchar(500), @place varchar(100), @maxlimit varchar(20),
  @Division varchar(100), @isDocketAutoInc bit
as
  update branch_master set branch_name = @branch_name, contact_person = @contactperson, address = @address, state_code = @state_code,
    city_code = @city_code, zone_code = @zone_code, email = @email, phone = @phone, fax = @fax, remarks = @remarks, IsHub = @ishub,
    IsMasterFranchisee = case when @IsWarehouse = 1 then 'true' else 'false' end,
    IsFranchisee = case when @IsFranchisee = 1 then 'true' else 'false' end, status = @status, company = @Company,
    ControllingBranch = @ControllingBranch, Edit_By = @Edit_By, Edit_Date = @Edit_Date, Branch_Gstin_no = @Branch_Gstin_No,
    short_code = @Short_Code, SapCode = @SapCode, Manual_code = @ManualCode, location = @location, primary_address = @primary_address,
    place = @place, maxlimit = @maxlimit, Division = @Division, isDocketAutoInc = @isDocketAutoInc
   where branch_code = @branch_code;
GO

create procedure sp_Delete_Branch_Master_Details @branch_code varchar(20), @retval int output
as
begin
  delete from branch_master where branch_code = @branch_code;
  set @retval = @@rowcount;
end
GO

create procedure sp_select_Branch_Master_Details_WithDivision @division varchar(20)
as
  select b.*, c.city_name, st.state_name, cm.CName, cb.branch_name as ControllingBrnachName, l.Location_Name
    from branch_master b
    left join city_master c on c.city_code = b.city_code
    left join state_master st on st.state_code = b.state_code
    left join CompanyMster cm on cm.CCode = b.company
    left join branch_master cb on cb.branch_code = b.ControllingBranch
    left join New_Location_master l on l.Location_Code = b.location
   where ',' + isnull(b.Division, '') + ',' like '%,' + @division + ',%'
   order by b.branch_name;
GO

-- GeneralMethods.AutoBindLedger: create the ledger (per division + financial year) if it does not exist.
create procedure usp_AutoBindLedger
  @LedgerName varchar(100), @GroupName varchar(100), @VendorOrClientCode varchar(20), @DrCr varchar(2), @Ledger_Type varchar(20),
  @CreatedDate date, @Branch_Code varchar(20), @Emp_Code varchar(50), @Financial_Year varchar(20), @division varchar(20),
  @status varchar(500) output
as
begin
  set nocount on;
  declare @group varchar(20) = (select top 1 GroupCode from tblAccountGroup where GroupName = @GroupName);
  if @group is null
  begin
    set @group = 'G' + right('000' + cast((select count(*) + 1 from tblAccountGroup) as varchar(5)), 3);
    insert into tblAccountGroup(GroupCode, GroupName) values (@group, @GroupName);
  end
  if not exists (select 1 from tblAccountLedger where LedgerName = @LedgerName and Financial_Year = @Financial_Year and Division = @division)
    insert into tblAccountLedger(LedgerCode, LedgerName, GroupCode, Ledger_Type, OpeningBal, VendorOrClientCode, DrCr, Financial_Year, Division, IsActive)
    -- Next number after the highest LA code (a row count would collide once ledgers have been deleted).
    values ('LA' + right('000000' + cast((select isnull(max(try_cast(substring(LedgerCode, 3, 20) as int)), 0) + 1
                                            from tblAccountLedger with (updlock, holdlock) where LedgerCode like 'LA[0-9]%') as varchar(8)), 6),
            @LedgerName, @group, @Ledger_Type, 0, @VendorOrClientCode, @DrCr, @Financial_Year, @division, 1);
  set @status = 'success';
end
GO
