import os

# adsb.fi — free, no auth required
# For global coverage use point/0/0/10000 (10000nm radius covers the globe).
# For regional, use point/{lat}/{lon}/{radius_nm}.
AIRPLANES_LIVE_BASE_URL = "https://api.adsb.fi/v1/point"

BOUNDING_BOX = (
    float(os.getenv('OPENSKY_BBOX_MIN_LAT', '24.0')),
    float(os.getenv('OPENSKY_BBOX_MAX_LAT', '50.0')),
    float(os.getenv('OPENSKY_BBOX_MIN_LON', '-125.0')),
    float(os.getenv('OPENSKY_BBOX_MAX_LON', '-66.0')),
)
POLL_INTERVAL_SECONDS = int(os.getenv('POLL_INTERVAL_SECONDS', '10'))
KAFKA_BOOTSTRAP_SERVERS = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092')
KAFKA_TOPIC = os.getenv('KAFKA_TOPIC_RAW', 'raw-flights')
REQUEST_TIMEOUT = 20
MAX_RETRIES = 3
