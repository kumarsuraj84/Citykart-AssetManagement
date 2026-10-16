#!/bin/bash
# CL2-IF item 5 (IF-04 / N4 / OBS-GUARD-MSG / CL1-N4-01): ENVIRONMENT_NAME x JWT_SECRET start-up matrix on throw-away
# containers of the RUNNING ckam-sec api image (ckam-sec-api). No database: DATABASE_URL points at a closed port, the
# start-up refusal happens before any database use. Each case: start detached, wait until the process exits or logs
# "Application startup complete", record the outcome, check the secret value never appears in the output, remove.
# usage: bash n4_startup_matrix.sh > raw/n4_startup_matrix.tsv
export MSYS_NO_PATHCONV=1
IMG=ckam-sec-api
GOOD40="Zq7#mP2vL9x\$Rt4wK8nB3cY6hJ1sF5gD0aE&uV-W"   # throw-away, 40 chars, many distinct characters
S31="9f3Kq2Lm8Xv4Tz7Wb1Nc6Rd5Hy0Pj3G"                # 31 characters, many distinct
S32_4="abcdabcdabcdabcdabcdabcdabcdabcd"               # 32 characters, 4 distinct
SP40="                                        "        # 40 spaces
A40="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
declare -A SECRETS=(
  [placeholder]="dev_secret_change_me" [change_me_too]="change_me_too" [short]="Sh0rt-but-random!" [spaces40]="$SP40"
  [a40]="$A40" [len31]="$S31" [len32_4distinct]="$S32_4" [good40]="$GOOD40" [UNSET]="__UNSET__"
)
SECRET_ORDER="UNSET placeholder change_me_too short spaces40 a40 len31 len32_4distinct good40"
# name -> value ("__UNSET__" = variable not passed at all)
declare -A ENVS=(
  [unset]="__UNSET__" [blank]="" [prd]="prd" [live]="live" [prod-1]="prod-1" [Production]="Production"
  [staging]="staging" [junk]="xq-7-junk" [sp_PROD_sp]=" PROD " [development]="development" [dev]="dev" [test]="test"
  [testing]="testing" [uat]="uat" [security-test]="security-test" [local]="local" [ci]="ci" [sp_UAT_sp]=" UAT "
  [Development]="Development"
)
ENV_ORDER="unset blank prd live prod-1 Production staging junk sp_PROD_sp development dev test testing uat security-test local ci sp_UAT_sp Development"
printf "env_label\tenv_value\tsecret_label\toutcome\texit\tsecret_in_output\tmsg_32\tmsg_8distinct\tmsg_placeholder\tdocs\n"
n=0
for e in $ENV_ORDER; do
  for s in $SECRET_ORDER; do
    # Production-treated names: full secret matrix. Dev names: only placeholder / UNSET / short (they must START).
    case "$e" in development|dev|test|testing|uat|security-test|local|ci|sp_UAT_sp|Development)
      case "$s" in placeholder|UNSET|short|good40) ;; *) continue;; esac;;
    esac
    n=$((n+1)); name="ckam-r2c-n4-$n"
    args=(-d --name "$name" --network none -e "DATABASE_URL=postgresql+asyncpg://x:y@127.0.0.1:1/none" -e "LOG_DIR=/tmp/logs")
    [ "${ENVS[$e]}" != "__UNSET__" ] && args+=(-e "ENVIRONMENT_NAME=${ENVS[$e]}")
    [ "${SECRETS[$s]}" != "__UNSET__" ] && args+=(-e "JWT_SECRET=${SECRETS[$s]}")
    docker run "${args[@]}" "$IMG" >/dev/null 2>&1
    outcome=TIMEOUT; code=-
    for i in $(seq 1 40); do
      st=$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null)
      if [ "$st" = "exited" ]; then outcome=REFUSED; code=$(docker inspect -f '{{.State.ExitCode}}' "$name"); break; fi
      if docker logs "$name" 2>&1 | grep -q "Application startup complete"; then outcome=STARTED; break; fi
      sleep 0.5
    done
    logs=$(docker logs "$name" 2>&1)
    docs=-
    if [ "$outcome" = STARTED ]; then
      # Is the API map published? (inside the container: python, no network needed)
      docs=$(docker exec "$name" python -c "import urllib.request as u
r=[]
for p in ('/docs','/redoc','/openapi.json'):
    try: r.append(str(u.urlopen('http://127.0.0.1:8000'+p).status))
    except Exception as ex: r.append(str(getattr(ex,'code','ERR')))
print('/'.join(r))" 2>/dev/null)
    fi
    leak=no
    sv="${SECRETS[$s]}"
    case "$s" in UNSET|spaces40) leak=n/a;; *)
      # Known placeholders are PUBLIC values the dev warning names on purpose; for them only refusals are checked.
      if [ "$outcome" = REFUSED ] || [ "$s" != placeholder -a "$s" != change_me_too ]; then
        printf '%s' "$logs" | grep -qF -- "$sv" && leak=YES
      else leak="n/a(public placeholder, dev warning)"; fi;;
    esac
    m32=$(printf '%s' "$logs" | grep -c "at least 32 characters")
    m8=$(printf '%s' "$logs" | grep -c "at least 8 different characters")
    mph=$(printf '%s' "$logs" | grep -c "must not be a placeholder")
    printf "%s\t[%s]\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$e" "${ENVS[$e]}" "$s" "$outcome" "$code" "$leak" "$m32" "$m8" "$mph" "$docs"
    if [ "$n" = 3 ]; then printf '%s\n' "$logs" | tail -4 | sed 's/^/# sample refusal output: /' >&2; fi
    docker rm -f "$name" >/dev/null 2>&1
  done
done
