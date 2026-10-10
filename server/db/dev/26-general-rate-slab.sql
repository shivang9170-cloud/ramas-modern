-- =============================================================================
-- DEV-ONLY: General Rate Master weight slabs (General_Rate_With_Slab).
-- The DLL's INSERT names origin_city, destination_city, mode_id, rate_on, contract_type and the 10 weight bands; the
-- Client Contract page read it back `WHERE origin_city … AND RateType … AND contract_type … AND EntRef = …`, so it also has
-- RateType and EntRef. The dev table copies ClientRate_With_Slab (same bands, EntRef, RateType, Status).
-- See docs/SCHEMA-VERIFICATION.md.
-- =============================================================================

if object_id('General_Rate_With_Slab') is null select top 0 * into General_Rate_With_Slab from ClientRate_With_Slab;
GO
