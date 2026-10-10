-- =============================================================================
-- DEV-ONLY: arrival (receiving a challan's manifests at a branch).
-- Names follow wwwroot/Operation/Arrival_Entry.aspx.cs, ClassLibrary/dal/Arrival_dal.cs,
-- Arrival_Cancel_Dal.cs and the strings compiled into bin/ClassLibrary.dll (newer than
-- the ClassLibrary source). The @dtArrival_Entry type/columns are unknown (config.tvp.arrivalEntry).
-- =============================================================================

-- Arrival adds one grn_docket_charge row per receiving branch (legacy insert_docket_Charge_Details),
-- so Docket_No cannot be the primary key.
declare @pk sysname = (select name from sys.key_constraints where parent_object_id = object_id('grn_docket_charge') and type = 'PK');
if @pk is not null exec('alter table grn_docket_charge drop constraint ' + @pk);
GO
alter table grn_docket_charge add IsExcessArrival bit default 0;
alter table grn_master add current_branch varchar(20);   -- Arrived_status exists already (03-docket.sql)
alter table Manifest_grn add Arrival_status varchar(20), Pending_Arrival varchar(20);
alter table dispatch_master add TPNO varchar(30);   -- fleet trip no. (legacy select_Dispatch_Details reads d.TPNO)
GO

drop table Arrival_entry;
create table Arrival_entry (
  slno int identity primary key, ArrivalNo varchar(30) not null unique, challan_no varchar(30), Receive_Date date, Receive_time varchar(10),
  Manifest_no varchar(max), Message varchar(500), user_id varchar(50), from_branch varchar(20), seal_no varchar(50),
  OpeningKM varchar(20), ClosingKM varchar(20), TPNO varchar(30), Financial_Year varchar(20), FinYr varchar(10), ShortCode varchar(10),
  actualwt decimal(18,2), inwardwt decimal(18,2), diffwt decimal(18,2), div_code varchar(20),
  IsCancelled bit default 0, CancelledBy varchar(50));
create table Arrival_Packg (
  id int identity primary key, ArrivalNo varchar(30), docket_no varchar(30), challan_no varchar(30), manifest_no varchar(30),
  freight decimal(18,2), package int, weight decimal(18,2), pending_freight decimal(18,2), pending_package int, pending_weight decimal(18,2),
  Remarks varchar(500), from_branch varchar(20), Financial_Year varchar(20), IsExcessArrival bit default 0,
  drs_no varchar(30), drs_status_entry varchar(20), IsCancelled bit default 0);
create table drs_entry_details (id int identity primary key, drs_no varchar(30), Financial_Year varchar(20), IsCancelled bit default 0);
GO

-- package / weight / freight = received; booked_* = as manifested (goes to the new grn_docket_charge row).
create type dbo.udt_Arrival_Entry as table (
  docket_no varchar(30), manifest_no varchar(30), package int, weight decimal(18,2), freight decimal(18,2),
  booked_package int, booked_weight decimal(18,2), booked_freight decimal(18,2), Remarks varchar(500), IsExcessArrival bit);
GO

create procedure sp_insert_Arrival_Entry
  @dtArrival_Entry dbo.udt_Arrival_Entry readonly,
  @challan_no varchar(30), @Receive_Date date, @Receive_time varchar(10), @Manifest_no varchar(max), @Message varchar(500),
  @user_id varchar(50), @from_branch varchar(20), @docket_No varchar(30), @Rcv_Packg int, @Remarks varchar(500), @rcv_wt float,
  @rcv_frt float, @sealno varchar(50), @OpeningKM varchar(20), @ClosingKM varchar(20), @TPNO varchar(30), @Financial_Year varchar(20),
  @FinYr varchar(10), @actualwt float, @inwardwt float, @diffwt float, @div_code varchar(20), @ShortCode varchar(10),
  @retval varchar(500) output
as
begin
  set nocount on;
  if not exists (select 1 from dispatch_master where challan_no = @challan_no and isnull(IsCancelled, '0') = '0')
  begin set @retval = 'Challan not found or cancelled'; return; end
  if exists (select 1 from Arrival_Packg p join Arrival_entry a on a.ArrivalNo = p.ArrivalNo join @dtArrival_Entry t
               on t.docket_no = p.docket_no and t.manifest_no = p.manifest_no
              where a.from_branch = @from_branch and isnull(a.IsCancelled, 0) = 0 and isnull(p.IsCancelled, 0) = 0)
  begin set @retval = 'Challan No already arrived!'; return; end

  declare @prefix varchar(30) = 'AE' + @ShortCode + @FinYr;
  declare @next int = isnull((select max(cast(right(ArrivalNo, 6) as int)) from Arrival_entry with (updlock, holdlock)
                              where ArrivalNo like @prefix + '%' and len(ArrivalNo) = len(@prefix) + 6), 0) + 1;
  declare @no varchar(30) = @prefix + right('000000' + cast(@next as varchar(6)), 6);

  insert into Arrival_entry(ArrivalNo, challan_no, Receive_Date, Receive_time, Manifest_no, Message, user_id, from_branch, seal_no,
    OpeningKM, ClosingKM, TPNO, Financial_Year, FinYr, ShortCode, actualwt, inwardwt, diffwt, div_code)
  values (@no, @challan_no, @Receive_Date, @Receive_time, @Manifest_no, @Message, @user_id, @from_branch, @sealno,
    @OpeningKM, @ClosingKM, @TPNO, @Financial_Year, @FinYr, @ShortCode, @actualwt, @inwardwt, @diffwt, @div_code);

  insert into Arrival_Packg(ArrivalNo, docket_no, challan_no, manifest_no, freight, package, weight, pending_freight, pending_package,
    pending_weight, Remarks, from_branch, Financial_Year, IsExcessArrival)
  select @no, docket_no, @challan_no, manifest_no, freight, package, weight, freight, package, weight, Remarks, @from_branch,
         @Financial_Year, isnull(IsExcessArrival, 0) from @dtArrival_Entry;

  -- The docket now lies at this branch with what was received pending here.
  insert into grn_docket_charge(Docket_No, freight_type, rate_on, pcs, actual_weight, charge_weight, freight, docket_charge,
    other_charge, service_tax, charges, pending_freight, pending_weight, pending_package, branch, IsExcessArrival)
  select docket_no, '', '', booked_package, booked_weight, booked_weight, booked_freight, 0, 0, 0, 0,
         freight, weight, package, @from_branch, isnull(IsExcessArrival, 0) from @dtArrival_Entry;

  update g set Arrival_status = 'generated'
    from Manifest_grn g join @dtArrival_Entry t on t.docket_no = g.docket_no and t.manifest_no = g.Manifest_no;
  update grn_master set current_branch = @from_branch, Arrived_status = 'generated', DocketStatus = 'ARRIVED'
   where docket_no in (select docket_no from @dtArrival_Entry);
  update mainfest_entry set Arrived_status = 'IsActive'
   where challan_no = @challan_no and mainfest_no in (select ltrim(rtrim(value)) from string_split(@Manifest_no, ','));
  update dispatch_master set arrival_status = 'generated' where challan_no = @challan_no;
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog, Origin, Destination)
  select docket_no, 'ARRIVAL', 'Arrived on ' + @no + ' (challan ' + @challan_no + ')', getdate(), @user_id, @from_branch, @from_branch
    from @dtArrival_Entry;
  set @retval = 'success';
