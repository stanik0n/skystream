interface StatsBarProps {
  count: number;
  connected: boolean;
  lastUpdate: Date | null;
}

export function StatsBar({ count, connected, lastUpdate }: StatsBarProps) {
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

      {/* Stats */}
      <div style={styles.stats}>
        <StatItem label="Aircraft" value={count.toLocaleString()} />
        <div style={styles.divider} />
        <StatItem label="Updated" value={formattedTime} />
        <div style={styles.divider} />
        <div style={styles.statusDot}>
          <span
            style={{
              ...styles.dot,
              backgroundColor: connected ? '#22c55e' : '#ef4444',
              boxShadow: connected
                ? '0 0 6px rgba(34,197,94,0.7)'
                : '0 0 6px rgba(239,68,68,0.7)',
            }}
          />
          <span style={styles.statusText}>
            {connected ? 'Live' : 'Disconnected'}
          </span>
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
    background: 'rgba(13, 17, 23, 0.9)',
    backdropFilter: 'blur(8px)',
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
  stats: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
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
