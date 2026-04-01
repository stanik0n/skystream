import { useState, useEffect } from 'react';
import type { Aircraft, FlightPhase } from '../types';
import { lookupAirline } from '../data/airlines';
import { useIsMobile } from '../hooks/useIsMobile';

const _WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) || 'ws://localhost:8000/ws';
const HTTP_URL = _WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '');

interface RouteAirport { iata_code: string; municipality: string; name: string; }
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
  } catch { return null; }
}

const metresToFeet = (m: number) => Math.round(m * 3.28084);
const msToKnots = (ms: number) => Math.round(ms * 1.94384);
const fpmLabel = (mps: number) => { const fpm = Math.round(mps * 196.85); return fpm > 0 ? `+${fpm.toLocaleString()} fpm` : `${fpm.toLocaleString()} fpm`; };

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

function formatDelay(s: number): string {
  if (!s) return 'On time';
  const m = Math.round(s / 60);
  return m > 0 ? `+${m} min late` : `${Math.abs(m)} min early`;
}

const PHASE_BADGE: Record<FlightPhase, { color: string; label: string }> = {
  GROUND:     { color: '#a0a0aa', label: 'GROUND'     },
  CLIMBING:   { color: '#00dc78', label: 'CLIMBING'   },
  CRUISE:     { color: '#00e5ff', label: 'CRUISE'     },
  DESCENDING: { color: '#ffaa00', label: 'DESCENDING' },
};

interface AircraftPanelProps {
  aircraft: Aircraft | null;
  onClose: () => void;
  isTracked: boolean;
  onTrack: () => void;
  onUntrack: () => void;
}

