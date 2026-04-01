import { useEffect, useRef, useState } from 'react';
import type { Aircraft, FlightPhase } from '../types';
import { lookupAirline } from '../data/airlines';
import { useIsMobile } from '../hooks/useIsMobile';

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

// ── Alert localStorage helpers ─────────────────────────────────────────────────
const ALERTS_KEY = 'sky_alerts';
const LAST_EMAIL_KEY = 'sky_alert_email';

function getStoredAlerts(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(ALERTS_KEY) ?? '{}'); } catch { return {}; }
}
function setStoredAlert(icao24: string, email: string) {
  const map = getStoredAlerts();
  map[icao24] = email;
  localStorage.setItem(ALERTS_KEY, JSON.stringify(map));
  localStorage.setItem(LAST_EMAIL_KEY, email);
}
function removeStoredAlert(icao24: string) {
  const map = getStoredAlerts();
  delete map[icao24];
  localStorage.setItem(ALERTS_KEY, JSON.stringify(map));
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
  const isMobile = useIsMobile();

  interface FlightMeta { eta: string | null; origin: string | null; destination: string | null; }
  const [meta, setMeta] = useState<Record<string, FlightMeta>>({});
  const [, setTick] = useState(0);
  const fetchedRef = useRef<Set<string>>(new Set());

  // ── Alert state ──────────────────────────────────────────────────────────────
  const [alertOpenFor, setAlertOpenFor] = useState<Set<string>>(new Set());
  const [alertEmails, setAlertEmails] = useState<Record<string, string>>({});
  const [alertSubscribed, setAlertSubscribed] = useState<Record<string, string | null>>({});
  const [alertSentImmediately, setAlertSentImmediately] = useState<Record<string, boolean>>({});
  const [alertLoading, setAlertLoading] = useState<Record<string, boolean>>({});
  const [alertErrors, setAlertErrors] = useState<Record<string, string | null>>({});

  // Route fetch
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

  // Countdown ticker
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Sync alert subscriptions from localStorage when tracked list changes
  useEffect(() => {
    const stored = getStoredAlerts();
    const lastEmail = localStorage.getItem(LAST_EMAIL_KEY) ?? '';
    setAlertSubscribed((prev) => {
      const next = { ...prev };
      for (const id of trackedIcao24s) next[id] = stored[id] ?? null;
      return next;
    });
    setAlertEmails((prev) => {
      const next = { ...prev };
      for (const id of trackedIcao24s) {
        if (!next[id]) next[id] = lastEmail;
      }
      return next;
    });
  }, [trackedIcao24s]);

  const toggleAlert = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAlertOpenFor((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setAlertErrors((prev) => ({ ...prev, [id]: null }));
  };

  const handleSubscribe = async (id: string, callsign: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const email = (alertEmails[id] ?? '').trim();
    if (!email || !email.includes('@')) {
      setAlertErrors((prev) => ({ ...prev, [id]: 'Enter a valid email.' }));
      return;
    }
    setAlertLoading((prev) => ({ ...prev, [id]: true }));
    setAlertErrors((prev) => ({ ...prev, [id]: null }));
    try {
      const resp = await fetch(`${HTTP_URL}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, icao24: id, callsign }),
      });
      const data = await resp.json();
      if (data.ok) {
        setStoredAlert(id, email);
        setAlertSubscribed((prev) => ({ ...prev, [id]: email }));
        setAlertSentImmediately((prev) => ({ ...prev, [id]: !!data.sent_immediately }));
      } else {
        setAlertErrors((prev) => ({ ...prev, [id]: data.error ?? 'Failed.' }));
      }
    } catch {
      setAlertErrors((prev) => ({ ...prev, [id]: 'Could not connect.' }));
    } finally {
      setAlertLoading((prev) => ({ ...prev, [id]: false }));
    }
  };

  const handleUnsubscribe = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const email = alertSubscribed[id];
    if (!email) return;
    setAlertLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await fetch(`${HTTP_URL}/subscribe/${id}?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
    } catch { /* best-effort */ }
    removeStoredAlert(id);
    setAlertSubscribed((prev) => ({ ...prev, [id]: null }));
    setAlertSentImmediately((prev) => ({ ...prev, [id]: false }));
    setAlertLoading((prev) => ({ ...prev, [id]: false }));
  };

  if (trackedIcao24s.length === 0) return null;

  const tracked = trackedIcao24s.map((id) => ({
    id,
    ac: aircraft.find((a) => a.icao24 === id) ?? null,
  }));

  // ── Mobile: horizontal chip strip ─────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{
        position: 'fixed',
        top: 56,
        left: 0,
        right: 0,
        height: 64,
        background: 'rgba(10,14,20,0.92)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        overflowX: 'auto',
        overflowY: 'hidden',
        gap: 8,
        padding: '0 12px',
        zIndex: 150,
        boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
      } as React.CSSProperties}>
        {tracked.map(({ id, ac }) => {
          const isActive = id === activeIcao24;
          const phase = ac?.flight_phase ?? 'CRUISE';
          const color = PHASE_COLORS[phase];
          const callsign = ac?.callsign?.trim() || id.toUpperCase();
          const flightMeta = meta[id];
          const origin = flightMeta?.origin;
          const destination = flightMeta?.destination;

          return (
            <div
              key={id}
              onClick={() => onFocus(id)}
              style={{
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: 44,
                padding: '0 10px',
                paddingRight: 24,
                borderRadius: 8,
                border: `1px solid ${isActive ? color : 'rgba(255,255,255,0.12)'}`,
                background: isActive ? `rgba(${hexToRgb(color)},0.12)` : 'rgba(255,255,255,0.05)',
                cursor: 'pointer',
                position: 'relative',
                gap: 2,
                minWidth: 60,
                transition: 'border-color 0.2s, background 0.2s',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: '#f0f6fc', fontFamily: 'monospace', letterSpacing: 0.8, lineHeight: 1 }}>
                {callsign}
              </span>
              <span style={{ fontSize: 9, color: isActive ? color : '#8b949e', fontWeight: 600 }}>
                {origin && destination ? `${origin}→${destination}` : PHASE_LABELS[phase]}
              </span>
              <button
                style={{ position: 'absolute', top: 3, right: 5, background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 10, padding: 0, lineHeight: 1 }}
                onClick={(e) => { e.stopPropagation(); onRemove(id); }}
              >✕</button>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Desktop: vertical panel with alert section per card ────────────────────
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
          const isAlertOpen = alertOpenFor.has(id);
          const subscribed = alertSubscribed[id] ?? null;
          const sentImmediately = alertSentImmediately[id] ?? false;
          const loading = alertLoading[id] ?? false;
          const error = alertErrors[id] ?? null;

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
                {/* Top row: callsign + bell + remove */}
                <div style={styles.cardTop}>
                  <div style={styles.cardLeft}>
                    <span style={styles.callsign}>{callsign}</span>
                    {airline && <span style={styles.airline}>{airline.name}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                    {/* Bell button */}
                    <button
                      style={{
                        background: isAlertOpen || subscribed ? 'rgba(88,166,255,0.12)' : 'none',
                        border: `1px solid ${isAlertOpen || subscribed ? 'rgba(88,166,255,0.3)' : 'transparent'}`,
                        borderRadius: 5,
                        color: subscribed ? '#00dc78' : isAlertOpen ? '#58a6ff' : '#6e7681',
                        cursor: 'pointer',
                        fontSize: 12,
                        padding: '2px 5px',
                        lineHeight: 1,
                        transition: 'color 0.15s, background 0.15s',
                      }}
                      onClick={(e) => toggleAlert(id, e)}
                      title={subscribed ? 'Alert set — click to manage' : 'Set landing alert'}
                    >
                      {subscribed ? '🔔' : '🔕'}
                    </button>
                    <button
                      style={styles.removeBtn}
                      onClick={(e) => { e.stopPropagation(); onRemove(id); }}
                      title="Stop tracking"
                    >✕</button>
                  </div>
                </div>

                {/* Stats */}
                <div style={styles.cardStats}>
                  <span style={{ ...styles.phaseBadge, color, background: `rgba(${hexToRgb(color)},0.15)` }}>
                    {PHASE_LABELS[phase]}
                  </span>
                  {ac?.altitude != null && <span style={styles.stat}>{metresToFeet(ac.altitude).toLocaleString()} ft</span>}
                  {ac?.velocity != null && <span style={styles.stat}>{msToKnots(ac.velocity)} kts</span>}
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

                {/* Alert section — toggles open via bell button */}
                {isAlertOpen && (
                  <div
                    style={styles.alertSection}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {subscribed ? (
                      <>
                        <div style={{ color: '#00dc78', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                          ✓ {sentImmediately ? 'Email sent!' : 'Alert set'}
                        </div>
                        <div style={{ color: '#8b949e', fontSize: 10, marginBottom: 8, lineHeight: 1.4 }}>
                          {sentImmediately
                            ? <>Sent to <span style={{ color: '#c9d1d9' }}>{subscribed}</span> — already within 1 hr.</>
                            : <>Notifying <span style={{ color: '#c9d1d9' }}>{subscribed}</span> ~1 hr before landing.</>
                          }
                        </div>
                        <button
                          style={styles.alertCancelBtn}
                          onClick={(e) => handleUnsubscribe(id, e)}
                          disabled={loading}
                        >
                          {loading ? 'Cancelling…' : 'Cancel alert'}
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ color: '#8b949e', fontSize: 10, marginBottom: 6 }}>
                          Email me ~1 hr before landing:
                        </div>
                        <div style={{ display: 'flex', gap: 5 }}>
                          <input
                            type="email"
                            placeholder="your@email.com"
                            value={alertEmails[id] ?? ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              setAlertEmails((prev) => ({ ...prev, [id]: v }));
                              setAlertErrors((prev) => ({ ...prev, [id]: null }));
                            }}
                            onKeyDown={(e) => e.key === 'Enter' && handleSubscribe(id, callsign, e as unknown as React.MouseEvent)}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              ...styles.alertInput,
                              borderColor: error ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.1)',
                            }}
                          />
                          <button
                            style={styles.alertBtn}
                            onClick={(e) => handleSubscribe(id, callsign, e)}
                            disabled={loading}
                          >
                            {loading ? '…' : 'Notify'}
                          </button>
                        </div>
                        {error && <div style={{ color: '#f87171', fontSize: 10, marginTop: 4 }}>{error}</div>}
                      </>
                    )}
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
    top: 16,
    left: 16,
    width: 230,
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
  accentBar: { height: 2, width: '100%' },
  cardBody: { padding: '7px 10px 8px' },
  cardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 5,
  },
  cardLeft: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  callsign: { fontSize: 14, fontWeight: 700, color: '#f0f6fc', fontFamily: 'monospace', letterSpacing: 1 },
  airline: { fontSize: 10, color: '#58a6ff', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 },
  removeBtn: { background: 'none', border: 'none', color: '#6e7681', cursor: 'pointer', fontSize: 11, padding: '0 2px', lineHeight: 1, flexShrink: 0 },
  cardStats: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  phaseBadge: { fontSize: 9, fontWeight: 700, letterSpacing: 0.5, borderRadius: 3, padding: '2px 5px', fontFamily: 'monospace' },
  stat: { fontSize: 11, color: '#8b949e', fontVariantNumeric: 'tabular-nums' },
  stale: { fontSize: 10, color: '#6e7681', fontStyle: 'italic' },
  routeLine: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 5 },
  routeCode: { fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: '#c9d1d9', letterSpacing: 0.5 },
  routeArrow: { fontSize: 10, color: '#6e7681' },
  etaRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 7, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.05)' },
  etaLabel: { fontSize: 10, color: '#6e7681', letterSpacing: 0.5 },
  etaValue: { fontSize: 13, fontWeight: 700, color: '#e6edf3', fontVariantNumeric: 'tabular-nums' },
  alertSection: {
    marginTop: 8,
    paddingTop: 8,
    borderTop: '1px solid rgba(255,255,255,0.06)',
  },
  alertInput: {
    flex: 1,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid',
    borderRadius: 6,
    color: '#f0f6fc',
    fontSize: 11,
    padding: '5px 8px',
    outline: 'none',
    minWidth: 0,
  },
  alertBtn: {
    background: 'rgba(88,166,255,0.15)',
    border: '1px solid rgba(88,166,255,0.3)',
    borderRadius: 6,
    color: '#58a6ff',
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    padding: '5px 10px',
    flexShrink: 0,
  },
  alertCancelBtn: {
    background: 'none',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    color: '#6e7681',
    fontSize: 10,
    cursor: 'pointer',
    padding: '3px 8px',
  },
};
