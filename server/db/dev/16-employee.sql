-- =============================================================================
-- DEV-ONLY: employee master (Master/Employee_Master.aspx) columns and stand-in procedures.
-- Procedure names come from the deployed bin/ClassLibrary.dll (usp_insert_Employee_Master, usp_Update_Employee_Master,
-- sp_Fill_Employee, getBindLocationFromBranch, emp_type_master); parameter names follow Employee_Master_Pal and the
-- DLL's strings — see docs/SCHEMA-VERIFICATION.md.
-- =============================================================================

alter table employee_master alter column DivCode varchar(100);
alter table employee_master add
  telephoneno varchar(20), presentaddress varchar(500), permanentaddress varchar(500), dateofjoining date, pincode varchar(10),
  EmailId varchar(100), PermanentPinCode varchar(10), Company varchar(20), PresentCity varchar(10), PermanentCity varchar(10),
  vc_Type varchar(10), vc_Guardian_Type varchar(10), vc_Guardian_Name varchar(100), IsAuthorized bit default 1,
  vc_Religion varchar(20), vc_Maritial_Status varchar(2), vc_Category varchar(20), vc_Nationality varchar(20), vc_Blood_Group varchar(5),
  vc_Ret_Name1 varchar(100), vc_Ret_Name2 varchar(100), vc_Ret_Name3 varchar(100), vc_Ret_Name4 varchar(100),
  vc_Ret_Address1 varchar(300), vc_Ret_Address2 varchar(300), vc_Ret_Address3 varchar(300), vc_Ret_Address4 varchar(300),
  vc_Relation_Name1 varchar(50), vc_Relation_Name2 varchar(50), vc_Relation_Name3 varchar(50), vc_Relation_Name4 varchar(50),
  vc_Mobile1 varchar(15), vc_Mobile2 varchar(15), vc_Mobile3 varchar(15), vc_Mobile4 varchar(15),
  vc_Gender varchar(10), dt_DOB_Date date, dt_WithEff_Date date, vc_Highest_Qualification varchar(100), dt_Leaving_Date date,
  fl_Total_Exp decimal(5,2), vc_PAN_No varchar(15), vc_Passport_No varchar(20), vc_Joining_Type varchar(2),
  vc_Location_Code varchar(20), vc_Report_To varchar(50), vc_Previous_CompanyName varchar(200), vc_CompanyAddress varchar(300),
  vc_CompanyPhone varchar(20), vc_Emp_Photo varchar(300), vc_Emp_Document varchar(300), isPF bit default 0, isESI bit default 0,
  isPTax bit default 0, isLWF bit default 0, isCost_visible bit default 0, sap_code varchar(20), manual_no varchar(20),
  User_Id varchar(50), Edit_By varchar(50), Edit_Date datetime, created_date datetime default getdate();
GO

-- Designations (sp_select_emp_type / emp_type_master). DC-116 is the pickup / delivery staff the operation screens list.
create table emp_type_master (emp_type_code varchar(20) primary key, emp_type_name varchar(100), desig_status varchar(10) default 'Active');
GO
create procedure sp_select_emp_type as
  select emp_type_code, emp_type_name from emp_type_master where isnull(desig_status, 'Active') = 'Active' order by emp_type_name;
GO
create procedure sp_Fill_Employee as
  select empcode, empname from employee_master where isnull(IsActive, 1) = 1 order by empname;
GO
create procedure getBindLocationFromBranch @branch_code varchar(20) as
  select Location_Code, Location_Name from New_Location_master where branch_code = @branch_code order by Location_Name;
GO

create procedure usp_insert_Employee_Master
  @empcode varchar(50), @empname varchar(200), @emptype varchar(20), @branch varchar(20), @depart varchar(20), @compname varchar(20),
  @PresentCity varchar(10), @PermanentCity varchar(10), @vc_Type varchar(10), @vc_Guardian_Type varchar(10), @vc_Guardian_Name varchar(100),
  @IsAuthorized bit, @telephoneno varchar(20), @presentaddress varchar(500), @permanentaddress varchar(500), @dateofjoining date,
  @pincode varchar(10), @mobileno varchar(20), @EmailId varchar(100), @PermanentPinCode varchar(10), @vc_Religion varchar(20),
  @vc_Maritial_Status varchar(2), @vc_Category varchar(20), @vc_Nationality varchar(20), @vc_Blood_Group varchar(5),
  @vc_Ret_Name1 varchar(100), @vc_Ret_Name2 varchar(100), @vc_Ret_Name3 varchar(100), @vc_Ret_Name4 varchar(100),
  @vc_Ret_Address1 varchar(300), @vc_Ret_Address2 varchar(300), @vc_Ret_Address3 varchar(300), @vc_Ret_Address4 varchar(300),
  @vc_Relation_Name1 varchar(50), @vc_Relation_Name2 varchar(50), @vc_Relation_Name3 varchar(50), @vc_Relation_Name4 varchar(50),
  @vc_Mobile1 varchar(15), @vc_Mobile2 varchar(15), @vc_Mobile3 varchar(15), @vc_Mobile4 varchar(15), @vc_Gender varchar(10),
  @dt_DOB_Date date, @dt_WithEff_Date date, @vc_Highest_Qualification varchar(100), @dt_Leaving_Date date, @fl_Total_Exp decimal(5,2),
  @vc_PAN_No varchar(15), @vc_Passport_No varchar(20), @vc_Joining_Type varchar(2), @vc_Location_Code varchar(20),
  @vc_Report_To varchar(50), @vc_Previous_CompanyName varchar(200), @vc_CompanyAddress varchar(300), @vc_CompanyPhone varchar(20),
  @vc_Emp_Photo varchar(300), @vc_Emp_Document varchar(300), @IsActive bit, @User_Id varchar(50), @isPF bit, @isESI bit,
  @isPTax bit, @isLWF bit, @isCost_visible bit, @Division varchar(100), @sap_code varchar(20), @manual_no varchar(20),
  @emid varchar(50) output
