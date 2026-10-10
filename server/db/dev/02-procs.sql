-- =============================================================================
-- DEV-ONLY STAND-INS for production stored procedures.
-- Signatures and result columns mirror what the legacy C# code sends/reads.
-- The real procedures in the production DB are used unchanged by the API.
-- =============================================================================

create procedure sp_select_login_160219 @userid varchar(50), @userpasswd varchar(100), @Division varchar(20)
as
begin
  set nocount on;
  select top 1 u.user_id, u.user_password, u.user_emp_type, u.user_branch,
         e.empname,
         b.branch_name as home_branch, b.branch_code as branch
    from users u
    left join employee_master e on e.empcode = u.user_id
    left join branch_master b on cast(b.branchid as varchar(20)) = left(u.user_branch, charindex(',', u.user_branch + ',') - 1)
   where u.user_id = @userid and u.user_password = @userpasswd and (u.DivCode = @Division or u.DivCode is null);
end
GO

create procedure SP_FRANCHISE_LOGIN160219 @userid varchar(50), @userpasswd varchar(100), @Division varchar(20)
as
begin
  set nocount on;
  select top 1 f.user_id, f.user_password, 'Franchisee' as user_emp_type, f.user_branch,
         mf.FranName as empname, b.branch_name as home_branch, b.branch_code as branch
    from Franchisee_Users f
    left join Franchise_Master mf on mf.FranCode = f.user_id
    left join Bind_Franch_Branch bfb on bfb.Franchise_Code = f.user_id
    left join branch_master b on b.branch_code = bfb.Branch_Code
   where f.user_id = @userid and f.user_password = @userpasswd;
end
GO

create procedure sp_Master_Franchisee_login @userid varchar(50), @userpasswd varchar(100), @Division varchar(20)
as
begin
  set nocount on;
  select top 1 f.user_id, f.user_password, 'Master Franchisee' as user_emp_type, f.user_branch,
         mf.FranName as empname, b.branch_name as home_branch, b.branch_code as branch
    from Franchisee_Users f
    left join MasterFranchise mf on mf.FranCode = f.user_id
    left join Bind_Franch_Branch bfb on bfb.Franchise_Code = f.user_id
    left join branch_master b on b.branch_code = bfb.Branch_Code
   where f.user_id = @userid and f.user_password = @userpasswd;
end
GO

create procedure sp_select_login_admin @userid varchar(50), @userpasswd varchar(100)
as
begin
  set nocount on;
  select user_id, user_password from users where user_id = @userid and user_password = @userpasswd;
end
GO

create procedure sp_select_Client_login @userid varchar(50), @userpasswd varchar(100), @Divcode varchar(20)
as
begin
  set nocount on;
  select user_id, user_password, client_name, user_branch, home_branch, branch_code
    from ClientLogin_Users
   where user_id = @userid and user_password = @userpasswd;
end
GO

create procedure sp_select_Branch_Master_Details
as
begin
  set nocount on;
  select branch_code, branch_name, city_code as City_Code, status from branch_master where status = 'Active' order by branch_name;
end
GO

create procedure sp_getForMainDashboardAccess @empCode varchar(50)
as
begin
  set nocount on;
  select MenuName, isActive from MainDashboard_Access where empCode = @empCode;
end
GO

-- ------------------------------------------------------------------ State
create procedure usp_Insert_State_Master @state_code varchar(10), @state_name varchar(100), @StateCode varchar(5), @status varchar(10), @Gstin_No varchar(20), @retval int output
as
begin
  set nocount on;
  if exists (select 1 from state_master where state_code = @state_code) begin set @retval = 0; return; end
  insert into state_master(state_code, state_name, StateCode, Gstin_No, active_flag) values (@state_code, @state_name, @StateCode, @Gstin_No, @status);
  set @retval = 1;
end
GO
create procedure sp_Update_state_master @state_code varchar(10), @state_name varchar(100), @status varchar(10), @Gstin_No varchar(20), @retval int output, @StateCode varchar(5)
as
begin
  set nocount on;
  update state_master set state_name = @state_name, active_flag = @status, Gstin_No = @Gstin_No, StateCode = @StateCode where state_code = @state_code;
  set @retval = @@rowcount;
end
GO
create procedure sp_Delete_state_master @state_code varchar(10), @retval int output
as
begin
  set nocount on;
  delete from state_master where state_code = @state_code;
  set @retval = @@rowcount;
end
GO

-- ------------------------------------------------------------------ Zone
create procedure usp_Insert_Zone_Master @zone_code varchar(10), @zone_name varchar(100), @zone_description varchar(250), @active_flag varchar(10), @retval int output
as
begin
  set nocount on;
  if exists (select 1 from zone_master where zone_code = @zone_code) begin set @retval = 0; return; end
  insert into zone_master(zone_code, zone_name, zone_description, active_flag) values (@zone_code, @zone_name, @zone_description, @active_flag);
  set @retval = 1;
