-- =============================================================================
-- DEV-ONLY: manifest tables, table type and stand-in procedures.
-- Names follow ClassLibrary/dal/Manifest_dal.cs and Manifest_Cancel_dal.cs.
-- The real TVP type name is unknown (config.tvp.manifestGrn / TVP_MANIFEST_GRN).
-- =============================================================================

alter table grn_docket_charge add branch varchar(20);   -- branch where the docket currently lies
GO

create type dbo.udt_Manifest_grn as table (docket_no varchar(50), freight decimal(18,2), package int, weight decimal(18,2));
GO

create table mainfest_entry (
  id int identity primary key, mainfest_no varchar(30) not null unique, mainfest_date date, mainfest_time varchar(10),
  from_branch varchar(20), to_branch varchar(20), To_City varchar(20), docat_list varchar(max), user_id varchar(50),
  div_code varchar(20), freight_type varchar(10), Financial_Year varchar(20), ShortCode varchar(10), FinYr varchar(10),
  Loadtype varchar(10), transportedby varchar(20), coloading_by varchar(30), coloader_name varchar(60), m_manual_no varchar(30),
  remarks varchar(500), dest_type varchar(20), challan_no varchar(30), Dispatch_Status varchar(20), Arrived_status varchar(10),
  IsCancelled varchar(2) default '0', CancelledBy varchar(50));
-- Column names as used by the legacy challan SQL (dispatch_master_dal.cs):
-- mainfest_entry.freight_type / div_code / Dispatch_Status, Manifest_grn.challan_no / Dispatch_Status.
create table Manifest_grn (
  id int identity primary key, docket_no varchar(30), freight decimal(18,2), package int, weight decimal(18,2),
  Manifest_no varchar(30), Financial_Year varchar(20), div_code varchar(20), challan_no varchar(30), Dispatch_Status varchar(20));
create table delivery_status_entry_details (id int identity primary key, docket_no varchar(30), pkt_status varchar(10), IsCancelled bit default 0);
GO

create procedure sp_GetDocketForManifest
  @current_branch varchar(20), @Destination varchar(20), @fromdate varchar(20), @todate varchar(20),
  @loadType varchar(10), @division varchar(20), @booking_mode varchar(10)
as
  select g1.docket_no, g1.booking_date, g1.booking_mode, g1.Consigner_Name as consigner_name, g1.consignee_name,
         b.branch_name as originbranch, isnull(bd.branch_name, g1.destination) as destinationbranch, g1.destination as destination_city,
         g1.LoadType, g2.pcs,
         coalesce(g2.pending_package, g2.pcs) as pending_package,
         coalesce(g2.pending_weight, g2.charge_weight) as pending_weight,
         coalesce(g2.pending_freight, case when g2.freight = 0 then g2.charges else g2.freight end) as pending_freight
    from grn_master g1
    join grn_docket_charge g2 on g2.Docket_No = g1.docket_no
    left join branch_master b on b.branch_code = g1.origin_branch
    left join branch_master bd on bd.branch_code = g1.destination_branch
   where coalesce(g2.branch, g1.origin_branch) = @current_branch
     and coalesce(g2.pending_package, g2.pcs) > 0
     and isnull(g1.IsCancel, '0') = '0'
     and g1.Division = @division
     and g1.booking_date between @fromdate and @todate
     and (@loadType like '%' + isnull(nullif(g1.LoadType, ''), 'PTL') + '%')
     and (@booking_mode = 'All' or g1.booking_mode = @booking_mode)
     and (g1.destination_branch = @Destination
          or exists (select 1 from city_master c where c.city_code = @Destination and c.city_name = g1.destination))
     and g1.docket_no not in (select docket_no from delivery_status_entry_details where pkt_status = 'DLVRD' and IsCancelled = 0)
   order by g1.docket_no;
GO

-- Generates ME + ShortCode + FinYr + 6-digit running number (menifest.aspx.cs bind()).
create procedure usp_insert_Manifest
  @mainfest_no varchar(30), @mainfest_date date, @mainfest_time varchar(10), @from_branch varchar(20), @to_branch varchar(20),
  @docat_list varchar(max), @user_id varchar(50), @division varchar(20), @frt_type varchar(10), @To_City varchar(20),
  @Financial_Year varchar(20), @ShortCode varchar(10), @FinYr varchar(10), @Loadtype varchar(10), @transportedby varchar(20),
  @coloading_by varchar(30), @coloader_name varchar(60), @m_manual_no varchar(30), @dtManifest_grn dbo.udt_Manifest_grn readonly,
  @remarks varchar(500), @dest_type varchar(20), @retval varchar(20) output, @retMsg varchar(500) output
