#!/usr/bin/env python3
"""국내 골프장 요금 보강: 한국관광공사 TourAPI(공공데이터포털) 골프장 이용요금 → kr-venues.json

- 자료는 태일골프 공공데이터 연결 서버(Google Apps Script, services.json 의 dataProxy, ?api=golf)로 받는다. 인증키는 그 서버에만 있다.
- 골프장 공식 홈페이지에서 확인한 요금(priceSrc 가 있는 곳)이나 태일골프가 직접 넣은 요금은 절대 덮어쓰지 않는다.
- 관광공사 요금은 price.memo 에 '한국관광공사 관광정보 기준(수정일)' 을 붙여 출처를 밝힌다.
사용: python3 tools/kr_tour_fees.py [--offline data/kr-tour-golf.json]
"""
import json, math, os, re, struct, sys, glob, time, urllib.request, urllib.parse
from datetime import datetime, timezone

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(R, 'data', 'kr-tour-golf.json')
KRV = os.path.join(R, 'kr-venues.json')
TAG = '한국관광공사 관광정보'


def fetch_all():
    px = os.environ.get('PROXY_URL') or json.load(open(os.path.join(R, 'services.json')))['dataProxy']
    items, total, page = [], None, 1
    while page <= 40:
        for tryno in range(3):
            try:
                req = urllib.request.Request(px + '?api=golf&page=%d' % page, headers={'User-Agent': 'TaeilGolf-data/1.0'})
                j = json.loads(urllib.request.urlopen(req, timeout=300).read().decode('utf-8'))
                break
            except Exception as e:
                print('page', page, 'retry', tryno, e, file=sys.stderr); time.sleep(10)
        else:
            raise SystemExit('연결 서버 응답 없음')
        if not j.get('ok'):
            print('::warning::연결 서버 오류: %s (공공데이터포털 관광정보 활용신청과 연결 서버 코드 교체가 필요할 수 있음)' % j.get('error'))
            raise SystemExit(0)
        items += j['items']; total = j['total']
        print('page', page, len(j['items']), '/', total, 'failed', j.get('failed'), file=sys.stderr)
        if len(j['items']) < 100 or len(items) >= total:
            break
        page += 1
    raw = {'fetched': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'src': '한국관광공사 TourAPI 국문 관광정보 서비스 (공공데이터포털)', 'total': total, 'items': items}
    os.makedirs(os.path.dirname(RAW), exist_ok=True)
    json.dump(raw, open(RAW, 'w'), ensure_ascii=False, indent=0)
    return raw


def asar_file(path, name):
    with open(path, 'rb') as f:
        h16 = f.read(16); hsize = struct.unpack('<I', h16[4:8])[0]; slen = struct.unpack('<I', h16[12:16])[0]
        hdr = json.loads(f.read(slen)); base = 8 + hsize
        node = hdr
        for part in name.split('/'):
            node = node['files'][part]
        f.seek(base + int(node['offset'])); return f.read(node['size'])


def km(a, b, c, d):
    return math.hypot((a - c) * 111.2, (b - d) * 111.2 * math.cos(math.radians(a)))


def norm(n):
    n = (n or '').lower()
    n = re.sub(r'\(.*?\)', '', n)
    return re.sub(r'(골프|클럽|컨트리|칸트리|리조트|퍼블릭|대중제|회원제|golf|club|resort|country|c\.?c|g\.?c|[^\w])', '', n)


NOT_COURSE = re.compile(r'스크린|screen|연습장|range|인도어|아카데미|파크\s*골프|파크골프|미니', re.I)


def money(s):
    return int(s.replace(',', '').replace('.', '')) if s else 0


