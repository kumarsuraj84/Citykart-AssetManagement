#!/bin/sh
# Production folder layout with FAKE canary secrets (PRODUCTION_INFRASTRUCTURE.md: <root>\releases\<sha>\frontend-dist,
# <root>\shared\.env, <root>\shared\nas.pw). Nothing here is a real value.
set -e
R=/tmp/root
D=$R/releases/abc/frontend-dist
mkdir -p $D/assets/sub $D/assets-evil $R/releases/abc/frontend-dist-evil $R/shared
echo ok > $D/assets/a.js
echo 'body{}' > $D/assets/sub/b.css
echo '<html>shell</html>' > $D/index.html
echo '<svg/>' > $D/favicon.svg
printf 'PNG' > $D/logo.png
echo 'DIST-SECRET root file not on the allow-list' > $D/secret_in_dist.txt
echo 'CANARY assets-evil sibling' > $D/assets-evil/secret.txt
echo 'CANARY frontend-dist-evil sibling' > $R/releases/abc/frontend-dist-evil/secret.txt
printf 'JWT_SECRET=FAKE-CANARY-NOT-REAL\nDATABASE_URL=postgresql+asyncpg://x:FAKE-CANARY@127.0.0.1/x\n' > $R/shared/.env
echo 'FAKE-NAS-CANARY' > $R/shared/nas.pw
echo 'CANARY outside dist' > $R/releases/abc/secret_outside.txt
echo 'CANARY outside dist' > $R/releases/secret_outside.txt
echo 'CANARY outside dist' > /tmp/secret_outside.txt
ln -sf /tmp/secret_outside.txt $D/assets/link_out.txt
ls -laR $R | head -60
