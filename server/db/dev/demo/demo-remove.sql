-- DEV-ONLY: removes everything demo-data.sql loaded (all rows tagged DMO…). Safe to run twice.
set nocount on;
set xact_abort on;
if db_name() not like '%[_]dev' and db_name() not like '%[_]test'
begin raiserror('Demo data is only for a *_dev or *_test database', 16, 1); return; end
begin transaction;
delete from tblAccountTrasaction where VoucherNo like 'DMO%';
delete from Franchisee_Invoice_Detail where F_Invoice_No like 'DMOFINV%';
delete from Franchisee_Invoice where F_Invoice_No like 'DMOFINV%';
delete from Vendor_Invoice_Verify_Details where Vendor_Bill_No like 'DMOVB%';
delete from Vendor_Invoice_Verify where Vendor_Bill_No like 'DMOVB%';
delete from OtherVendorInvoice where InvoiceNo like 'DMOOTH%';
delete from miscellaneous_bill where Bill_No like 'DMOMIS%';
delete from warehouse_bill where Bill_No like 'DMOWHO%';
delete from Bill_Receive_Details where BR_No like 'DMOBR%';
delete from Bill_Receive where BR_No like 'DMOBR%';
delete from client_bill_charge_details where bill_no like 'DMOBL%';
delete from client_bill where bill_no like 'DMOBL%';
delete from pod_received where IOM_number like 'DMOIOM%';
delete from pod_dispatch where IOM_number like 'DMOIOM%';
delete from delivery_status_entry_grn where docket_no like 'DMO%';
delete from delivery_status_entry_details where docket_no like 'DMO%';
delete from drs_entry_details_grn where Drs_no like 'DMODRS%';
delete from drs_entry_details where Drs_no like 'DMODRS%';
delete from Arrival_Packg where ArrivalNo like 'DMOAR%';
delete from Arrival_entry where ArrivalNo like 'DMOAR%';
delete from dispatch_master where challan_no like 'DMOCH%';
delete from Manifest_grn where Manifest_no like 'DMOMF%';
delete from mainfest_entry where mainfest_no like 'DMOMF%';
delete from Pick_Up_grn where Pickup_no like 'DMOPK%';
delete from Pick_up_entry where pickup_no like 'DMOPK%';
delete from docket_tracking where docket_no like 'DMO%';
delete from docket_other_charges where docket like 'DMO%';
delete from grn_docket_charge where Docket_No like 'DMO%';
delete from grn_master where docket_no like 'DMO%';
delete from client_Master where client_code like 'DMOC%';
commit;
print 'Demo data removed';
