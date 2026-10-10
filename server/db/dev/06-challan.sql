-- =============================================================================
-- DEV-ONLY: challan (vehicle dispatch) tables, table types and stand-in procedures.
-- Names follow ClassLibrary/dal/dispatch_master_dal.cs, dispatch_master_Cancel_Dal.cs,
-- vendor_master_dal.cs, VehicleName_Master_Dal.cs, Account_Contra_dal.cs and
-- wwwroot/App_Code/GeneralMethods.cs. Type names are unknown (config.tvp.*).
-- =============================================================================

alter table dispatch_master add
  mode_code varchar(10), vendor_type varchar(20), vendor_code varchar(20), market_vendor_name varchar(100),
  challan_date date, challan_time varchar(10), from_branch varchar(20), tobcode varchar(20), to_city varchar(20),
  dest_type varchar(20), route_code varchar(20), Route_Time varchar(20), frt_type varchar(10), rate_on varchar(20),
  truck_no varchar(20), vehicle_name varchar(50), engine_no varchar(50), chasis_no varchar(50), model varchar(50),
  make varchar(50), capacity varchar(20), IsOverload bit, OverloadWeight varchar(20),
  drivername varchar(100), address varchar(100), dlno varchar(50), refdispatch varchar(100),
  second_driver_name varchar(100), sec_mobileno varchar(20), sec_dlno varchar(50), sec_ref varchar(100),
  seal_no varchar(50), loadedby varchar(100), delydate date, delytime varchar(10),
  opening_meter varchar(20), closing_meter varchar(20), penalty decimal(18,2), incentive decimal(18,2),
  message varchar(500), manifest_no varchar(max), total_weight decimal(18,2), total_price decimal(18,2),
  total_freight decimal(18,2), advance decimal(18,2), bal_amount decimal(18,2), Labour_Charge decimal(18,2),
  other_charge decimal(18,2), deduction_amt decimal(18,2), hire_charge decimal(18,2), overload_charge decimal(18,2),
  EWayBill varchar(50), Location varchar(200), dispatch_type varchar(20), status varchar(20), user_id varchar(50),
  div_code varchar(20), ShortCode varchar(10), arrival_status varchar(20), CancelledBy varchar(50), created_at datetime default getdate();
GO

create table Arrival_entry (id int identity primary key, challan_no varchar(30), IsCancelled bit default 0);

create table vendors_master (
  vendor_code varchar(20) primary key, Name varchar(100), vendor_type varchar(20), vendor_Mode varchar(20),
  DivCode varchar(100), active_flag bit default 1, TDS decimal(5,2) default 0);
create table temp_vendors_master (
  vendor_code varchar(20) primary key, Name varchar(100), vendor_mode varchar(20), FTLDIVISION varchar(100),
  active_flag bit default 1, TDS decimal(5,2) default 0);
create table Vechile_Master (
  VEHICLE_NO varchar(20) primary key, VendorCodeName varchar(20), Vechile_Type_Code varchar(50), ENGINE_NO varchar(50),
  CHASSIS_NO varchar(50), MODEL varchar(50), MAKE varchar(50), Vechile_Capacity decimal(18,2));
create table Driver_master (id int identity primary key, Drivername varchar(100), branch varchar(50), mobile_no varchar(20), IsActive bit default 1);

create table route (
  route_code varchar(20) primary key, route_name varchar(100), from_route_code varchar(20), To_Route_Code varchar(20),
  route_type varchar(10), total_km decimal(18,2));
create table routedetail (id int identity primary key, route_code varchar(20), from_station varchar(20), to_station varchar(20));
create table Route_SetTime (Set_Id int identity primary key, route_code varchar(20), Set_Time1 varchar(10));

create table tblAccountGroup (GroupCode varchar(20) primary key, GroupName varchar(100));
create table tblAccountLedger (
  LedgerCode varchar(20) primary key, LedgerName varchar(100), GroupCode varchar(20), Ledger_Type varchar(20),
  OpeningBal decimal(18,2) default 0, ClosingBal decimal(18,2) default 0, VendorOrClientCode varchar(20), DrCr varchar(2),
  Financial_Year varchar(20), Division varchar(20), IsActive bit default 1);
create table tblAccountTrasaction (
  SlNo int identity primary key, LedgerCode varchar(20), Dr decimal(18,2) default 0, Cr decimal(18,2) default 0,
  CreatedDate datetime default getdate(), VoucherNo varchar(30), Mode varchar(20), Entry varchar(20),
  Financial_Year varchar(20), Division varchar(20), IsCancelled bit default 0);
GO

create type dbo.udt_Mainfest_no as table (mainfest_no varchar(30));
create type dbo.ud_Transaction_Details as table (
  Ledger_code varchar(20), Amount_Dr float, Amount_Cr float, Balance real, TransId int, Entry varchar(20), Mode varchar(20));
