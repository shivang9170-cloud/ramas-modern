-- =============================================================================
-- DEV-ONLY: POD courier to head office + POD receive at head office.
-- Names follow wwwroot/Operation/POD_Dispatch_To_Head_Office.aspx.cs, POD_Courier_Cancel.aspx.cs,
-- podreceive.aspx.cs, POD_Received_Cancel.aspx.cs and their DALs.
-- =============================================================================

alter table pod_dispatch add Dispatch varchar(5);
alter table POD_Dispatch_D add Doc_Cat varchar(50), Doc_Dt date, MODE varchar(2), PName varchar(100), CCode varchar(20),
  AWBill_No varchar(50), Financial_Year varchar(20), division varchar(20);
alter table grn_master add PODDispatch_status varchar(40), IOM_number varchar(30);
alter table grn_docket_charge add PODRCV_status varchar(40);
GO

create table Courier (CCode varchar(20) primary key, CName varchar(100), Active bit default 1);
create table POD_Dispatch_H (
  Slno int identity primary key, Doc_Cat varchar(50), Doc_No varchar(30) unique, Doc_Dt date, Ent_Dt datetime, Branch_Code varchar(20),
  MODE varchar(2), PName varchar(100), CCode varchar(20), USER_ID varchar(50), Courier_Type varchar(10), Financial_Year varchar(20),
  division varchar(20), Receive_Status bit default 0, IsCancelled bit default 0, Cancel_By varchar(50));
create table pod_received (
  id int identity primary key, IOM_number varchar(30), docket_no varchar(30), Receive_date date, Remark varchar(500), Doc_No varchar(30),
  user_id varchar(50), IsCancelled varchar(2) default '0', LastUpdate datetime, DivCode varchar(20), Financial_Year varchar(20));
GO

-- Generates PODD-<n> (Generate_Autocode("POD_Dispatch_H", "PODD-", "Doc_No", "100000")) and returns it in @retval.
create procedure usp_insert_Pod_Dispatch_H
  @Doc_Cat varchar(50), @Doc_No varchar(30), @Doc_Dt date, @Ent_Dt datetime, @Branch_Code varchar(20), @MODE varchar(2),
  @PName varchar(100), @CCode varchar(20), @USER_ID varchar(50), @Courier_Type varchar(10), @financial_year varchar(20),
  @division varchar(20), @retval varchar(20) output
as
begin
  set nocount on;
  declare @next int = isnull((select max(cast(substring(Doc_No, 6, 20) as int)) from POD_Dispatch_H with (updlock, holdlock)
                              where Doc_No like 'PODD-%'), 100000) + 1;
  set @retval = 'PODD-' + cast(@next as varchar(12));
  insert into POD_Dispatch_H(Doc_Cat, Doc_No, Doc_Dt, Ent_Dt, Branch_Code, MODE, PName, CCode, USER_ID, Courier_Type, Financial_Year, division)
  values (@Doc_Cat, @retval, @Doc_Dt, @Ent_Dt, @Branch_Code, @MODE, @PName, @CCode, @USER_ID, @Courier_Type, @financial_year, @division);
end
GO

create procedure GET_POD_DISPATCH_LIST_BY_COURIER_FOR_VIEW_CANCEL @Financial_Year varchar(20), @Branch_code varchar(20), @division varchar(20)
as
  select h.Doc_No, h.Doc_Dt, h.MODE, h.PName, c.CName, d.AWBill_No, h.USER_ID, h.Receive_Status, h.IsCancelled,
         (select count(*) from POD_Dispatch_D x where x.Doc_No = h.Doc_No and isnull(x.IsCancelled, 0) = 0) as iom_count
    from POD_Dispatch_H h
    left join Courier c on c.CCode = h.CCode
    outer apply (select top 1 AWBill_No from POD_Dispatch_D d where d.Doc_No = h.Doc_No) d
   where h.Branch_Code = @Branch_code and h.division = @division and h.Financial_Year = @Financial_Year
   order by h.Doc_Dt desc, h.Doc_No desc;
GO

create procedure CHECK_WHEN_POD_ALREADY_RECEIVED @doc_no varchar(30)
as
  select top 1 docket_no from pod_received where Doc_No = @doc_no and isnull(IsCancelled, '0') = '0';
GO

create procedure CANCEL_POD_DISPATCH_BY_COUREIR @Doc_No varchar(30), @Cancel_By varchar(50)
as
begin
  update pod_dispatch set Dispatch = null
   where IOM_number in (select IOM_No from POD_Dispatch_D where Doc_No = @Doc_No and isnull(IsCancelled, 0) = 0);
  update POD_Dispatch_D set IsCancelled = 1 where Doc_No = @Doc_No;
  update POD_Dispatch_H set IsCancelled = 1, Cancel_By = @Cancel_By where Doc_No = @Doc_No and isnull(IsCancelled, 0) = 0;
end
GO

