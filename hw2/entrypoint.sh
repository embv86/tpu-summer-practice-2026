#!/bin/bash

export HADOOP_HOME=/usr/local/hadoop
export HADOOP_CONF_DIR=$HADOOP_HOME/etc/hadoop
export PATH=$PATH:$HADOOP_HOME/bin:$HADOOP_HOME/sbin

echo "Настройка конфигурации Hadoop..."

cat <<EOF > $HADOOP_CONF_DIR/core-site.xml
<configuration>
    <property>
        <name>fs.defaultFS</name>
        <value>hdfs://192.168.34.2:8020</value>
    </property>
</configuration>
EOF

cat <<EOF > $HADOOP_CONF_DIR/yarn-site.xml
<configuration>
    <property>
        <name>yarn.resourcemanager.address</name>
        <value>192.168.34.2:8032</value>
    </property>
    <property>
        <name>yarn.resourcemanager.hostname</name>
        <value>192.168.34.2</value>
    </property>
</configuration>
EOF

echo "Ожидание готовности HDFS..."
until hdfs dfs -ls / > /dev/null 2>&1; do
    echo "HDFS пока недоступен, ждем 3 секунды..."
    sleep 3
done
echo "HDFS найден и доступен! Кластер готов к работе."

echo "Загрузка датасета /ml-latest-small в HDFS..."
hdfs dfs -mkdir -p /ml-latest-small > /dev/null 2>&1 || true
if [ -d "/app/ml-latest-small" ]; then
    hdfs dfs -put -f /app/ml-latest-small/* /ml-latest-small/
elif [ -d "/ml-latest-small" ]; then
    hdfs dfs -put -f /ml-latest-small/* /ml-latest-small/
fi
echo "Датасет успешно подготовлен в HDFS (/ml-latest-small)."

echo "Создание/очистка файла /sparkExperiments.txt на HDFS..."
hdfs dfs -rm -f /sparkExperiments.txt > /dev/null 2>&1 || true
hdfs dfs -touchz /sparkExperiments.txt

echo "Запуск PySpark приложения..."
python3 /app/main.py

echo "Проверка результатов в /sparkExperiments.txt:"
hdfs dfs -cat /sparkExperiments.txt

echo "Все задачи HW2 успешно выполнены."
