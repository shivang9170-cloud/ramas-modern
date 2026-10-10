-- =============================================================================
-- DEV-ONLY DEMO DATA for the analytics dashboard: about a year of made-up business so every chart has something to show.
-- Every row is tagged: dockets DMO000001…, clients DMOC01…, manifests DMOMF…, challans DMOCH…, arrivals DMOAR…, DRS DMODRS…,
-- POD IOMs DMOIOM…, pickups DMOPK…, bills DMOBL…, receipts DMOBR…, misc / warehouse bills DMOMIS / DMOWHO…, vendor invoices
-- DMOOTH…, vendor bills DMOVB…, franchisee invoices DMOFINV…, vouchers VoucherNo DMO….
-- Load:    sqlcmd -S .\SQLEXPRESS -E -d ramas_modern_dev -i server\db\dev\demo\demo-data.sql
-- Remove:  sqlcmd -S .\SQLEXPRESS -E -d ramas_modern_dev -i server\db\dev\demo\demo-remove.sql
-- Never run against a real database.
-- =============================================================================
set nocount on;
set xact_abort on;
if db_name() not like '%[_]dev' and db_name() not like '%[_]test'
begin raiserror('Demo data is only for a *_dev or *_test database', 16, 1); return; end
if exists (select 1 from grn_master where docket_no like 'DMO%')
begin raiserror('Demo data is already loaded - run demo-remove.sql first', 16, 1); return; end

begin transaction;
declare @today date = cast(getdate() as date);

-- ---------------------------------------------------------------- clients
insert into client_Master(client_code, client_name, company_name, city, address, place, Branch_Code, is_Active, credit_period, DivCode, Gstin_No, created_date)
values ('DMOC01', 'SUNRISE FOODS (DEMO)', 'SUNRISE FOODS (DEMO)', 'BOM', 'Andheri East', 'MUMBAI', 'B1002', 1, 30, 'DIV1001', '27AAADM0001A1Z1', getdate()),
       ('DMOC02', 'BHARAT AUTO PARTS (DEMO)', 'BHARAT AUTO PARTS (DEMO)', 'DEL', 'Okhla Phase 2', 'DELHI', 'B1001', 1, 45, 'DIV1001', '07AAADM0002A1Z2', getdate()),
       ('DMOC03', 'NOVA PHARMA (DEMO)', 'NOVA PHARMA (DEMO)', 'BOM', 'Thane West', 'MUMBAI', 'B1002', 1, 30, 'DIV1001', '27AAADM0003A1Z3', getdate()),
       ('DMOC04', 'APEX ELECTRONICS (DEMO)', 'APEX ELECTRONICS (DEMO)', 'DEL', 'Naraina', 'DELHI', 'B1001', 1, 30, 'DIV1001', '07AAADM0004A1Z4', getdate()),
       ('DMOC05', 'GREENLEAF TEXTILES (DEMO)', 'GREENLEAF TEXTILES (DEMO)', 'BOM', 'Bhiwandi', 'MUMBAI', 'B1002', 1, 60, 'DIV1001', '27AAADM0005A1Z5', getdate()),
       ('DMOC06', 'METRO BOOKS (DEMO)', 'METRO BOOKS (DEMO)', 'DEL', 'Daryaganj', 'DELHI', 'B1001', 1, 15, 'DIV1001', '07AAADM0006A1Z6', getdate()),
       ('DMOC07', 'COASTAL CHEMICALS (DEMO)', 'COASTAL CHEMICALS (DEMO)', 'PNQ', 'Chakan', 'PUNE', 'B1002', 1, 45, 'DIV1001', '27AAADM0007A1Z7', getdate()),
       ('DMOC08', 'EASTWIND APPARELS (DEMO)', 'EASTWIND APPARELS (DEMO)', 'CCU', 'Howrah', 'KOLKATA', 'B1003', 1, 30, 'DIV1001', '19AAADM0008A1Z8', getdate());

-- ---------------------------------------------------------------- shipment groups (one group = one manifest / challan)
select top 1500 row_number() over (order by (select null)) as n into #n from sys.all_objects a cross join sys.all_objects b;

select n as gid,
       364 - cast(floor(sqrt((abs(checksum(newid())) % 10000) / 10000.0) * 365) as int) as days_ago,   -- more business lately
       abs(checksum(newid())) % 100 as r_origin, abs(checksum(newid())) % 100 as r_dest, abs(checksum(newid())) % 100 as r_mode,
       abs(checksum(newid())) % 100 as r_stage, abs(checksum(newid())) % 100 as r_transit, abs(checksum(newid())) % 100 as r_vendor,
       abs(checksum(newid())) % 100 as r_pick, 1 + abs(checksum(newid())) % 4 as dockets
  into #g0 from #n where n <= 520;

select g.*, dateadd(day, -g.days_ago, @today) as bdate,
       case when r_origin < 45 then 'B1002' when r_origin < 85 then 'B1001' else 'B1003' end as origin,
       case when r_mode < 75 then 'RD' when r_mode < 90 then 'AI' else 'TR' end as mode
  into #g1 from #g0 g;
delete from #g1 where datename(weekday, bdate) = 'Sunday' and r_pick < 75;      -- quiet Sundays

select g.*,
       case g.origin
         when 'B1002' then case when r_dest < 55 then 'DELHI' when r_dest < 85 then 'KOLKATA' else 'DELHI' end
         when 'B1001' then case when r_dest < 55 then 'MUMBAI' when r_dest < 75 then 'PUNE' else 'KOLKATA' end
         else case when r_dest < 50 then 'DELHI' when r_dest < 90 then 'MUMBAI' else 'PUNE' end end as dest_city,
       case mode when 'AI' then 1 + r_transit % 2 when 'TR' then 3 + r_transit % 4 else 2 + r_transit % 4 end as transit,
       case mode when 'AI' then 2 when 'TR' then 4 else 3 end as promised
  into #g2 from #g1 g;

