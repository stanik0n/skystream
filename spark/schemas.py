"""
PySpark schema definitions for SkyStream.
Mirrors the FlightState Pydantic model used by the producer.
"""
from pyspark.sql.types import (
    ArrayType,
    BooleanType,
    DoubleType,
    IntegerType,
    LongType,
    StringType,
    StructField,
    StructType,
)

# Schema for messages arriving on the raw-flights Kafka topic.
# Each message value is a JSON-encoded FlightState produced by producer/schemas.py.
FLIGHT_STATE_SCHEMA = StructType(
    [
        StructField("icao24", StringType(), nullable=False),
        StructField("callsign", StringType(), nullable=True),
        StructField("origin_country", StringType(), nullable=True),
        StructField("time_position", LongType(), nullable=True),
        StructField("last_contact", LongType(), nullable=True),
        StructField("longitude", DoubleType(), nullable=True),
        StructField("latitude", DoubleType(), nullable=True),
        StructField("baro_altitude", DoubleType(), nullable=True),
        StructField("on_ground", BooleanType(), nullable=False),
        StructField("velocity", DoubleType(), nullable=True),
        StructField("true_track", DoubleType(), nullable=True),
        StructField("vertical_rate", DoubleType(), nullable=True),
        StructField("sensors", ArrayType(IntegerType(), containsNull=True), nullable=True),
        StructField("geo_altitude", DoubleType(), nullable=True),
        StructField("squawk", StringType(), nullable=True),
        StructField("spi", BooleanType(), nullable=True),
        StructField("position_source", IntegerType(), nullable=True),
        StructField("ingested_at", StringType(), nullable=True),
    ]
)