as
begin
  set nocount on;
  -- grn_docket_charge: one row per branch the docket has been at (booking + arrivals).
  if exists (select 1 from @dtManifest_grn t join grn_docket_charge c on c.Docket_No = t.docket_no
              join grn_master g on g.docket_no = c.Docket_No
              where coalesce(c.branch, g.origin_branch) = @from_branch and t.package > coalesce(c.pending_package, c.pcs))
  begin set @retval = ''; set @retMsg = 'Package count exceeds pending packages'; return; end

  declare @prefix varchar(30) = 'ME' + @ShortCode + @FinYr;
  declare @next int = isnull((select max(cast(right(mainfest_no, 6) as int)) from mainfest_entry with (updlock, holdlock)
                              where mainfest_no like @prefix + '%'), 0) + 1;
  set @retval = @prefix + right('000000' + cast(@next as varchar(6)), 6);

  insert into mainfest_entry(mainfest_no, mainfest_date, mainfest_time, from_branch, to_branch, To_City, docat_list, user_id, div_code,
    freight_type, Financial_Year, ShortCode, FinYr, Loadtype, transportedby, coloading_by, coloader_name, m_manual_no, remarks, dest_type, IsCancelled)
  values (@retval, @mainfest_date, @mainfest_time, @from_branch, @to_branch, @To_City, @docat_list, @user_id, @division,
    @frt_type, @Financial_Year, @ShortCode, @FinYr, @Loadtype, @transportedby, @coloading_by, @coloader_name, @m_manual_no, @remarks, @dest_type, '0');

  insert into Manifest_grn(docket_no, freight, package, weight, Manifest_no, Financial_Year, div_code)
  select docket_no, freight, package, weight, @retval, @Financial_Year, @division from @dtManifest_grn;

  update c set
      pending_package = coalesce(c.pending_package, c.pcs) - t.package,
      pending_weight = case when coalesce(c.pending_weight, c.charge_weight) - t.weight < 0 then 0 else coalesce(c.pending_weight, c.charge_weight) - t.weight end,
      pending_freight = case when coalesce(c.pending_freight, c.freight) - t.freight < 0 then 0 else coalesce(c.pending_freight, c.freight) - t.freight end
    from grn_docket_charge c join @dtManifest_grn t on t.docket_no = c.Docket_No
    join grn_master g on g.docket_no = c.Docket_No
   where coalesce(c.branch, g.origin_branch) = @from_branch;
  update grn_master set manifest_status = 'generated', DocketStatus = 'MANIFEST GENERATED'
   where docket_no in (select docket_no from @dtManifest_grn);
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog, Origin, Destination)
  select docket_no, 'MANIFEST', 'Manifested on ' + @retval, getdate(), @user_id, @from_branch, isnull(nullif(@to_branch, ''), @To_City) from @dtManifest_grn;
  set @retMsg = 'success';
end
GO

create procedure usp_Select_Manifest_Entry
  @booking_date1 varchar(20), @booking_date2 varchar(20), @currbranch varchar(20), @user_id varchar(60), @IsCancelled int,
  @mainfest_no varchar(30) = null, @Financial_Year varchar(20), @division varchar(20)
as
  select m.mainfest_no, m.mainfest_date, m.mainfest_time, m.to_branch, b.branch_name as to_branch_name, m.To_City, m.freight_type,
         m.challan_no, m.user_id,
         (select count(*) from Manifest_grn g where g.Manifest_no = m.mainfest_no) as docket_count,
         (select isnull(sum(package), 0) from Manifest_grn g where g.Manifest_no = m.mainfest_no) as total_package
    from mainfest_entry m left join branch_master b on b.branch_code = m.to_branch
   where m.from_branch = @currbranch and m.div_code = @division
     and m.mainfest_date between @booking_date1 and @booking_date2
     and isnull(m.IsCancelled, '0') = cast(@IsCancelled as varchar(2))
     and (@user_id like 'admin%' or m.user_id like @user_id)
     and (@mainfest_no is null or m.mainfest_no like '%' + @mainfest_no + '%')
   order by m.mainfest_date desc, m.mainfest_no desc;
GO

create procedure usp_Manifest_Cancel @Manifest_no varchar(30), @user_id varchar(50), @branch_code varchar(20), @Financial_Year varchar(20), @success varchar(1000) output
as
begin
  set nocount on;
  update mainfest_entry set IsCancelled = '1', CancelledBy = @user_id where mainfest_no = @Manifest_no;
  update c set
      pending_package = coalesce(c.pending_package, 0) + g.package,
      pending_weight = coalesce(c.pending_weight, 0) + g.weight,
      pending_freight = coalesce(c.pending_freight, 0) + g.freight
    from grn_docket_charge c join Manifest_grn g on g.docket_no = c.Docket_No and g.Manifest_no = @Manifest_no
    join grn_master gm on gm.docket_no = c.Docket_No
   where coalesce(c.branch, gm.origin_branch) = @branch_code;
  update grn_master set manifest_status = null, DocketStatus = null
   where docket_no in (select docket_no from Manifest_grn where Manifest_no = @Manifest_no)
     and docket_no not in (select g.docket_no from Manifest_grn g join mainfest_entry m on m.mainfest_no = g.Manifest_no
                            where m.mainfest_no <> @Manifest_no and isnull(m.IsCancelled, '0') = '0');
  insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog)
  select docket_no, 'MANIFEST', 'Manifest ' + @Manifest_no + ' cancelled', getdate(), @user_id from Manifest_grn where Manifest_no = @Manifest_no;
  set @success = 'success';
end
GO
