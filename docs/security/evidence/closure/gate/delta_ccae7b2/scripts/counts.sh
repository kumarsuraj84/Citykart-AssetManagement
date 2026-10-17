#!/bin/sh
# GT rehearsal: exact row count of every table in schema public of database $1 (one line per table).
set -eu
export PGPASSWORD=gate_app_throwaway_pw
psql -h 127.0.0.1 -U ckassetapp -d "$1" -Atc "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1" | while read t; do
  n=$(psql -h 127.0.0.1 -U ckassetapp -d "$1" -Atc "select count(*) from public.\"$t\"")
  echo "$t,$n"
done