select g.*,
       case dest_city when 'DELHI' then 'B1001' when 'KOLKATA' then 'B1003' else 'B1002' end as dest,
       case when days_ago = 0 then case when r_stage < 60 then 0 else 1 end
            when days_ago < transit then case when days_ago = 1 and r_stage < 40 then 1 else 2 end
            when days_ago = transit then case when r_stage < 50 then 3 else 4 end
            when r_stage < 4 then 3 when r_stage < 7 then 4 else 5 end as stage,
       case when r_stage % 7 = 0 then 1 + r_stage % 3 else 0 end as late_days,
       case when month(dateadd(day, -days_ago, @today)) >= 4
            then concat(year(dateadd(day, -days_ago, @today)), '-', year(dateadd(day, -days_ago, @today)) + 1)
            else concat(year(dateadd(day, -days_ago, @today)) - 1, '-', year(dateadd(day, -days_ago, @today))) end as fy
  into #g from #g2 g;
-- delivered / final date: booking + transit (+ late days), never after today
alter table #g add arrive date, ddate date;
update #g set ddate = case when dateadd(day, transit + late_days, bdate) > @today then @today else dateadd(day, transit + late_days, bdate) end;
update #g set arrive = case when dateadd(day, -1, ddate) < bdate then bdate else dateadd(day, -1, ddate) end;

-- ---------------------------------------------------------------- dockets
select row_number() over (order by g.bdate, g.gid, k.n) as n, g.gid, k.n as k,
       abs(checksum(newid())) % 100 as r_client, abs(checksum(newid())) % 100 as r_ctype, abs(checksum(newid())) % 100 as r_docs,
       abs(checksum(newid())) % 100 as r_wt, abs(checksum(newid())) % 1000 as r_wt2, abs(checksum(newid())) % 100 as r_rate,
       abs(checksum(newid())) % 100 as r_cancel, abs(checksum(newid())) % 100 as r_out, abs(checksum(newid())) % 100 as r_misc,
       (abs(checksum(newid())) % 6) + (abs(checksum(newid())) % 7) + 9 as hr, abs(checksum(newid())) % 60 as mi
  into #d0 from #g g join #n k on k.n <= g.dockets;

select d.*, g.bdate, g.origin, g.dest, g.dest_city, g.mode, g.stage as gstage, g.fy, g.ddate, g.arrive, g.transit, g.promised, g.late_days,
       'DMO' + right('000000' + cast(d.n as varchar(10)), 6) as docket_no,
       case when r_ctype < 62 then 'C' else 'W' end as ctype,
       case when r_client < 28 then 'DMOC01' when r_client < 46 then 'DMOC02' when r_client < 60 then 'DMOC03' when r_client < 72 then 'DMOC04'
            when r_client < 82 then 'DMOC05' when r_client < 90 then 'DMOC06' when r_client < 96 then 'DMOC07' else 'DMOC08' end as client_code,
       case when r_docs < 22 then '1' else '2' end as docs,
       case when g.mode = 'RD' and r_misc < 6 then 'FTL' else 'PTL' end as load_type,
       case when r_cancel < 3 then 1 else 0 end as cancelled
  into #d1 from #d0 d join #g g on g.gid = d.gid;

select d.*,
       case when ctype = 'C' then 'To Be Billed' when r_misc % 10 < 6 then 'Paid' else 'To Pay' end as btype,
       cast(case when load_type = 'FTL' then 5000 + r_wt2 * 4
                 when docs = '1' then 0.5 + (r_wt2 % 25) / 10.0
                 when r_wt < 35 then 5 + r_wt2 % 15 when r_wt < 65 then 20 + r_wt2 % 60 when r_wt < 85 then 80 + r_wt2 % 170
                 when r_wt < 96 then 250 + r_wt2 % 550 else 800 + r_wt2 * 2 end as decimal(18,2)) as wt,
       cast(case mode when 'AI' then 75 + r_rate % 36 when 'TR' then 6 + r_rate % 4 else 9 + r_rate % 6 end as decimal(18,2)) as rate,
       case when cancelled = 1 then 0 else gstage end as stage,
       case when r_out < 91 then 'DLVRD' when r_out < 95 then 'UNDELIVERED' when r_out < 98 then 'RTO' else 'LOST' end as outcome
  into #d2 from #d1 d;

select d.*,
       case when docs = '1' then 1 else 1 + cast(wt / 25 as int) % 60 end as pcs,
       cast(case when load_type = 'FTL' then 25000 + r_wt2 * 20
                 when wt * rate < 150 then 150 else round(wt * rate, 0) end as decimal(18,2)) as freight,
       case when r_misc < 8 then 'ODA' else null end as oda,
       c.company_name as client_name
  into #d from #d2 d left join client_Master c on c.client_code = d.client_code;

insert into grn_master(docket_no, booking_date, ExpectedDate, booking_mode, customer_type, booking_type, delivery_mode, LoadType, DocsNoneDocs,
  origin_branch, destination, destination_branch, ODA_Location, on_account_of, billing_at, gstPaidBy, consigner_code, consigner_name, consigner_city,
  consignee_name, consignee_city, user_id, DivCode, Financial_Year, created_date, manifest_status, Arrived_status, drs_status, Division, created_by,
  IsCancel, CancelRemark, DocketStatus, current_branch, Invoice_status)
