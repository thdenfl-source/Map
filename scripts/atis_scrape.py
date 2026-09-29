#!/usr/bin/env python3
"""국내 공항 D-ATIS 수집 — GitHub Actions(.github/workflows/atis.yml)가 돌린다.

왜 서버에서 받는가
  앱(브라우저)이 atis.guru 를 직접 부르면 CORS 에 막혀 공개 CORS 프록시를
  거쳐야 하는데, 공짜 프록시들은 막히거나 느리거나 사라지기 일쑤다(실제로
  인천·김포가 하나도 안 나왔다). 여기서 받아 JSON 한 장으로 만들어 두면
  앱은 raw.githubusercontent.com(CORS 허용)에서 바로 읽는다.

atis.guru 는 항공기가 ACARS 로 D-ATIS 를 요청할 때 오가는 원문을 모아
공항별 페이지로 보여 준다. 공개 API 는 없다. 페이지는 서버에서 미리
그려진 HTML 이고, 원문은 <div class="atis"> 안에, 수집 시각은 그 카드의
<h6 class="card-subtitle">2026-09-23 06:24 UTC</h6> 에 있다. 같은 모양의
칸에 METAR·TAF 도 들어 있으므로 ATIS 만 골라낸다.

출력(표준 출력, JSON):
  { "generated": "...Z",
    "airports": { "RKSI": [ {"type","code","time","collected","text"} ... ] },
    "status":   { "RKSI": "ok 3" | "none" | "http 404" | "err ..." } }
"""
import datetime as dt
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URL = "https://atis.guru/atis/{}"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36 (+https://github.com/thdenfl-source/Map)")

BLOCK_RE = re.compile(r'<div[^>]*class="[^"]*\batis\b[^"]*"[^>]*>(.*?)</div>', re.S | re.I)
SUB_RE = re.compile(r'card-subtitle[^>]*>([^<]+)<', re.I)
STAMP_RE = re.compile(r'(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)(?::\d\d)?\s*(?:UTC|Z)', re.I)
TAG_RE = re.compile(r'<[^>]+>')


def airports():
    """지도에 올라 있는 국내 공항 — 앱과 같은 목록(js/04-map.js AIRPORTS_KR)."""
    src = (ROOT / "js" / "04-map.js").read_text(encoding="utf-8")
    return sorted(set(re.findall(r"icao:\s*'(RK[A-Z]{2})'", src)))


def meta(text):
    up = text.upper()
    m = re.search(r'\b(?:ATIS|INFO(?:RMATION)?)\s+(?:INFO(?:RMATION)?\s+)?([A-Z])\b', up)
    arr = re.search(r'\bARR(?:IVAL)?\b', up) is not None
    dep = re.search(r'\bDEP(?:ARTURE)?\b', up) is not None
    hm = re.search(r'\b([01]\d|2[0-3])([0-5]\d)\s?Z\b', up)
    return {
        "type": "ARR" if arr and not dep else ("DEP" if dep and not arr else ""),
        "code": m.group(1) if m else "",
        "time": f"{hm.group(1)}{hm.group(2)}Z" if hm else "",
    }


def is_atis(text):
    up = text.upper()
    if re.match(r'^(METAR|SPECI|TAF)\b', up) or re.match(r'^[A-Z]{4}\s+\d{6}Z\b', up):
        return False                      # 같은 칸 모양의 METAR·TAF
    return len(text) >= 30 and re.search(r'\b(ATIS|INFORMATION)\b', up) is not None


def parse(page):
    out = []
    for m in BLOCK_RE.finditer(page):
        raw = TAG_RE.sub(" ", m.group(1))
        text = re.sub(r"\s+", " ", html.unescape(raw)).strip()
        if not is_atis(text):
            continue
        subs = SUB_RE.findall(page[: m.start()])
        st = STAMP_RE.search(subs[-1]) if subs else None
        collected = None
        if st:
            y, mo, d, h, mi = map(int, st.groups())
            collected = dt.datetime(y, mo, d, h, mi, tzinfo=dt.timezone.utc).isoformat().replace("+00:00", "Z")
        item = {**meta(text), "collected": collected, "text": text}
        # 지난 ATIS 가 아래로 줄줄이 붙는다 — 도착·출발·통합별로 맨 앞(최신) 하나씩
        if any(o["type"] == item["type"] for o in out):
            continue
        out.append(item)
        if len(out) >= 2:
            break
    return out


def fetch(icao):
    req = urllib.request.Request(URL.format(icao), headers={"User-Agent": UA, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def main():
    result = {"generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
              "source": "atis.guru", "airports": {}, "status": {}}
    for icao in airports():
        try:
            items = parse(fetch(icao))
            if items:
                result["airports"][icao] = items
            result["status"][icao] = f"ok {len(items)}" if items else "none"
        except urllib.error.HTTPError as e:
            result["status"][icao] = f"http {e.code}"
        except Exception as e:  # noqa: BLE001 — 한 공항이 실패해도 나머지는 받는다
            result["status"][icao] = f"err {type(e).__name__}"
        time.sleep(0.5)           # 남의 서버다 — 몰아서 두드리지 않는다
    json.dump(result, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