-- Courier documents not yet fully received (the receive page lists them).
create procedure search_Doc_no_Datewise @booking_date1 varchar(20), @booking_date2 varchar(20), @Divcode varchar(20)
as
  select h.Doc_No, h.Doc_Dt, h.MODE, b.branch_name as from_branch, c.CName, h.PName,
         (select count(*) from POD_Dispatch_D d where d.Doc_No = h.Doc_No and isnull(d.IsCancelled, 0) = 0) as iom_count
    from POD_Dispatch_H h
    left join branch_master b on b.branch_code = h.Branch_Code
    left join Courier c on c.CCode = h.CCode
   where h.division = @Divcode and isnull(h.IsCancelled, 0) = 0 and isnull(h.Receive_Status, 0) = 0
     and h.Doc_Dt between @booking_date1 and @booking_date2
   order by h.Doc_Dt, h.Doc_No;
GO

create procedure search_pod_on_the_basis_of_pod_number_After_Courier @Doc_No varchar(30), @DivCode varchar(20)
as
  select h.Doc_No, p.IOM_number, p.Iom_date, p.docket_no, g.consignee_name, g.PODDispatch_status,
         c.pcs, c.charge_weight, case when c.freight = 0 then c.charges else c.freight end as freight,
         (select count(*) from pod_dispatch_image i where i.IOM_number = p.IOM_number and i.docket_no = p.docket_no) as images
    from POD_Dispatch_H h
    join POD_Dispatch_D d on d.Doc_No = h.Doc_No and isnull(d.IsCancelled, 0) = 0
    join pod_dispatch p on p.IOM_number = d.IOM_No and isnull(p.IsCancelled, 0) = 0
    join grn_master g on g.docket_no = p.docket_no
    left join grn_docket_charge c on c.Docket_No = g.docket_no and isnull(c.branch, g.origin_branch) = g.origin_branch
   where h.Doc_No = @Doc_No and h.division = @DivCode and isnull(h.IsCancelled, 0) = 0
   order by p.IOM_number, p.docket_no;
GO

create procedure GET_DOC_NO_BY_DOCKET_NO_FOR_POD_RECEIVE @docket_no varchar(30)
as
  select top 1 d.Doc_No from pod_dispatch p
    join POD_Dispatch_D d on d.IOM_No = p.IOM_number and isnull(d.IsCancelled, 0) = 0
   where p.docket_no = @docket_no and isnull(p.IsCancelled, 0) = 0
     and p.docket_no not in (select docket_no from pod_received where isnull(IsCancelled, '0') = '0')
   order by d.id desc;
GO

create procedure Insert_Pod_Received
  @IOM_number varchar(30), @docket_no varchar(30), @Receive_date date, @Remark varchar(500), @Doc_No varchar(30), @user_id varchar(50),
  @IsCancelled varchar(2), @LastUpdate datetime, @DivCode varchar(20), @Financial_Year varchar(20)
as
begin
  insert into pod_received(IOM_number, docket_no, Receive_date, Remark, Doc_No, user_id, IsCancelled, LastUpdate, DivCode, Financial_Year)
  values (@IOM_number, @docket_no, @Receive_date, @Remark, @Doc_No, @user_id, @IsCancelled, @LastUpdate, @DivCode, @Financial_Year);
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog)
  values (@docket_no, 'POD', 'POD received at head office (' + @Doc_No + ')', getdate(), @user_id);
end
GO

create procedure usp_search_POD_Receive_Entry
  @booking_date1 varchar(20), @booking_date2 varchar(20), @Doc_no varchar(30) = null, @IsCancelled int, @user_id varchar(60),
  @Financial_Year varchar(20), @DivCode varchar(20)
as
  select r.Doc_No, r.Receive_date, r.docket_no, r.IOM_number, r.Remark, r.user_id, b.branch_name as from_branch
    from pod_received r
    left join POD_Dispatch_H h on h.Doc_No = r.Doc_No
    left join branch_master b on b.branch_code = h.Branch_Code
   where r.DivCode = @DivCode and r.Receive_date between @booking_date1 and @booking_date2
     and cast(isnull(r.IsCancelled, '0') as int) = @IsCancelled
     and (@user_id like 'admin%' or r.user_id like @user_id + '%')
     and (@Doc_no is null or r.Doc_No like '%' + @Doc_no + '%' or r.docket_no like '%' + @Doc_no + '%')
   order by r.Receive_date desc, r.Doc_No, r.docket_no;
GO

create procedure usp_POD_Receive_Cancel @Doc_No varchar(30), @user_id varchar(50), @Financial_Year varchar(20), @DivCode varchar(20),
  @success varchar(1000) output
as
begin
  set nocount on;
  declare @d table (docket_no varchar(30), IOM_number varchar(30));
  insert into @d select docket_no, IOM_number from pod_received where Doc_No = @Doc_No and isnull(IsCancelled, '0') = '0' and DivCode = @DivCode;
  if not exists (select 1 from @d) begin set @success = 'Nothing received on this document'; return; end
  update pod_received set IsCancelled = '1', LastUpdate = getdate() where Doc_No = @Doc_No and isnull(IsCancelled, '0') = '0';
  update grn_master set PODDispatch_status = null where docket_no in (select docket_no from @d);
  update grn_docket_charge set PODRCV_status = null where Docket_No in (select docket_no from @d);
  update POD_Dispatch_D set ho_receive = null where Doc_No = @Doc_No;
  update POD_Dispatch_H set Receive_Status = 0 where Doc_No = @Doc_No;
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog)
  select docket_no, 'POD', 'POD receive cancelled (' + @Doc_No + ')', getdate(), @user_id from @d;
  set @success = 'success';
end
GO