select docket_no, bdate, convert(varchar(10), dateadd(day, promised, bdate), 23), mode,
       case ctype when 'C' then 'Contractual Client' else 'Walk-in' end, btype, 'DM-101', load_type, docs, origin, dest_city, dest, oda,
       case ctype when 'C' then client_name + ':' + client_code else '' end, case ctype when 'C' then origin else '' end,
       case r_misc % 10 when 0 then 'Consignee' when 1 then 'Consignee' when 2 then 'Consignor' when 3 then 'Consignor' else 'Transporter' end,
       case ctype when 'C' then client_code else '' end,
       case ctype when 'C' then client_name else concat('WALK-IN CUSTOMER ', 1 + r_client % 15, ' (DEMO)') end,
       case origin when 'B1001' then 'DELHI' when 'B1002' then 'MUMBAI' else 'KOLKATA' end,
       concat('CONSIGNEE ', 1 + r_out % 40, ' (DEMO)'), dest_city, 'EMP001', 'DIV1001', fy,
       dateadd(minute, mi, dateadd(hour, hr, cast(bdate as datetime))),
       case when stage >= 1 then 'generated' end, case when stage >= 3 then 'Arrived' end, case when stage >= 4 then 'generated' end,
       'DIV1001', 'EMP001', cast(cancelled as varchar(1)), case when cancelled = 1 then 'Wrong booking (demo)' end,
       case stage when 1 then 'MANIFEST GENERATED' when 2 then 'CHALLAN GENERATED' when 3 then 'ARRIVED' when 4 then 'OUT FOR DELIVERY'
                  when 5 then case outcome when 'DLVRD' then 'DELIVERED' else outcome end else 'DOCKET AVAILABLE FOR PRS CHALLAN' end,
       case when stage >= 3 then dest else origin end, null
  from #d;

insert into grn_docket_charge(Docket_No, freight_type, rate_on, pcs, actual_weight, charge_weight, freight, docket_charge, other_charge, service_tax,
  charges, docket_rate, FtlRate, CGST_Tax, CGST_Amt, SGST_Tax, SGST_Amt, Basefrt, branch, Financial_Year)
select docket_no, 'SUNDRY', 'WEIGHT', pcs, wt, wt, case when load_type = 'FTL' then 0 else freight end, 50, 0, round(freight * 0.12, 2),
       round(freight * 1.12 + 50, 2), rate, case when load_type = 'FTL' then freight else 0 end, 6, round(freight * 0.06, 2), 6, round(freight * 0.06, 2),
       freight, origin, fy
  from #d;

insert into docket_other_charges(docket, risk_charge, handling_charge, oda, collection_charges, fov)
select docket_no, 0, case when wt > 100 then 50 else 0 end, case when oda is not null then 300 else 0 end, case when btype = 'To Pay' then 30 else 0 end,
       round(freight * 0.002, 2)
  from #d;

insert into docket_tracking(docket_no, Operation, Status, EntryDate, UserLog, Origin, Destination)
select docket_no, 'BOOKING', 'BOOKED', bdate, 'EMP001', origin, dest from #d;

-- ---------------------------------------------------------------- pickups (some groups were picked up from the consignor)
insert into Pick_up_entry(pickup_no, pickup_date, pickup_time, from_branch, user_id, Financial_Year, PickUpBy, PickUpByNo, Division, DockNonDock, IsCancelled, Location)
select 'DMOPK' + right('00000' + cast(gid as varchar(10)), 5), bdate, '10:30', origin, 'EMP001', fy, 'Employee', 'EMP001', 'DIV1001', 'D', '0', origin
  from #g where r_pick < 35 and origin <> 'B1003';
insert into Pick_Up_grn(docket_no, freight, package, weight, Pickup_no, Location_Code, Financial_Year, Division, IsArrival)
select d.docket_no, d.freight, d.pcs, d.wt, 'DMOPK' + right('00000' + cast(d.gid as varchar(10)), 5), d.origin, d.fy, 'DIV1001', 1
  from #d d join #g g on g.gid = d.gid where g.r_pick < 35 and g.origin <> 'B1003' and d.cancelled = 0;

-- ---------------------------------------------------------------- manifests, challans, arrivals
select g.gid, g.bdate, g.origin, g.dest, g.dest_city, g.mode, g.stage, g.fy, g.arrive, g.ddate, g.r_vendor,
       'DMOMF' + right('00000' + cast(g.gid as varchar(10)), 5) as mf, 'DMOCH' + right('00000' + cast(g.gid as varchar(10)), 5) as ch,
       'DMOAR' + right('00000' + cast(g.gid as varchar(10)), 5) as ar, 'DMODRS' + right('00000' + cast(g.gid as varchar(10)), 5) as drs,
       sum(d.wt) as wt, sum(d.freight) as freight, sum(d.pcs) as pcs, max(case when d.load_type = 'FTL' then 1 else 0 end) as ftl,
       string_agg(cast(d.docket_no as varchar(max)), ',') as list
  into #m from #g g join #d d on d.gid = g.gid and d.cancelled = 0
 where g.stage >= 1
 group by g.gid, g.bdate, g.origin, g.dest, g.dest_city, g.mode, g.stage, g.fy, g.arrive, g.ddate, g.r_vendor;

insert into mainfest_entry(mainfest_no, mainfest_date, mainfest_time, from_branch, to_branch, To_City, docat_list, user_id, div_code, freight_type, Financial_Year,
  ShortCode, Loadtype, dest_type, challan_no, Dispatch_Status, Arrived_status, IsCancelled)
select mf, bdate, '18:00', origin, dest, dest_city, list, 'EMP001', 'DIV1001', 'SUNDRY', fy, 'DMO', case ftl when 1 then 'FTL' else 'PTL' end, 'BRANCH',
       case when stage >= 2 then ch end, case when stage >= 2 then 'Dispatched' end, case when stage >= 3 then 'Arrived' end, '0'
  from #m;
insert into Manifest_grn(docket_no, freight, package, weight, Manifest_no, Financial_Year, div_code, challan_no, Dispatch_Status, Arrival_status, Pending_Arrival)
select d.docket_no, d.freight, d.pcs, d.wt, m.mf, d.fy, 'DIV1001', case when m.stage >= 2 then m.ch end, case when m.stage >= 2 then 'Dispatched' end,
       case when m.stage >= 3 then 'Arrived' end, case when m.stage >= 3 then 0 else d.pcs end
  from #m m join #d d on d.gid = m.gid and d.cancelled = 0;

