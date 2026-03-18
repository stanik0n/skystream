"""
PySpark UDFs for in-stream enrichment of flight data.
"""
from __future__ import annotations

from typing import Optional

from pyspark.sql.functions import udf
from pyspark.sql.types import StringType

# ── Flight phase thresholds ───────────────────────────────────────────────────
# Vertical rate thresholds in m/s
_CLIMB_RATE_THRESHOLD = 1.0     # > +1 m/s  → CLIMBING
_DESCEND_RATE_THRESHOLD = -1.0  # < -1 m/s  → DESCENDING

# Altitude threshold: below ~304 m (1000 ft) AGL is considered low
# We use barometric altitude as a proxy.
_LOW_ALTITUDE_M = 304.0  # metres ≈ 1 000 ft


def _determine_flight_phase(
    on_ground: Optional[bool],
    vertical_rate: Optional[float],
    baro_altitude: Optional[float],
) -> str:
    """
    Pure Python logic for determining flight phase.

    Rules (in priority order):
    1. on_ground is True  → GROUND
    2. vertical_rate > +1 m/s  → CLIMBING
    3. vertical_rate < -1 m/s  → DESCENDING
    4. Otherwise  → CRUISE
    """
    if on_ground is True:
        return "GROUND"

    vr = vertical_rate if vertical_rate is not None else 0.0

    if vr > _CLIMB_RATE_THRESHOLD:
        return "CLIMBING"
    if vr < _DESCEND_RATE_THRESHOLD:
        return "DESCENDING"

    return "CRUISE"


# Register as a PySpark UDF returning StringType
flight_phase_udf = udf(
    lambda on_ground, vertical_rate, baro_altitude: _determine_flight_phase(
        on_ground, vertical_rate, baro_altitude
    ),
    StringType(),
)
