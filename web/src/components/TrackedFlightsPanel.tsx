import { useEffect, useRef, useState } from 'react';
import type { Aircraft, FlightPhase } from '../types';
import { lookupAirline } from '../data/airlines';

const _WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) || 'ws://localhost:8000/ws';
const HTTP_URL = _WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '');

const PHASE_COLORS: Record<FlightPhase, string> = {
  GROUND:     '#a0a0aa',
  CLIMBING:   '#00dc78',
  CRUISE:     '#32a0ff',
  DESCENDING: '#ffaa00',
};

const PHASE_LABELS: Record<FlightPhase, string> = {
  GROUND:     'GND',
  CLIMBING:   'CLB',
  CRUISE:     'CRZ',
  DESCENDING: 'DSC',
};

const metresToFeet = (m: number) => Math.round(m * 3.28084);
const msToKnots = (ms: number) => Math.round(ms * 1.94384);

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Arriving';
  const totalMins = Math.round(diff / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function hexToRgb(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '255,255,255';
  return `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}`;
}

interface TrackedFlightsPanelProps {
  trackedIcao24s: string[];
  aircraft: Aircraft[];
  activeIcao24: string | null;
  onFocus: (icao24: string) => void;
  onRemove: (icao24: string) => void;
}

export function TrackedFlightsPanel({
  trackedIcao24s,
  aircraft,
  activeIcao24,
  onFocus,
  onRemove,
}: TrackedFlightsPanelProps) {
  interface FlightMeta { eta: string | null; origin: string | null; destination: string | null; }
  // Cache of icao24 → flight meta
  const [meta, setMeta] = useState<Record<string, FlightMeta>>({});
  // Tick every minute to refresh displayed countdown
  const [, setTick] = useState(0);
  const fetchedRef = useRef<Set<string>>(new Set());

  // Fetch ETA for newly tracked flights
  useEffect(() => {
    for (const id of trackedIcao24s) {
      if (fetchedRef.current.has(id)) continue;
      fetchedRef.current.add(id);
      const ac = aircraft.find((a) => a.icao24 === id);
      const callsign = ac?.callsign?.trim() ?? '';
      if (!callsign) continue;
      fetch(`${HTTP_URL}/route/${id}?callsign=${encodeURIComponent(callsign)}`)
        .then((r) => r.json())
        .then((data) => {
          setMeta((prev) => ({
            ...prev,
            [id]: {
              eta: data.actual_on ?? data.estimated_on ?? data.scheduled_on ?? null,
              origin: data.origin?.iata_code ?? null,
              destination: data.destination?.iata_code ?? null,
            },
          }));
        })
        .catch(() => {});
    }
    // Clean up removed flights
    setMeta((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        if (!trackedIcao24s.includes(id)) {
          delete next[id];
          fetchedRef.current.delete(id);
        }
      }
      return next;
    });
  }, [trackedIcao24s, aircraft]);

  // Countdown ticker — update every 30s
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  if (trackedIcao24s.length === 0) return null;

  const tracked = trackedIcao24s.map((id) => ({
    id,
    ac: aircraft.find((a) => a.icao24 === id) ?? null,
  }));

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.headerLabel}>Tracking</span>
        <span style={styles.headerCount}>{trackedIcao24s.length}</span>
      </div>

      <div style={styles.list}>
        {tracked.map(({ id, ac }) => {
          const isActive = id === activeIcao24;
          const phase = ac?.flight_phase ?? 'CRUISE';
          const color = PHASE_COLORS[phase];
          const callsign = ac?.callsign?.trim() || id.toUpperCase();
          const airline = lookupAirline(ac?.callsign ?? '');
          const flightMeta = meta[id];
          const eta = flightMeta?.eta;
          const origin = flightMeta?.origin;
          const destination = flightMeta?.destination;

          return (
            <div
              key={id}
              onClick={() => onFocus(id)}
              style={{
                ...styles.card,
                borderColor: isActive ? color : 'rgba(255,255,255,0.07)',
                background: isActive ? `rgba(${hexToRgb(color)},0.08)` : 'rgba(255,255,255,0.03)',
              }}
            >
              <div style={{ ...styles.accentBar, background: color }} />

              <div style={styles.cardBody}>
                <div style={styles.cardTop}>
                  <div style={styles.cardLeft}>
                    <span style={styles.callsign}>{callsign}</span>
                    {airline && <span style={styles.airline}>{airline.name}</span>}
                  </div>
                  <button
                    style={styles.removeBtn}
                    onClick={(e) => { e.stopPropagation(); onRemove(id); }}
                    title="Stop tracking"
                  >
                    ✕
                  </button>
                </div>

                <div style={styles.cardStats}>
                  <span style={{ ...styles.phaseBadge, color, background: `rgba(${hexToRgb(color)},0.15)` }}>
                    {PHASE_LABELS[phase]}
                  </span>
                  {ac?.altitude != null && (
                    <span style={styles.stat}>{metresToFeet(ac.altitude).toLocaleString()} ft</span>
                  )}
                  {ac?.velocity != null && (
                    <span style={styles.stat}>{msToKnots(ac.velocity)} kts</span>
                  )}
                  {!ac && <span style={styles.stale}>No signal</span>}
                </div>

                {origin && destination && (
                  <div style={styles.routeLine}>
                    <span style={styles.routeCode}>{origin}</span>
                    <span style={styles.routeArrow}>→</span>
                    <span style={styles.routeCode}>{destination}</span>
                  </div>
                )}

                {eta && (
                  <div style={styles.etaRow}>
                    <span style={styles.etaLabel}>ETA</span>
                    <span style={styles.etaValue}>{timeUntil(eta)}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 64,
    left: 16,
    width: 220,
    background: 'rgba(10,14,20,0.94)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    overflow: 'hidden',
    zIndex: 100,
    boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
    maxHeight: 'calc(100vh - 120px)',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    padding: '10px 14px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#8b949e',
    letterSpacing: 1,
    textTransform: 'uppercase',
    flex: 1,
  },
  headerCount: {
    fontSize: 11,
    fontWeight: 700,
    color: '#58a6ff',
    background: 'rgba(88,166,255,0.15)',
    borderRadius: 10,
    padding: '1px 7px',
  },
  list: {
    overflowY: 'auto',
    flex: 1,
    padding: '6px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  card: {
    borderRadius: 8,
    border: '1px solid',
    cursor: 'pointer',
    overflow: 'hidden',
    transition: 'border-color 0.2s, background 0.2s',
  },
  accentBar: {
    height: 2,
    width: '100%',
  },
  cardBody: {
    padding: '7px 10px 8px',
  },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 5,
  },
  cardLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    minWidth: 0,
  },
  callsign: {
    fontSize: 14,
    fontWeight: 700,
    color: '#f0f6fc',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  airline: {
    fontSize: 10,
    color: '#58a6ff',
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 130,
  },
  removeBtn: {
    background: 'none',
    border: 'none',
    color: '#6e7681',
    cursor: 'pointer',
    fontSize: 11,
    padding: '0 2px',
    lineHeight: 1,
    flexShrink: 0,
  },
  cardStats: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  phaseBadge: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: 0.5,
    borderRadius: 3,
    padding: '2px 5px',
    fontFamily: 'monospace',
  },
  stat: {
    fontSize: 11,
    color: '#8b949e',
    fontVariantNumeric: 'tabular-nums',
  },
  stale: {
    fontSize: 10,
    color: '#6e7681',
    fontStyle: 'italic',
  },
  routeLine: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  routeCode: {
    fontSize: 11,
    fontWeight: 700,
    fontFamily: 'monospace',
    color: '#c9d1d9',
    letterSpacing: 0.5,
  },
  routeArrow: {
    fontSize: 10,
    color: '#6e7681',
  },
  etaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 7,
    paddingTop: 6,
    borderTop: '1px solid rgba(255,255,255,0.05)',
  },
  etaLabel: {
    fontSize: 10,
    color: '#6e7681',
    letterSpacing: 0.5,
  },
  etaValue: {
    fontSize: 13,
    fontWeight: 700,
    color: '#e6edf3',
    fontVariantNumeric: 'tabular-nums',
  },
};
