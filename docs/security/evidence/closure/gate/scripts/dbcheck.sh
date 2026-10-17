#!/bin/sh
# GT: run a read-only SQL file against database $1 of the throw-away gate DB, as the app role.
export PGPASSWORD=gate_app_throwaway_pw
psql -h 127.0.0.1 -U ckassetapp -d "$1" -f "$2"
