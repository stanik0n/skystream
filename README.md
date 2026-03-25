# SkyStream

A real-time flight tracking pipeline that ingests live ADS-B telemetry from 9,000+ aircraft globally, processes it through a streaming data stack, and renders it on an interactive map with under 5 seconds of latency.

![TypeScript](https://img.shields.io/badge/TypeScript-62.8%25-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python-36%25-3776ab?style=flat-square&logo=python&logoColor=white)
![Apache Kafka](https://img.shields.io/badge/Kafka-Streaming-231f20?style=flat-square&logo=apachekafka&logoColor=white)
![Apache Spark](https://img.shields.io/badge/Spark-Processing-e25a1c?style=flat-square&logo=apachespark&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-Cache-dc382d?style=flat-square&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ed?style=flat-square&logo=docker&logoColor=white)

## Demo

**Live:** http://173.212.237.120:5173

![SkyStream Map](https://i.imgur.com/placeholder.png)

---

## Architecture

```
airplanes.live ADS-B API  (~9,000 aircraft / 10s)
          │
          ▼
    Producer (Python)
          │  Kafka · raw-flights topic
          ▼
  Spark Structured Streaming
          │
          ├──▶  TimescaleDB (PostgreSQL)   historical trails · 24h retention
          └──▶  Redis Hash                 live state cache · 2min TTL
                     │
                     ▼
           FastAPI WebSocket Server
                     │  5s broadcast interval
                     ▼
          React + deck.gl + MapLibre GL
```

---

## Features

- **Live global map** — 9,000+ aircraft rendered in real-time with GPU-accelerated icons (deck.gl `IconLayer`)
- **Flight trails** — short trail on the map, full path on click (up to 48h history from TimescaleDB)
- **Flight info panel** — origin/destination, airline, aircraft type, altitude, speed, and phase via FlightAware AeroAPI
- **Flight tracking** — pin aircraft to a sidebar to keep an eye on specific flights
- **Landing alerts** — subscribe to an email notification when a tracked flight is ~1 hour from landing (Resend API)
- **Mobile responsive** — bottom sheet for flight info, horizontal tracking strip, compact stats bar
- **Search with autocomplete** — search by callsign or ICAO24 hex code

---

## Stack

| Layer | Technology |
|---|---|
| Data source | [airplanes.live](https://airplanes.live) — free ADS-B API, no auth |
| Message broker | Apache Kafka (Confluent) |
| Stream processor | Apache Spark Structured Streaming |
| Time-series DB | TimescaleDB (PostgreSQL extension) |
| Live cache | Redis |
| Backend | FastAPI + WebSockets (Python) |
| Frontend | React + deck.gl + MapLibre GL (TypeScript) |
| Email | Resend API |
| Flight data | FlightAware AeroAPI |
| Map tiles | OpenFreeMap |
| Deployment | Docker Compose |

---

## Getting Started

### Prerequisites

- Docker + Docker Compose
- A [FlightAware AeroAPI](https://flightaware.com/commercial/aeroapi/) key (for route info — optional)
- A [Resend](https://resend.com) API key (for email alerts — optional)

### Setup

```bash
git clone https://github.com/stanik0n/skystream.git
cd skystream

cp .env.example .env
# Edit .env and fill in any optional API keys
```

### Run

```bash
cd infra
docker compose up -d
```

The app will be available at `http://localhost:5173`.

On first start, Spark downloads its dependencies (~60s). After that, aircraft should start appearing on the map within ~30 seconds.

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `VITE_WS_URL` | Yes | WebSocket URL (`ws://localhost:8000/ws`) |
| `FLIGHTAWARE_API_KEY` | No | Route/airline info per flight |
| `RESEND_API_KEY` | No | Email landing alerts |
| `ALERT_FROM_EMAIL` | No | Sender address for alerts |
| `OPENSKY_BBOX_*` | No | Bounding box (defaults to US coverage) |
| `POLL_INTERVAL_SECONDS` | No | Fetch interval, default `10` |

---

## Project Structure

```
skystream/
├── producer/        Python service — polls airplanes.live, publishes to Kafka
├── spark/           PySpark streaming job — enriches data, writes to Redis + Postgres
├── websocket/       FastAPI server — WebSocket broadcast, REST endpoints, email alerts
├── web/             React frontend — map, panels, search, tracking
├── infra/           Docker Compose, PostgreSQL init SQL
└── scripts/         Dev utilities (test flight injection, loop script)
```

---

## How It Works

1. **Producer** polls `airplanes.live` every 10 seconds for ~9,000 aircraft positions and publishes each as a JSON message to the `raw-flights` Kafka topic.

2. **Spark** reads from Kafka, parses the payload, computes `flight_phase` (GROUND / CLIMBING / CRUISE / DESCENDING) from vertical rate, and writes to two sinks every 5 seconds:
   - **Redis** — latest state per aircraft (`HSET flights {icao24}`)
   - **TimescaleDB** — append-only time-series row for history

3. **WebSocket server** reads Redis every 5 seconds, filters stale entries (> 2 min old), and fans the data out to all connected browser clients.

4. **Frontend** receives the WebSocket payload and updates the deck.gl `IconLayer` in place — no full re-renders.

---

## Scripts

Inject a test flight that loops around the US indefinitely (useful for testing alerts and tracking):

```bash
# On the server
nohup python3 scripts/loop_test_flight.py > /tmp/loop_flight.log 2>&1 &

# Stop it
pkill -f loop_test_flight.py
```

---

## License

MIT
