-- =============================================================================
-- DEV-ONLY: DRS (delivery run sheet) at the delivering branch.
-- Names follow wwwroot/Operation/Drs_Entry.aspx.cs, Drs_Entry_Cancel.aspx.cs,
-- ClassLibrary/dal/dal_drs_entry.cs, Drs_Cancel_Dal.cs and the statements compiled into
-- bin/ClassLibrary.dll (drs_entry_details_grn insert + grn_docket_charge / grn_master updates).
-- The @dtDrs_entry_details_grn type name is unknown (config.tvp.drsGrn).
-- =============================================================================

alter table grn_master alter column drs_status varchar(30);
alter table grn_master add drs_no varchar(30);
alter table grn_docket_charge add drs_statusC varchar(30), drs_noC varchar(30);
alter table delivery_status_entry_details add drs_no varchar(30), Financial_Year varchar(20);
GO

drop table drs_entry_details;
create table drs_entry_details (
  slno int identity primary key, Drs_no varchar(30) not null unique, Drs_date date, Drs_time varchar(10), Location varchar(max),
  docket_no varchar(max), from_branch varchar(20), total_weight decimal(18,2), empcode varchar(50), Franchisee_Code varchar(50),
  DRSType varchar(20), isFranchisee bit default 0, Financial_Year varchar(20), DelBy varchar(100), DelByNo varchar(20),
  ShortCode varchar(10), FinYr varchar(10), Division varchar(20), DockNonDock int, Driver_Name varchar(100), Vehicle_No varchar(20),
  challan_no varchar(30), Dispatch_Status varchar(20), Drs_delivery_status_Entry varchar(20), IsClose bit default 0,
  IsCancelled bit default 0, canceledBy varchar(50), canceledDate datetime);
create table drs_entry_details_grn (
  id int identity primary key, docket_no varchar(30), freight decimal(18,2), weight decimal(18,2), packg int, Drs_no varchar(30),
  Location varchar(60), Dispatch_Status varchar(20), Financial_Year varchar(20), division varchar(20),
  pending_Package int, pending_freight decimal(18,2), pending_weight decimal(18,2), challan_no varchar(30), isCancel bit default 0);
GO

create type dbo.udt_Drs_entry_details_grn as table (
  docket_no varchar(30), freight decimal(18,2), weight decimal(18,2), packg int, Location varchar(60),
  pending_Package int, pending_freight decimal(18,2), pending_weight decimal(18,2), challan_no varchar(30));
GO

-- Dockets lying at this branch (arrived, destined here) with packets not yet out on a DRS.
create procedure SEARCH_DOCKET_NO_FOR_DRS_ENTRY
  @branch_code varchar(20), @from_date varchar(20), @to_date varchar(20), @Financial_Year varchar(20), @div_code varchar(20)
as
  select ap.docket_no, ap.challan_no, ae.Receive_Date as Arrival_date, g.booking_date, g.Consigner_Name, g.consignee_name,
         g.destination, g.delivery_mode, g.destinationLocation as LocCode, l.Location_Name,
         c.pending_package as package, c.pending_weight as weight, c.pending_freight as freight
    from Arrival_Packg ap
    join Arrival_entry ae on ae.ArrivalNo = ap.ArrivalNo
    join grn_master g on g.docket_no = ap.docket_no
    join grn_docket_charge c on c.Docket_No = ap.docket_no and c.branch = @branch_code
    left join New_Location_master l on l.Location_Code = g.destinationLocation
   where ae.from_branch = @branch_code and isnull(ae.IsCancelled, 0) = 0 and isnull(ap.IsCancelled, 0) = 0
     and g.destination_branch = @branch_code and g.Division = @div_code and isnull(g.IsCancel, '0') = '0'
     and g.delivery_mode = 'DM-101'   -- door delivery (godown deliveries go straight to delivery status)
     and ae.Receive_Date between @from_date and @to_date
     and c.pending_package > 0
     and g.docket_no not in (select docket_no from delivery_status_entry_details where pkt_status = 'DLVRD' and IsCancelled = 0)
   order by ae.Receive_Date, ap.docket_no;
GO

create procedure usp_insert_DRS
  @dtDrs_entry_details_grn dbo.udt_Drs_entry_details_grn readonly,
  @Drs_no varchar(30), @Drs_date date, @Drs_time varchar(10), @Location varchar(max), @docket_no_list varchar(max),
  @from_branch varchar(20), @total_weight float, @empcode varchar(50), @Franchisee_Code varchar(50), @DRSType varchar(20),
  @isFranchisee bit, @Financial_Year varchar(20), @DelBy varchar(100), @DelByNo varchar(20), @ShortCode varchar(10),
  @FinYr varchar(10), @Division varchar(20), @DockNonDock int, @Driver_Name varchar(100), @Vehicle_No varchar(20),
  @retval varchar(20) output
