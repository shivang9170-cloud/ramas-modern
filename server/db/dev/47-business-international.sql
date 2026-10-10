-- One system for every business (2026-10-10): courier, TMS (cargo / FTL), domestic and international export / import.
--
--   tblDivisionProfile    what each division (company line of business) works like - legacy DivisionMaster is not altered:
--                         BusinessType COURIER | CARGO | FTL | INTERNATIONAL, UseBagging (manifest packets > bags > master
--                         bags; TMS divisions manifest whole dockets in one entry), AllowInternational (docket may be
--                         Export / Import), the auto-bagging limits. Edited on the Division Master.
--   tblCountry, tblCurrency, tblPort, tblCarrier   international masters (generic master screen)
--   docket_international  the export / import details of a docket (a domestic docket has no row)
-- Reference rows (countries, currencies, major ports, carriers) are real-world codes, not demo data. Safe to re-run.

if object_id('tblDivisionProfile', 'U') is null
create table tblDivisionProfile (
  DivCode varchar(20) primary key,
  BusinessType varchar(20) not null default 'COURIER',
  UseBagging bit not null default 0,
  AllowInternational bit not null default 0,
  DocketsPerPacket int not null default 10,
  ItemsPerBag int not null default 10,
  BagsPerMasterBag int not null default 10,
  UpdatedBy varchar(50),
  UpdatedDate datetime default getdate()
);
GO

-- every division gets a profile once: COURIER by name > bagging on; CARGO / FTL (TMS) > whole-docket manifests
insert into tblDivisionProfile(DivCode, BusinessType, UseBagging, AllowInternational, UpdatedBy)
select d.DivCode,
       case when upper(d.DivName) like '%INTERNATIONAL%' or upper(d.DivName) like '%EXPORT%' then 'INTERNATIONAL'
            when upper(d.DivName) like '%COURIER%' then 'COURIER'
            when upper(d.DivName) like '%FTL%' or upper(d.DivName) like '%TRUCK%' then 'FTL'
            else 'CARGO' end,
       case when upper(d.DivName) like '%COURIER%' or upper(d.DivName) like '%INTERNATIONAL%' or upper(d.DivName) like '%EXPORT%' then 1 else 0 end,
       case when upper(d.DivName) like '%FTL%' or upper(d.DivName) like '%TRUCK%' then 0 else 1 end,
       'setup'
  from DivisionMaster d
 where not exists (select 1 from tblDivisionProfile p where p.DivCode = d.DivCode);
GO

-- ---------------------------------------------------------------- international masters
if object_id('tblCurrency', 'U') is null
create table tblCurrency (
  CurrencyCode varchar(3) primary key,
  CurrencyName varchar(60) not null,
  Symbol nvarchar(5),
  RateToINR decimal(18, 4) not null default 1,   -- 1 unit = this many rupees (customs / bank rate, updated by the user)
  RateDate date,
  IsActive bit not null default 1
);
if object_id('tblCountry', 'U') is null
create table tblCountry (
  CountryCode varchar(2) primary key,             -- ISO 3166 alpha-2
  CountryName varchar(80) not null,
  IsdCode varchar(6),
  CurrencyCode varchar(3),
  IsActive bit not null default 1
);
if object_id('tblPort', 'U') is null
create table tblPort (
  PortCode varchar(10) primary key,               -- IATA airport code / UN-LOCODE (sea, ICD)
  PortName varchar(100) not null,
  PortType varchar(10) not null default 'AIR',    -- AIR | SEA | ICD | LAND
  CountryCode varchar(2) not null,
  CityName varchar(60),
  IsActive bit not null default 1
);
if object_id('tblCarrier', 'U') is null
create table tblCarrier (
  CarrierCode varchar(10) primary key,
  CarrierName varchar(100) not null,
  CarrierType varchar(20) not null default 'AIRLINE',  -- AIRLINE | SHIPPING LINE | COURIER | ROAD
  AwbPrefix varchar(5),                                -- airline's 3-digit MAWB prefix
  IsActive bit not null default 1
);
GO

