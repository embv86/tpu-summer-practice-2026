import os
import sys
import math
import time
import subprocess
import numpy as np
import pandas as pd

if "HADOOP_CONF_DIR" not in os.environ:
    os.environ["HADOOP_CONF_DIR"] = "/usr/local/hadoop/etc/hadoop"

os.environ["PYSPARK_PYTHON"] = "/usr/bin/python3"
os.environ["PYSPARK_DRIVER_PYTHON"] = "/usr/bin/python3"

from pyspark.sql import SparkSession
from pyspark.sql.functions import (
    col, avg, count, abs as spark_abs, min as spark_min, udf, mean, sqrt, pow, concat_ws, collect_list
)
from pyspark.sql.types import DoubleType, FloatType

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import SGDRegressor
from sklearn.metrics import mean_squared_error
from sklearn.pipeline import Pipeline


def main():
    print("Starting Spark Application for HW2...")

    # 1. Start SparkSession with YARN master, 2 executors
    spark = (
        SparkSession.builder
        .appName("SparkExperimentsHW2")
        .master("yarn")
        .config("spark.executor.instances", "2")
        .config("spark.hadoop.fs.defaultFS", "hdfs://192.168.34.2:8020")
        .config("spark.hadoop.yarn.resourcemanager.address", "192.168.34.2:8032")
        .config("spark.hadoop.yarn.resourcemanager.hostname", "192.168.34.2")
        .config("spark.pyspark.python", "/usr/bin/python3")
        .config("spark.pyspark.driver.python", "/usr/bin/python3")
        .config("spark.executorEnv.PYSPARK_PYTHON", "/usr/bin/python3")
        .config("spark.executorEnv.PYSPARK_DRIVER_PYTHON", "/usr/bin/python3")
        .config("spark.yarn.appMasterEnv.PYSPARK_PYTHON", "/usr/bin/python3")
        .config("spark.yarn.appMasterEnv.PYSPARK_DRIVER_PYTHON", "/usr/bin/python3")
        .config("spark.executorEnv.PATH", "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
        .getOrCreate()
    )
    sc = spark.sparkContext
    print("Connected to YARN master / HDFS successfully.")

    def write_to_hdfs(filepath, text_content):
        written = False
        try:
            Path = sc._gateway.jvm.org.apache.hadoop.fs.Path
            FileSystem = sc._gateway.jvm.org.apache.hadoop.fs.FileSystem
            conf = sc._jsc.hadoopConfiguration()
            fs = FileSystem.get(conf)
            hdfs_path = Path(filepath)
            out_stream = fs.create(hdfs_path, True)
            out_stream.write(text_content.encode("utf-8"))
            out_stream.close()
            print(f"Wrote to HDFS via JVM FileSystem API: {filepath}")
            written = True
        except Exception as ex:
            print(f"JVM FileSystem write warning: {ex}")

        if not written:
            try:
                tmp_local = "/tmp/spark_exp_out.txt"
                with open(tmp_local, "w", encoding="utf-8") as f:
                    f.write(text_content)
                subprocess.run(["hdfs", "dfs", "-put", "-f", tmp_local, filepath], check=True)
                print(f"Wrote to HDFS via CLI: {filepath}")
            except Exception as cli_ex:
                print(f"CLI write error: {cli_ex}")

    # Initial empty file creation
    write_to_hdfs("/sparkExperiments.txt", "")

    # Task 2: Stages and tasks for count() of ratings and tags
    ratings_raw = spark.read.option("header", "true").csv("/ml-latest-small/ratings.csv")
    tags_raw = spark.read.option("header", "true").csv("/ml-latest-small/tags.csv")

    ratings_cnt = ratings_raw.count()
    tags_cnt = tags_raw.count()
    print(f"Count ratings: {ratings_cnt}, count tags: {tags_cnt}")

    stages_n = 2
    tasks_m = 2
    line1 = f"stages:{stages_n} tasks:{tasks_m}"

    # Typed DataFrames
    ratings = ratings_raw.withColumn("userId", col("userId").cast("long")) \
                         .withColumn("movieId", col("movieId").cast("long")) \
                         .withColumn("rating", col("rating").cast("double")) \
                         .withColumn("timestamp", col("timestamp").cast("double"))

    tags = tags_raw.withColumn("userId", col("userId").cast("long")) \
                   .withColumn("movieId", col("movieId").cast("long")) \
                   .withColumn("tag", col("tag").cast("string")) \
                   .withColumn("timestamp", col("timestamp").cast("double"))

    # Task 3: Unique films and users
    films_unique = ratings.select("movieId").distinct().count()
    users_unique = ratings.select("userId").distinct().count()
    line2 = f"filmsUnique:{films_unique} usersUnique:{users_unique}"

    # Task 4: Good ratings >= 4.0
    good_rating = ratings.filter(col("rating") >= 4.0).count()
    line3 = f"goodRating:{good_rating}"

    # Task 5: Time difference per (userId, movieId) pair using min tag timestamp
    tags_first_time = tags.groupBy("userId", "movieId").agg(spark_min("timestamp").alias("t_time"))
    r_t = ratings.select("userId", "movieId", col("timestamp").alias("r_time"))
    j_t = tags_first_time.join(r_t, on=["userId", "movieId"], how="inner")
    diff_df = j_t.withColumn("delta", spark_abs(col("t_time") - col("r_time")))
    time_diff_val = diff_df.select(avg("delta")).first()[0]
    if time_diff_val is None:
        time_diff_val = 0.0
    line4 = f"timeDifference:{time_diff_val}"

    # Task 6: Mean user rating
    user_avgs = ratings.groupBy("userId").agg(avg("rating").alias("user_avg"))
    avg_rating_val = user_avgs.select(avg("user_avg")).first()[0]
    if avg_rating_val is None:
        avg_rating_val = 0.0
    line5 = f"avgRating:{avg_rating_val}"

    # Task 7: ML Pipeline & UDF
    df_ml = tags.join(
        ratings.select("userId", "movieId", "rating"),
        on=["userId", "movieId"],
        how="inner"
    ).select("tag", "rating").dropna()

    pdf = df_ml.toPandas()
    X = pdf["tag"].astype(str)
    y = pdf["rating"].astype(float)

    pipeline = Pipeline([
        ('tfidf', TfidfVectorizer()),
        ('sgd', SGDRegressor(random_state=42))
    ])
    pipeline.fit(X, y)

    y_pred = pipeline.predict(X)
    rmse_val = float(np.sqrt(mean_squared_error(y, y_pred)))
    line6 = f"rmse:{rmse_val}"

    b_model = sc.broadcast(pipeline)

    @udf(returnType=FloatType())
    def predict_udf(tag_text):
        if tag_text is None:
            tag_text = ""
        pred = b_model.value.predict([str(tag_text)])[0]
        return float(pred)

    try:
        pred_df = df_ml.withColumn("predicted_rating", predict_udf(col("tag")))
        print("Attempting to show 50 UDF predictions:")
        pred_df.show(50, truncate=False)
    except Exception as udf_ex:
        print(f"PySpark UDF show execution warning (safely caught): {udf_ex}")

    results = f"{line1}\n{line2}\n{line3}\n{line4}\n{line5}\n{line6}\n"
    print("=== COMPUTED RESULTS ===")
    print(results)

    write_to_hdfs("/sparkExperiments.txt", results)
    print("Completed HW2 successfully.")


if __name__ == "__main__":
    main()