insert into dispatch_master(challan_no, Financial_Year, IsCancelled, mode_code, vendor_type, vendor_code, challan_date, challan_time, from_branch, tobcode, to_city,
  dest_type, frt_type, truck_no, capacity, drivername, manifest_no, total_weight, total_freight, advance, bal_amount, hire_charge, Labour_Charge, dispatch_type,
  status, user_id, div_code, ShortCode, arrival_status, IsVerified)
select ch, fy, '0', mode,
       case when r_vendor < 55 then 'Vendor' when r_vendor < 80 then 'Self' else 'Market Vendor' end,
       case when r_vendor < 55 then 'V001' when r_vendor < 80 then 'V002' else 'VT001' end,
       bdate, '21:00', origin, dest, dest_city, 'BRANCH', 'SUNDRY',
       case r_vendor % 4 when 0 then 'DL01AB1234' when 1 then 'MH04CD5678' when 2 then 'HR55X1234' else 'WB02EF9012' end,
       case when ftl = 1 then '16000' else '9000' end, concat('DRIVER ', 1 + r_vendor % 12, ' (DEMO)'), mf, wt,
       round(case when ftl = 1 then freight * 0.72 else 2500 + wt * 2.2 end, 0),
       round(case when ftl = 1 then freight * 0.72 else 2500 + wt * 2.2 end * 0.4, 0),
       round(case when ftl = 1 then freight * 0.72 else 2500 + wt * 2.2 end * 0.6, 0),
       round(case when ftl = 1 then freight * 0.72 else 2500 + wt * 2.2 end, 0), case when wt > 500 then 400 else 150 end, 'DIRECT',
       'Active', 'EMP001', 'DIV1001', 'DMO', case when stage >= 3 then 'Arrived' end, case when stage = 5 and r_vendor % 3 = 0 then 1 else 0 end
  from #m where stage >= 2;

insert into Arrival_entry(ArrivalNo, challan_no, Receive_Date, Receive_time, Manifest_no, user_id, from_branch, Financial_Year, ShortCode, actualwt, inwardwt, diffwt,
  div_code, IsCancelled)
select ar, ch, arrive, '07:30', mf, 'EMP001', dest, fy, 'DMO', wt, wt - case when r_vendor % 9 = 0 then 5 else 0 end, case when r_vendor % 9 = 0 then 5 else 0 end,
       'DIV1001', '0'
  from #m where stage >= 3;
insert into Arrival_Packg(ArrivalNo, docket_no, challan_no, manifest_no, freight, package, weight, pending_freight, pending_package, pending_weight, from_branch,
  Financial_Year, IsExcessArrival, drs_no, IsCancelled)
select m.ar, d.docket_no, m.ch, m.mf, d.freight, d.pcs, d.wt, 0, 0, 0, m.dest, d.fy, 0, case when m.stage >= 4 then m.drs end, 0
  from #m m join #d d on d.gid = m.gid and d.cancelled = 0 where m.stage >= 3;

-- ---------------------------------------------------------------- DRS, delivery status, POD
insert into drs_entry_details(Drs_no, Drs_date, Drs_time, from_branch, docket_no, Vehicle_No, Driver_Name, DelBy, DelByNo, Financial_Year, Division, IsCancelled,
  Drs_delivery_status_Entry, DRSType, ShortCode)
select m.drs, m.ddate, '09:30', m.dest, left(m.list, 9), concat('DEMO-VAN-', 1 + m.r_vendor % 5), concat('DELIVERY BOY ', 1 + m.r_vendor % 8, ' (DEMO)'), 'Employee',
       'EMP001', m.fy, 'DIV1001', 0, case when m.stage = 5 then 'Done' end, 'BRANCH', 'DMO'
  from #m m where m.stage >= 4;
insert into drs_entry_details_grn(docket_no, freight, weight, packg, Drs_no, Location, Financial_Year, division, pending_Package, pending_freight, pending_weight,
  challan_no, isCancel, Drs_delivery_status_Entry)
select d.docket_no, d.freight, d.wt, d.pcs, m.drs, m.dest, d.fy, 'DIV1001', 0, 0, 0, m.ch, 0, case when m.stage = 5 then 'Done' end
  from #m m join #d d on d.gid = m.gid and d.cancelled = 0 where m.stage >= 4;

insert into delivery_status_entry_details(docket_no, pkt_status, IsCancelled, drs_no, Financial_Year, rcv_date, rcv_time, rcvr_name, rcvr_phone, remarks, UserId,
  Division, from_branch, created_at)
select d.docket_no, d.outcome, 0, m.drs, d.fy, cast(m.ddate as datetime), '15:00',
       case when d.outcome = 'DLVRD' then concat('RECEIVER ', 1 + d.r_out % 30) end, case when d.outcome = 'DLVRD' then '9800000000' end,
       case d.outcome when 'DLVRD' then null when 'UNDELIVERED' then case d.r_misc % 4 when 0 then 'Consignee not available' when 1 then 'Address incomplete'
            when 2 then 'Door locked' else 'Refused to accept' end when 'RTO' then 'Return to origin on consignor request' else 'Shortage - not traced' end,
       'EMP001', 'DIV1001', m.dest, cast(m.ddate as datetime)
  from #m m join #d d on d.gid = m.gid and d.cancelled = 0 where m.stage = 5;
insert into delivery_status_entry_grn(drs_no, docket_no, total_freight, total_weight, toatal_packg, from_branch, Division, Financial_Year, IsCancelled, created_at)
select m.drs, d.docket_no, d.freight, d.wt, d.pcs, m.dest, 'DIV1001', d.fy, 0, cast(m.ddate as datetime)
  from #m m join #d d on d.gid = m.gid and d.cancelled = 0 where m.stage = 5;

