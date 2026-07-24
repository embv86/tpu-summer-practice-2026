# Базовый образ с Java 8 (Eclipse Temurin JRE)
FROM eclipse-temurin:8-jre-jammy

# Переменные окружения Hadoop
ENV HADOOP_VERSION=3.3.6
ENV HADOOP_HOME=/usr/local/hadoop
ENV HADOOP_CONF_DIR=/usr/local/hadoop/etc/hadoop
ENV PATH=$PATH:$HADOOP_HOME/bin:$HADOOP_HOME/sbin

# Установка Python 3, pip, curl и дополнительных утилит
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    procps \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Копирование и распаковка клиента Hadoop
COPY hadoop-${HADOOP_VERSION}.tar.gz /tmp/
RUN tar -xzf /tmp/hadoop-$HADOOP_VERSION.tar.gz -C /usr/local/ && \
    mv /usr/local/hadoop-$HADOOP_VERSION /usr/local/hadoop && \
    rm /tmp/hadoop-$HADOOP_VERSION.tar.gz

WORKDIR /app

# Установка зависимостей Python (PySpark, scikit-learn, pandas, numpy)
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Предварительная загрузка датасета ml-latest-small на этапе сборки образа
RUN curl -s -L -o /tmp/ml.zip https://files.grouplens.org/datasets/movielens/ml-latest-small.zip && \
    python3 -c "import zipfile; zipfile.ZipFile('/tmp/ml.zip').extractall('/app')" && \
    rm /tmp/ml.zip

# Копирование исходного кода приложения
COPY app /app

# Копирование скрипта точки входа
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
