import { useEffect, useMemo, useState } from 'react';
import { FlightMap } from './components/Map';
import { AircraftPanel } from './components/AircraftPanel';
import { TrackedFlightsPanel } from './components/TrackedFlightsPanel';
import { TopNav } from './components/TopNav';
import { useFlights } from './hooks/useFlights';
import { useIsMobile } from './hooks/useIsMobile';
import type { Aircraft, FlightPhase } from './types';

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) || 'ws://localhost:8000/ws';
const HTTP_URL = WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '');

const NAV_H = 56;
const TRACKED_STRIP_H = 64;

export default function App() {
  const isMobile = useIsMobile();
  const { aircraft, trails, connected, count, lastUpdate } = useFlights(WS_URL);
  const [selectedAircraft, setSelectedAircraft] = useState<Aircraft | null>(null);
  const [selectedTrail, setSelectedTrail] = useState<{ path: [number, number][]; phase: FlightPhase } | null>(null);
  const [trackedIcao24s, setTrackedIcao24s] = useState<string[]>([]);
  const [activeTrackIcao24, setActiveTrackIcao24] = useState<string | null>(null);

  useEffect(() => {
    setSelectedTrail(null);
    if (!selectedAircraft) return;
    const cs = encodeURIComponent(selectedAircraft.callsign?.trim() ?? '');
    fetch(`${HTTP_URL}/trail/${selectedAircraft.icao24}?callsign=${cs}`)
      .then((r) => r.json())
      .then((data: { path: [number, number][]; phase: FlightPhase }) => {
        if (data.path.length > 1) setSelectedTrail(data);
      })
      .catch(() => {});
  }, [selectedAircraft?.icao24]);

  useEffect(() => {
    if (!selectedAircraft) return;
    const updated = aircraft.find((a) => a.icao24 === selectedAircraft.icao24);
    if (updated) setSelectedAircraft(updated);
  }, [aircraft]);

  const handleTrack = (icao24: string) =>
    setTrackedIcao24s((prev) => prev.includes(icao24) ? prev : [...prev, icao24]);

  const handleUntrack = (icao24: string) => {
    setTrackedIcao24s((prev) => prev.filter((id) => id !== icao24));
    if (activeTrackIcao24 === icao24) setActiveTrackIcao24(null);
  };

  const handleFocusTracked = (icao24: string) => {
    setActiveTrackIcao24(icao24);
    const ac = aircraft.find((a) => a.icao24 === icao24);
    if (ac) setSelectedAircraft(ac);
  };

  const handleSearch = (query: string): boolean => {
    const q = query.toUpperCase().trim();
    const match = aircraft.find(
      (a) => a.callsign?.trim().toUpperCase() === q || a.icao24.toUpperCase() === q,
    );
    if (!match) return false;
    setSelectedAircraft(match);
    handleTrack(match.icao24);
    return true;
  };

  const trackTarget = useMemo(() => {
    if (!activeTrackIcao24) return null;
    const ac = aircraft.find((a) => a.icao24 === activeTrackIcao24);
    return ac ? { lon: ac.lon, lat: ac.lat } : null;
  }, [activeTrackIcao24, aircraft]);

  const selectedSpeed = selectedAircraft?.velocity != null
    ? Math.round(selectedAircraft.velocity * 1.94384)
    : 0;

  const hasMobileTracked = isMobile && trackedIcao24s.length > 0;
  const mainTop = NAV_H + (hasMobileTracked ? TRACKED_STRIP_H : 0);
  const mainLeft = 0;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: '#131313' }}>
      {/* Fixed top navbar */}
      <TopNav
        count={count}
        connected={connected}
        aircraft={aircraft}
        onSearch={handleSearch}
      />

      {/* Mobile tracked strip */}
      {hasMobileTracked && (
        <TrackedFlightsPanel
          trackedIcao24s={trackedIcao24s}
          aircraft={aircraft}
          activeIcao24={activeTrackIcao24}
          onFocus={handleFocusTracked}
          onRemove={handleUntrack}
        />
      )}

      {/* Main map area */}
      <main style={{
        position: 'absolute',
        top: mainTop,
        left: mainLeft,
        right: 0,
        bottom: 0,
      }}>
        <FlightMap
          aircraft={aircraft}
          trails={trails}
          selectedIcao24={selectedAircraft?.icao24 ?? null}
          selectedTrail={selectedTrail}
          onSelect={(ac) => setSelectedAircraft(ac)}
          trackTarget={trackTarget}
          onBreakTracking={() => setActiveTrackIcao24(null)}
        />

        {/* Desktop tracked panel (inside map area) */}
        {!isMobile && trackedIcao24s.length > 0 && (
          <TrackedFlightsPanel
            trackedIcao24s={trackedIcao24s}
            aircraft={aircraft}
            activeIcao24={activeTrackIcao24}
            onFocus={handleFocusTracked}
            onRemove={handleUntrack}
          />
        )}

        {/* Aircraft detail panel */}
        <AircraftPanel
          aircraft={selectedAircraft}
          onClose={() => setSelectedAircraft(null)}
          isTracked={selectedAircraft ? trackedIcao24s.includes(selectedAircraft.icao24) : false}
          onTrack={() => selectedAircraft && handleTrack(selectedAircraft.icao24)}
          onUntrack={() => selectedAircraft && handleUntrack(selectedAircraft.icao24)}
        />

        {/* Bottom bento stats (desktop) */}
        {!isMobile && (
          <div style={{
            position: 'absolute',
            bottom: 32,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 12,
            zIndex: 30,
            pointerEvents: 'none',
          }}>
            <BentoStat icon="airplanemode_active" value={count.toLocaleString()} label="Flights Tracked" iconColor="#c3f5ff" iconBg="rgba(195,245,255,0.08)" />
            <BentoStat icon="track_changes" value={trackedIcao24s.length.toString()} label="Active Tracked" iconColor="#ffe9d5" iconBg="rgba(255,233,213,0.08)" />
            <BentoStat icon="speed" value={selectedSpeed > 0 ? `${selectedSpeed} kts` : '0'} label="Knots Velocity" iconColor="#bac9cc" iconBg="rgba(186,201,204,0.08)" />
          </div>
        )}
      </main>

      {/* Coordinates strip */}
      {!isMobile && (
        <div style={{ position: 'fixed', bottom: 6, right: 16, zIndex: 40, pointerEvents: 'none' }}>
          <p style={{ fontSize: 9, color: '#849396', letterSpacing: '-0.01em', opacity: 0.5, fontFamily: 'Inter, sans-serif' }}>
            SOURCE: SKYSTREAM-ORBIT-V4 · {connected ? 'LIVE' : 'DISCONNECTED'} · {lastUpdate ? lastUpdate.toLocaleTimeString() : '—'}
          </p>
        </div>
      )}
    </div>
  );
}

function BentoStat({ icon, value, label, iconColor, iconBg }: {
  icon: string; value: string; label: string; iconColor: string; iconBg: string;
}) {
  return (
    <div style={{
      background: 'rgba(14,14,14,0.6)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: 12,
      padding: '14px 18px',
      display: 'flex', alignItems: 'center', gap: 14,
      minWidth: 190,
      boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
      pointerEvents: 'auto',
    }}>
      <div style={{ padding: 8, background: iconBg, borderRadius: 8, color: iconColor, flexShrink: 0 }}>
        <span className="material-symbols-outlined" style={{ fontSize: 22 }}>{icon}</span>
      </div>
      <div>
        <p style={{ fontSize: 22, fontWeight: 700, fontFamily: 'Space Grotesk, sans-serif', color: '#e5e2e1', lineHeight: 1 }}>{value}</p>
        <p style={{ fontSize: 10, color: '#849396', textTransform: 'uppercase', fontFamily: 'Inter, sans-serif', marginTop: 4, letterSpacing: '0.05em' }}>{label}</p>
      </div>
    </div>
  );
}
