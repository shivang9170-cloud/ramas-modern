-- =============================================================================
-- DEV-ONLY: vehicle master (Master/Vechile_Master.aspx, View_Vechile_Master.aspx) columns and stand-in procedures.
-- Procedure names come from the deployed bin/ClassLibrary.dll (usp_Insert_Vechile, usp_Update_Vechile);
-- parameter names are the DLL's strings — see docs/SCHEMA-VERIFICATION.md.
-- =============================================================================

alter table Vechile_Master add
  ContainerSize varchar(50), Vechile_Status varchar(20) default 'Active', OwnerName varchar(100), VehicelType varchar(20),
  VenderType varchar(20), Created_Branch varchar(20), Home_Branch varchar(20), Created_By varchar(50), Created_Date datetime default getdate(),
  veh_route varchar(20), veh_route_1 varchar(20), veh_route_2 varchar(20), veh_route_3 varchar(20), veh_route_4 varchar(20),
  veh_route_5 varchar(20), veh_route_6 varchar(20), veh_route_7 varchar(20), veh_route_8 varchar(20), veh_route_9 varchar(20),
  tank_capacity varchar(10), fuel_type varchar(20), VehicleName_id_fk int, division varchar(20), AMC varchar(20),
  DealerName varchar(100), Address varchar(500), Date_Of_Purchase date, InvoiceNo varchar(50), InvoiceValue decimal(18,2),
  DealMaturityAmount decimal(18,2), Transcode varchar(20), currentloc varchar(20), Edit_By varchar(50), Edit_Date datetime;
GO

-- Vehicle type details the page copies into the form (vm.VechileCapacity).
alter table freight_master add
  container_Capacity decimal(18,2), ContainerSize varchar(50), Container_Type varchar(50), Bodys varchar(50),
  VehicleMode varchar(50), NoOfWheel int, active_flag varchar(10) default 'Active';
alter table route add isStatus bit default 1;
-- Vehicle makers (General/VehicleName_Master.aspx).
create table Vehicle_master (slno int identity primary key, vehicle_name varchar(100), active_flag varchar(10) default 'Active');
GO

create procedure usp_Insert_Vechile
  @VEHICLE_NO varchar(20), @Vechile_Type_Code varchar(50), @CHASSIS_NO varchar(50), @ENGINE_NO varchar(50), @MAKE varchar(50),
  @MODEL varchar(50), @Vechile_Capacity decimal(18,2), @ContainerSize varchar(50), @Vechile_Status varchar(20),
  @Created_By varchar(50), @Created_Branch varchar(20), @Home_Branch varchar(20), @VehicelType varchar(20), @VenderType varchar(20),
  @OwnerName varchar(100), @VendorCodeName varchar(20),
  @veh_route varchar(20), @veh_route_1 varchar(20), @veh_route_2 varchar(20), @veh_route_3 varchar(20), @veh_route_4 varchar(20),
  @veh_route_5 varchar(20), @veh_route_6 varchar(20), @veh_route_7 varchar(20), @veh_route_8 varchar(20), @veh_route_9 varchar(20),
  @tank_capacity varchar(10), @VehicleName_id_fk int, @fuel_type varchar(20), @division varchar(20), @Financial_Year varchar(20),
  @ud_Transaction_Details dbo.ud_Transaction_Details readonly,
  @DealerName varchar(100), @Address varchar(500), @Date_Of_Purchase date, @InvoiceNo varchar(50), @InvoiceValue decimal(18,2),
  @DealMaturityAmount decimal(18,2), @NameofFinancer varchar(100), @LoanAccNoChassis varchar(50), @LoanChassisAmount decimal(18,2),
  @LoanAccNoBody varchar(50), @LoanBodyAmount decimal(18,2), @LoanStartDate date, @LoanEndDate date, @CoverNoteNo varchar(50),
  @PolicyNo varchar(50), @ReceiptDate date, @InsStartDate date, @InsEndDate date, @NameofInsuranceNo varchar(100),
  @HypothecatedWith varchar(100), @Narration varchar(500), @AMC varchar(20),
  @ReturnValue varchar(200) output
