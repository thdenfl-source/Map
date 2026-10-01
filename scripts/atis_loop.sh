#!/usr/bin/env bash
# ATIS 수집 반복 — .github/workflows/atis.yml 이 돌린다.
#
# GitHub 의 예약 실행은 '10분마다' 로 걸어 두어도 실제로는 몇 시간에 한 번만
# 깨운다(등록 후 하루 동안 4시간 간격 남짓으로 두 번). 그래서 한 번 깨면 그
# 작업 안에서 10분 간격으로 계속 받아 올린다. 작업 한도(6시간) 안에서 끝내고,
# 그동안 들어온 다음 예약은 대기열에서 기다렸다가 이어받는다(같은 concurrency).
#
#   RUN_SEC    — 이만큼 돌고 끝낸다(기본 335분)
#   EVERY_SEC  — 수집 간격(기본 600초)
#   ATIS_REMOTE — 올릴 곳(기본: 이 저장소). 시험할 때 바꾼다.
set -u
cd "$(dirname "$0")/.."

run_sec=${RUN_SEC:-$((335 * 60))}
every=${EVERY_SEC:-600}
remote=${ATIS_REMOTE:-"https://x-access-token:${TOKEN}@github.com/${GITHUB_REPOSITORY}.git"}
end=$(( $(date +%s) + run_sec ))
n=0

while :; do
  t0=$(date +%s); n=$((n + 1))
  # 한 공항도 못 받았으면(그쪽 서버나 네트워크가 막힌 것) 올리지 않는다 —
  # 그대로 올리면 멀쩡한 앞 자료를 '전부 실패' 로 덮어쓴다.
  if timeout 240 python3 scripts/atis_scrape.py > atis.new.json && python3 - <<'PY'
import json, sys
d = json.load(open("atis.new.json"))
st = d.get("status", {})
good = [k for k, v in st.items() if not v.startswith(("err", "http"))]
print(d.get("generated"), {k: v for k, v in st.items() if v != "none"})
sys.exit(0 if good else 1)
PY
  then
    rm -rf out && mkdir out && cp atis.new.json out/atis.json
    if ( cd out && git init -q -b atis-data && git add atis.json \
         && git -c user.name="github-actions[bot]" \
                -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
                commit -q -m "ATIS $(date -u +%Y-%m-%dT%H:%MZ)" \
         && git push -q -f "$remote" atis-data ); then
      echo "#$n 올림"
    else
      echo "#$n 올리기 실패 — 다음 차례에 다시"
    fi
  else
    echo "#$n 수집 실패 — 이번 차례는 건너뛴다"
  fi

  next=$(( t0 + every ))
  if [ "$next" -ge "$end" ]; then echo "끝 (${n}회)"; break; fi
  now=$(date +%s)
  [ "$next" -gt "$now" ] && sleep $(( next - now ))
done