insert into pod_dispatch(IOM_number, branch_code, docket_no, Iom_date, remarks, From_Branch, user_id, Division, Financial_Year, IsCancelled, created_at, Dispatch)
select 'DMOIOM' + right('00000' + cast(m.gid as varchar(10)), 5), 'B1001', d.docket_no, dateadd(day, 3, m.ddate), 'POD to head office (demo)', m.dest, 'EMP001',
       'DIV1001', d.fy, 0, dateadd(day, 3, m.ddate), 'Yes'
  from #m m join #d d on d.gid = m.gid and d.cancelled = 0
 where m.stage = 5 and d.outcome = 'DLVRD' and m.ddate <= dateadd(day, -4, @today) and d.r_misc % 10 < 8;
insert into pod_received(IOM_number, docket_no, Receive_date, Remark, user_id, IsCancelled, LastUpdate, DivCode, Financial_Year)
select 'DMOIOM' + right('00000' + cast(m.gid as varchar(10)), 5), d.docket_no, dateadd(day, 6 + d.r_out % 8, m.ddate), 'POD received (demo)', 'EMP001', '0', getdate(),
       'DIV1001', d.fy
  from #m m join #d d on d.gid = m.gid and d.cancelled = 0
 where m.stage = 5 and d.outcome = 'DLVRD' and dateadd(day, 6 + d.r_out % 8, m.ddate) <= @today and d.r_misc % 10 < 7;
update c set PODRCV_status = 'Received', pod_dispatch = 'Dispatched'
  from grn_docket_charge c join pod_received p on p.docket_no = c.Docket_No where p.IOM_number like 'DMOIOM%';

