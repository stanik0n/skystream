export interface Aircraft {
  icao24: string;
  callsign: string | null;
  lat: number;
  lon: number;
  altitude: number | null;
  velocity: number | null;
  heading: number | null;
  vertical_rate: number | null;
  on_ground: boolean;
  flight_phase: 'GROUND' | 'CLIMBING' | 'CRUISE' | 'DESCENDING';
  category: string | null;
}

export type FlightPhase = Aircraft['flight_phase'];

export interface TrailEntry {
  icao24: string;
  path: [number, number][];
  phase: FlightPhase;
}

export interface PositionsMessage {
  type: 'positions';
  timestamp: string;
  count: number;
  aircraft: Aircraft[];
}
