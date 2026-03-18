import os

OPENSKY_URL = 'https://opensky-network.org/api/states/all'

# OAuth2 Client Credentials (preferred — basic auth is being deprecated)
OPENSKY_CLIENT_ID = os.getenv('OPENSKY_CLIENT_ID', '')
OPENSKY_CLIENT_SECRET = os.getenv('OPENSKY_CLIENT_SECRET', '')
OPENSKY_TOKEN_URL = os.getenv(
    'OPENSKY_TOKEN_URL',
    'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
)

# Legacy basic auth fallback (will be removed by OpenSky eventually)
OPENSKY_USERNAME = os.getenv('OPENSKY_USERNAME', '')
OPENSKY_PASSWORD = os.getenv('OPENSKY_PASSWORD', '')

BOUNDING_BOX = (
    float(os.getenv('OPENSKY_BBOX_MIN_LAT', '24.0')),
    float(os.getenv('OPENSKY_BBOX_MAX_LAT', '50.0')),
    float(os.getenv('OPENSKY_BBOX_MIN_LON', '-125.0')),
    float(os.getenv('OPENSKY_BBOX_MAX_LON', '-66.0')),
)
POLL_INTERVAL_SECONDS = int(os.getenv('POLL_INTERVAL_SECONDS', '10'))
KAFKA_BOOTSTRAP_SERVERS = os.getenv('KAFKA_BOOTSTRAP_SERVERS', 'kafka:9092')
KAFKA_TOPIC = os.getenv('KAFKA_TOPIC_RAW', 'raw-flights')
REQUEST_TIMEOUT = 10
MAX_RETRIES = 3