as
begin
  set nocount on;
  if exists (select 1 from drs_entry_details where Drs_no = @Drs_no) begin set @retval = 'DRS no exists'; return; end
  if exists (select 1 from @dtDrs_entry_details_grn t join grn_docket_charge c on c.Docket_No = t.docket_no and c.branch = @from_branch
              where t.packg > c.pending_package)
  begin set @retval = 'Packets exceed pending'; return; end

  insert into drs_entry_details(Drs_no, Drs_date, Drs_time, Location, docket_no, from_branch, total_weight, empcode, Franchisee_Code,
    DRSType, isFranchisee, Financial_Year, DelBy, DelByNo, ShortCode, FinYr, Division, DockNonDock, Driver_Name, Vehicle_No)
  values (@Drs_no, @Drs_date, @Drs_time, @Location, @docket_no_list, @from_branch, @total_weight, @empcode, @Franchisee_Code,
    @DRSType, @isFranchisee, @Financial_Year, @DelBy, @DelByNo, @ShortCode, @FinYr, @Division, @DockNonDock, @Driver_Name, @Vehicle_No);

  insert into drs_entry_details_grn(docket_no, freight, weight, packg, Drs_no, Location, Financial_Year, division,
    pending_Package, pending_freight, pending_weight, challan_no)
  select docket_no, freight, weight, packg, @Drs_no, Location, @Financial_Year, @Division,
         pending_Package, pending_freight, pending_weight, challan_no from @dtDrs_entry_details_grn;

  update c set pending_package = c.pending_package - t.packg,
               pending_weight = case when c.pending_weight - t.weight < 0 then 0 else c.pending_weight - t.weight end,
               pending_freight = case when c.pending_freight - t.freight < 0 then 0 else c.pending_freight - t.freight end,
               drs_statusC = 'Drs_Entry_generated', drs_noC = isnull(c.drs_noC, @Drs_no)
    from grn_docket_charge c join @dtDrs_entry_details_grn t on t.docket_no = c.Docket_No and c.branch = @from_branch;
  update grn_master set drs_status = 'Drs_Entry_generated', drs_no = @Drs_no, DocketStatus = 'OUT FOR DELIVERY'
   where docket_no in (select docket_no from @dtDrs_entry_details_grn) and current_branch = @from_branch;
  update p set drs_no = @Drs_no, drs_status_entry = 'Drs_Entry_generated'
    from Arrival_Packg p join @dtDrs_entry_details_grn t on t.docket_no = p.docket_no and t.challan_no = p.challan_no
   where p.from_branch = @from_branch and isnull(p.IsCancelled, 0) = 0;
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog, Origin, Destination)
  select docket_no, 'DRS', 'Out for delivery on ' + @Drs_no + ' (' + cast(packg as varchar(10)) + ' pkts)', getdate(), @empcode,
         @from_branch, @from_branch from @dtDrs_entry_details_grn;
  set @retval = 'success';
end
GO

create procedure usp_search_DrsEntry
  @booking_date1 varchar(20), @booking_date2 varchar(20), @currbranch varchar(20), @user_id varchar(60), @IsCancelled int,
  @Drs_no varchar(30) = null, @DRSType varchar(20), @Financial_Year varchar(20), @division varchar(20)
as
  select dr.Drs_no, dr.Drs_date, dr.Drs_time, b.branch_name as from_branch, dr.challan_no, dr.empcode, drg.docket_no,
         drg.packg, drg.weight, dr.DelBy, dr.Vehicle_No, dr.total_weight
    from drs_entry_details dr
    join drs_entry_details_grn drg on drg.Drs_no = dr.Drs_no
    join branch_master b on dr.from_branch = b.branch_code
   where dr.from_branch = @currbranch and dr.Division = @division and dr.DRSType = @DRSType
     and dr.Drs_date between @booking_date1 and @booking_date2
     and isnull(dr.IsCancelled, 0) = @IsCancelled
     and (@user_id like 'admin%' or dr.empcode like @user_id)
     and (@Drs_no is null or dr.Drs_no like '%' + @Drs_no + '%')
   order by dr.Drs_date desc, dr.Drs_no desc;
GO

create procedure usp_DRS_Cancel @Drs_no varchar(30), @user_id varchar(50), @Financial_Year varchar(20), @Branch_Code varchar(20),
  @success varchar(1000) output
as
begin
  set nocount on;
  if not exists (select 1 from drs_entry_details where Drs_no = @Drs_no and from_branch = @Branch_Code and isnull(IsCancelled, 0) = 0)
  begin set @success = 'DRS not found'; return; end
  update drs_entry_details set IsCancelled = 1, canceledBy = @user_id, canceledDate = getdate() where Drs_no = @Drs_no;
  update drs_entry_details_grn set isCancel = 1 where Drs_no = @Drs_no;
  update c set pending_package = c.pending_package + g.packg, pending_weight = c.pending_weight + g.weight,
               pending_freight = c.pending_freight + g.freight,
               drs_statusC = case when c.drs_noC = @Drs_no then null else c.drs_statusC end,
               drs_noC = case when c.drs_noC = @Drs_no then null else c.drs_noC end
    from grn_docket_charge c join drs_entry_details_grn g on g.docket_no = c.Docket_No and g.Drs_no = @Drs_no
   where c.branch = @Branch_Code;
  update grn_master set drs_status = null, drs_no = null, DocketStatus = 'ARRIVED' where drs_no = @Drs_no;
  update Arrival_Packg set drs_no = null, drs_status_entry = null where drs_no = @Drs_no;
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog)
  select docket_no, 'DRS', 'DRS ' + @Drs_no + ' cancelled', getdate(), @user_id from drs_entry_details_grn where Drs_no = @Drs_no;
  set @success = 'success';
end
GO