export function AircraftPanel({ aircraft, onClose, isTracked, onTrack, onUntrack }: AircraftPanelProps) {
  const isMobile = useIsMobile();
  const [flightInfo, setFlightInfo] = useState<FlightInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setFlightInfo(null);
    setExpanded(false);
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
  const displayName = flightInfo?.flight_number || aircraft.callsign?.trim() || aircraft.icao24.toUpperCase();
  const arrivalTime = flightInfo?.actual_on ?? flightInfo?.estimated_on ?? flightInfo?.scheduled_on;

  // Glass panel styles
  const glassPanel: React.CSSProperties = {
    background: 'rgba(14,14,14,0.65)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: 12,
    boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
  };

  const panelStyle: React.CSSProperties = isMobile ? {
    position: 'fixed',
    bottom: 0, left: 0, right: 0,
    maxHeight: '75vh',
    background: 'rgba(14,14,14,0.97)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderTop: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '12px 12px 0 0',
    padding: '0 20px 32px',
    color: '#e5e2e1',
    zIndex: 160,
    overflowY: 'auto',
    boxShadow: '0 -20px 40px rgba(0,0,0,0.5)',
  } : {
    ...glassPanel,
    position: 'absolute',
    top: 32, right: 32,
    width: 320,
    maxHeight: 'calc(100vh - 120px)',
    padding: 24,
    color: '#e5e2e1',
    zIndex: 30,
    overflowY: 'auto',
  };

  return (
    <div style={panelStyle}>
      {/* Mobile drag handle */}
      {isMobile && (
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.15)', borderRadius: 2, margin: '12px auto 16px' }} />
      )}

      {/* Phase accent bar */}
      <div style={{
        height: 2,
        background: `linear-gradient(90deg, ${phase.color}00, ${phase.color}, ${phase.color}00)`,
        marginBottom: 20,
        borderRadius: 1,
        ...(isMobile ? { marginLeft: -20, marginRight: -20 } : { marginLeft: -24, marginRight: -24 }),
      }} />

      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <p style={{ fontSize: 10, color: '#849396', letterSpacing: '0.2em', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', marginBottom: 4 }}>
            Active Tracking
          </p>
          <p style={{ fontSize: 26, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif', color: '#c3f5ff', letterSpacing: '-0.02em', lineHeight: 1 }}>
            {displayName}
          </p>
          {airline && (
            <p style={{ fontSize: 11, color: '#849396', marginTop: 4, fontFamily: 'Inter, sans-serif' }}>{airline.name}</p>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          {/* Phase badge */}
          <div style={{
            padding: '4px 10px',
            background: `${phase.color}18`,
            border: `1px solid ${phase.color}33`,
            borderRadius: 6,
            fontSize: 10, fontWeight: 700,
            color: phase.color,
            fontFamily: 'Space Grotesk, sans-serif',
            letterSpacing: '0.05em',
          }}>{phase.label}</div>
          {/* Close + Track */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={isTracked ? onUntrack : onTrack}
              style={{
                padding: '4px 10px',
                background: isTracked ? 'rgba(0,220,120,0.1)' : 'rgba(0,229,255,0.1)',
                border: `1px solid ${isTracked ? 'rgba(0,220,120,0.4)' : 'rgba(0,229,255,0.3)'}`,
                borderRadius: 6,
                color: isTracked ? '#00dc78' : '#00e5ff',
                fontSize: 11, fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
              }}
            >{isTracked ? 'Untrack' : 'Track'}</button>
            <button
              onClick={onClose}
              style={{
                padding: '4px 8px',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 6,
                color: '#849396',
                fontSize: 13, cursor: 'pointer',
              }}
            >✕</button>
          </div>
        </div>
      </div>

      {/* Route section */}
      {(flightInfo || infoLoading) && (
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 10,
          padding: '14px 16px',
          marginBottom: 16,
        }}>
          {infoLoading ? (
            <p style={{ color: '#849396', fontSize: 12, textAlign: 'center' }}>Loading route…</p>
          ) : flightInfo ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: 22, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif', color: '#e5e2e1', lineHeight: 1 }}>
                    {flightInfo.origin.iata_code}
                  </p>
                  <p style={{ fontSize: 10, color: '#849396', marginTop: 3 }}>{flightInfo.origin.municipality}</p>
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 12px' }}>
                  <div style={{ width: '100%', height: 1, background: 'rgba(59,73,76,1)', position: 'relative', marginBottom: 8 }}>
                    <span className="material-symbols-outlined" style={{
                      position: 'absolute', top: '50%', left: '50%',
                      transform: 'translate(-50%, -50%) rotate(90deg)',
                      fontSize: 16, color: '#c3f5ff',
                      background: 'rgba(14,14,14,0.65)',
                      padding: '0 4px',
                    }}>flight</span>
                  </div>
                  {arrivalTime && (
                    <p style={{ fontSize: 9, color: '#849396', whiteSpace: 'nowrap', fontFamily: 'Inter, sans-serif' }}>
                      {flightInfo.actual_on ? 'LANDED' : 'ETA'} {formatTime(arrivalTime)}
                    </p>
                  )}
                  {flightInfo.route_distance && (
                    <p style={{ fontSize: 9, color: '#52525b', marginTop: 2 }}>
                      {flightInfo.route_distance.toLocaleString()} nm
                    </p>
                  )}
                </div>

                <div style={{ textAlign: 'center' }}>
                  <p style={{ fontSize: 22, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif', color: '#e5e2e1', lineHeight: 1 }}>
                    {flightInfo.destination.iata_code}
                  </p>
                  <p style={{ fontSize: 10, color: '#849396', marginTop: 3 }}>{flightInfo.destination.municipality}</p>
                </div>
              </div>

              {/* Delays + aircraft type */}
              {(flightInfo.aircraft_type || flightInfo.departure_delay || flightInfo.arrival_delay) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {flightInfo.aircraft_type && (
                    <span style={{ fontSize: 10, color: '#849396', background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '2px 7px', fontFamily: 'Inter, sans-serif' }}>
                      {flightInfo.aircraft_type}
                    </span>
                  )}
                  {flightInfo.status && (
                    <span style={{ fontSize: 10, color: '#00dc78', background: 'rgba(0,220,120,0.08)', borderRadius: 4, padding: '2px 7px' }}>
                      {flightInfo.status}
                    </span>
                  )}
                  {flightInfo.departure_delay !== 0 && (
                    <span style={{ fontSize: 10, color: flightInfo.departure_delay > 0 ? '#ffaa00' : '#00dc78', background: 'rgba(255,255,255,0.05)', borderRadius: 4, padding: '2px 7px' }}>
                      Dep {formatDelay(flightInfo.departure_delay)}
                    </span>
                  )}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* Altitude + Speed grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 8, padding: '12px 14px',
        }}>
          <p style={{ fontSize: 9, color: '#849396', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, fontFamily: 'Inter, sans-serif' }}>Altitude</p>
          <p style={{ fontSize: 18, fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif', color: '#e5e2e1', lineHeight: 1 }}>
            {aircraft.altitude != null ? (
              <>{metresToFeet(aircraft.altitude).toLocaleString()} <span style={{ fontSize: 10, fontWeight: 400, color: '#849396' }}>ft</span></>
            ) : '—'}
          </p>
        </div>
        <div style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 8, padding: '12px 14px',
        }}>
          <p style={{ fontSize: 9, color: '#849396', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6, fontFamily: 'Inter, sans-serif' }}>Ground Speed</p>
          <p style={{ fontSize: 18, fontWeight: 600, fontFamily: 'Space Grotesk, sans-serif', color: '#e5e2e1', lineHeight: 1 }}>
            {aircraft.velocity != null ? (
              <>{msToKnots(aircraft.velocity)} <span style={{ fontSize: 10, fontWeight: 400, color: '#849396' }}>kts</span></>
            ) : '—'}
          </p>
        </div>
      </div>

      {/* Expand button → full telemetry */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: '100%',
          background: 'linear-gradient(90deg, #c3f5ff, #00e5ff)',
          border: 'none',
          borderRadius: 8,
          color: '#00363d',
          fontWeight: 700,
          fontSize: 12,
          letterSpacing: '0.08em',
          padding: '12px 0',
          cursor: 'pointer',
          fontFamily: 'Space Grotesk, sans-serif',
          textTransform: 'uppercase',
          boxShadow: '0 4px 20px rgba(0,229,255,0.2)',
          transition: 'filter 0.2s',
          marginBottom: expanded ? 16 : 0,
        }}
      >
        {expanded ? 'Hide Telemetry' : 'View Full Flight Telemetry'}
      </button>

      {/* Expanded telemetry */}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {[
            { label: 'Heading', value: aircraft.heading != null ? `${Math.round(aircraft.heading)}°` : '—' },
            aircraft.vertical_rate != null && { label: 'Vert. Rate', value: fpmLabel(aircraft.vertical_rate), color: aircraft.vertical_rate > 1 ? '#00dc78' : aircraft.vertical_rate < -1 ? '#ffaa00' : '#849396' },
            { label: 'Position', value: `${aircraft.lat.toFixed(4)}°, ${aircraft.lon.toFixed(4)}°` },
            { label: 'ICAO24', value: aircraft.icao24.toUpperCase() },
            { label: 'On Ground', value: aircraft.on_ground ? 'Yes' : 'No' },
          ].filter(Boolean).map((row) => {
            const r = row as { label: string; value: string; color?: string };
            return (
              <div key={r.label} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                fontSize: 12,
              }}>
                <span style={{ color: '#849396', fontFamily: 'Inter, sans-serif' }}>{r.label}</span>
                <span style={{ color: r.color ?? '#e5e2e1', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