end
GO

create procedure search_ArrivalEntry
  @booking_date1 varchar(20), @booking_date2 varchar(20), @currbranch varchar(20), @user_id varchar(60), @IsCancelled int,
  @challan_no varchar(30) = null, @Financial_Year varchar(20), @division varchar(20)
as
  select a.ArrivalNo, a.challan_no, a.receive_date, a.Receive_time, a.user_id, d.truck_no, b.branch_name as dispatch_from,
         (select count(*) from Arrival_Packg p where p.ArrivalNo = a.ArrivalNo) as docket_count,
         (select isnull(sum(package), 0) from Arrival_Packg p where p.ArrivalNo = a.ArrivalNo) as total_package,
         a.inwardwt, a.diffwt
    from Arrival_entry a
    left join dispatch_master d on d.challan_no = a.challan_no
    left join branch_master b on b.branch_code = d.from_branch
   where a.from_branch = @currbranch and a.div_code = @division
     and a.Receive_Date between @booking_date1 and @booking_date2
     and isnull(a.IsCancelled, 0) = @IsCancelled
     and (@user_id like 'admin%' or a.user_id like @user_id)
     and (@challan_no is null or a.challan_no like '%' + @challan_no + '%' or a.ArrivalNo like '%' + @challan_no + '%')
   order by a.Receive_Date desc, a.ArrivalNo desc;
GO

create procedure usp_Arrival_Cancel @challan_no varchar(30), @user_id varchar(50), @Financial_Year varchar(20), @branch_Code varchar(20),
  @success varchar(1000) output
as
begin
  set nocount on;
  declare @arrivals table (ArrivalNo varchar(30));
  insert into @arrivals select ArrivalNo from Arrival_entry
   where challan_no = @challan_no and from_branch = @branch_Code and isnull(IsCancelled, 0) = 0;
  if not exists (select 1 from @arrivals) begin set @success = 'Arrival entry not found'; return; end

  update Arrival_entry set IsCancelled = 1, CancelledBy = @user_id where ArrivalNo in (select ArrivalNo from @arrivals);
  update Arrival_Packg set IsCancelled = 1 where ArrivalNo in (select ArrivalNo from @arrivals);
  -- remove the "lies at this branch" rows added on arrival
  delete c from grn_docket_charge c
   where c.branch = @branch_Code
     and c.Docket_No in (select docket_no from Arrival_Packg where ArrivalNo in (select ArrivalNo from @arrivals));
  update g set Arrival_status = null
    from Manifest_grn g join Arrival_Packg p on p.docket_no = g.docket_no and p.manifest_no = g.Manifest_no
   where p.ArrivalNo in (select ArrivalNo from @arrivals);
  update m set Arrived_status = null
    from mainfest_entry m where m.challan_no = @challan_no and m.to_branch = @branch_Code;
  update grn_master set current_branch = null, Arrived_status = null, DocketStatus = 'CHALLAN GENERATED'
   where docket_no in (select docket_no from Arrival_Packg where ArrivalNo in (select ArrivalNo from @arrivals));
  update dispatch_master set arrival_status = null
   where challan_no = @challan_no
     and not exists (select 1 from Arrival_entry a where a.challan_no = @challan_no and isnull(a.IsCancelled, 0) = 0);
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog)
  select docket_no, 'ARRIVAL', 'Arrival cancelled (challan ' + @challan_no + ')', getdate(), @user_id
    from Arrival_Packg where ArrivalNo in (select ArrivalNo from @arrivals);
  set @success = 'success';
end
GO
