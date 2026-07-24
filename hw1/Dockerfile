# Базовый образ с Java 8 (Eclipse Temurin JRE)
FROM eclipse-temurin:8-jre-jammy

# Переменные окружения Hadoop
ENV HADOOP_VERSION=3.3.6
ENV HADOOP_HOME=/usr/local/hadoop
ENV PATH=$PATH:$HADOOP_HOME/bin:$HADOOP_HOME/sbin

# Копирование архива Hadoop в контейнер
COPY hadoop-${HADOOP_VERSION}.tar.gz /tmp/

# Распаковка Hadoop и очистка архива
RUN tar -xzf /tmp/hadoop-$HADOOP_VERSION.tar.gz -C /usr/local/ && \
    mv /usr/local/hadoop-$HADOOP_VERSION /usr/local/hadoop && \
    rm /tmp/hadoop-$HADOOP_VERSION.tar.gz

# Настройка скрипта запуска
COPY hadoop-hw1.sh /hadoop-hw1.sh
RUN chmod +x /hadoop-hw1.sh

# Точка входа в контейнер
ENTRYPOINT ["/hadoop-hw1.sh"]