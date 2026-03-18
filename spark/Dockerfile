FROM python:3.11-slim

# Java is required to run Spark
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jdk-headless \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir pyspark==3.5.3 redis>=5.0

ENV JAVA_HOME=/usr/lib/jvm/default-java
ENV PYSPARK_PYTHON=python3

WORKDIR /opt/spark/work-dir

CMD ["python", "/opt/spark/work-dir/spark/stream_processor.py"]
