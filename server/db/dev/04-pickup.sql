-- =============================================================================
-- DEV-ONLY: freight types + pickup (PRS) tables and stand-in procedures.
-- Names follow ClassLibrary/dal/Pick_Up_Entry_dal.cs, Pick_Up_grn_dal.cs,
-- Pickup_Entry_Cancel_Dal.cs and grn_class OperationDAL.GetFtlType.
-- =============================================================================

create table freight_master (container_code varchar(20) primary key, freight_name varchar(60));
GO
create procedure Get_FreightMaster as select container_code, freight_name from freight_master order by freight_name;
GO

-- columns the pickup flow reads/writes on existing tables
alter table grn_master add pickup_status varchar(20), DocketStatus varchar(100), Dispatch_Status varchar(20);
alter table grn_docket_charge add pending_freight decimal(18,2), pending_weight decimal(18,2), pending_package int;
alter table employee_master add emptype varchar(20), mobileno varchar(20), Department varchar(20);
alter table New_Location_master add Location_Name varchar(100), branch_code varchar(20);
GO

create table Pick_up_entry (
  id int identity primary key, pickup_no varchar(30) not null unique, pickup_date date, pickup_time varchar(10),
  from_branch varchar(20), user_id varchar(50), Franchisee_Code varchar(50), Financial_Year varchar(20),
  PickUpBy varchar(50), PickUpByNo varchar(20), ShortCode varchar(10), FinYr varchar(10), Division varchar(20),
  DockNonDock varchar(2), IsCancelled varchar(2) default '0', CancelledBy varchar(50), challan_no varchar(30),
  Dispatch_Status varchar(20), Location varchar(500), docat_list varchar(max));
create table Pick_Up_grn (
  id int identity primary key, docket_no varchar(30), freight decimal(18,2), package int, weight decimal(18,2),
  Pickup_no varchar(30), Location_Code varchar(30), Financial_Year varchar(20), Division varchar(20), IsArrival varchar(5) default '0');
create table dispatch_master (id int identity primary key, challan_no varchar(30), Financial_Year varchar(20), IsCancelled varchar(2) default '0');
GO

create procedure usp_Fill_BranchWise_Location @branch_code varchar(20)
as select Location_Code, Location_Name from New_Location_master where branch_code = @branch_code order by Location_Name;
GO
create procedure usp_Fill_BranchWise_LocationByZone @branch_code varchar(20), @ZoneName varchar(100)
as select l.Location_Code, l.Location_Name
     from New_Location_master l join branch_master b on b.branch_code = l.branch_code
     join zone_master z on z.zone_code = b.zone_code
    where z.zone_name = @ZoneName order by l.Location_Name;
GO

-- Generates PS + ShortCode + FinYr + 6-digit running number (pickup_entry.aspx.cs bind()).
create procedure usp_insert_PickUpEntry
  @pickup_no varchar(30), @pickup_date date, @pickup_time varchar(10), @from_branch varchar(20), @user_id varchar(50),
  @Franchisee_Code varchar(50), @Financial_Year varchar(20), @PickUpBy varchar(50), @PickUpByNo varchar(20),
  @ShortCode varchar(10), @FinYr varchar(10), @Division varchar(20), @DockNonDock varchar(2), @retval varchar(20) output
as
begin
  set nocount on;
  declare @prefix varchar(30) = 'PS' + @ShortCode + @FinYr;
  declare @next int = isnull((select max(cast(right(pickup_no, 6) as int)) from Pick_up_entry with (updlock, holdlock)
                              where pickup_no like @prefix + '%'), 0) + 1;
  set @retval = @prefix + right('000000' + cast(@next as varchar(6)), 6);
  insert into Pick_up_entry(pickup_no, pickup_date, pickup_time, from_branch, user_id, Franchisee_Code, Financial_Year,
                            PickUpBy, PickUpByNo, ShortCode, FinYr, Division, DockNonDock, IsCancelled)
  values (@retval, @pickup_date, @pickup_time, @from_branch, @user_id, @Franchisee_Code, @Financial_Year,
          @PickUpBy, @PickUpByNo, @ShortCode, @FinYr, @Division, @DockNonDock, '0');
end
GO

create procedure usp_search_PickupEntry
  @booking_date1 varchar(20), @booking_date2 varchar(20), @IsCancelled int, @pickup_no varchar(30) = null,
  @currbranch varchar(20), @user_id varchar(50), @Financial_Year varchar(20), @division varchar(20)
as
  select pe.pickup_no, pe.pickup_date, pe.pickup_time, pe.challan_no, pe.PickUpBy, e.empname as PickUpByName,
         (select count(*) from Pick_Up_grn pg where pg.Pickup_no = pe.pickup_no) as docket_count
    from Pick_up_entry pe left join employee_master e on e.empcode = pe.PickUpBy
   where pe.from_branch = @currbranch and pe.Division = @division
     and pe.pickup_date between @booking_date1 and @booking_date2
     and isnull(pe.IsCancelled, '0') = cast(@IsCancelled as varchar(2))
     and (@pickup_no is null or pe.pickup_no like '%' + @pickup_no + '%')
   order by pe.pickup_date desc, pe.pickup_no desc;
GO

create procedure usp_PickupEntry_Cancel @Pickup_no varchar(30), @user_id varchar(50), @Financial_Year varchar(20), @success varchar(1000) output
as
begin
  set nocount on;
  update Pick_up_entry set IsCancelled = '1', CancelledBy = @user_id where pickup_no = @Pickup_no;
  update grn_master set pickup_status = null, DocketStatus = null
   where docket_no in (select docket_no from Pick_Up_grn where Pickup_no = @Pickup_no);
  set @success = 'success';
end
GO