end
GO
create procedure Update_zone_master @zone_code varchar(10), @zone_name varchar(100), @zone_description varchar(250), @active_flag varchar(10), @retval int output
as
begin
  set nocount on;
  update zone_master set zone_name = @zone_name, zone_description = @zone_description, active_flag = @active_flag where zone_code = @zone_code;
  set @retval = @@rowcount;
end
GO
create procedure Delete_zone_master @zone_code varchar(10), @retval int output
as
begin
  set nocount on;
  delete from zone_master where zone_code = @zone_code;
  set @retval = @@rowcount;
end
GO

-- ------------------------------------------------------------------ City
create procedure usp_Insert_City_Master @city_code varchar(10), @city_name varchar(100), @state_code varchar(10), @zone_code varchar(10), @Active_flag varchar(10), @Districtcode varchar(20)
as
begin
  set nocount on;
  insert into city_master(city_code, city_name, state_code, zone_code, active_flag, Districtcode) values (@city_code, @city_name, @state_code, @zone_code, @Active_flag, @Districtcode);
end
GO
create procedure sp_update_City_master @city_code varchar(10), @city_name varchar(100), @state_code varchar(10), @zone_code varchar(10), @oda varchar(5), @oda_km int, @activ varchar(10), @Districtcode varchar(20), @retval int output
as
begin
  set nocount on;
  update city_master set city_name = @city_name, state_code = @state_code, zone_code = @zone_code, oda = @oda, oda_km = @oda_km, active_flag = @activ, Districtcode = @Districtcode where city_code = @city_code;
  set @retval = @@rowcount;
end
GO
create procedure Delete_city_master @city_code varchar(10), @retval int output
as
begin
  set nocount on;
  delete from city_master where city_code = @city_code;
  set @retval = @@rowcount;
end
GO

-- ------------------------------------------------------------------ Commodity
create procedure sp_Update_Commodity_master @Commodity_code varchar(20), @Commodity_name varchar(100), @status varchar(10), @retval int output
as
begin
  set nocount on;
  update Commodity_master set Commodity_name = @Commodity_name, active_flag = @status where Commodity_code = @Commodity_code;
  set @retval = @@rowcount;
end
GO
create procedure sp_Delete_Commodity_master @Commodity_code varchar(20), @retval int output
as
begin
  set nocount on;
  delete from Commodity_master where Commodity_code = @Commodity_code;
  set @retval = @@rowcount;
end
GO

-- ------------------------------------------------------------------ Item
create procedure usp_Insert_Item_Master @item_code varchar(20), @item_name varchar(100), @active_flag varchar(10)
as
begin
  set nocount on;
  insert into item_master(item_code, item_name, active_flag) values (@item_code, @item_name, @active_flag);
end
GO

-- ------------------------------------------------------------------ Department
create procedure uspHeadOfficeDepartmentMaster @DepartmentCode varchar(20) = null, @DepartmentName varchar(100) = null, @operation int
as
begin
  set nocount on;
  if @operation = 1 insert into HeadOfficeDepartmentMaster(DepartmentCode, DepartmentName) values (@DepartmentCode, @DepartmentName);
  else if @operation = 2 update HeadOfficeDepartmentMaster set DepartmentName = @DepartmentName where DepartmentCode = @DepartmentCode;
  else if @operation = 3 delete from HeadOfficeDepartmentMaster where DepartmentCode = @DepartmentCode;
  else if @operation = 4 select * from HeadOfficeDepartmentMaster;
end
GO

-- ------------------------------------------------------------------ Division
create procedure usp_Insert_Division_Master @DivCode varchar(20), @DivName varchar(100), @CompanyCode varchar(20), @Domain varchar(100), @IsActive bit
as
begin
  set nocount on;
  insert into DivisionMaster(DivCode, DivName, CompanyCode, Domain, IsActive) values (@DivCode, @DivName, @CompanyCode, @Domain, @IsActive);
end
GO
create procedure usp_Update_Division_Master @DivCode varchar(20), @DivName varchar(100), @Domain varchar(100), @CompanyCode varchar(20), @IsActive bit
as
begin
  set nocount on;
  update DivisionMaster set DivName = @DivName, Domain = @Domain, CompanyCode = @CompanyCode, IsActive = @IsActive where DivCode = @DivCode;
end
GO
create procedure sp_Delete_Division_Master @DivCode varchar(20)
as
begin
  set nocount on;
  delete from DivisionMaster where DivCode = @DivCode;
end
GO
