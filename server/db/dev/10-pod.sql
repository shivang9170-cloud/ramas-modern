-- =============================================================================
-- DEV-ONLY: POD dispatch (IOM) at the delivering branch.
-- Names follow wwwroot/Operation/Pod_Dispatch.aspx.cs, POD_Dispatch_Cancel.aspx.cs,
-- ClassLibrary/dal/pod_dispatch_dal.cs and POD_Dispatch_Cancel_Dal.cs.
-- @dtPod_Dispatch_image type name unknown (config.tvp.podImage).
-- =============================================================================

alter table grn_docket_charge add pod_dispatch varchar(40), IOM_num varchar(30);
GO

drop table pod_dispatch;
create table pod_dispatch (
  Slno int identity primary key, IOM_number varchar(30), branch_code varchar(20), docket_no varchar(30), Iom_date date,
  remarks varchar(500), ImagePath varchar(300), From_Branch varchar(20), user_id varchar(50), Division varchar(20),
  Financial_Year varchar(20), IsCancelled bit default 0, CancelledBy varchar(50), created_at datetime default getdate());
create table pod_dispatch_image (id int identity primary key, IOM_number varchar(30), docket_no varchar(30), ImagePath varchar(300));
-- courier to head office (POD_Dispatch_To_Head_Office.aspx) — only what the cancel check reads for now
create table POD_Dispatch_D (id int identity primary key, Doc_No varchar(30), IOM_No varchar(30), ho_receive varchar(20), IsCancelled bit default 0);
GO

create type dbo.udt_Pod_Dispatch_image as table (ImagePath varchar(300));
GO

-- The POD is made at the delivering branch (origin for FTL dockets), in the docket's division.
create procedure CHECK_DOCKET_NO_ELIGIBLE_FOR_POD_DISPATCH @docket_no varchar(30), @branch_code varchar(20), @div_code varchar(20)
as
  select g.docket_no,
         case when exists (select 1 from pod_dispatch p where p.docket_no = g.docket_no and isnull(p.IsCancelled, 0) = 0) then '1' else '0' end
           as pod_generated_status
    from grn_master g
   where g.docket_no = @docket_no and g.Division = @div_code
     and (case when g.LoadType = 'FTL' then g.origin_branch else g.destination_branch end) = @branch_code;
GO

create procedure usp_insert_Pod_Dispatch
  @IOM_number varchar(30), @branch_code varchar(20), @docket_no varchar(30), @Iom_date date, @reamrks varchar(500),
  @ImagePath varchar(300), @From_Branch varchar(20), @user_id varchar(50), @division varchar(20), @Fin_year varchar(20),
  @dtPod_Dispatch_image dbo.udt_Pod_Dispatch_image readonly, @retval varchar(20) output
as
begin
  set nocount on;
  if exists (select 1 from pod_dispatch where docket_no = @docket_no and isnull(IsCancelled, 0) = 0)
  begin set @retval = '0'; return; end
  insert into pod_dispatch(IOM_number, branch_code, docket_no, Iom_date, remarks, ImagePath, From_Branch, user_id, Division, Financial_Year)
  values (@IOM_number, @branch_code, @docket_no, @Iom_date, @reamrks, @ImagePath, @From_Branch, @user_id, @division, @Fin_year);
  insert into pod_dispatch_image(IOM_number, docket_no, ImagePath) select @IOM_number, @docket_no, ImagePath from @dtPod_Dispatch_image;
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog, Origin, Destination)
  values (@docket_no, 'POD', 'POD dispatched on ' + @IOM_number, getdate(), @user_id, @From_Branch, @branch_code);
  set @retval = '1';
end
GO

create procedure usp_search_POD_Dispatch_Entry
  @booking_date1 varchar(20), @booking_date2 varchar(20), @currbranch varchar(20), @IsCancelled int, @IOM_number varchar(30) = null,
  @user_id varchar(60), @Financial_Year varchar(20), @division varchar(20)
as
  select p.IOM_number, p.Iom_date, p.docket_no, p.branch_code, b.branch_name as sent_to, p.remarks, p.user_id,
         (select count(*) from pod_dispatch_image i where i.IOM_number = p.IOM_number and i.docket_no = p.docket_no) as images
    from pod_dispatch p left join branch_master b on b.branch_code = p.branch_code
   where p.From_Branch = @currbranch and p.Division = @division
     and p.Iom_date between @booking_date1 and @booking_date2
     and isnull(p.IsCancelled, 0) = @IsCancelled
     and (@user_id like 'admin%' or p.user_id like @user_id + '%')
     and (@IOM_number is null or p.IOM_number like '%' + @IOM_number + '%' or p.docket_no like '%' + @IOM_number + '%')
   order by p.Iom_date desc, p.IOM_number desc, p.docket_no;
GO

create procedure usp_POD_Dispatch_Cancel @IOM_number varchar(30), @user_id varchar(50), @Financial_Year varchar(20), @success varchar(1000) output
as
begin
  set nocount on;
  if not exists (select 1 from pod_dispatch where IOM_number = @IOM_number and isnull(IsCancelled, 0) = 0)
  begin set @success = 'POD dispatch not found'; return; end
  update grn_docket_charge set pod_dispatch = null, IOM_num = null where IOM_num = @IOM_number;
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog)
  select docket_no, 'POD', 'POD dispatch ' + @IOM_number + ' cancelled', getdate(), @user_id
    from pod_dispatch where IOM_number = @IOM_number and isnull(IsCancelled, 0) = 0;
  update pod_dispatch set IsCancelled = 1, CancelledBy = @user_id where IOM_number = @IOM_number;
  set @success = 'success';
end
GO