as
begin
  set nocount on;
  insert into employee_master(empcode, empname, emptype, branch, Department, Company, PresentCity, PermanentCity, vc_Type, vc_Guardian_Type,
    vc_Guardian_Name, IsAuthorized, telephoneno, presentaddress, permanentaddress, dateofjoining, pincode, mobileno, EmailId, PermanentPinCode,
    vc_Religion, vc_Maritial_Status, vc_Category, vc_Nationality, vc_Blood_Group, vc_Ret_Name1, vc_Ret_Name2, vc_Ret_Name3, vc_Ret_Name4,
    vc_Ret_Address1, vc_Ret_Address2, vc_Ret_Address3, vc_Ret_Address4, vc_Relation_Name1, vc_Relation_Name2, vc_Relation_Name3,
    vc_Relation_Name4, vc_Mobile1, vc_Mobile2, vc_Mobile3, vc_Mobile4, vc_Gender, dt_DOB_Date, dt_WithEff_Date, vc_Highest_Qualification,
    dt_Leaving_Date, fl_Total_Exp, vc_PAN_No, vc_Passport_No, vc_Joining_Type, vc_Location_Code, vc_Report_To, vc_Previous_CompanyName,
    vc_CompanyAddress, vc_CompanyPhone, vc_Emp_Photo, vc_Emp_Document, IsActive, User_Id, isPF, isESI, isPTax, isLWF, isCost_visible,
    DivCode, sap_code, manual_no)
  values (@empcode, @empname, @emptype, @branch, @depart, @compname, @PresentCity, @PermanentCity, @vc_Type, @vc_Guardian_Type,
    @vc_Guardian_Name, @IsAuthorized, @telephoneno, @presentaddress, @permanentaddress, @dateofjoining, @pincode, @mobileno, @EmailId, @PermanentPinCode,
    @vc_Religion, @vc_Maritial_Status, @vc_Category, @vc_Nationality, @vc_Blood_Group, @vc_Ret_Name1, @vc_Ret_Name2, @vc_Ret_Name3, @vc_Ret_Name4,
    @vc_Ret_Address1, @vc_Ret_Address2, @vc_Ret_Address3, @vc_Ret_Address4, @vc_Relation_Name1, @vc_Relation_Name2, @vc_Relation_Name3,
    @vc_Relation_Name4, @vc_Mobile1, @vc_Mobile2, @vc_Mobile3, @vc_Mobile4, @vc_Gender, @dt_DOB_Date, @dt_WithEff_Date, @vc_Highest_Qualification,
    @dt_Leaving_Date, @fl_Total_Exp, @vc_PAN_No, @vc_Passport_No, @vc_Joining_Type, @vc_Location_Code, @vc_Report_To, @vc_Previous_CompanyName,
    @vc_CompanyAddress, @vc_CompanyPhone, @vc_Emp_Photo, @vc_Emp_Document, @IsActive, @User_Id, @isPF, @isESI, @isPTax, @isLWF, @isCost_visible,
    @Division, @sap_code, @manual_no);
  set @emid = @empcode;
end
GO

