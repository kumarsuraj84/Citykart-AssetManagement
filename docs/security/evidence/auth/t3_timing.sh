#!/usr/bin/env bash
# Username/account-state enumeration via response TIMING. 35 samples each.
# existing+valid (argon2 runs, resets counter, no lock) vs non-existent vs locked vs disabled.
API=http://127.0.0.1:8200
PW='Sec#Test2026ok'
D="C:/Users/User2/AppData/Local/Temp/claude/D--ANKUR-AI-PROJECTS-Asset-Management/33a6302e-4441-4084-94a5-472d20016684/scratchpad/sec/auth"
N=35
sample(){ # $1 loginid $2 pw $3 outfile
  : > "$3"
  for i in $(seq 1 $N); do
    curl -s -o /dev/null -w '%{time_total}\n' -X POST $API/api/auth/login \
      -H 'Content-Type: application/json' -d "{\"login_id\":\"$1\",\"password\":\"$2\"}" >> "$3"
  done
}
stats(){ # $1 file $2 label
  awk '{a[NR]=$1*1000; s+=$1*1000} END{n=NR; asort(a); mean=s/n; med=(n%2)?a[int(n/2)+1]:(a[n/2]+a[n/2+1])/2; printf "%-22s n=%d mean=%.1fms median=%.1fms min=%.1f max=%.1f\n","'"$2"'",n,mean,med,a[1],a[n]}' "$1"
}
sample "SECVIEW"   "$PW"        "$D/t_existing.txt"     # 200, argon2 runs, counter reset
sample "ghostzzz9" "$PW"        "$D/t_nonexist.txt"     # 401, no argon2
sample "SECLOCK"   "$PW"        "$D/t_locked.txt"       # 423, early return
sample "SECDIS"    "$PW"        "$D/t_disabled.txt"     # 401, filtered out, no argon2
echo "--- timing summary ---"
stats "$D/t_existing.txt" "existing(valid,200)"
stats "$D/t_nonexist.txt" "nonexistent(401)"
stats "$D/t_locked.txt"   "locked(423)"
stats "$D/t_disabled.txt" "disabled(401)"
