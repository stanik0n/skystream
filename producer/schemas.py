from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class FlightState(BaseModel):
    """Represents a single aircraft state vector from the adsb.fi API."""

    icao24: str = Field(..., description="ICAO 24-bit address of the transponder in hex")
    callsign: Optional[str] = Field(None, description="Callsign / flight number")
    latitude: Optional[float] = Field(None, description="WGS-84 latitude in decimal degrees")
    longitude: Optional[float] = Field(None, description="WGS-84 longitude in decimal degrees")
    baro_altitude: Optional[float] = Field(None, description="Barometric altitude in metres")
    geo_altitude: Optional[float] = Field(None, description="Geometric altitude in metres")
    on_ground: bool = Field(False, description="True when aircraft is on the ground")
    velocity: Optional[float] = Field(None, description="Ground speed in m/s")
    true_track: Optional[float] = Field(None, description="True track in degrees clockwise from north")
    vertical_rate: Optional[float] = Field(None, description="Vertical rate in m/s (positive = climbing)")
    squawk: Optional[str] = Field(None, description="Transponder squawk code")
    ingested_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
        description="ISO8601 timestamp when this record was ingested by the producer",
    )

    @field_validator('callsign')
    @classmethod
    def strip_callsign(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            return v if v else None
        return v

    @field_validator('icao24')
    @classmethod
    def lower_icao24(cls, v: str) -> str:
        return v.strip().lower()
