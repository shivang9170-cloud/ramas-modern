-- =============================================================================
-- DEV-ONLY: delivery status entry (DRS-wise door delivery + godown delivery).
-- Names follow wwwroot/Operation/deliverystatusentry.aspx.cs, deliverystatusentry_Cancel.aspx.cs,
-- ClassLibrary/dal/delivery_status_entry_dal.cs and deliverystatusentry_Cancel_dal.cs.
-- =============================================================================

alter table delivery_status_entry_details add
  rcv_date datetime, rcv_time varchar(10), rcvr_name varchar(100), rcvr_phone varchar(20), remarks varchar(500),
  UserId varchar(50), Division varchar(20), from_branch varchar(20), created_at datetime default getdate();
alter table delivery_status_entry_details alter column pkt_status varchar(20);
alter table drs_entry_details alter column Drs_delivery_status_Entry varchar(40);
alter table grn_docket_charge add drs_status_entry varchar(40);
alter table Arrival_Packg add Drs_delivery_status varchar(40);
alter table drs_entry_details_grn add Drs_delivery_status_Entry varchar(40);
GO

create table delivery_status_entry_grn (
  id int identity primary key, drs_no varchar(30), docket_no varchar(max), total_freight float, total_weight float, toatal_packg float,
  from_branch varchar(20), Division varchar(20), Financial_Year varchar(20), IsCancelled bit default 0, created_at datetime default getdate());
create table Drs_status_reason (id int identity primary key, status_reason varchar(100));
create table client_bill_charge_details (id int identity primary key, bill_no varchar(30), docket_no varchar(30), amount decimal(18,2));
create table pod_dispatch (id int identity primary key, docket_no varchar(30), IsCancelled bit default 0);
GO

-- One status row per docket. UNDELIVERED puts the packets back as pending at the branch so the
-- docket can go on another DRS (the legacy page only reset grn_docket_charge.drs_statusC).
create procedure Insert_Delivery_status_entry_Details
  @drs_no varchar(30), @docket_no varchar(30), @pkt_status varchar(20), @rcv_date datetime, @rcv_time varchar(10),
  @rcvr_name varchar(100), @rcvr_phone varchar(20), @remarks varchar(500), @UserId varchar(50), @Division varchar(20),
  @Financial_Year varchar(20), @from_branch varchar(20)
as
begin
  set nocount on;
  insert into delivery_status_entry_details(drs_no, docket_no, pkt_status, rcv_date, rcv_time, rcvr_name, rcvr_phone, remarks,
    UserId, Division, Financial_Year, from_branch, IsCancelled)
  values (@drs_no, @docket_no, @pkt_status, @rcv_date, @rcv_time, @rcvr_name, @rcvr_phone, @remarks,
    @UserId, @Division, @Financial_Year, @from_branch, 0);
  if @pkt_status = 'UNDELIVERED' and isnull(@drs_no, '') <> ''
    update c set pending_package = c.pending_package + g.packg, pending_weight = c.pending_weight + g.weight,
                 pending_freight = c.pending_freight + g.freight
      from grn_docket_charge c join drs_entry_details_grn g on g.docket_no = c.Docket_No and g.Drs_no = @drs_no
     where c.Docket_No = @docket_no and c.branch = @from_branch;
  update grn_master set DocketStatus = case @pkt_status when 'DLVRD' then 'DELIVERED' else @pkt_status end where docket_no = @docket_no;
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog, Origin, Destination)
  values (@docket_no, 'DELIVERY', @pkt_status + isnull(' — ' + nullif(@rcvr_name, ''), '') + isnull(' (' + nullif(@drs_no, '') + ')', ''),
          getdate(), @UserId, @from_branch, @from_branch);
end
GO

create procedure Insert_delivery_status_entry_grn
  @drs_no varchar(30), @docket_no varchar(max), @total_freight float, @total_weight float, @toatal_packg float,
  @from_branch varchar(20), @Division varchar(20), @Financial_Year varchar(20)
as
  insert into delivery_status_entry_grn(drs_no, docket_no, total_freight, total_weight, toatal_packg, from_branch, Division, Financial_Year)
  values (@drs_no, @docket_no, @total_freight, @total_weight, @toatal_packg, @from_branch, @Division, @Financial_Year);
GO

