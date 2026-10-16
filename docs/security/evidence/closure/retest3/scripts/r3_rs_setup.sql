-- CL3 IF-01/IF-02 role split: pre-split setup on a NEW throw-away database in the ckam-sec Postgres.
-- Run as the superuser (ckam) connected to the `postgres` database. Throw-away roles/db, dropped at the end.
\set ON_ERROR_STOP on
DROP DATABASE IF EXISTS ckam_r3_rs;
DROP ROLE IF EXISTS r3_app;
DROP ROLE IF EXISTS r3_migrator;
DROP ROLE IF EXISTS r3_owner;
CREATE ROLE r3_owner NOLOGIN;
CREATE ROLE r3_migrator LOGIN PASSWORD 'r3_mig_throwaway';
CREATE ROLE r3_app LOGIN PASSWORD 'r3_app_throwaway';
-- migrator may act as the owner (needed so ALEMBIC_SET_ROLE=r3_owner works during the first migration)
GRANT r3_owner TO r3_migrator;
CREATE DATABASE ckam_r3_rs OWNER r3_owner;
GRANT CONNECT ON DATABASE ckam_r3_rs TO r3_migrator, r3_app;
