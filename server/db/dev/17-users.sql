-- =============================================================================
-- DEV-ONLY: staff logins (User/User_Master.aspx). The page's DAL (users_bal) wrote
--   update users set user_status=@user_status, user_password=@user_password where user_id=@user_id
--   delete from users where user_id=@user_id
-- and inserted user_id, user_password, user_branch (branch ids, first = home branch), user_created_date,
-- user_emp_type, user_type and user_status — see docs/SCHEMA-VERIFICATION.md.
-- =============================================================================

alter table users add user_status varchar(10) default 'Active', user_created_date datetime default getdate();
GO
update users set user_status = 'Active' where user_status is null;
GO

-- The login stand-in now also returns user_status (the API refuses inactive logins).
alter procedure sp_select_login_160219 @userid varchar(50), @userpasswd varchar(100), @Division varchar(20)
as
begin
  set nocount on;
  select top 1 u.user_id, u.user_password, u.user_emp_type, u.user_branch, u.user_status,
         e.empname,
         b.branch_name as home_branch, b.branch_code as branch
    from users u
    left join employee_master e on e.empcode = u.user_id
    left join branch_master b on cast(b.branchid as varchar(20)) = left(u.user_branch, charindex(',', u.user_branch + ',') - 1)
   where u.user_id = @userid and u.user_password = @userpasswd and (u.DivCode = @Division or u.DivCode is null);
end
GO
