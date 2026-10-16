#!/bin/bash
# CL2-IF IF-13 attacker check on the one root step (volume-init): can a symlink planted in a data volume make the
# root chown touch a file OUTSIDE the volume?
#  - the app user (10001) planted /data/uploads/evil_link_shadow -> /etc/shadow and /data/logs/evil_dir_etc -> /etc
#    (owned by 10001, so find never even selects them);
#  - here a ROOT-owned symlink and a root-owned file are added too (worst case: left behind by the old root image),
#    then the exact volume-init command from docker-compose.yml is re-run with the same restrictions,
#    and /etc/shadow, /etc/passwd and /app/app/main.py are checked inside that same container.
export MSYS_NO_PATHCONV=1
docker run --rm --network none -v ckam-r2c_uploads:/data/uploads -v ckam-r2c_logs:/data/logs alpine:latest \
  sh -c 'ln -s /etc/passwd /data/uploads/root_link_passwd && ln -s /app/app/main.py /data/logs/root_link_main && echo x > /data/uploads/root_file && ls -lan /data/uploads /data/logs'
echo "# re-run volume-init (image ckam-r2c-volume-init, user 0:0, cap-drop ALL + CHOWN, DAC_READ_SEARCH, no-new-privileges, no network)"
docker run --rm --user 0:0 --network none --cap-drop ALL --cap-add CHOWN --cap-add DAC_READ_SEARCH \
  --security-opt no-new-privileges:true -v ckam-r2c_uploads:/data/uploads -v ckam-r2c_logs:/data/logs \
  --entrypoint sh ckam-r2c-volume-init -c "find /data/uploads /data/logs \\( ! -user 10001 -o ! -group 10001 \\) -exec chown -h 10001:10001 {} + && echo 'volume-init: done'; echo '# targets after chown (must still be root-owned):'; ls -ln /etc/shadow /etc/passwd /app/app/main.py; ls -lnd /etc; echo '# links/files in the volumes:'; ls -lan /data/uploads /data/logs"
echo "# cleanup of the planted links/files"
docker run --rm --network none -v ckam-r2c_uploads:/data/uploads -v ckam-r2c_logs:/data/logs alpine:latest \
  sh -c 'rm -f /data/uploads/root_link_passwd /data/logs/root_link_main /data/uploads/root_file /data/uploads/evil_link_shadow /data/logs/evil_dir_etc; ls -lan /data/uploads /data/logs'
