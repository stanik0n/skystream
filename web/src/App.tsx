import { useState } from 'react';
import { FlightMap } from './components/Map';
import { AircraftPanel } from './components/AircraftPanel';
import { StatsBar } from './components/StatsBar';
import { useFlights } from './hooks/useFlights';
import type { Aircraft } from './types';

const WS_URL =
  (import.meta.env.VITE_WS_URL as string | undefined) ||
  'ws://localhost:8000/ws';

export default function App() {
  const { aircraft, connected, count, lastUpdate } = useFlights(WS_URL);
  const [selectedAircraft, setSelectedAircraft] = useState<Aircraft | null>(null);

  const handleSelect = (ac: Aircraft | null) => {
    setSelectedAircraft(ac);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Top stats bar */}
      <StatsBar
        count={count}
        connected={connected}
        lastUpdate={lastUpdate}
      />

      {/* Map canvas — offset below stats bar */}
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
          selectedIcao24={selectedAircraft?.icao24 ?? null}
          onSelect={handleSelect}
        />
      </div>

      {/* Side panel for selected aircraft */}
      <AircraftPanel
        aircraft={selectedAircraft}
        onClose={() => setSelectedAircraft(null)}
      />
    </div>
  );
}