merge tblCurrency t using (values
  ('INR', 'INDIAN RUPEE', 'Rs', 1), ('USD', 'US DOLLAR', '$', 83.5), ('EUR', 'EURO', 'EUR', 90.5), ('GBP', 'POUND STERLING', 'GBP', 106),
  ('AED', 'UAE DIRHAM', 'AED', 22.7), ('SGD', 'SINGAPORE DOLLAR', 'S$', 62), ('CNY', 'CHINESE YUAN', 'CNY', 11.5),
  ('JPY', 'JAPANESE YEN', 'JPY', 0.56), ('SAR', 'SAUDI RIYAL', 'SAR', 22.2), ('AUD', 'AUSTRALIAN DOLLAR', 'A$', 55),
  ('CAD', 'CANADIAN DOLLAR', 'C$', 61), ('BDT', 'BANGLADESHI TAKA', 'Tk', 0.70), ('NPR', 'NEPALESE RUPEE', 'NRs', 0.625)
) s(code, name, sym, rate) on t.CurrencyCode = s.code
when not matched then insert (CurrencyCode, CurrencyName, Symbol, RateToINR, RateDate) values (s.code, s.name, s.sym, s.rate, cast(getdate() as date));

merge tblCountry t using (values
  ('IN', 'INDIA', '+91', 'INR'), ('AE', 'UNITED ARAB EMIRATES', '+971', 'AED'), ('US', 'UNITED STATES', '+1', 'USD'),
  ('GB', 'UNITED KINGDOM', '+44', 'GBP'), ('SG', 'SINGAPORE', '+65', 'SGD'), ('CN', 'CHINA', '+86', 'CNY'),
  ('JP', 'JAPAN', '+81', 'JPY'), ('SA', 'SAUDI ARABIA', '+966', 'SAR'), ('AU', 'AUSTRALIA', '+61', 'AUD'),
  ('CA', 'CANADA', '+1', 'CAD'), ('DE', 'GERMANY', '+49', 'EUR'), ('FR', 'FRANCE', '+33', 'EUR'),
  ('NL', 'NETHERLANDS', '+31', 'EUR'), ('BD', 'BANGLADESH', '+880', 'BDT'), ('NP', 'NEPAL', '+977', 'NPR'),
  ('LK', 'SRI LANKA', '+94', 'USD'), ('MY', 'MALAYSIA', '+60', 'USD'), ('TH', 'THAILAND', '+66', 'USD'),
  ('HK', 'HONG KONG', '+852', 'USD'), ('QA', 'QATAR', '+974', 'USD'), ('KW', 'KUWAIT', '+965', 'USD'), ('OM', 'OMAN', '+968', 'USD')
) s(code, name, isd, cur) on t.CountryCode = s.code
when not matched then insert (CountryCode, CountryName, IsdCode, CurrencyCode) values (s.code, s.name, s.isd, s.cur);

