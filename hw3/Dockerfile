# Базовый образ с Python 3.10
FROM python:3.10-slim-bullseye

# Установка OpenJDK 11, curl, procps
RUN apt-get update && apt-get install -y --no-install-recommends \
    openjdk-11-jre-headless \
    curl \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Динамическая настройка символической ссылки на Java 11
RUN JAVA_DIR=$(ls -d /usr/lib/jvm/java-11-openjdk-* 2>/dev/null | head -n 1) && \
    if [ -n "$JAVA_DIR" ]; then ln -s "$JAVA_DIR" /usr/lib/jvm/java-11-openjdk; fi

ENV JAVA_HOME=/usr/lib/jvm/java-11-openjdk
ENV PATH=$PATH:$JAVA_HOME/bin
ENV JDK_JAVA_OPTIONS="--add-opens=java.base/java.util=ALL-UNNAMED --add-opens=java.base/java.lang=ALL-UNNAMED --add-opens=java.base/java.lang.reflect=ALL-UNNAMED"

WORKDIR /app

# Загрузка SQL коннектора Flink для Kafka
RUN curl -s -L -o /app/flink-sql-connector-kafka-1.17.2.jar \
    https://repo1.maven.org/maven2/org/apache/flink/flink-sql-connector-kafka/1.17.2/flink-sql-connector-kafka-1.17.2.jar

# Установка зависимостей Python (PyFlink)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Копирование исходного кода приложения
COPY app /app

# Настройка и запуск скрипта точки входа
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
