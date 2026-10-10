-- =============================================================================
-- DEV-ONLY: General Rate Master (Rate/General_Rate_Master.aspx, general_rate_master_bal).
-- The standard tariff: GenaraleRate_Master_City (sic), General_Rate_location, General_Rate_State, General_Rate_zone —
-- the page's inline INSERTs name the same rate / charge / date columns as the client contract tables, without a client.
-- The dev tables copy the client contract tables' columns (select into keeps the identity slno); unused client columns
-- stay empty. EntRef series of their own (RMEC- / RMEL- / RMES- / RMEZ-, max + 1 per table as the page read them).
-- See docs/SCHEMA-VERIFICATION.md.
-- =============================================================================

if object_id('GenaraleRate_Master_City') is null select top 0 * into GenaraleRate_Master_City from client_contract_city;
if object_id('General_Rate_location') is null select top 0 * into General_Rate_location from client_contract_location;
if object_id('General_Rate_State') is null select top 0 * into General_Rate_State from client_contract_State;
if object_id('General_Rate_zone') is null select top 0 * into General_Rate_zone from client_contract_zone;
GO
