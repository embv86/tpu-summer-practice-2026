import os
import json
import logging

from pyflink.common import Configuration
from pyflink.common.typeinfo import Types

try:
    from pyflink.common import SimpleStringSchema
except ImportError:
    from pyflink.common.serialization import SimpleStringSchema

try:
    from pyflink.datastream import StreamExecutionEnvironment
except ImportError:
    from pyflink.datastream import StreamExecutionEnvironment

try:
    from pyflink.datastream.functions import KeyedProcessFunction
except ImportError:
    from pyflink.datastream import KeyedProcessFunction

try:
    from pyflink.datastream.state import ValueStateDescriptor
except ImportError:
    try:
        from pyflink.common.state import ValueStateDescriptor
    except ImportError:
        from pyflink.datastream import ValueStateDescriptor

try:
    from pyflink.datastream.connectors.kafka import FlinkKafkaConsumer, FlinkKafkaProducer
except ImportError:
    from pyflink.datastream.connectors import FlinkKafkaConsumer, FlinkKafkaProducer

from pyflink.datastream.formats.json import JsonRowDeserializationSchema

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("PyFlinkKafkaApp")

BOOTSTRAP_SERVERS = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "192.168.34.2:9092")
INPUT_TOPIC = "input_topic"

def parse_device_id(row):
    return int(getattr(row, 'device_id', row[0]))

def parse_temperature(row):
    return float(getattr(row, 'temperature', row[1]))

def parse_execution_time(row):
    return int(getattr(row, 'execution_time', row[2]))

def format_task_1(row):
    device_id = parse_device_id(row)
    temperature = int(parse_temperature(row))
    execution_time = parse_execution_time(row)
    return json.dumps({
        "device_id": device_id,
        "temperature": temperature,
        "execution_time": execution_time
    }, separators=(',', ':'))

def format_task_2(row):
    device_id = parse_device_id(row)
    c_temp = parse_temperature(row)
    execution_time = parse_execution_time(row)
    f_temp = c_temp * 1.8 + 32.0
    return json.dumps({
        "device_id": device_id,
        "temperature": f_temp,
        "execution_time": execution_time
    }, separators=(',', ':'))

def format_task_3(row):
    device_id = parse_device_id(row)
    temperature = int(parse_temperature(row))
    execution_time = parse_execution_time(row)
    return json.dumps({
        "device_id": device_id,
        "temperature": temperature,
        "execution_time": execution_time
    }, separators=(',', ':'))

class GlobalAvgFunction(KeyedProcessFunction):
    def __init__(self):
        self.count_state = None
        self.sum_state = None

    def open(self, runtime_context):
        self.count_state = runtime_context.get_state(
            ValueStateDescriptor("global_count", Types.LONG())
        )
        self.sum_state = runtime_context.get_state(
            ValueStateDescriptor("global_sum", Types.DOUBLE())
        )

    def process_element(self, value, ctx):
        count = self.count_state.value()
        if count is None:
            count = 0
        total_sum = self.sum_state.value()
        if total_sum is None:
            total_sum = 0.0

        count += 1
        c_temp = parse_temperature(value)
        total_sum += c_temp

        self.count_state.update(count)
        self.sum_state.update(total_sum)

        avg = total_sum / count
        device_id = parse_device_id(value)
        temperature = int(c_temp)
        execution_time = parse_execution_time(value)

        res = {
            "device_id": device_id,
            "temperature": temperature,
            "execution_time": execution_time,
            "average_temperature": avg
        }
        yield json.dumps(res, separators=(',', ':'))

class Window5PerDeviceFunction(KeyedProcessFunction):
    def __init__(self):
        self.history_state = None

    def open(self, runtime_context):
        self.history_state = runtime_context.get_state(
            ValueStateDescriptor("device_history", Types.STRING())
        )

    def process_element(self, value, ctx):
        history_raw = self.history_state.value()
        if history_raw is None:
            history = []
        else:
            history = json.loads(history_raw)

        c_temp = parse_temperature(value)
        history.append(c_temp)
        if len(history) > 5:
            history = history[-5:]

        self.history_state.update(json.dumps(history))

        avg = sum(history) / len(history)
        device_id = parse_device_id(value)
        temperature = int(c_temp)
        execution_time = parse_execution_time(value)

        res = {
            "device_id": device_id,
            "temperature": temperature,
            "execution_time": execution_time,
            "average_temperature": avg
        }
        yield json.dumps(res, separators=(',', ':'))

def create_producer(topic_name):
    producer_props = {
        'bootstrap.servers': BOOTSTRAP_SERVERS
    }
    return FlinkKafkaProducer(
        topic=topic_name,
        serialization_schema=SimpleStringSchema(),
        producer_config=producer_props
    )

def main():
    logger.info("Initializing PyFlink Execution Environment...")
    config = Configuration()
    config.set_string("env.java.opts", "--add-opens=java.base/java.util=ALL-UNNAMED --add-opens=java.base/java.lang=ALL-UNNAMED --add-opens=java.base/java.lang.reflect=ALL-UNNAMED")
    jar_path = "file:///app/flink-sql-connector-kafka-1.17.2.jar"
    if os.path.exists("/app/flink-sql-connector-kafka-1.17.2.jar"):
        config.set_string("pipeline.jars", jar_path)

    env = StreamExecutionEnvironment.get_execution_environment(config)
    if os.path.exists("/app/flink-sql-connector-kafka-1.17.2.jar"):
        env.add_jars(jar_path)

    env.set_parallelism(1)

    type_info = Types.ROW_NAMED(
        ["device_id", "temperature", "execution_time"],
        [Types.INT(), Types.INT(), Types.INT()]
    )

    json_deserializer = JsonRowDeserializationSchema.builder() \
        .type_info(type_info) \
        .build()

    kafka_props = {
        'bootstrap.servers': BOOTSTRAP_SERVERS,
        'group.id': 'hw3_flink_group',
        'auto.offset.reset': 'earliest'
    }

    kafka_consumer = FlinkKafkaConsumer(
        topics=INPUT_TOPIC,
        deserialization_schema=json_deserializer,
        properties=kafka_props
    )

    input_stream = env.add_source(kafka_consumer)

    # Task 1: Pass-through to topic_task_1
    task_1_stream = input_stream.map(format_task_1, output_type=Types.STRING())
    task_1_stream.add_sink(create_producer("topic_task_1"))

    # Task 2: Celsius to Fahrenheit to topic_task_2
    task_2_stream = input_stream.map(format_task_2, output_type=Types.STRING())
    task_2_stream.add_sink(create_producer("topic_task_2"))

    # Task 3: Filter temp > 50 to topic_task_3
    task_3_stream = input_stream.filter(lambda r: parse_temperature(r) > 50) \
                                .map(format_task_3, output_type=Types.STRING())
    task_3_stream.add_sink(create_producer("topic_task_3"))

    # Task 4: Global average temperature to topic_task_4
    task_4_stream = input_stream.key_by(lambda r: 1) \
                                .process(GlobalAvgFunction(), output_type=Types.STRING()) \
                                .set_parallelism(1)
    task_4_stream.add_sink(create_producer("topic_task_4"))

    # Task 5: Per-device 5-message window average to topic_task_5
    task_5_stream = input_stream.key_by(lambda r: parse_device_id(r)) \
                                .process(Window5PerDeviceFunction(), output_type=Types.STRING())
    task_5_stream.add_sink(create_producer("topic_task_5"))

    logger.info("Executing PyFlink Kafka Streaming Job...")
    env.execute("PyFlink Streaming HW3 Job")

if __name__ == "__main__":
    main()
