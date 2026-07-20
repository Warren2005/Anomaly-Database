#!/bin/sh
set -e
exec gunicorn app.main:app -c gunicorn.conf.py
