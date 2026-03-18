import { useState } from 'react';
import type { Aircraft, FlightPhase } from '../types';
import { lookupAirline, airlineLogoUrl } from '../data/airlines';

const metresToFeet = (m: number): number => Math.round(m * 3.28084);
const msToKnots = (ms: number): number => Math.round(ms * 1.94384);
const fpmLabel = (mps: number): string => {
  const fpm = Math.round(mps * 196.85);
  return fpm > 0 ? `+${fpm.toLocaleString()} fpm` : `${fpm.toLocaleString()} fpm`;
};

const PHASE_BADGE: Record<FlightPhase, { color: string; label: string; glow: string }> = {
  GROUND:     { color: '#a0a0aa', label: 'Ground',     glow: 'rgba(160,160,170,0.3)' },
  CLIMBING:   { color: '#00dc78', label: 'Climbing',   glow: 'rgba(0,220,120,0.3)'   },
  CRUISE:     { color: '#32a0ff', label: 'Cruise',     glow: 'rgba(50,160,255,0.3)'  },
  DESCENDING: { color: '#ffaa00', label: 'Descending', glow: 'rgba(255,170,0,0.3)'   },
};

interface AircraftPanelProps {
  aircraft: Aircraft | null;
  onClose: () => void;
}

export function AircraftPanel({ aircraft, onClose }: AircraftPanelProps) {
  const [logoError, setLogoError] = useState(false);

  if (!aircraft) return null;

  const phase = PHASE_BADGE[aircraft.flight_phase];
  const airline = lookupAirline(aircraft.callsign);
  const logoUrl = airline && !logoError ? airlineLogoUrl(airline.iata) : null;

  return (
    <div style={styles.panel}>
      {/* Accent line */}
      <div style={{ ...styles.accentLine, background: phase.color, boxShadow: `0 0 12px ${phase.glow}` }} />

      {/* Header */}
      <div style={styles.header}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={styles.callsign}>
            {aircraft.callsign?.trim() || '——'}
          </div>
          <div style={styles.icao}>{aircraft.icao24.toUpperCase()}</div>
          {airline && (
            <div style={styles.airlineName}>{airline.name}</div>
          )}
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
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close panel">
            ✕
          </button>
        </div>
      </div>

      {/* Phase badge */}
      <div
        style={{
          ...styles.badge,
          color: phase.color,
          background: phase.glow,
          border: `1px solid ${phase.color}40`,
        }}
      >
        {phase.label}
      </div>

      {/* Data rows */}
      <div style={styles.dataGrid}>
        <DataRow
          label="Altitude"
          value={
            aircraft.altitude != null
              ? `${metresToFeet(aircraft.altitude).toLocaleString()} ft`
              : '—'
          }
        />
        <DataRow
          label="Speed"
          value={
            aircraft.velocity != null
              ? `${msToKnots(aircraft.velocity)} kts`
              : '—'
          }
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
              aircraft.vertical_rate > 1
                ? '#00dc78'
                : aircraft.vertical_rate < -1
                ? '#ffaa00'
                : '#8b949e'
            }
          />
        )}
        <DataRow
          label="Position"
          value={`${aircraft.lat.toFixed(4)}°, ${aircraft.lon.toFixed(4)}°`}
        />
        <DataRow label="On Ground" value={aircraft.on_ground ? 'Yes' : 'No'} />
      </div>
    </div>
  );
}

function DataRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={{ ...styles.rowValue, ...(valueColor ? { color: valueColor } : {}) }}>
        {value}
      </span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 64,
    right: 16,
    width: 290,
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
    marginBottom: 14,
    letterSpacing: 0.5,
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