as
begin
  set nocount on;
  if exists (select 1 from Vechile_Master where VEHICLE_NO = @VEHICLE_NO) begin set @ReturnValue = 'Vehicle No already Exists!!'; return; end
  insert into Vechile_Master(VEHICLE_NO, Vechile_Type_Code, CHASSIS_NO, ENGINE_NO, MAKE, MODEL, Vechile_Capacity, ContainerSize,
    Vechile_Status, Created_By, Created_Branch, Home_Branch, VehicelType, VenderType, OwnerName, VendorCodeName,
    veh_route, veh_route_1, veh_route_2, veh_route_3, veh_route_4, veh_route_5, veh_route_6, veh_route_7, veh_route_8, veh_route_9,
    tank_capacity, VehicleName_id_fk, fuel_type, division, AMC, DealerName, Address, Date_Of_Purchase, InvoiceNo, InvoiceValue,
    DealMaturityAmount, currentloc)
  values (@VEHICLE_NO, @Vechile_Type_Code, @CHASSIS_NO, @ENGINE_NO, @MAKE, @MODEL, @Vechile_Capacity, @ContainerSize,
    @Vechile_Status, @Created_By, @Created_Branch, @Home_Branch, @VehicelType, @VenderType, @OwnerName, @VendorCodeName,
    @veh_route, @veh_route_1, @veh_route_2, @veh_route_3, @veh_route_4, @veh_route_5, @veh_route_6, @veh_route_7, @veh_route_8, @veh_route_9,
    @tank_capacity, @VehicleName_id_fk, @fuel_type, @division, @AMC, @DealerName, @Address, @Date_Of_Purchase, @InvoiceNo, @InvoiceValue,
    @DealMaturityAmount, @Created_Branch);
  set @ReturnValue = 'success';
end
GO

create procedure usp_Update_Vechile
  @VEHICLE_NO varchar(20), @Vechile_Type_Code varchar(50), @CHASSIS_NO varchar(50), @ENGINE_NO varchar(50), @MAKE varchar(50),
  @MODEL varchar(50), @Vechile_Capacity decimal(18,2), @ContainerSize varchar(50), @Vechile_Status varchar(20),
  @VehicelType varchar(20), @VenderType varchar(20), @OwnerName varchar(100), @Create_Branch varchar(20), @VendorCodeName varchar(20),
  @veh_route varchar(20), @veh_route_1 varchar(20), @veh_route_2 varchar(20), @veh_route_3 varchar(20), @veh_route_4 varchar(20),
  @veh_route_5 varchar(20), @veh_route_6 varchar(20), @veh_route_7 varchar(20), @veh_route_8 varchar(20), @veh_route_9 varchar(20),
  @tank_capacity varchar(10), @VehicleName_id_fk int, @fuel_type varchar(20)
as
  update Vechile_Master set Vechile_Type_Code = @Vechile_Type_Code, CHASSIS_NO = @CHASSIS_NO, ENGINE_NO = @ENGINE_NO, MAKE = @MAKE,
    MODEL = @MODEL, Vechile_Capacity = @Vechile_Capacity, ContainerSize = @ContainerSize, Vechile_Status = @Vechile_Status,
    VehicelType = @VehicelType, VenderType = @VenderType, OwnerName = @OwnerName, Created_Branch = @Create_Branch,
    VendorCodeName = @VendorCodeName, veh_route = @veh_route, veh_route_1 = @veh_route_1, veh_route_2 = @veh_route_2,
    veh_route_3 = @veh_route_3, veh_route_4 = @veh_route_4, veh_route_5 = @veh_route_5, veh_route_6 = @veh_route_6,
    veh_route_7 = @veh_route_7, veh_route_8 = @veh_route_8, veh_route_9 = @veh_route_9, tank_capacity = @tank_capacity,
    VehicleName_id_fk = @VehicleName_id_fk, fuel_type = @fuel_type
  where VEHICLE_NO = @VEHICLE_NO;
GO
