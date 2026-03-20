"""
SkyStream PySpark Structured Streaming Job
Consumes raw flight state vectors from Kafka, enriches them,
and writes to both TimescaleDB (via JDBC) and Redis (latest state cache).
"""
from __future__ import annotations

import json
import logging
import os
import sys

# Ensure the work directory is on the Python path so local modules are importable.
sys.path.insert(0, "/opt/spark/work-dir/spark")

import redis as redis_lib
from pyspark.sql import DataFrame, SparkSession
from pyspark.sql.functions import col, from_json, to_timestamp, when

from schemas import FLIGHT_STATE_SCHEMA


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("skystream.spark")

# ── Configuration from environment ───────────────────────────────────────────
KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "kafka:9092")
KAFKA_TOPIC = os.getenv("KAFKA_TOPIC_RAW", "raw-flights")
POSTGRES_JDBC_URL = os.getenv("POSTGRES_JDBC_URL", "jdbc:postgresql://postgres:5432/skystream")
POSTGRES_USER = os.getenv("POSTGRES_USER", "postgres")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "postgres")
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379")
CHECKPOINT_LOCATION = os.getenv(
    "CHECKPOINT_LOCATION", "/opt/spark/checkpoints/raw-flights"
)
PROCESSING_TIME = os.getenv("SPARK_TRIGGER_INTERVAL", "5 seconds")


# ── Redis connection factory (called inside foreachBatch) ─────────────────────

def _get_redis_client() -> redis_lib.Redis:
    """Return a Redis client parsed from REDIS_URL."""
    return redis_lib.from_url(REDIS_URL, decode_responses=True)


# ── Helpers ───────────────────────────────────────────────────────────────────

def row_to_json(row) -> str:
    """Serialize a PySpark Row to a compact JSON string."""
    d = row.asDict(recursive=True)
    # Convert any non-serializable types (e.g. Timestamp → ISO string).
    for key, value in d.items():
        if hasattr(value, "isoformat"):
            d[key] = value.isoformat()
        elif value is None:
            d[key] = None
    return json.dumps(d, default=str)


# ── foreachBatch handlers ─────────────────────────────────────────────────────

def write_to_postgres(batch_df: DataFrame, batch_id: int) -> None:
    """Write a micro-batch DataFrame to the flight_states TimescaleDB table."""
    count = batch_df.count()
    if count == 0:
        logger.debug("Batch %d: empty, skipping Postgres write.", batch_id)
        return

    logger.info("Batch %d: writing %d rows to Postgres.", batch_id, count)
    try:
        (
            batch_df.write.format("jdbc")
            .option("url", POSTGRES_JDBC_URL)
            .option("dbtable", "flight_states")
            .option("user", POSTGRES_USER)
            .option("password", POSTGRES_PASSWORD)
            .option("driver", "org.postgresql.Driver")
            .option("batchsize", 1000)
            .mode("append")
            .save()
        )
        logger.info("Batch %d: Postgres write complete.", batch_id)
    except Exception as exc:
        logger.error("Batch %d: Postgres write failed: %s", batch_id, exc)
        raise


def write_to_redis(batch_df: DataFrame, batch_id: int) -> None:
    """
    Cache the latest state per aircraft in Redis hash 'flights'.
    Uses a pipeline for efficiency.
    """
    rows = batch_df.collect()
    if not rows:
        logger.debug("Batch %d: empty, skipping Redis write.", batch_id)
        return

    logger.info("Batch %d: caching %d aircraft states in Redis.", batch_id, len(rows))
    try:
        r = _get_redis_client()
        pipe = r.pipeline(transaction=False)
        for row in rows:
            icao24 = row["icao24"]
            if icao24:
                pipe.hset("flights", icao24, row_to_json(row))
        pipe.execute()
        logger.info("Batch %d: Redis write complete.", batch_id)
    except Exception as exc:
        logger.error("Batch %d: Redis write failed: %s", batch_id, exc)
        # Do not re-raise; Redis write failure should not stop the stream.


