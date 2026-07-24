#!/bin/bash

# Переменные окружения Hadoop
export HADOOP_HOME=/usr/local/hadoop
export HADOOP_CONF_DIR=$HADOOP_HOME/etc/hadoop
export PATH=$PATH:$HADOOP_HOME/bin:$HADOOP_HOME/sbin

echo "Настройка конфигурации Hadoop..."

# Конфигурация HDFS NameNode
cat <<EOF > $HADOOP_CONF_DIR/core-site.xml
<configuration>
    <property>
        <name>fs.defaultFS</name>
        <value>hdfs://192.168.34.2:8020</value>
    </property>
</configuration>
EOF

# Конфигурация YARN ResourceManager
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

# Ожидание доступности файловой системы HDFS
echo "Ожидание готовности HDFS..."
until hdfs dfs -ls / > /dev/null 2>&1; do
    echo "HDFS пока недоступен, ждем 3 секунды..."
    sleep 3
done
echo "HDFS найден и доступен! Кластер готов к работе."

# Загрузка датасета ml-latest-small в HDFS
echo "Загрузка датасета /ml-latest-small в HDFS..."
hdfs dfs -mkdir -p /ml-latest-small > /dev/null 2>&1 || true
if [ -d "/app/ml-latest-small" ]; then
    hdfs dfs -put -f /app/ml-latest-small/* /ml-latest-small/
elif [ -d "/ml-latest-small" ]; then
    hdfs dfs -put -f /ml-latest-small/* /ml-latest-small/
fi
echo "Датасет успешно подготовлен в HDFS (/ml-latest-small)."

# Подготовка результирующего файла экспериментов
echo "Создание/очистка файла /sparkExperiments.txt на HDFS..."
hdfs dfs -rm -f /sparkExperiments.txt > /dev/null 2>&1 || true
hdfs dfs -touchz /sparkExperiments.txt

# Запуск скрипта анализа PySpark
echo "Запуск PySpark приложения..."
python3 /app/main.py

# Вывод результатов в консоль
echo "Проверка результатов в /sparkExperiments.txt:"
hdfs dfs -cat /sparkExperiments.txt

echo "Все задачи HW2 успешно выполнены."