-- Godown-delivery dockets lying at this branch without a delivery status.
create procedure GET_GODOWN_DELIVERY_DOCKETS_IN_DRS_STATUS_ENTRY @Division varchar(20), @current_branch varchar(20), @Financial_Year varchar(20)
as
  select g.docket_no, g.booking_date, g.Consigner_Name as consigner, g.consignee_name as consignee, ae.Receive_Date as Arrival_date,
         c.pending_package as packg, c.pending_weight as weight, c.pending_freight as freight
    from grn_master g
    join grn_docket_charge c on c.Docket_No = g.docket_no and c.branch = @current_branch
    join Arrival_Packg ap on ap.docket_no = g.docket_no and ap.from_branch = @current_branch and isnull(ap.IsCancelled, 0) = 0
    join Arrival_entry ae on ae.ArrivalNo = ap.ArrivalNo and isnull(ae.IsCancelled, 0) = 0
   where g.Division = @Division and g.delivery_mode = 'DM-102' and g.destination_branch = @current_branch
     and isnull(g.IsCancel, '0') = '0' and c.pending_package > 0
     and g.docket_no not in (select docket_no from delivery_status_entry_details where isnull(IsCancelled, 0) = 0)
   order by g.docket_no;
GO

-- Stand-in for the To Pay auto bill: records one bill line for the docket.
create procedure CREATE_AUTO_CLIENT_BILL_AND_FINALIZE
  @Financial_Year varchar(20), @branch_code varchar(20), @ShortYear varchar(10), @docket_no varchar(30), @user_id varchar(50)
as
  if not exists (select 1 from client_bill_charge_details where docket_no = @docket_no)
    insert into client_bill_charge_details(bill_no, docket_no, amount)
    select 'BL' + @ShortYear + right('000000' + cast((select count(*) + 1 from client_bill_charge_details) as varchar(6)), 6),
           @docket_no, charges from grn_docket_charge
     where Docket_No = @docket_no and isnull(branch, (select origin_branch from grn_master where docket_no = @docket_no))
                                      = (select origin_branch from grn_master where docket_no = @docket_no);
GO

create procedure usp_search_DeliveryEntry
  @booking_date1 varchar(20), @booking_date2 varchar(20), @currbranch varchar(20), @IsCancelled int, @Drs_no varchar(30) = null,
  @user_id varchar(60), @Financial_Year varchar(20), @Division varchar(20)
as
  select d.drs_no, d.docket_no, d.pkt_status, d.rcv_date, d.rcv_time, d.rcvr_name, d.UserId as user_id
    from delivery_status_entry_details d
   where d.from_branch = @currbranch and d.Division = @Division
     and cast(d.rcv_date as date) between @booking_date1 and @booking_date2
     and isnull(d.IsCancelled, 0) = @IsCancelled
     and (@user_id like 'admin%' or d.UserId like @user_id)
     and (@Drs_no is null or d.drs_no like '%' + @Drs_no + '%' or d.docket_no like '%' + @Drs_no + '%')
   order by d.rcv_date desc, d.drs_no, d.docket_no;
GO

create procedure usp_Delivery_Status_Cancel @Drs_no varchar(30), @user_id varchar(50), @Financial_Year varchar(20), @branch_Code varchar(20),
  @success varchar(1000) output
as
begin
  set nocount on;
  declare @rows table (docket_no varchar(30), pkt_status varchar(20));
  insert into @rows select docket_no, pkt_status from delivery_status_entry_details
   where drs_no = @Drs_no and from_branch = @branch_Code and isnull(IsCancelled, 0) = 0;
  if not exists (select 1 from @rows) begin set @success = 'No delivery status to cancel'; return; end

  -- undo the "undelivered -> pending again" of Insert_Delivery_status_entry_Details
  update c set pending_package = c.pending_package - g.packg, pending_weight = c.pending_weight - g.weight,
               pending_freight = c.pending_freight - g.freight
    from grn_docket_charge c join drs_entry_details_grn g on g.docket_no = c.Docket_No and g.Drs_no = @Drs_no
    join @rows r on r.docket_no = c.Docket_No and r.pkt_status = 'UNDELIVERED'
   where c.branch = @branch_Code;
  update delivery_status_entry_details set IsCancelled = 1 where drs_no = @Drs_no and from_branch = @branch_Code;
  update delivery_status_entry_grn set IsCancelled = 1 where drs_no = @Drs_no and from_branch = @branch_Code;
  update drs_entry_details_grn set Drs_delivery_status_Entry = null where Drs_no = @Drs_no;
  update drs_entry_details set Drs_delivery_status_Entry = null where Drs_no = @Drs_no;
  update grn_docket_charge set drs_status_entry = null, drs_statusC = 'Drs_Entry_generated'
   where branch = @branch_Code and Docket_No in (select docket_no from @rows);
  update Arrival_Packg set Drs_delivery_status = null where from_branch = @branch_Code and docket_no in (select docket_no from @rows);
  update grn_master set drs_status = 'Drs_Entry_generated', DocketStatus = 'OUT FOR DELIVERY' where docket_no in (select docket_no from @rows);
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog)
  select docket_no, 'DELIVERY', 'Delivery status cancelled (' + @Drs_no + ')', getdate(), @user_id from @rows;
  set @success = 'success';
end
GO