def won_in(txt):
    """'150,000원', '15만원', '15만 5천원' → 원 단위 숫자 목록"""
    out = []
    for m in re.finditer(r'(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(만\s*(?:\d{1,4}\s*천)?\s*원|천\s*원|원)', txt):
        num, unit = m.group(1), m.group(2).replace(' ', '')
        if unit.startswith('만'):
            v = float(num.replace(',', '')) * 10000
            t = re.search(r'(\d{1,4})천', unit)
            if t: v += int(t.group(1)) * 1000
        elif unit.startswith('천'):
            v = float(num.replace(',', '')) * 1000
        else:
            v = float(num.replace(',', ''))
        out.append((m.start(), int(v)))
    return out


def clean(t):
    t = re.sub(r'<br\s*/?>', '\n', t or '', flags=re.I)
    t = re.sub(r'<[^>]+>', ' ', t)
    t = t.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    return '\n'.join(re.sub(r'[ \t]+', ' ', l).strip() for l in t.split('\n') if l.strip())


GF_MIN, GF_MAX = 25000, 600000
OLD = '%04d-%02d-%02d' % (datetime.now().year - 2, datetime.now().month, 1)


def parse_fee(fee, small=False):
    """관광공사 이용요금 글 → {wdD, weD, cart, caddie} (확실한 것만). small=스크린·연습장"""
    lo, hi = (3000, 100000) if small else (GF_MIN, GF_MAX)
    txt = clean(fee); p = {}
    for line in txt.split('\n'):
        if re.search(r'9\s*홀', line) and not re.search(r'18\s*홀', line):
            continue  # 9홀 요금은 메모로만
        if re.search(r'회원(?!제)|우대|주주|경로|청소년|군인|도민|지역민|시민|야간', line) and not re.search(r'비\s*회원|일반', line):
            continue
        w = won_in(line)
        if not w:
            continue
        if re.search(r'카트', line) and 'cart' not in p:
            v = w[0][1]
            if 40000 <= v <= 200000 and re.search(r'팀|대|카트\s*(?:비|료)?\s*[:：]?\s*\d', line) and not re.search(r'1\s*인|인당', line):
                p['cart'] = v
            continue
        if re.search(r'캐디|캐티|도우미', line) and 'caddie' not in p:
            v = w[0][1]
            if 100000 <= v <= 250000 and not re.search(r'1\s*인|인당', line):
                p['caddie'] = v
            continue
        def after(rx):
            m = re.search(rx, line)
            if not m: return 0
            for pos, v in w:
                if pos >= m.end() and lo <= v <= hi:
                    return v
            return 0
        wd = after(r'주중|평일|월\s*[~\-]\s*금')
        we = after(r'주말|토\s*[·,/~\-]?\s*일|토요일|일요일|공휴일|휴일')
        if wd and 'wdD' not in p: p['wdD'] = wd
        if we and 'weD' not in p: p['weD'] = we
        if not wd and not we and re.search(r'그린\s*피|입장료|이용료|게임|1\s*인|시간', line) and 'wdD' not in p and 'weD' not in p:
            gv = [v for _, v in w if lo <= v <= hi]
            if len(gv) == 1: p['gf'] = gv[0]
    if 'gf' in p:
        g = p.pop('gf')
        if 'wdD' not in p and 'weD' not in p: p['wdD'] = g; p['weD'] = g
    return p, txt


