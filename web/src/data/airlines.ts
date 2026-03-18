export interface AirlineInfo {
  name: string;
  iata: string;
}

// Keyed by ICAO callsign prefix (first 3 letters of callsign)
export const AIRLINES: Record<string, AirlineInfo> = {
  // ── North America ────────────────────────────────────────────────────────────
  AAL: { name: 'American Airlines',    iata: 'AA' },
  UAL: { name: 'United Airlines',      iata: 'UA' },
  DAL: { name: 'Delta Air Lines',      iata: 'DL' },
  SWA: { name: 'Southwest Airlines',   iata: 'WN' },
  ASA: { name: 'Alaska Airlines',      iata: 'AS' },
  JBU: { name: 'JetBlue Airways',      iata: 'B6' },
  FFT: { name: 'Frontier Airlines',    iata: 'F9' },
  NKS: { name: 'Spirit Airlines',      iata: 'NK' },
  HAL: { name: 'Hawaiian Airlines',    iata: 'HA' },
  SKW: { name: 'SkyWest Airlines',     iata: 'OO' },
  EDV: { name: 'Endeavor Air',         iata: '9E' },
  RPA: { name: 'Republic Airways',     iata: 'YX' },
  WJA: { name: 'WestJet',             iata: 'WS' },
  ACA: { name: 'Air Canada',           iata: 'AC' },
  AMX: { name: 'Aeromexico',           iata: 'AM' },
  VOI: { name: 'Volaris',              iata: 'Y4' },
  VIV: { name: 'VivaAerobus',          iata: 'VB' },
  SYI: { name: 'Sun Country Airlines', iata: 'SY' },
  BOU: { name: 'Breeze Airways',       iata: 'MX' },

  // ── Europe ───────────────────────────────────────────────────────────────────
  BAW: { name: 'British Airways',       iata: 'BA' },
  KLM: { name: 'KLM Royal Dutch',      iata: 'KL' },
  AFR: { name: 'Air France',           iata: 'AF' },
  DLH: { name: 'Lufthansa',            iata: 'LH' },
  IBE: { name: 'Iberia',               iata: 'IB' },
  IBS: { name: 'Iberia Express',       iata: 'I2' },
  AZA: { name: 'ITA Airways',          iata: 'AZ' },
  SAS: { name: 'Scandinavian Airlines', iata: 'SK' },
  FIN: { name: 'Finnair',              iata: 'AY' },
  TAP: { name: 'TAP Air Portugal',     iata: 'TP' },
  EZY: { name: 'easyJet',              iata: 'U2' },
  RYR: { name: 'Ryanair',              iata: 'FR' },
  VLG: { name: 'Vueling',              iata: 'VY' },
  BEL: { name: 'Brussels Airlines',    iata: 'SN' },
  LOT: { name: 'LOT Polish Airlines',  iata: 'LO' },
  AUA: { name: 'Austrian Airlines',    iata: 'OS' },
  SWR: { name: 'Swiss International',  iata: 'LX' },
  THY: { name: 'Turkish Airlines',     iata: 'TK' },
  WZZ: { name: 'Wizz Air',            iata: 'W6' },
  NAX: { name: 'Norwegian Air',        iata: 'DY' },
  AEE: { name: 'Aegean Airlines',      iata: 'A3' },
  EIN: { name: 'Aer Lingus',           iata: 'EI' },
  TVF: { name: 'Transavia France',     iata: 'TO' },
  TRA: { name: 'Transavia',            iata: 'HV' },
  GEC: { name: 'Lufthansa Cargo',      iata: 'LH' },
  EWG: { name: 'Eurowings',            iata: 'EW' },
  WUK: { name: 'Wizz Air UK',          iata: 'W9' },
  BAL: { name: 'Balkan Holidays Air',  iata: 'VB' },
  CTN: { name: 'Croatia Airlines',     iata: 'OU' },
  CSA: { name: 'Czech Airlines',       iata: 'OK' },
  ROU: { name: 'TAROM',                iata: 'RO' },

  // ── Middle East ──────────────────────────────────────────────────────────────
  UAE: { name: 'Emirates',             iata: 'EK' },
  ETD: { name: 'Etihad Airways',       iata: 'EY' },
  QTR: { name: 'Qatar Airways',        iata: 'QR' },
  FDB: { name: 'flydubai',             iata: 'FZ' },
  ELY: { name: 'El Al Israel',         iata: 'LY' },
  MSR: { name: 'EgyptAir',             iata: 'MS' },
  RAM: { name: 'Royal Air Maroc',      iata: 'AT' },
  GFA: { name: 'Gulf Air',             iata: 'GF' },
  OMA: { name: 'Oman Air',             iata: 'WY' },
  SVA: { name: 'Saudia',               iata: 'SV' },
  PIA: { name: 'Pakistan Airlines',    iata: 'PK' },
  IAW: { name: 'Iraqi Airways',        iata: 'IA' },
  RJA: { name: 'Royal Jordanian',      iata: 'RJ' },
  MEA: { name: 'Middle East Airlines', iata: 'ME' },
  FBA: { name: 'flynas',               iata: 'XY' },

  // ── Asia-Pacific ─────────────────────────────────────────────────────────────
  CPA: { name: 'Cathay Pacific',        iata: 'CX' },
  SIA: { name: 'Singapore Airlines',   iata: 'SQ' },
  MAS: { name: 'Malaysia Airlines',    iata: 'MH' },
  JAL: { name: 'Japan Airlines',       iata: 'JL' },
  ANA: { name: 'All Nippon Airways',   iata: 'NH' },
  KAL: { name: 'Korean Air',           iata: 'KE' },
  AAR: { name: 'Asiana Airlines',      iata: 'OZ' },
  CCA: { name: 'Air China',            iata: 'CA' },
  CSN: { name: 'China Southern',       iata: 'CZ' },
  CES: { name: 'China Eastern',        iata: 'MU' },
  CHH: { name: 'Hainan Airlines',      iata: 'HU' },
  QFA: { name: 'Qantas',               iata: 'QF' },
  VOZ: { name: 'Virgin Australia',     iata: 'VA' },
  JST: { name: 'Jetstar',              iata: 'JQ' },
  AXM: { name: 'AirAsia',             iata: 'AK' },
  IGO: { name: 'IndiGo',               iata: '6E' },
  AIC: { name: 'Air India',            iata: 'AI' },
  GAL: { name: 'Garuda Indonesia',     iata: 'GA' },
  EVA: { name: 'EVA Air',              iata: 'BR' },
  CAL: { name: 'China Airlines',       iata: 'CI' },
  PAL: { name: 'Philippine Airlines',  iata: 'PR' },
  VJC: { name: 'VietJet Air',          iata: 'VJ' },
  HVN: { name: 'Vietnam Airlines',     iata: 'VN' },
  BAV: { name: 'Bamboo Airways',       iata: 'QH' },
  TGW: { name: 'Thai Lion Air',        iata: 'SL' },
  THA: { name: 'Thai Airways',         iata: 'TG' },
  AIQ: { name: 'AirAsia X',           iata: 'D7' },
  SJY: { name: 'Jeju Air',             iata: '7C' },
  TWB: { name: 'Tway Air',             iata: 'TW' },
  JJA: { name: 'Jin Air',              iata: 'LJ' },
  ABL: { name: 'Air Busan',            iata: 'BX' },

  // ── Africa ───────────────────────────────────────────────────────────────────
  SAA: { name: 'South African Airways', iata: 'SA' },
  ETH: { name: 'Ethiopian Airlines',   iata: 'ET' },
  KQA: { name: 'Kenya Airways',        iata: 'KQ' },
  MSC: { name: 'EgyptAir',             iata: 'MS' },
  AMW: { name: 'Air Malawi',           iata: 'QM' },
  RWD: { name: 'RwandAir',             iata: 'WB' },
  AHY: { name: 'Azerbaijan Airlines',  iata: 'J2' },

  // ── Latin America ────────────────────────────────────────────────────────────
  LAN: { name: 'LATAM Airlines',       iata: 'LA' },
  TAM: { name: 'LATAM Brasil',         iata: 'JJ' },
  GLO: { name: 'Gol Airlines',         iata: 'G3' },
  AZU: { name: 'Azul Brazilian',       iata: 'AD' },
  AVA: { name: 'Avianca',              iata: 'AV' },
  COA: { name: 'Copa Airlines',        iata: 'CM' },
  BOA: { name: 'Boliviana de Aviación', iata: 'OB' },
  ARE: { name: 'Aerolíneas Argentinas', iata: 'AR' },

  // ── Cargo ────────────────────────────────────────────────────────────────────
  FDX: { name: 'FedEx',                iata: 'FX' },
  UPS: { name: 'UPS Airlines',         iata: '5X' },
  ABX: { name: 'ABX Air',              iata: 'GB' },
  GTI: { name: 'Atlas Air',            iata: '5Y' },
  PAC: { name: 'Polar Air Cargo',      iata: 'PO' },
  NCR: { name: 'National Air Cargo',   iata: 'N8' },
};

export function lookupAirline(callsign: string | null): AirlineInfo | null {
  if (!callsign) return null;
  const clean = callsign.trim().toUpperCase();
  // Try 3-letter prefix first, then 2-letter
  return AIRLINES[clean.slice(0, 3)] ?? AIRLINES[clean.slice(0, 2)] ?? null;
}

export function airlineLogoUrl(iata: string): string {
  return `https://pics.avs.io/200/80/${iata}.png`;
}