GO

-- Next number for an entry type: prefix + branch short code + short year + 6 digits.
create procedure GET_AUTO_GENERATED_CODE_FOR_ENTRY
  @prefix varchar(10), @ShortYear varchar(10), @branch_code varchar(20), @Financial_Year varchar(20), @retval varchar(800) output
as
begin
  set nocount on;
  declare @p varchar(40) = @prefix + isnull((select short_code from branch_master where branch_code = @branch_code), '') + @ShortYear;
  declare @next int = isnull((select max(cast(right(challan_no, 6) as int)) from dispatch_master with (updlock, holdlock)
                              where challan_no like @p + '%' and len(challan_no) = len(@p) + 6), 0) + 1;
  set @retval = @p + right('000000' + cast(@next as varchar(6)), 6);
end
GO

create procedure sp_insert_Dispatch_Master
  @dtMainfest_no dbo.udt_Mainfest_no readonly, @ud_Transaction_Details dbo.ud_Transaction_Details readonly,
  @mode_code varchar(10), @vendor_type varchar(20), @vendor_code varchar(20), @fltno varchar(20), @airline_name varchar(50),
  @airway_billno varchar(50), @train_no varchar(20), @rr_no varchar(20), @train_name varchar(50), @draft_no varchar(50),
  @dispatch_date datetime, @bank varchar(100), @amount float, @delayhrs varchar(10), @delaycharge float, @loadedby varchar(100),
  @drivername varchar(100), @address varchar(100), @dlno varchar(50), @refdispatch varchar(100), @vehicle_name varchar(50),
  @engine_no varchar(50), @chasis_no varchar(50), @model varchar(50), @make varchar(50), @validity varchar(20),
  @capacity varchar(20), @ofstate varchar(50), @delaydate datetime, @delytime varchar(10), @penalty float, @incentive float,
  @opening_meter varchar(20), @closing_meter varchar(20), @challanno varchar(30), @challan_date datetime, @challantime varchar(10),
  @tobcode varchar(20), @message varchar(500), @total_weight float, @total_price float, @total_freight float, @advance float,
  @manifest_no varchar(max), @status varchar(20), @user_id varchar(50), @from_branch varchar(20), @bal_amount float,
  @truck_no varchar(20), @br_no varchar(20), @market_vendor_name varchar(100), @pickup_no varchar(30), @drs_no varchar(30),
  @dispatch_type varchar(20), @Location varchar(200), @sealno varchar(50), @second_driver_name varchar(100),
  @sec_mobileno varchar(20), @sec_dlno varchar(50), @sec_ref varchar(100), @route_code varchar(20), @frt_type varchar(10),
  @rate_on varchar(20), @to_city varchar(20), @Route_Time varchar(20), @Financial_Year varchar(20), @ShortCode varchar(10),
  @IsOverload bit, @OverloadWeight varchar(20), @EWayBill varchar(50), @dest_type varchar(20), @Labour_Charge float,
  @Division varchar(20), @other_charge float, @deduction_amt float, @hire_charge float, @overload_charge float,
  @retval varchar(200) output
