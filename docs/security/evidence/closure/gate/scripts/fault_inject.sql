-- GT step 6 (fault injection, throw-away copy gate_copy_c only): make migration 4 (c6e8a0b2d4f6) fail by
-- pre-creating a trigger with the name it creates. Shows what a failure part-way through `alembic upgrade head` leaves.
CREATE FUNCTION gt_dummy_trigger_fn() RETURNS trigger AS $$ BEGIN RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_asset_lifecycle_fields_guard BEFORE UPDATE ON asset FOR EACH ROW EXECUTE FUNCTION gt_dummy_trigger_fn();