merge tblPort t using (values
  ('DEL', 'INDIRA GANDHI INTL AIRPORT, DELHI', 'AIR', 'IN', 'DELHI'), ('BOM', 'CHHATRAPATI SHIVAJI INTL AIRPORT, MUMBAI', 'AIR', 'IN', 'MUMBAI'),
  ('MAA', 'CHENNAI INTL AIRPORT', 'AIR', 'IN', 'CHENNAI'), ('BLR', 'KEMPEGOWDA INTL AIRPORT, BENGALURU', 'AIR', 'IN', 'BENGALURU'),
  ('CCU', 'NETAJI SUBHAS CHANDRA BOSE INTL AIRPORT, KOLKATA', 'AIR', 'IN', 'KOLKATA'), ('HYD', 'RAJIV GANDHI INTL AIRPORT, HYDERABAD', 'AIR', 'IN', 'HYDERABAD'),
  ('INNSA1', 'NHAVA SHEVA (JNPT)', 'SEA', 'IN', 'NAVI MUMBAI'), ('INMUN1', 'MUNDRA PORT', 'SEA', 'IN', 'MUNDRA'),
  ('INMAA1', 'CHENNAI SEAPORT', 'SEA', 'IN', 'CHENNAI'), ('INTKD6', 'ICD TUGHLAKABAD', 'ICD', 'IN', 'DELHI'),
  ('DXB', 'DUBAI INTL AIRPORT', 'AIR', 'AE', 'DUBAI'), ('AEJEA', 'JEBEL ALI PORT', 'SEA', 'AE', 'DUBAI'),
  ('JFK', 'JOHN F KENNEDY INTL AIRPORT, NEW YORK', 'AIR', 'US', 'NEW YORK'), ('LHR', 'LONDON HEATHROW AIRPORT', 'AIR', 'GB', 'LONDON'),
  ('SIN', 'SINGAPORE CHANGI AIRPORT', 'AIR', 'SG', 'SINGAPORE'), ('SGSIN', 'PORT OF SINGAPORE', 'SEA', 'SG', 'SINGAPORE'),
  ('PVG', 'SHANGHAI PUDONG INTL AIRPORT', 'AIR', 'CN', 'SHANGHAI'), ('CNSHA', 'PORT OF SHANGHAI', 'SEA', 'CN', 'SHANGHAI'),
  ('FRA', 'FRANKFURT AIRPORT', 'AIR', 'DE', 'FRANKFURT'), ('DAC', 'HAZRAT SHAHJALAL INTL AIRPORT, DHAKA', 'AIR', 'BD', 'DHAKA'),
  ('KTM', 'TRIBHUVAN INTL AIRPORT, KATHMANDU', 'AIR', 'NP', 'KATHMANDU')
) s(code, name, typ, country, city) on t.PortCode = s.code
when not matched then insert (PortCode, PortName, PortType, CountryCode, CityName) values (s.code, s.name, s.typ, s.country, s.city);

merge tblCarrier t using (values
  ('AI', 'AIR INDIA', 'AIRLINE', '098'), ('6E', 'INDIGO', 'AIRLINE', '312'), ('EK', 'EMIRATES SKYCARGO', 'AIRLINE', '176'),
  ('QR', 'QATAR AIRWAYS CARGO', 'AIRLINE', '157'), ('SQ', 'SINGAPORE AIRLINES CARGO', 'AIRLINE', '618'), ('LH', 'LUFTHANSA CARGO', 'AIRLINE', '020'),
  ('MAEU', 'MAERSK LINE', 'SHIPPING LINE', null), ('MSCU', 'MSC MEDITERRANEAN SHIPPING', 'SHIPPING LINE', null),
  ('CMDU', 'CMA CGM', 'SHIPPING LINE', null), ('DHL', 'DHL EXPRESS', 'COURIER', null), ('FDX', 'FEDEX', 'COURIER', null), ('UPS', 'UPS', 'COURIER', null)
) s(code, name, typ, prefix) on t.CarrierCode = s.code
when not matched then insert (CarrierCode, CarrierName, CarrierType, AwbPrefix) values (s.code, s.name, s.typ, s.prefix);
GO

-- ---------------------------------------------------------------- docket export / import details
if object_id('docket_international', 'U') is null
create table docket_international (
  docket_no varchar(50) primary key,
  ShipmentType varchar(10) not null,             -- EXPORT | IMPORT
  OriginCountry varchar(2),
  DestinationCountry varchar(2),
  OriginPort varchar(10),
  DestinationPort varchar(10),
  CarrierCode varchar(10),
  MawbNo varchar(30),                            -- master airway bill / ocean BL
  HawbNo varchar(30),                            -- house airway bill / house BL
  FlightVoyage varchar(30),
  Incoterm varchar(5),
  CurrencyCode varchar(3),
  ExchangeRate decimal(18, 4),
  InvoiceValueFC decimal(18, 2),
  InvoiceValueINR decimal(18, 2),
  HsCode varchar(12),
  IecNo varchar(10),
  CustomsDocNo varchar(30),                      -- shipping bill (export) / bill of entry (import)
  CustomsDocDate date,
  OverseasName varchar(200),                     -- consignee abroad (export) / shipper abroad (import)
  OverseasAddress varchar(500),
  OverseasCity varchar(60),
  OverseasZip varchar(15),
  OverseasPhone varchar(30),
  OverseasEmail varchar(100),
  CreatedBy varchar(50),
  CreatedDate datetime default getdate(),
  UpdatedBy varchar(50),
  UpdatedDate datetime
);
GO
