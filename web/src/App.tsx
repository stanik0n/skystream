import { useMemo, useState } from 'react';
import { FlightMap } from './components/Map';
import { AircraftPanel } from './components/AircraftPanel';
import { StatsBar } from './components/StatsBar';
import { useFlights } from './hooks/useFlights';
import type { Aircraft } from './types';

const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) || 'ws://localhost:8000/ws';

export default function App() {
  const { aircraft, trails, connected, count, lastUpdate } = useFlights(WS_URL);
  const [selectedAircraft, setSelectedAircraft] = useState<Aircraft | null>(null);

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
      />

      <div
        style={{
          position: 'absolute',
          top: 52,
          left: 0,
          right: 0,
          bottom: 0,
        }}
      >
        <FlightMap
          aircraft={aircraft}
          trails={trails}
          selectedIcao24={selectedAircraft?.icao24 ?? null}
          onSelect={setSelectedAircraft}
        />
      </div>

      <AircraftPanel
        aircraft={selectedAircraft}
        onClose={() => setSelectedAircraft(null)}
      />
    </div>
  );
}
