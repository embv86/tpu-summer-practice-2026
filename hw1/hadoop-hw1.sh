#!/bin/bash

export HADOOP_HOME=/usr/local/hadoop
export HADOOP_CONF_DIR=$HADOOP_HOME/etc/hadoop

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
</configuration>
EOF

cat <<'EOF' > $HADOOP_CONF_DIR/mapred-site.xml
<configuration>
    <property>
        <name>mapreduce.framework.name</name>
        <value>yarn</value>
    </property>
    <property>
        <name>yarn.app.mapreduce.am.env</name>
        <value>HADOOP_MAPRED_HOME=$HADOOP_HOME</value>
    </property>
    <property>
        <name>mapreduce.map.env</name>
        <value>HADOOP_MAPRED_HOME=$HADOOP_HOME</value>
    </property>
    <property>
        <name>mapreduce.reduce.env</name>
        <value>HADOOP_MAPRED_HOME=$HADOOP_HOME</value>
    </property>
    <property>
        <name>mapreduce.application.classpath</name>
        <value>$HADOOP_HOME/etc/hadoop:$HADOOP_HOME/share/hadoop/common/*:$HADOOP_HOME/share/hadoop/common/lib/*:$HADOOP_HOME/share/hadoop/hdfs/*:$HADOOP_HOME/share/hadoop/hdfs/lib/*:$HADOOP_HOME/share/hadoop/mapreduce/*:$HADOOP_HOME/share/hadoop/mapreduce/lib/*:$HADOOP_HOME/share/hadoop/yarn/*:$HADOOP_HOME/share/hadoop/yarn/lib/*</value>
    </property>
</configuration>
EOF

echo "Ожидание тестовых данных (ждем появления файла /shadow.txt)..."
until hdfs dfs -test -e /shadow.txt > /dev/null 2>&1; do
    echo "Файл /shadow.txt пока не найден, ждем 5 секунд..."
    sleep 5
done
echo "Файл /shadow.txt найден! Кластер полностью готов к работе."

echo "Задача 1: Создание директории /createme..."
hdfs dfs -mkdir -p /createme

echo "Задача 2: Удаление директории /delme..."
hdfs dfs -rm -r -f -skipTrash /delme

echo "Задача 3: Создание /nonnull.txt..."
echo "arbitrary content" > /tmp/local_nonnull.txt
hdfs dfs -put -f /tmp/local_nonnull.txt /nonnull.txt

echo "Задача 4: Запуск MapReduce джобы Wordcount..."
hdfs dfs -rm -r -f -skipTrash /output_wordcount
yarn jar $HADOOP_HOME/share/hadoop/mapreduce/hadoop-mapreduce-examples-3.3.6.jar wordcount /shadow.txt /output_wordcount

echo "Задача 5: Извлечение количества 'Innsmouth'..."
hdfs dfs -cat /output_wordcount/part-r-00000 | grep -w "Innsmouth" | awk '{print $2}' > /tmp/whataboutinsmouth.txt
hdfs dfs -put -f /tmp/whataboutinsmouth.txt /whataboutinsmouth.txt

echo "Все задачи успешно выполнены."