as
begin
  set nocount on;
  if exists (select 1 from dispatch_master where challan_no = @challanno)
  begin set @retval = 'Challan No Allready Exists!!!'; return; end
  if exists (select 1 from Manifest_grn g join @dtMainfest_no t on t.mainfest_no = g.Manifest_no where g.Dispatch_Status = 'IsActive')
  begin set @retval = 'Manifest already dispatched'; return; end

  insert into dispatch_master(challan_no, Financial_Year, IsCancelled, mode_code, vendor_type, vendor_code, market_vendor_name,
    challan_date, challan_time, from_branch, tobcode, to_city, dest_type, route_code, Route_Time, frt_type, rate_on, truck_no,
    vehicle_name, engine_no, chasis_no, model, make, capacity, IsOverload, OverloadWeight, drivername, address, dlno, refdispatch,
    second_driver_name, sec_mobileno, sec_dlno, sec_ref, seal_no, loadedby, delydate, delytime, opening_meter, closing_meter,
    penalty, incentive, message, manifest_no, total_weight, total_price, total_freight, advance, bal_amount, Labour_Charge,
    other_charge, deduction_amt, hire_charge, overload_charge, EWayBill, Location, dispatch_type, status, user_id, div_code, ShortCode)
  values (@challanno, @Financial_Year, '0', @mode_code, @vendor_type, @vendor_code, @market_vendor_name,
    @challan_date, @challantime, @from_branch, @tobcode, @to_city, @dest_type, @route_code, @Route_Time, @frt_type, @rate_on, @truck_no,
    @vehicle_name, @engine_no, @chasis_no, @model, @make, @capacity, @IsOverload, @OverloadWeight, @drivername, @address, @dlno, @refdispatch,
    @second_driver_name, @sec_mobileno, @sec_dlno, @sec_ref, @sealno, @loadedby, @delaydate, @delytime, @opening_meter, @closing_meter,
    @penalty, @incentive, @message, @manifest_no, @total_weight, @total_price, @total_freight, @advance, @bal_amount, @Labour_Charge,
    @other_charge, @deduction_amt, @hire_charge, @overload_charge, @EWayBill, @Location, @dispatch_type, @status, @user_id, @Division, @ShortCode);

  update m set challan_no = @challanno, Dispatch_Status = 'IsActive'
    from mainfest_entry m join @dtMainfest_no t on t.mainfest_no = m.mainfest_no;
  update g set challan_no = @challanno, Dispatch_Status = 'IsActive'
    from Manifest_grn g join @dtMainfest_no t on t.mainfest_no = g.Manifest_no;
  update grn_master set Dispatch_Status = 'IsActive', DocketStatus = 'CHALLAN GENERATED'
   where docket_no in (select g.docket_no from Manifest_grn g join @dtMainfest_no t on t.mainfest_no = g.Manifest_no);
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog, Origin, Destination)
  select g.docket_no, 'CHALLAN', 'Dispatched on challan ' + @challanno + ' (' + @truck_no + ')', getdate(), @user_id,
         @from_branch, isnull(nullif(@tobcode, ''), @to_city)
    from Manifest_grn g join @dtMainfest_no t on t.mainfest_no = g.Manifest_no;

  insert into tblAccountTrasaction(LedgerCode, Dr, Cr, CreatedDate, VoucherNo, Mode, Entry, Financial_Year, Division)
  select Ledger_code, Amount_Dr, Amount_Cr, @challan_date, @challanno, Mode, Entry, @Financial_Year, @Division
    from @ud_Transaction_Details;
  set @retval = 'success';
end
GO

create procedure usp_select_challan_entry_cancel
  @booking_date1 varchar(20), @booking_date2 varchar(20), @currbranch varchar(20), @user_id varchar(60), @IsCancelled int,
  @challan_no varchar(30), @Financial_Year varchar(20), @division varchar(20)
as
  select d.challan_no, d.challan_date, d.challan_time, d.mode_code, b.branch_name as from_branch,
         isnull(tb.branch_name, c.city_name) as tobcode, d.manifest_no, d.user_id, d.truck_no, d.vendor_type,
         isnull(v.Name, tv.Name) as vendor_name, d.total_weight, d.total_price, d.total_freight, d.arrival_status
    from dispatch_master d
    left join branch_master b on b.branch_code = d.from_branch
    left join branch_master tb on tb.branch_code = d.tobcode
    left join city_master c on c.city_code = d.to_city
    left join vendors_master v on v.vendor_code = d.vendor_code
    left join temp_vendors_master tv on tv.vendor_code = d.vendor_code
   where d.from_branch = @currbranch and d.div_code = @division
     and d.challan_date between @booking_date1 and @booking_date2
     and isnull(d.IsCancelled, '0') = cast(@IsCancelled as varchar(2))
     and (@user_id like 'admin%' or d.user_id like @user_id)
     and (@challan_no = 'ALL' or d.challan_no like '%' + @challan_no + '%')
   order by d.challan_date desc, d.challan_no desc;
GO

create procedure usp_Dispatch_Master_Cancel @challan_no varchar(30), @user_id varchar(50), @Financial_Year varchar(20), @success varchar(1000) output
as
begin
  set nocount on;
  if not exists (select 1 from dispatch_master where challan_no = @challan_no and isnull(IsCancelled, '0') = '0')
  begin set @success = 'Challan not found or already cancelled'; return; end
  update dispatch_master set IsCancelled = '1', CancelledBy = @user_id where challan_no = @challan_no;
  update grn_master set Dispatch_Status = null, DocketStatus = 'MANIFEST GENERATED'
   where docket_no in (select docket_no from Manifest_grn where challan_no = @challan_no);
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog)
  select docket_no, 'CHALLAN', 'Challan ' + @challan_no + ' cancelled', getdate(), @user_id from Manifest_grn where challan_no = @challan_no;
  update mainfest_entry set challan_no = null, Dispatch_Status = null where challan_no = @challan_no;
  update Manifest_grn set challan_no = null, Dispatch_Status = null where challan_no = @challan_no;
  update tblAccountTrasaction set IsCancelled = 1 where VoucherNo = @challan_no and Mode = 'CHALLAN';
  set @success = 'success';
end
GO