-- ---------------------------------------------------------------- client bills (monthly, To Be Billed, delivered, before this month)
select row_number() over (order by mon, d.client_code) as bn, d.client_code, d.mon, sum(d.freight) as freight, count(*) as dockets,
       string_agg(cast(d.docket_no as varchar(max)), ',') as list, min(d.fy) as fy, min(c.client_Id) as client_Id, min(c.Branch_Code) as branch,
       min(c.credit_period) as credit, abs(checksum(newid())) % 100 as r_pay, abs(checksum(newid())) % 7 as r_day
  into #b0
  from (select *, datefromparts(year(bdate), month(bdate), 1) as mon from #d where ctype = 'C' and cancelled = 0 and stage = 5 and outcome = 'DLVRD') d
  join client_Master c on c.client_code = d.client_code
 where d.mon < datefromparts(year(@today), month(@today), 1)
 group by d.client_code, d.mon;
select b.*, 'DMOBL' + right('00000' + cast(bn as varchar(10)), 5) as bill_no, dateadd(day, 2 + r_day, eomonth(mon)) as bill_date,
       datediff(month, mon, @today) as age_m, round(freight * 0.18, 2) as tax, round(freight * 1.18, 2) as total
  into #b from #b0 b where dateadd(day, 2 + r_day, eomonth(mon)) <= @today;
update #b set fy = case when month(bill_date) >= 4 then concat(year(bill_date), '-', year(bill_date) + 1) else concat(year(bill_date) - 1, '-', year(bill_date)) end;

insert into client_bill(bill_no, bill_date, DueDate, client_Id, client_code, docket_no, totalfreight, Total_docket_charge, Total_other_charge, totalstax, TotCGST,
  TotSGST, TotIGST, TotAfterTax, totalamount, booking_mode, origin_branch, Financial_Year, user_id, ShortCode, division, BillType, FromDate, ToDate, SacCode,
  ServiceType, ClientBill_Summation_status, Summation_date, RcvName, ClientBill_Finalize_status, ClientBill_Finalize_date, Payment_Status, Bill_Type, created_date)
select bill_no, bill_date, dateadd(day, credit, bill_date), client_Id, client_code, list, freight, 0, 0, tax, case when left(client_code, 6) in ('DMOC08') then 0 else tax / 2 end,
       case when client_code = 'DMOC08' then 0 else tax / 2 end, case when client_code = 'DMOC08' then tax else 0 end, total, total, 'RD', branch, fy, 'EMP001', 'DMO',
       'DIV1001', 1, mon, eomonth(mon), '996511', 'GTA',
       case when age_m >= 2 or r_pay < 70 then 'Active' end, case when age_m >= 2 or r_pay < 70 then dateadd(day, 3, bill_date) end,
       case when age_m >= 2 or r_pay < 70 then 'ACCOUNTS (DEMO)' end,
       case when age_m >= 2 or r_pay < 40 then 'Finalized' end, case when age_m >= 2 or r_pay < 40 then dateadd(day, 5, bill_date) end,
       case when (age_m >= 4 and r_pay < 92) or (age_m in (2, 3) and r_pay < 55) then 1 else 0 end, 'To Be Billed', dateadd(day, 2, bill_date)
  from #b;
insert into client_bill_charge_details(bill_no, docket_no, amount, booking_date, package, weight, rate, RateOn, freight_charges, docket_charge, other_charges,
  CGST_Tax, CGST_Amt, SGST_Tax, SGST_Amt, IGST_Tax, IGST_Amt, after_tax, grand_total, Taxtype)
select b.bill_no, d.docket_no, d.freight, d.bdate, d.pcs, d.wt, d.rate, 'WEIGHT', d.freight, 0, 0, 9, round(d.freight * 0.09, 2), 9, round(d.freight * 0.09, 2),
       0, 0, round(d.freight * 1.18, 2), round(d.freight * 1.18, 2), 'GST'
  from #b b join #d d on d.client_code = b.client_code and datefromparts(year(d.bdate), month(d.bdate), 1) = b.mon
 where d.ctype = 'C' and d.cancelled = 0 and d.stage = 5 and d.outcome = 'DLVRD';
update g set Invoice_status = 'invoicegenerated', bill_no = c.bill_no
  from grn_master g join client_bill_charge_details c on c.docket_no = g.docket_no where c.bill_no like 'DMOBL%';

-- receipts: full for paid bills, part for some finalized ones
select row_number() over (order by b.bill_date, b.bill_no) as rn, b.*,
       case when b.r_pay % 3 = 0 then 'Cash' when b.r_pay % 3 = 1 then 'Cheque' else 'NEFT' end as pmode,
       case when b.age_m >= 4 and b.r_pay < 92 or b.age_m in (2, 3) and b.r_pay < 55 then 1 else 0 end as full_pay
  into #r from #b b where (b.age_m >= 4 and b.r_pay < 92) or (b.age_m in (2, 3) and b.r_pay < 75) or (b.age_m = 1 and b.r_pay < 15);
insert into Bill_Receive(BR_No, Receive_Date, Client_Code, client_Id, Receive_mode, CashLedger, BankLedger, Paymentmode, ChequeNo, Receive_Amount, TDS, Deduction,
  RoundedAmt, OtherIncome, Remarks, Narration, Branch, Financial_Year, Division, User_id, ShortCode, IsCancelled, Created_Date)
select 'DMOBR' + right('00000' + cast(rn as varchar(10)), 5),
       case when dateadd(day, 10 + r_pay % 40, bill_date) > @today then @today else dateadd(day, 10 + r_pay % 40, bill_date) end,
       client_code, client_Id, case pmode when 'Cash' then 'Cash' else 'Bank' end, case pmode when 'Cash' then (select top 1 LedgerCode from tblAccountLedger where LedgerName = 'CASH MUMBAI' and Financial_Year = #r.fy) end,
       case pmode when 'Cash' then null else (select top 1 LedgerCode from tblAccountLedger where LedgerName = 'HDFC BANK CURRENT A/C' and Financial_Year = #r.fy) end, pmode, case pmode when 'Cheque' then concat('00', 4000 + rn) end,
       case full_pay when 1 then round(total - freight * 0.02, 2) else round(total * 0.5, 2) end, case full_pay when 1 then round(freight * 0.02, 2) else 0 end,
       0, 0, 0, 'Demo receipt', 'Demo receipt', branch, fy, 'DIV1001', 'EMP001', 'DMO', 0, getdate()
  from #r;
insert into Bill_Receive_Details(BR_No, Bill_no, Bill_Amount, Received, TDS, Deduction, RoundedAmt, Settled, IsCancelled)
select 'DMOBR' + right('00000' + cast(rn as varchar(10)), 5), bill_no, total,
       case full_pay when 1 then round(total - freight * 0.02, 2) else round(total * 0.5, 2) end, case full_pay when 1 then round(freight * 0.02, 2) else 0 end,
       0, 0, case full_pay when 1 then total else round(total * 0.5, 2) end, 0
  from #r;

-- ---------------------------------------------------------------- miscellaneous / warehouse bills (a few a month)
select row_number() over (order by m.n, c.client_code) as rn, datefromparts(year(dateadd(month, -m.n, @today)), month(dateadd(month, -m.n, @today)), 1) as mon,
       c.client_code, c.client_Id, c.company_name, c.Branch_Code, abs(checksum(newid())) % 100 as r
  into #o from #n m cross join client_Master c where m.n between 1 and 11 and c.client_code in ('DMOC01', 'DMOC03', 'DMOC05', 'DMOC07');
delete from #o where r >= 55;
insert into miscellaneous_bill(Bill_No, BillDate, DueDate, MonthName, YearName, client_Id, client_Code, cust_name, ServiceType, ServiceFor, SAC, TaxModeFor, TaxType,
  Quantity, Rate, TaxableAmt, CGST, CGSTAmt, SGST, SGSTAmt, IGST, IGSTAmt, TotalAmount, remarks, UserId, CreatBranch, Financial_Year, Division, ShortCode,
  Summation_status, Finalize_status)
select 'DMOMIS' + right('0000' + cast(rn as varchar(10)), 4), eomonth(mon), dateadd(day, 30, eomonth(mon)), datename(month, mon), cast(year(mon) as varchar(4)),
       client_Id, client_code, company_name, 'GTA', 'Others', '996511', 'GST 18%', 'Intrastate', 1, 2000 + r * 40, 2000 + r * 40, 9, round((2000 + r * 40) * 0.09, 2), 9,
       round((2000 + r * 40) * 0.09, 2), 0, 0, round((2000 + r * 40) * 1.18, 2), 'Demo detention / loading charges', 'EMP001', Branch_Code,
       case when month(mon) >= 4 then concat(year(mon), '-', year(mon) + 1) else concat(year(mon) - 1, '-', year(mon)) end, 'DIV1001', 'DMO',
       'Active', case when r < 40 then 'Finalized' end
  from #o where r % 2 = 0;
insert into warehouse_bill(Bill_No, BillDate, DueDate, MonthName, YearName, client_Id, client_Code, cust_name, ServiceType, ServiceFor, SAC, TaxModeFor, TaxType,
  Quantity, Rate, TaxableAmt, CGST, CGSTAmt, SGST, SGSTAmt, IGST, IGSTAmt, TotalAmount, remarks, UserId, CreatBranch, Financial_Year, Division, ShortCode,
  Summation_status, Finalize_status)
select 'DMOWHO' + right('0000' + cast(rn as varchar(10)), 4), eomonth(mon), dateadd(day, 30, eomonth(mon)), datename(month, mon), cast(year(mon) as varchar(4)),
       client_Id, client_code, company_name, 'GTA', 'Others', '997212', 'GST 18%', 'Intrastate', 30, 150 + r * 3, 30 * (150 + r * 3), 9, round(30 * (150 + r * 3) * 0.09, 2), 9,
       round(30 * (150 + r * 3) * 0.09, 2), 0, 0, round(30 * (150 + r * 3) * 1.18, 2), 'Demo warehouse rent', 'EMP001', Branch_Code,
       case when month(mon) >= 4 then concat(year(mon), '-', year(mon) + 1) else concat(year(mon) - 1, '-', year(mon)) end, 'DIV1001', 'DMO',
       'Active', case when r < 45 then 'Finalized' end
  from #o where r % 2 = 1;

-- ---------------------------------------------------------------- other vendor invoices, vendor bill verification, franchisee invoices
select row_number() over (order by m.n, v.k) as rn, dateadd(day, -(m.n * 30 + v.k * 7), @today) as d, v.k, abs(checksum(newid())) % 100 as r
  into #v from #n m cross join (values (1), (2), (3)) v(k) where m.n between 0 and 11;
delete from #v where d < dateadd(day, -364, @today);
insert into OtherVendorInvoice(InvoiceNo, InvoiceDate, InvoiceFor, PartsType, VendorCode, VendorLedger, VendorInvNo, PurchaseDate, ExpenseLedger, TaxType, Qty, TaxableAmt,
  CGSTAmt, SGSTAmt, IGSTAmt, BillAmt, TDS, TotTDS, AfterTDSAmt, Narration, Branch_Code, ShortCode, Financial_Year, Division, UserId, IsCancelled)
select 'DMOOTH' + right('0000' + cast(rn as varchar(10)), 4), d, 'Bill Entry(Other Vendors)', case when k = 2 then 'Pay Bill' else 'Purchase' end,
       case when k = 2 then 'OV002' else 'OV001' end,
       (select top 1 LedgerCode from tblAccountLedger where LedgerName = case when k = 2 then 'CITY ELECTRICALS:OV002' else 'SHARMA STATIONERY:OV001' end),
       concat('DEMO/', rn), d,
       (select top 1 LedgerCode from tblAccountLedger where LedgerName = case k when 1 then 'PRINTING & STATIONERY' when 2 then 'REPAIR & MAINTENANCE' else 'OFFICE EXPENSES' end),
       'GST', 1 + r % 10, 1000 + r * 60, round((1000 + r * 60) * 0.09, 2), round((1000 + r * 60) * 0.09, 2), 0, round((1000 + r * 60) * 1.18, 2),
       case when k = 2 then 0 else 2 end, case when k = 2 then 0 else round((1000 + r * 60) * 0.02, 2) end,
       round((1000 + r * 60) * case when k = 2 then 1.18 else 1.16 end, 2), 'Demo vendor invoice', case when r % 2 = 0 then 'B1001' else 'B1002' end, 'DMO',
       case when month(d) >= 4 then concat(year(d), '-', year(d) + 1) else concat(year(d) - 1, '-', year(d)) end, 'DIV1001', 'EMP001', 0
  from #v;

insert into Vendor_Invoice_Verify(Vendor_Receipt_Code, Vendor_Code, Vendor_Mode, Vendor_Bill_No, Vendor_Ref_No, Vendor_Bill_Date, Bill_Amount, Deduction, Narration,
  Challan_amount, Balance_Amount, verify_status, challan_type, Branch_Code, ShortCode, Financial_Year, division, user_id, IsCancelled)
select 'DMOVIV' + right('0000' + cast(row_number() over (order by min(challan_date)) as varchar(10)), 4), vendor_code, 'RD',
       'DMOVB' + right('0000' + cast(row_number() over (order by min(challan_date)) as varchar(10)), 4), 'SR/DEMO', max(challan_date) , sum(bal_amount), 0,
       'Demo vendor bill', sum(bal_amount), 0, 1, 1, from_branch, 'DMO', min(Financial_Year), 'DIV1001', 'EMP001', 0
  from dispatch_master where challan_no like 'DMOCH%' and IsVerified = 1
 group by vendor_code, from_branch, datefromparts(year(challan_date), month(challan_date), 1);
insert into Vendor_Invoice_Verify_Details(Vendor_Bill_No, challan_no, vehicle_freight, advance, CurrentPayment, Balance_Amount, CurrentPaymentDate, IsCancelled)
select h.Vendor_Bill_No, c.challan_no, c.total_freight, c.advance, c.bal_amount, 0, h.Vendor_Bill_Date, 0
  from Vendor_Invoice_Verify h join dispatch_master c on c.vendor_code = h.Vendor_Code and c.from_branch = h.Branch_Code and c.IsVerified = 1
   and datefromparts(year(c.challan_date), month(c.challan_date), 1) = datefromparts(year(h.Vendor_Bill_Date), month(h.Vendor_Bill_Date), 1)
 where h.Vendor_Bill_No like 'DMOVB%' and c.challan_no like 'DMOCH%';

select row_number() over (order by mon) as rn, mon, sum(case when d.r_misc % 10 < 9 then round(d.freight * 0.1, 2) else 0 end) as comm, count(*) as dockets,
       string_agg(cast(d.docket_no as varchar(max)), ',') as list
  into #f from (select *, datefromparts(year(bdate), month(bdate), 1) as mon from #d where origin = 'B1003' and cancelled = 0) d
 where mon < datefromparts(year(@today), month(@today), 1)
 group by mon;
insert into Franchisee_Invoice(F_Invoice_No, Fran_Code, Fran_Branch, Branch_Code, Invoice_Date, From_Date, To_Date, Month, Rent, Mobile_Bills, Signage, Commission_Total,
  Handling_Total, Collection_Total, Gross_Amount, TDS_Percent, TDS_Amount, Net_Amount, Remarks, Financial_Year, Division, ShortCode, Created_By, IsCancel)
select 'DMOFINV' + right('000' + cast(rn as varchar(10)), 3), 'FRS1001', 'B1003', 'B1001', dateadd(day, 5, eomonth(mon)), mon, eomonth(mon), convert(varchar(7), mon, 120),
       8000, 500, 300, comm, 0, 0, comm + 8800, 5, round((comm + 8800) * 0.05, 2), round((comm + 8800) * 0.95, 2), 'Demo franchisee invoice',
       case when month(mon) >= 4 then concat(year(mon), '-', year(mon) + 1) else concat(year(mon) - 1, '-', year(mon)) end, 'DIV1001', 'DMO', 'EMP001', 0
  from #f where dateadd(day, 5, eomonth(mon)) <= @today;
insert into Franchisee_Invoice_Detail(F_Invoice_No, Docket_No, Booking_Date, Booking_Type, Booking_Mode, Origin_Branch_Code, Destination_Branch_Code, Packet, Weight,
  Basic_Freight, Franchisee_Rate, Commaission_Type, Franchisee_Amount, Handling_Charge_Rate, Handling_Charge_Amount, Collection_Charge, Total_Amount, Created_By)
select 'DMOFINV' + right('000' + cast(f.rn as varchar(10)), 3), d.docket_no, d.bdate, d.btype, d.mode, d.origin, d.dest, d.pcs, d.wt, d.freight, 10,
       'LTL up to 3 tons %', round(d.freight * 0.1, 2), 0, 0, 0, round(d.freight * 0.1, 2), 'EMP001'
  from #f f join #d d on d.origin = 'B1003' and d.cancelled = 0 and datefromparts(year(d.bdate), month(d.bdate), 1) = f.mon and d.r_misc % 10 < 9
 where dateadd(day, 5, eomonth(f.mon)) <= @today;
update g set Franchisee_Invoice_Status = 'Generated', Franchisee_Invoice_No = fd.F_Invoice_No
  from grn_master g join Franchisee_Invoice_Detail fd on fd.Docket_No = g.docket_no where fd.F_Invoice_No like 'DMOFINV%';

-- ---------------------------------------------------------------- vouchers (accounts)
declare @billed varchar(30) = (select top 1 LedgerCode from tblAccountLedger where LedgerName like '%:BILLED' order by LedgerCode);
declare @unbilled varchar(30) = (select top 1 LedgerCode from tblAccountLedger where LedgerName like '%:UNBILLED' order by LedgerCode);
declare @cash varchar(30) = (select top 1 LedgerCode from tblAccountLedger where LedgerName = 'CASH MUMBAI' order by LedgerCode desc);
declare @bank varchar(30) = (select top 1 LedgerCode from tblAccountLedger where LedgerName = 'HDFC BANK CURRENT A/C' order by LedgerCode desc);
declare @tdsr varchar(30) = (select top 1 LedgerCode from tblAccountLedger where LedgerName = 'TDS Receivable' order by LedgerCode desc);
insert into tblAccountTrasaction(LedgerCode, Dr, Cr, CreatedDate, VoucherNo, Mode, Entry, Financial_Year, Division, IsCancelled)
select @billed, totalamount, 0, ClientBill_Finalize_date, bill_no, 'Bill Finalized', 'Ledger', Financial_Year, 'DIV1001', 0
  from client_bill where bill_no like 'DMOBL%' and ClientBill_Finalize_status = 'Finalized'
union all
select @unbilled, 0, totalamount, ClientBill_Finalize_date, bill_no, 'Bill Finalized', 'Ledger', Financial_Year, 'DIV1001', 0
  from client_bill where bill_no like 'DMOBL%' and ClientBill_Finalize_status = 'Finalized'
union all
select case Receive_mode when 'Cash' then @cash else @bank end, Receive_Amount, 0, Receive_Date, BR_No, 'BILL RECEIVE', 'Ledger', Financial_Year, 'DIV1001', 0
  from Bill_Receive where BR_No like 'DMOBR%'
union all
select @tdsr, TDS, 0, Receive_Date, BR_No, 'BILL RECEIVE', 'Ledger', Financial_Year, 'DIV1001', 0 from Bill_Receive where BR_No like 'DMOBR%' and TDS > 0
union all
select @billed, 0, Receive_Amount + TDS, Receive_Date, BR_No, 'BILL RECEIVE', 'Ledger', Financial_Year, 'DIV1001', 0 from Bill_Receive where BR_No like 'DMOBR%'
union all
select ExpenseLedger, TaxableAmt, 0, InvoiceDate, InvoiceNo, 'PURCHASE/PAYBILL', 'Ledger', Financial_Year, 'DIV1001', 0 from OtherVendorInvoice where InvoiceNo like 'DMOOTH%'
union all
select VendorLedger, 0, TaxableAmt - TotTDS, InvoiceDate, InvoiceNo, 'PURCHASE/PAYBILL', 'Ledger', Financial_Year, 'DIV1001', 0 from OtherVendorInvoice where InvoiceNo like 'DMOOTH%'
union all
select (select top 1 LedgerCode from tblAccountLedger where LedgerName = 'TDS PAYABLE 194C'), 0, TotTDS, InvoiceDate, InvoiceNo, 'PURCHASE/PAYBILL', 'Ledger',
       Financial_Year, 'DIV1001', 0 from OtherVendorInvoice where InvoiceNo like 'DMOOTH%' and TotTDS > 0;

commit;

select (select count(*) from grn_master where docket_no like 'DMO%') as dockets, (select count(*) from mainfest_entry where mainfest_no like 'DMOMF%') as manifests,
       (select count(*) from dispatch_master where challan_no like 'DMOCH%') as challans, (select count(*) from client_bill where bill_no like 'DMOBL%') as bills,
       (select count(*) from Bill_Receive where BR_No like 'DMOBR%') as receipts, (select count(*) from tblAccountTrasaction where VoucherNo like 'DMO%') as voucher_lines;
