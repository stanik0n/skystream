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
  onSearch: (query: string) => boolean; // returns true if found
}

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
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        fromRef.current = end;
      }
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, duration]);

  return display;
}

const PHASE_DOT_COLORS: Record<FlightPhase, string> = {
  GROUND:     'rgb(160,160,170)',
  CLIMBING:   'rgb(0,220,120)',
  CRUISE:     'rgb(50,160,255)',
  DESCENDING: 'rgb(255,170,0)',
};

export function StatsBar({ count, connected, lastUpdate, phaseCounts, onSearch }: StatsBarProps) {
  const animatedCount = useAnimatedCount(count);
  const [query, setQuery] = useState('');
  const [notFound, setNotFound] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const formattedTime = lastUpdate
    ? lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  const handleSearch = () => {
    if (!query.trim()) return;
    const found = onSearch(query.trim());
    if (!found) {
      setNotFound(true);
      setTimeout(() => setNotFound(false), 2000);
    } else {
      setQuery('');
    }
  };

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
            <span style={{ ...styles.phaseDot, background: PHASE_DOT_COLORS[phase], boxShadow: `0 0 5px ${PHASE_DOT_COLORS[phase]}` }} />
            <span style={styles.phaseCount}>{phaseCounts[phase].toLocaleString()}</span>
          </div>
        ))}
      </div>

      {/* Flight search */}
      <div style={styles.searchWrapper}>
        <input
          ref={inputRef}
          style={{
            ...styles.searchInput,
            borderColor: notFound ? 'rgba(239,68,68,0.6)' : 'rgba(255,255,255,0.12)',
          }}
          placeholder="Track flight…"
          value={query}
          onChange={(e) => setQuery(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          spellCheck={false}
        />
        <button style={styles.searchBtn} onClick={handleSearch} title="Track flight">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
        </button>
        {notFound && (
          <div style={styles.notFound}>Not found</div>
        )}
      </div>

      {/* Right stats */}
      <div style={styles.stats}>
        <StatItem label="Aircraft" value={animatedCount.toLocaleString()} />
        <div style={styles.divider} />
        <StatItem label="Updated" value={formattedTime} />
        <div style={styles.divider} />
        <div style={styles.statusDot}>
          <span style={{
            ...styles.dot,
            backgroundColor: connected ? '#22c55e' : '#ef4444',
            boxShadow: connected ? '0 0 7px rgba(34,197,94,0.8)' : '0 0 7px rgba(239,68,68,0.8)',
          }} />
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
    gap: 20,
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  brandIcon: { fontSize: 20 },
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
  searchWrapper: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    flex: '0 0 auto',
  },
  searchInput: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid',
    borderRight: 'none',
    borderRadius: '8px 0 0 8px',
    color: '#f0f6fc',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: 1,
    padding: '5px 12px',
    width: 140,
    outline: 'none',
    fontFamily: 'monospace',
    transition: 'border-color 0.2s',
  },
  searchBtn: {
    background: 'rgba(88,166,255,0.15)',
    border: '1px solid rgba(88,166,255,0.3)',
    borderRadius: '0 8px 8px 0',
    color: '#58a6ff',
    cursor: 'pointer',
    padding: '6px 10px',
    display: 'flex',
    alignItems: 'center',
    height: '100%',
    transition: 'background 0.15s',
  },
  notFound: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    background: 'rgba(239,68,68,0.15)',
    border: '1px solid rgba(239,68,68,0.4)',
    borderRadius: 6,
    color: '#f87171',
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 10px',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  },
  stats: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    flexShrink: 0,
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