def main():
    if '--offline' in sys.argv:
        raw = json.load(open(sys.argv[sys.argv.index('--offline') + 1]))
    else:
        raw = fetch_all()
    items = raw['items']
    asar = sorted(glob.glob(os.path.join(R, 'app-*.asar')))[-1]
    W = json.loads(asar_file(asar, 'world_builtin.json'))['list']
    WK = [d for d in W if d.get('c') == 'South Korea']
    W = [d for d in WK if not NOT_COURSE.search((d.get('n') or '') + ' ' + (d.get('nk') or ''))]
    WS = [d for d in WK if NOT_COURSE.search((d.get('n') or '') + ' ' + (d.get('nk') or ''))]
    K = json.load(open(KRV)); V = K['venues']; byid = {v['id']: v for v in V}
    before = json.dumps(V, ensure_ascii=False, sort_keys=True)
    cands = [('w-%.5f,%.5f' % (d['lat'], d['lng']), d['lat'], d['lng'], d.get('nk') or d.get('n') or '') for d in W]
    cands += [(v['id'], v['lat'], v['lng'], v.get('name', '')) for v in V if v.get('type') == 'course' and 'lat' in v]
    small = [('k%.5f,%.5f' % (d['lat'], d['lng']), d['lat'], d['lng'], d.get('nk') or d.get('n') or '') for d in WS]
    small += [(v['id'], v['lat'], v['lng'], v.get('name', '')) for v in V if v.get('type') in ('screen', 'range', 'unk') and 'lat' in v]
    stat = dict(items=len(items), matched=0, priced=0, kept_official=0, no_amount=0, unmatched=0)
    used = set(); unmatched = []
    for it in items:
        if not it.get('y') or not it.get('fee'):
            continue
        lat, lng, t = float(it['y']), float(it['x']), it['t']
        k = norm(t)
        best = None
        is_small = bool(NOT_COURSE.search(t))
        pool, far, near = (small, 0.4, 0.08) if is_small else (cands, 3, 0.8)
        for cid, a, b, n in pool:
            dist = km(lat, lng, a, b)
            if dist > far: continue
            nn = norm(n); same = bool(k and nn and (k in nn or nn in k))
            score = dist - (2.5 if same else 0)
            if (same or dist < near) and (best is None or score < best[0]):
                best = (score, cid)
        if not best:
            stat['unmatched'] += 1; unmatched.append(t); continue
        cid = best[1]
        if cid in used: continue
        used.add(cid); stat['matched'] += 1
        v = byid.get(cid)
        if v is None:
            v = {'id': cid}; V.append(v); byid[cid] = v
        old = v.get('price') or {}
        if v.get('priceSrc') or (old and TAG not in (old.get('memo') or '')):
            stat['kept_official'] += 1; continue
        p, txt = parse_fee(it['fee'], small=is_small)
        mod = it.get('m') or ''
        mod = '%s-%s-%s' % (mod[:4], mod[4:6], mod[6:8]) if len(mod) >= 8 else ''
        memo = '%s 기준(수정일 %s), 바뀔 수 있으니 예약 전 골프장 확인 · 원문: %s' % (TAG, mod, txt.replace('\n', ' / ')[:300])
        if mod and mod < OLD:  # 2년 넘은 정보는 금액을 쓰지 않고 메모로만
            p = {}; memo = memo.replace('기준(수정일', '기준(오래된 정보, 수정일')
        if not any(p.get(x) for x in ('wdD', 'weD', 'cart', 'caddie')):
            stat['no_amount'] += 1
        pr = {x: p[x] for x in ('wdD', 'weD', 'cart', 'caddie') if p.get(x)}
        pr['unit'] = ('1인 기준' if is_small else '18홀 1인') if (pr.get('wdD') or pr.get('weD')) else ''
        pr['memo'] = memo
        if pr.get('wdD') or pr.get('weD'): stat['priced'] += 1
        v['price'] = {x: y for x, y in pr.items() if y}
        v['priceTour'] = it['id']
        if not v.get('phone') and it.get('tel'): v['phone'] = clean(it['tel']).split('\n')[0][:40]
        v['updated'] = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    if json.dumps(V, ensure_ascii=False, sort_keys=True) == before:
        print(json.dumps(stat, ensure_ascii=False)); print('요금 변경 없음 → kr-venues.json 그대로'); return
    K['updated'] = datetime.now(timezone.utc).isoformat()
    K['count'] = len(V)
    srcs = K.get('source', '')
    if '한국관광공사' not in srcs:
        K['source'] = (srcs + ' + 한국관광공사 TourAPI 골프장 이용요금 (공공데이터포털)').strip(' +')
    json.dump(K, open(KRV, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(json.dumps(stat, ensure_ascii=False))
    if unmatched: print('못 맞춘 곳:', ', '.join(unmatched[:80]))


if __name__ == '__main__':
    main()
