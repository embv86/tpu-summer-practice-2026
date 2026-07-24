#!/bin/bash
set -e

# Запуск приложения потоковой обработки PyFlink
echo "Запуск приложения PyFlink Streaming HW3..."
exec python3 /app/main.py
