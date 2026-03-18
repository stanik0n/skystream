from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class FlightState(BaseModel):
    """Represents a single aircraft state vector from the OpenSky Network API."""

    icao24: str = Field(..., description="Unique ICAO 24-bit address of the transponder in hex")
    callsign: Optional[str] = Field(None, description="Callsign of the vehicle (8 chars). Can be null")
    origin_country: Optional[str] = Field(None, description="Country name inferred from the ICAO 24-bit address")
    time_position: Optional[int] = Field(None, description="Unix timestamp (seconds) for the last position update")
    last_contact: Optional[int] = Field(None, description="Unix timestamp (seconds) for the last update in general")
    longitude: Optional[float] = Field(None, description="WGS-84 longitude in decimal degrees")
    latitude: Optional[float] = Field(None, description="WGS-84 latitude in decimal degrees")
    baro_altitude: Optional[float] = Field(None, description="Barometric altitude in metres")
    on_ground: bool = Field(False, description="Boolean value which indicates if the position was retrieved from a surface position report")
    velocity: Optional[float] = Field(None, description="Velocity over ground in m/s")
    true_track: Optional[float] = Field(None, description="True track in decimal degrees clockwise from north (north=0)")
    vertical_rate: Optional[float] = Field(None, description="Vertical rate in m/s. Positive means climbing")
    sensors: Optional[list[int]] = Field(None, description="IDs of the receivers which contributed to this state vector")
    geo_altitude: Optional[float] = Field(None, description="Geometric altitude in metres")
    squawk: Optional[str] = Field(None, description="The transponder code aka Squawk")
    spi: Optional[bool] = Field(None, description="Whether flight status indicates special purpose indicator")
    position_source: Optional[int] = Field(None, description="Origin of this state's position: 0=ADS-B, 1=ASTERIX, 2=MLAT, 3=FLARM")
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

    model_config = {
        "json_schema_extra": {
            "example": {
                "icao24": "a1b2c3",
                "callsign": "UAL123",
                "origin_country": "United States",
                "time_position": 1700000000,
                "last_contact": 1700000001,
                "longitude": -87.6298,
                "latitude": 41.8781,
                "baro_altitude": 10668.0,
                "on_ground": False,
                "velocity": 250.0,
                "true_track": 270.0,
                "vertical_rate": 0.0,
                "geo_altitude": 10820.0,
                "squawk": "1234",
                "ingested_at": "2024-01-01T00:00:00+00:00",
            }
        }
    }