create procedure usp_Update_Employee_Master
  @empcode varchar(50), @empname varchar(200), @emptype varchar(20), @branch varchar(20), @depart varchar(20), @compname varchar(20),
  @PresentCity varchar(10), @PermanentCity varchar(10), @vc_Type varchar(10), @vc_Guardian_Type varchar(10), @vc_Guardian_Name varchar(100),
  @IsAuthorized bit, @telephoneno varchar(20), @presentaddress varchar(500), @permanentaddress varchar(500), @dateofjoining date,
  @pincode varchar(10), @mobileno varchar(20), @EmailId varchar(100), @PermanentPinCode varchar(10), @vc_Religion varchar(20),
  @vc_Maritial_Status varchar(2), @vc_Category varchar(20), @vc_Nationality varchar(20), @vc_Blood_Group varchar(5),
  @vc_Ret_Name1 varchar(100), @vc_Ret_Name2 varchar(100), @vc_Ret_Name3 varchar(100), @vc_Ret_Name4 varchar(100),
  @vc_Ret_Address1 varchar(300), @vc_Ret_Address2 varchar(300), @vc_Ret_Address3 varchar(300), @vc_Ret_Address4 varchar(300),
  @vc_Relation_Name1 varchar(50), @vc_Relation_Name2 varchar(50), @vc_Relation_Name3 varchar(50), @vc_Relation_Name4 varchar(50),
  @vc_Mobile1 varchar(15), @vc_Mobile2 varchar(15), @vc_Mobile3 varchar(15), @vc_Mobile4 varchar(15), @vc_Gender varchar(10),
  @dt_DOB_Date date, @dt_WithEff_Date date, @vc_Highest_Qualification varchar(100), @dt_Leaving_Date date, @fl_Total_Exp decimal(5,2),
  @vc_PAN_No varchar(15), @vc_Passport_No varchar(20), @vc_Joining_Type varchar(2), @vc_Location_Code varchar(20),
  @vc_Report_To varchar(50), @vc_Previous_CompanyName varchar(200), @vc_CompanyAddress varchar(300), @vc_CompanyPhone varchar(20),
  @vc_Emp_Photo varchar(300), @vc_Emp_Document varchar(300), @IsActive bit, @Edit_By varchar(50), @isPF bit, @isESI bit,
  @isPTax bit, @isLWF bit, @isCost_visible bit, @Division varchar(100), @sap_code varchar(20), @manual_no varchar(20)
as
  update employee_master set empname = @empname, emptype = @emptype, branch = @branch, Department = @depart, Company = @compname,
    PresentCity = @PresentCity, PermanentCity = @PermanentCity, vc_Type = @vc_Type, vc_Guardian_Type = @vc_Guardian_Type,
    vc_Guardian_Name = @vc_Guardian_Name, IsAuthorized = @IsAuthorized, telephoneno = @telephoneno, presentaddress = @presentaddress,
    permanentaddress = @permanentaddress, dateofjoining = @dateofjoining, pincode = @pincode, mobileno = @mobileno, EmailId = @EmailId,
    PermanentPinCode = @PermanentPinCode, vc_Religion = @vc_Religion, vc_Maritial_Status = @vc_Maritial_Status, vc_Category = @vc_Category,
    vc_Nationality = @vc_Nationality, vc_Blood_Group = @vc_Blood_Group, vc_Ret_Name1 = @vc_Ret_Name1, vc_Ret_Name2 = @vc_Ret_Name2,
    vc_Ret_Name3 = @vc_Ret_Name3, vc_Ret_Name4 = @vc_Ret_Name4, vc_Ret_Address1 = @vc_Ret_Address1, vc_Ret_Address2 = @vc_Ret_Address2,
    vc_Ret_Address3 = @vc_Ret_Address3, vc_Ret_Address4 = @vc_Ret_Address4, vc_Relation_Name1 = @vc_Relation_Name1,
    vc_Relation_Name2 = @vc_Relation_Name2, vc_Relation_Name3 = @vc_Relation_Name3, vc_Relation_Name4 = @vc_Relation_Name4,
    vc_Mobile1 = @vc_Mobile1, vc_Mobile2 = @vc_Mobile2, vc_Mobile3 = @vc_Mobile3, vc_Mobile4 = @vc_Mobile4, vc_Gender = @vc_Gender,
    dt_DOB_Date = @dt_DOB_Date, dt_WithEff_Date = @dt_WithEff_Date, vc_Highest_Qualification = @vc_Highest_Qualification,
    dt_Leaving_Date = @dt_Leaving_Date, fl_Total_Exp = @fl_Total_Exp, vc_PAN_No = @vc_PAN_No, vc_Passport_No = @vc_Passport_No,
    vc_Joining_Type = @vc_Joining_Type, vc_Location_Code = @vc_Location_Code, vc_Report_To = @vc_Report_To,
    vc_Previous_CompanyName = @vc_Previous_CompanyName, vc_CompanyAddress = @vc_CompanyAddress, vc_CompanyPhone = @vc_CompanyPhone,
    vc_Emp_Photo = @vc_Emp_Photo, vc_Emp_Document = @vc_Emp_Document, IsActive = @IsActive, Edit_By = @Edit_By, Edit_Date = getdate(),
    isPF = @isPF, isESI = @isESI, isPTax = @isPTax, isLWF = @isLWF, isCost_visible = @isCost_visible, DivCode = @Division,
    sap_code = @sap_code, manual_no = @manual_no
  where empcode = @empcode;
GO
