import { useEffect, useRef, useState } from 'react';
import type { FlightPhase } from '../types';

interface PhaseCounts {
  GROUND: number;
  CLIMBING: number;
  CRUISE: number;
  DESCENDING: number;
}

interface StatsBarProps {
  count: number;
  connected: boolean;
  lastUpdate: Date | null;
  phaseCounts: PhaseCounts;
}

// Smoothly animate a number to a new target value
function useAnimatedCount(target: number, duration = 600): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const start = fromRef.current;
    const end = target;
    if (start === end) return;

    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // cubic ease-out
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        fromRef.current = end;
      }
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [target, duration]);

  return display;
}

const PHASE_DOT_COLORS: Record<FlightPhase, string> = {
  GROUND:     'rgb(160,160,170)',
  CLIMBING:   'rgb(0,220,120)',
  CRUISE:     'rgb(50,160,255)',
  DESCENDING: 'rgb(255,170,0)',
};

export function StatsBar({ count, connected, lastUpdate, phaseCounts }: StatsBarProps) {
  const animatedCount = useAnimatedCount(count);

  const formattedTime = lastUpdate
    ? lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  return (
    <div style={styles.bar}>
      {/* Branding */}
      <div style={styles.brand}>
        <span style={styles.brandIcon}>✈</span>
        <span style={styles.brandName}>SkyStream</span>
      </div>

      {/* Phase breakdown */}
      <div style={styles.phaseRow}>
        {(Object.keys(phaseCounts) as FlightPhase[]).map((phase) => (
          <div key={phase} style={styles.phaseItem}>
            <span
              style={{
                ...styles.phaseDot,
                background: PHASE_DOT_COLORS[phase],
                boxShadow: `0 0 5px ${PHASE_DOT_COLORS[phase]}`,
              }}
            />
            <span style={styles.phaseCount}>{phaseCounts[phase].toLocaleString()}</span>
          </div>
        ))}
      </div>

      {/* Right stats */}
      <div style={styles.stats}>
        <StatItem label="Aircraft" value={animatedCount.toLocaleString()} />
        <div style={styles.divider} />
        <StatItem label="Updated" value={formattedTime} />
        <div style={styles.divider} />
        <div style={styles.statusDot}>
          <span
            style={{
              ...styles.dot,
              backgroundColor: connected ? '#22c55e' : '#ef4444',
              boxShadow: connected
                ? '0 0 7px rgba(34,197,94,0.8)'
                : '0 0 7px rgba(239,68,68,0.8)',
            }}
          />
          <span style={styles.statusText}>{connected ? 'Live' : 'Disconnected'}</span>
        </div>
      </div>
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.statItem}>
      <span style={styles.statLabel}>{label}</span>
      <span style={styles.statValue}>{value}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 52,
    background: 'rgba(10, 14, 20, 0.92)',
    backdropFilter: 'blur(10px)',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 20px',
    zIndex: 200,
    color: '#e6edf3',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minWidth: 130,
  },
  brandIcon: {
    fontSize: 20,
  },
  brandName: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: 0.5,
    color: '#58a6ff',
  },
  phaseRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  phaseItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
  },
  phaseDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0,
  },
  phaseCount: {
    fontSize: 13,
    fontWeight: 600,
    color: '#c9d1d9',
    fontVariantNumeric: 'tabular-nums',
  },
  stats: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    minWidth: 220,
    justifyContent: 'flex-end',
  },
  statItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 1,
  },
  statLabel: {
    fontSize: 10,
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 15,
    fontWeight: 600,
    color: '#f0f6fc',
    fontVariantNumeric: 'tabular-nums',
  },
  divider: {
    width: 1,
    height: 28,
    background: 'rgba(255,255,255,0.1)',
  },
  statusDot: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0,
  },
  statusText: {
    fontSize: 13,
    fontWeight: 500,
    color: '#e6edf3',
  },
};
