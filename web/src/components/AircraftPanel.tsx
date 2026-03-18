import type { Aircraft, FlightPhase } from '../types';

// ── Unit conversion helpers ────────────────────────────────────────────────────
const metresToFeet = (m: number): number => Math.round(m * 3.28084);
const msToKnots = (ms: number): number => Math.round(ms * 1.94384);

// ── Phase badge colours ────────────────────────────────────────────────────────
const PHASE_BADGE: Record<FlightPhase, { bg: string; label: string }> = {
  GROUND:     { bg: '#6b7280', label: 'Ground'     },
  CLIMBING:   { bg: '#10b981', label: 'Climbing'   },
  CRUISE:     { bg: '#3b82f6', label: 'Cruise'     },
  DESCENDING: { bg: '#f59e0b', label: 'Descending' },
};

interface AircraftPanelProps {
  aircraft: Aircraft | null;
  onClose: () => void;
}

export function AircraftPanel({ aircraft, onClose }: AircraftPanelProps) {
  if (!aircraft) return null;

  const phase = PHASE_BADGE[aircraft.flight_phase];

  return (
    <div style={styles.panel}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <div style={styles.callsign}>
            {aircraft.callsign ?? '——'}
          </div>
          <div style={styles.icao}>{aircraft.icao24.toUpperCase()}</div>
        </div>
        <button style={styles.closeBtn} onClick={onClose} aria-label="Close panel">
          ✕
        </button>
      </div>

      {/* Phase badge */}
      <div style={{ ...styles.badge, backgroundColor: phase.bg }}>
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
          value={
            aircraft.heading != null
              ? `${Math.round(aircraft.heading)}°`
              : '—'
          }
        />
        <DataRow
          label="Position"
          value={
            `${aircraft.lat.toFixed(4)}° N, ${aircraft.lon.toFixed(4)}°`
          }
        />
        <DataRow
          label="On Ground"
          value={aircraft.on_ground ? 'Yes' : 'No'}
        />
      </div>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={styles.rowValue}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 64,
    right: 16,
    width: 280,
    background: 'rgba(13, 17, 23, 0.92)',
    backdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 12,
    padding: '16px',
    color: '#e6edf3',
    zIndex: 100,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  callsign: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: 1,
    color: '#f0f6fc',
  },
  icao: {
    fontSize: 12,
    color: '#8b949e',
    marginTop: 2,
    fontFamily: 'monospace',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#8b949e',
    fontSize: 16,
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: 4,
  },
  badge: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: 20,
    fontSize: 12,
    fontWeight: 600,
    marginBottom: 14,
    color: '#fff',
  },
  dataGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 14,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    paddingBottom: 6,
  },
  rowLabel: {
    color: '#8b949e',
  },
  rowValue: {
    color: '#e6edf3',
    fontWeight: 500,
  },
};
