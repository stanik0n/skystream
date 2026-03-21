"""
Loops a fake test flight around a circuit over the US.
The plane moves along waypoints continuously, updating Redis every 5 seconds.
ETA is always kept ~58 min from now so landing alerts can be tested anytime.

Usage:
    python3 loop_test_flight.py
    Ctrl+C to stop
"""
import json
import math
import time
import redis
from datetime import datetime, timedelta, timezone

r = redis.from_url("redis://localhost:6379", decode_responses=True)

ICAO24   = "test01"
CALLSIGN = "SKY001"
UPDATE_INTERVAL = 5  # seconds between position updates

# Waypoints forming a loop over the US (lat, lon)
WAYPOINTS = [
    (33.94, -118.41),  # LAX — Los Angeles
    (36.08, -115.15),  # LAS — Las Vegas
    (33.43, -112.01),  # PHX — Phoenix
    (29.99, -102.20),  # midpoint TX
    (32.90, -97.04),   # DFW — Dallas
    (29.98, -95.34),   # HOU — Houston
    (29.18, -81.05),   # DAB — Daytona
    (25.79, -80.29),   # MIA — Miami
    (33.64, -84.43),   # ATL — Atlanta
    (35.21, -80.94),   # CLT — Charlotte
    (38.85, -77.04),   # DCA — Washington
    (40.64, -73.78),   # JFK — New York
    (41.98, -87.90),   # ORD — Chicago
    (39.86, -104.67),  # DEN — Denver
    (37.62, -122.38),  # SFO — San Francisco
    (33.94, -118.41),  # back to LAX
]


def bearing(lat1, lon1, lat2, lon2) -> float:
    """Calculate true bearing from point 1 to point 2 in degrees."""
    lat1, lat2 = math.radians(lat1), math.radians(lat2)
    dlon = math.radians(lon2 - lon1)
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def interpolate(p1, p2, t) -> tuple:
    """Linear interpolation between two (lat, lon) points, t in [0, 1]."""
    return (
        p1[0] + (p2[0] - p1[0]) * t,
        p1[1] + (p2[1] - p1[1]) * t,
    )


def segment_length(p1, p2) -> float:
    """Approximate distance between two points (degrees, used for speed pacing)."""
    return math.hypot(p2[0] - p1[0], p2[1] - p1[1])


# Build total route with cumulative distances
segments = []
total_len = 0.0
for i in range(len(WAYPOINTS) - 1):
    seg_len = segment_length(WAYPOINTS[i], WAYPOINTS[i + 1])
    segments.append((WAYPOINTS[i], WAYPOINTS[i + 1], seg_len))
    total_len += seg_len

# Full loop duration — plane completes the circuit in this many seconds
LOOP_DURATION_S = 3600  # 1 hour loop
speed = total_len / LOOP_DURATION_S

print(f"[SkyStream] Looping {CALLSIGN} every {LOOP_DURATION_S // 60} min. Press Ctrl+C to stop.\n")

try:
    while True:
        # Base position on wall-clock time so it's always consistent
        # regardless of when the script is started
        elapsed = time.time() % LOOP_DURATION_S
        pos = elapsed * speed
        walked = 0.0
        lat, lon, hdg = WAYPOINTS[0][0], WAYPOINTS[0][1], 0.0

        for p1, p2, seg_len in segments:
            if walked + seg_len >= pos:
                t = (pos - walked) / seg_len if seg_len > 0 else 0
                lat, lon = interpolate(p1, p2, t)
                hdg = bearing(p1[0], p1[1], p2[0], p2[1])
                break
            walked += seg_len

        now = datetime.now(timezone.utc)
        eta = now + timedelta(minutes=58)

        # Determine flight phase based on position in loop
        loop_fraction = elapsed / LOOP_DURATION_S
        if loop_fraction < 0.05 or loop_fraction > 0.95:
            phase, vrate, alt = "CLIMBING", 8.0, 3000.0
        elif loop_fraction < 0.15:
            phase, vrate, alt = "CLIMBING", 5.0, 8000.0
        elif loop_fraction > 0.80:
            phase, vrate, alt = "DESCENDING", -6.0, 5000.0
        elif loop_fraction > 0.90:
            phase, vrate, alt = "DESCENDING", -10.0, 2000.0
        else:
            phase, vrate, alt = "CRUISE", 0.2, 11000.0

        aircraft = {
            "icao24":        ICAO24,
            "callsign":      CALLSIGN,
            "latitude":      round(lat, 5),
            "longitude":     round(lon, 5),
            "baro_altitude": alt,
            "geo_altitude":  alt + 60,
            "velocity":      240.0,
            "true_track":    round(hdg, 1),
            "vertical_rate": vrate,
            "on_ground":     False,
            "flight_phase":  phase,
            "squawk":        "1234",
            "category":      "A3",
            "ingested_at":   now.isoformat(),
        }
        r.hset("flights", ICAO24, json.dumps(aircraft))

        route = {
            "origin":          {"iata_code": "LAX", "municipality": "Los Angeles", "name": "Los Angeles Intl"},
            "destination":     {"iata_code": "DFW", "municipality": "Dallas",      "name": "Dallas/Fort Worth Intl"},
            "aircraft_type":   "B737",
            "flight_number":   CALLSIGN,
            "status":          "En Route",
            "departure_delay": 0,
            "arrival_delay":   0,
            "route_distance":  1235,
            "estimated_on":    eta.isoformat(),
            "actual_on":       None,
            "scheduled_on":    eta.isoformat(),
        }
        r.setex(f"route:{CALLSIGN}", 3600, json.dumps(route))

        print(f"\r[{now.strftime('%H:%M:%S')}] {CALLSIGN}  lat={lat:.3f}  lon={lon:.3f}  hdg={hdg:.0f}°  {phase:<10}", end="", flush=True)

        time.sleep(UPDATE_INTERVAL)

except KeyboardInterrupt:
    print("\n[SkyStream] Stopped. Cleaning up...")
    r.hdel("flights", ICAO24)
    r.delete(f"route:{CALLSIGN}")
    print("[SkyStream] Test flight removed from Redis.")
