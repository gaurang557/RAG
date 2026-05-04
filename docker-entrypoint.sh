#!/bin/sh
set -e

echo "Initialising database…"
python init_db.py

echo "Starting API server…"
exec uvicorn app:app --host 0.0.0.0 --port 8000
