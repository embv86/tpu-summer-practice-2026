FROM eclipse-temurin:8-jre-jammy

ENV HADOOP_VERSION=3.3.6
ENV HADOOP_HOME=/usr/local/hadoop
ENV PATH=$PATH:$HADOOP_HOME/bin:$HADOOP_HOME/sbin

COPY hadoop-${HADOOP_VERSION}.tar.gz /tmp/

RUN tar -xzf /tmp/hadoop-$HADOOP_VERSION.tar.gz -C /usr/local/ && \
    mv /usr/local/hadoop-$HADOOP_VERSION /usr/local/hadoop && \
    rm /tmp/hadoop-$HADOOP_VERSION.tar.gz

COPY hadoop-hw1.sh /hadoop-hw1.sh
RUN chmod +x /hadoop-hw1.sh

ENTRYPOINT ["/hadoop-hw1.sh"]