import { useState, useEffect } from 'react';
import type { Aircraft, FlightPhase } from '../types';
import { lookupAirline, airlineLogoUrl } from '../data/airlines';

const _WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) || 'ws://localhost:8000/ws';
const HTTP_URL = _WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '');

interface RouteAirport {
  iata_code: string;
  municipality: string;
  name: string;
}

interface FlightInfo {
  origin: RouteAirport;
  destination: RouteAirport;
  aircraft_type: string | null;
  flight_number: string | null;
  status: string | null;
  departure_delay: number;
  arrival_delay: number;
  route_distance: number | null;
  estimated_on: string | null;
  actual_on: string | null;
  scheduled_on: string | null;
}

async function fetchFlightInfo(icao24: string, callsign: string): Promise<FlightInfo | null> {
  try {
    const qs = callsign ? `?callsign=${encodeURIComponent(callsign)}` : '';
    const resp = await fetch(`${HTTP_URL}/route/${icao24}${qs}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.origin || !data.destination) return null;
    return data as FlightInfo;
  } catch {
    return null;
  }
}

const metresToFeet = (m: number): number => Math.round(m * 3.28084);
const msToKnots = (ms: number): number => Math.round(ms * 1.94384);
const fpmLabel = (mps: number): string => {
  const fpm = Math.round(mps * 196.85);
  return fpm > 0 ? `+${fpm.toLocaleString()} fpm` : `${fpm.toLocaleString()} fpm`;
};

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

function formatDelay(seconds: number): string {
  if (!seconds || seconds === 0) return 'On time';
  const mins = Math.round(seconds / 60);
  return mins > 0 ? `+${mins} min late` : `${Math.abs(mins)} min early`;
}

const PHASE_BADGE: Record<FlightPhase, { color: string; label: string; glow: string }> = {
  GROUND:     { color: '#a0a0aa', label: 'Ground',     glow: 'rgba(160,160,170,0.3)' },
  CLIMBING:   { color: '#00dc78', label: 'Climbing',   glow: 'rgba(0,220,120,0.3)'   },
  CRUISE:     { color: '#32a0ff', label: 'Cruise',     glow: 'rgba(50,160,255,0.3)'  },
  DESCENDING: { color: '#ffaa00', label: 'Descending', glow: 'rgba(255,170,0,0.3)'   },
};

const STATUS_COLOR: Record<string, string> = {
  'Scheduled':  '#8b949e',
  'En Route':   '#32a0ff',
  'Landing':    '#ffaa00',
  'Landed':     '#00dc78',
  'Cancelled':  '#ff4444',
  'Diverted':   '#ff8800',
};

interface AircraftPanelProps {
  aircraft: Aircraft | null;
  onClose: () => void;
  isTracked: boolean;
  onTrack: () => void;
  onUntrack: () => void;
}

export function AircraftPanel({ aircraft, onClose, isTracked, onTrack, onUntrack }: AircraftPanelProps) {
  const [logoError, setLogoError] = useState(false);
  const [flightInfo, setFlightInfo] = useState<FlightInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);

  useEffect(() => {
    setFlightInfo(null);
    if (!aircraft) return;
    setInfoLoading(true);
    fetchFlightInfo(aircraft.icao24, aircraft.callsign ?? '').then((r) => {
      setFlightInfo(r);
      setInfoLoading(false);
    });
  }, [aircraft?.icao24, aircraft?.callsign]);

  if (!aircraft) return null;

  const phase = PHASE_BADGE[aircraft.flight_phase];
  const airline = lookupAirline(aircraft.callsign);
  const logoUrl = airline && !logoError ? airlineLogoUrl(airline.iata) : null;
  const arrivalTime = flightInfo?.actual_on ?? flightInfo?.estimated_on ?? flightInfo?.scheduled_on;
  const arrDelay = flightInfo?.arrival_delay ?? 0;
  const depDelay = flightInfo?.departure_delay ?? 0;

  return (
    <div style={styles.panel}>
      {/* Accent line */}
      <div style={{ ...styles.accentLine, background: phase.color, boxShadow: `0 0 12px ${phase.glow}` }} />

      {/* Header */}
      <div style={styles.header}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.callsign}>
            {flightInfo?.flight_number || aircraft.callsign?.trim() || '——'}
          </div>
          <div style={styles.icao}>{aircraft.icao24.toUpperCase()}</div>
          {airline && <div style={styles.airlineName}>{airline.name}</div>}
        </div>
        <div style={styles.headerRight}>
          {airline && (
            logoUrl ? (
              <img
                src={logoUrl}
                alt={airline.name}
                style={styles.logo}
                onError={() => setLogoError(true)}
              />
            ) : (
              <div style={{ ...styles.iataBadge, borderColor: phase.color, color: phase.color }}>
                {airline.iata}
              </div>
            )
          )}
          <button
            style={{
              ...styles.trackBtn,
              color: isTracked ? '#00dc78' : '#58a6ff',
              borderColor: isTracked ? 'rgba(0,220,120,0.4)' : 'rgba(88,166,255,0.3)',
              background: isTracked ? 'rgba(0,220,120,0.1)' : 'rgba(88,166,255,0.1)',
            }}
            onClick={isTracked ? onUntrack : onTrack}
          >
            {isTracked ? 'Untrack' : 'Track'}
          </button>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close panel">✕</button>
        </div>
      </div>

      {/* Phase badge + FA status */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' as const }}>
        <div style={{ ...styles.badge, color: phase.color, background: phase.glow, border: `1px solid ${phase.color}40` }}>
          {phase.label}
        </div>
        {flightInfo?.status && (
          <div style={{
            ...styles.badge,
            color: STATUS_COLOR[flightInfo.status] ?? '#8b949e',
            background: `${STATUS_COLOR[flightInfo.status] ?? '#8b949e'}22`,
            border: `1px solid ${STATUS_COLOR[flightInfo.status] ?? '#8b949e'}40`,
          }}>
            {flightInfo.status}
          </div>
        )}
      </div>

      {/* Route */}
      {(flightInfo || infoLoading) && (
        <div style={styles.routeBox}>
          {infoLoading ? (
            <span style={{ color: '#8b949e', fontSize: 12 }}>Loading…</span>
          ) : flightInfo ? (
            <>
              <div style={styles.routeRow}>
                <div style={styles.routeAirport}>
                  <span style={styles.routeIata}>{flightInfo.origin.iata_code}</span>
                  <span style={styles.routeCity}>{flightInfo.origin.municipality}</span>
                  <span style={styles.routeAirportName}>{flightInfo.origin.name}</span>
                </div>
                <div style={styles.routeMiddle}>
                  <svg width="32" height="14" viewBox="0 0 32 14" fill="none" style={{ opacity: 0.4 }}>
                    <path d="M2 7h24M20 2l6 5-6 5" stroke="#8b949e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  {flightInfo.route_distance && (
                    <span style={styles.routeDist}>{flightInfo.route_distance.toLocaleString()} nm</span>
                  )}
                </div>
                <div style={{ ...styles.routeAirport, alignItems: 'flex-end' as const }}>
                  <span style={styles.routeIata}>{flightInfo.destination.iata_code}</span>
                  <span style={styles.routeCity}>{flightInfo.destination.municipality}</span>
                  <span style={{ ...styles.routeAirportName, textAlign: 'right' as const }}>{flightInfo.destination.name}</span>
                </div>
              </div>

              {/* Aircraft type + delays */}
              <div style={styles.routeMeta}>
                {flightInfo.aircraft_type && (
                  <span style={styles.metaChip}>{flightInfo.aircraft_type}</span>
                )}
                {depDelay !== 0 && (
                  <span style={{ ...styles.metaChip, color: depDelay > 0 ? '#ffaa00' : '#00dc78' }}>
                    Dep {formatDelay(depDelay)}
                  </span>
                )}
                {arrDelay !== 0 && (
                  <span style={{ ...styles.metaChip, color: arrDelay > 0 ? '#ffaa00' : '#00dc78' }}>
                    Arr {formatDelay(arrDelay)}
                  </span>
                )}
              </div>

              {/* Arrival time */}
              {arrivalTime && (
                <div style={styles.etaRow}>
                  <span style={{ color: '#8b949e', fontSize: 11 }}>
                    {flightInfo.actual_on ? 'Landed' : 'ETA'}
                  </span>
                  <span style={{ color: '#e6edf3', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {formatTime(arrivalTime)}
                  </span>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Data rows */}
      <div style={styles.dataGrid}>
        <DataRow
          label="Altitude"
          value={aircraft.altitude != null ? `${metresToFeet(aircraft.altitude).toLocaleString()} ft` : '—'}
        />
        <DataRow
          label="Speed"
          value={aircraft.velocity != null ? `${msToKnots(aircraft.velocity)} kts` : '—'}
        />
        <DataRow
          label="Heading"
          value={aircraft.heading != null ? `${Math.round(aircraft.heading)}°` : '—'}
        />
        {aircraft.vertical_rate != null && (
          <DataRow
            label="Vert. Rate"
            value={fpmLabel(aircraft.vertical_rate)}
            valueColor={
              aircraft.vertical_rate > 1 ? '#00dc78' : aircraft.vertical_rate < -1 ? '#ffaa00' : '#8b949e'
            }
          />
        )}
        <DataRow label="Position" value={`${aircraft.lat.toFixed(4)}°, ${aircraft.lon.toFixed(4)}°`} />
        <DataRow label="On Ground" value={aircraft.on_ground ? 'Yes' : 'No'} />
      </div>
    </div>
  );
}

function DataRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={{ ...styles.rowValue, ...(valueColor ? { color: valueColor } : {}) }}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 64,
    right: 16,
    width: 300,
    background: 'rgba(10, 14, 20, 0.94)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 14,
    padding: '0 16px 16px',
    color: '#e6edf3',
    zIndex: 100,
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
    overflow: 'hidden',
  },
  accentLine: {
    height: 3,
    marginLeft: -16,
    marginRight: -16,
    marginBottom: 14,
    borderRadius: '14px 14px 0 0',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  callsign: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: 1.5,
    color: '#f0f6fc',
  },
  icao: {
    fontSize: 11,
    color: '#8b949e',
    marginTop: 3,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  headerRight: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 6,
    flexShrink: 0,
    marginLeft: 8,
  },
  airlineName: {
    fontSize: 11,
    color: '#58a6ff',
    marginTop: 4,
    fontWeight: 500,
  },
  logo: {
    height: 28,
    maxWidth: 90,
    objectFit: 'contain',
    filter: 'brightness(0) invert(1)',
    opacity: 0.85,
  },
  iataBadge: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: 1.5,
    border: '1px solid',
    borderRadius: 5,
    padding: '2px 8px',
    fontFamily: 'monospace',
  },
  trackBtn: {
    border: '1px solid',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.5,
    cursor: 'pointer',
    padding: '4px 10px',
    borderRadius: 6,
    lineHeight: 1,
    transition: 'color 0.2s, background 0.2s, border-color 0.2s',
  },
  closeBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#8b949e',
    fontSize: 14,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 6,
    lineHeight: 1,
  },
  badge: {
    display: 'inline-block',
    padding: '3px 12px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 0.5,
  },
  routeBox: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: '10px 14px',
    marginBottom: 14,
  },
  routeRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  routeMiddle: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    paddingTop: 2,
    flexShrink: 0,
  },
  routeDist: {
    fontSize: 10,
    color: '#8b949e',
    whiteSpace: 'nowrap',
  },
  routeAirport: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  routeIata: {
    fontSize: 18,
    fontWeight: 700,
    fontFamily: 'monospace',
    letterSpacing: 2,
    color: '#f0f6fc',
    lineHeight: 1,
  },
  routeCity: {
    fontSize: 10,
    color: '#8b949e',
    letterSpacing: 0.3,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 95,
  },
  routeAirportName: {
    fontSize: 9,
    color: '#6e7681',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: 95,
  },
  routeMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  metaChip: {
    fontSize: 11,
    color: '#8b949e',
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 4,
    padding: '2px 7px',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  etaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  dataGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 13,
    borderBottom: '1px solid rgba(255,255,255,0.05)',
    padding: '7px 0',
  },
  rowLabel: {
    color: '#8b949e',
  },
  rowValue: {
    color: '#e6edf3',
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
  },
};
