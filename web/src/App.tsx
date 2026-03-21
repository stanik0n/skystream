import { useEffect, useMemo, useState } from 'react';
import { FlightMap } from './components/Map';
import { AircraftPanel } from './components/AircraftPanel';
import { StatsBar } from './components/StatsBar';
import { TrackedFlightsPanel } from './components/TrackedFlightsPanel';
import { useFlights } from './hooks/useFlights';
import { useIsMobile } from './hooks/useIsMobile';
import type { Aircraft, FlightPhase } from './types';

const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) || 'ws://localhost:8000/ws';
const HTTP_URL = WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '');

export default function App() {
  const isMobile = useIsMobile();
  const { aircraft, trails, connected, count, lastUpdate } = useFlights(WS_URL);
  const [selectedAircraft, setSelectedAircraft] = useState<Aircraft | null>(null);
  const [selectedTrail, setSelectedTrail] = useState<{ path: [number, number][]; phase: FlightPhase } | null>(null);
  // Set of icao24s being tracked, and which one the map is currently following
  const [trackedIcao24s, setTrackedIcao24s] = useState<string[]>([]);
  const [activeTrackIcao24, setActiveTrackIcao24] = useState<string | null>(null);

  // Fetch full flight path whenever a new aircraft is selected
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

  // Keep selected aircraft live data in sync
  useEffect(() => {
    if (!selectedAircraft) return;
    const updated = aircraft.find((a) => a.icao24 === selectedAircraft.icao24);
    if (updated) setSelectedAircraft(updated);
  }, [aircraft]);

  const handleTrack = (icao24: string) => {
    setTrackedIcao24s((prev) => prev.includes(icao24) ? prev : [...prev, icao24]);
  };

  const handleUntrack = (icao24: string) => {
    setTrackedIcao24s((prev) => prev.filter((id) => id !== icao24));
    if (activeTrackIcao24 === icao24) setActiveTrackIcao24(null);
  };

  const handleFocusTracked = (icao24: string) => {
    setActiveTrackIcao24(icao24);
    const ac = aircraft.find((a) => a.icao24 === icao24);
    if (ac) setSelectedAircraft(ac);
  };

  // Search by callsign or icao24
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

  // Track target: live position of the actively followed aircraft
  const trackTarget = useMemo(() => {
    if (!activeTrackIcao24) return null;
    const ac = aircraft.find((a) => a.icao24 === activeTrackIcao24);
    return ac ? { lon: ac.lon, lat: ac.lat } : null;
  }, [activeTrackIcao24, aircraft]);

  const phaseCounts = useMemo(
    () => ({
      GROUND:     aircraft.filter((a) => a.flight_phase === 'GROUND').length,
      CLIMBING:   aircraft.filter((a) => a.flight_phase === 'CLIMBING').length,
      CRUISE:     aircraft.filter((a) => a.flight_phase === 'CRUISE').length,
      DESCENDING: aircraft.filter((a) => a.flight_phase === 'DESCENDING').length,
    }),
    [aircraft],
  );

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <StatsBar
        count={count}
        connected={connected}
        lastUpdate={lastUpdate}
        phaseCounts={phaseCounts}
        onSearch={handleSearch}
        aircraft={aircraft}
      />

      <div style={{ position: 'absolute', top: isMobile && trackedIcao24s.length > 0 ? 116 : 52, left: 0, right: 0, bottom: 0 }}>
        <FlightMap
          aircraft={aircraft}
          trails={trails}
          selectedIcao24={selectedAircraft?.icao24 ?? null}
          selectedTrail={selectedTrail}
          onSelect={(ac) => {
            setSelectedAircraft(ac);
          }}
          trackTarget={trackTarget}
          onBreakTracking={() => setActiveTrackIcao24(null)}
        />
      </div>

      <TrackedFlightsPanel
        trackedIcao24s={trackedIcao24s}
        aircraft={aircraft}
        activeIcao24={activeTrackIcao24}
        onFocus={handleFocusTracked}
        onRemove={handleUntrack}
      />

      <AircraftPanel
        aircraft={selectedAircraft}
        onClose={() => setSelectedAircraft(null)}
        isTracked={selectedAircraft ? trackedIcao24s.includes(selectedAircraft.icao24) : false}
        onTrack={() => selectedAircraft && handleTrack(selectedAircraft.icao24)}
        onUntrack={() => selectedAircraft && handleUntrack(selectedAircraft.icao24)}
      />
    </div>
  );
}