_PG_COLS = [
    "time", "icao24", "callsign", "latitude", "longitude",
    "baro_altitude", "geo_altitude", "velocity", "true_track",
    "vertical_rate", "on_ground", "flight_phase", "squawk", "ingested_at",
]


def process_batch(batch_df: DataFrame, batch_id: int) -> None:
    """Orchestrate all sink writes for a single micro-batch."""
    # Cache the batch to avoid recomputation across multiple sinks.
    batch_df.cache()
    try:
        # Postgres gets only schema columns (no category — avoids DB migration)
        pg_df = batch_df.select(*[col(c) for c in _PG_COLS])
        write_to_postgres(pg_df, batch_id)
        # Redis gets all fields including category (schema-less JSON)
        write_to_redis(batch_df, batch_id)
    finally:
        batch_df.unpersist()


# ── Spark session ─────────────────────────────────────────────────────────────

def build_spark_session() -> SparkSession:
    return (
        SparkSession.builder.appName("SkyStreamProcessor")
        .master(os.getenv("SPARK_MASTER", "local[*]"))
        .config(
            "spark.jars.packages",
            "org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.3,org.postgresql:postgresql:42.7.0",
        )
        .config("spark.driver.memory", "2g")
        .config("spark.sql.streaming.checkpointLocation", CHECKPOINT_LOCATION)
        .config("spark.sql.shuffle.partitions", "4")
        .config("spark.streaming.stopGracefullyOnShutdown", "true")
        .getOrCreate()
    )


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    spark = build_spark_session()
    spark.sparkContext.setLogLevel("WARN")

    logger.info("Reading from Kafka topic '%s' at %s", KAFKA_TOPIC, KAFKA_BOOTSTRAP_SERVERS)

    # 1. Read raw bytes from Kafka.
    raw_stream = (
        spark.readStream.format("kafka")
        .option("kafka.bootstrap.servers", KAFKA_BOOTSTRAP_SERVERS)
        .option("subscribe", KAFKA_TOPIC)
        .option("startingOffsets", "latest")
        .option("failOnDataLoss", "false")
        .option("maxOffsetsPerTrigger", 10_000)
        .load()
    )

    # 2. Deserialise JSON payload.
    parsed = raw_stream.select(
        from_json(col("value").cast("string"), FLIGHT_STATE_SCHEMA).alias("data"),
        col("timestamp").alias("kafka_timestamp"),
    ).select("data.*", "kafka_timestamp")

    # 3. Enrich: add flight_phase column using native Spark expression.
    flight_phase_col = (
        when(col("on_ground") == True, "GROUND")
        .when((col("vertical_rate") > 2) & (col("baro_altitude") < 10000), "CLIMBING")
        .when((col("vertical_rate") < -2) & (col("baro_altitude") < 10000), "DESCENDING")
        .otherwise("CRUISE")
    )
    enriched = parsed.withColumn("flight_phase", flight_phase_col)

    # 4. Add 'time' column (TimescaleDB partition key) from ingested_at string.
    enriched = enriched.withColumn(
        "time",
        to_timestamp(col("ingested_at")),
    )

    # 5. Select all output columns (category included for Redis; Postgres split happens in process_batch).
    output_cols = [
        "time",
        "icao24",
        "callsign",
        "latitude",
        "longitude",
        "baro_altitude",
        "geo_altitude",
        "velocity",
        "true_track",
        "vertical_rate",
        "on_ground",
        "flight_phase",
        "squawk",
        "category",
        "ingested_at",
    ]
    output_df = enriched.select(
        *[col(c) for c in output_cols if c != "ingested_at"],
        to_timestamp(col("ingested_at")).alias("ingested_at"),
    )

    # 6. Start the streaming query.
    query = (
        output_df.writeStream.foreachBatch(process_batch)
        .trigger(processingTime=PROCESSING_TIME)
        .option("checkpointLocation", CHECKPOINT_LOCATION)
        .start()
    )

    logger.info(
        "Streaming query started. Checkpoint: %s  Trigger: %s",
        CHECKPOINT_LOCATION,
        PROCESSING_TIME,
    )
    query.awaitTermination()


if __name__ == "__main__":
    main()
