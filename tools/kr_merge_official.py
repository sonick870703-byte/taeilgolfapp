#!/usr/bin/env python3
"""Merge official-homepage fee collections (chunk*.json) into kr-venues.json.
Never overwrites a venue that already has priceSrc from an earlier official check."""
import json, sys, glob, html, datetime
DAY = datetime.date.today().isoformat()
src_dir = sys.argv[1]
items = []
for f in sorted(glob.glob(src_dir.rstrip('/') + '/chunk*.json')):
    items += json.load(open(f, encoding='utf-8'))
d = json.load(open('kr-venues.json', encoding='utf-8'))
by = {v['id']: v for v in d['venues']}
add = upd = skip = bad = 0
def ok_fee(x, small=False):
    return x is None or (20000 <= x <= 600000)
for it in items:
    if it.get('status') not in ('ok', 'partial'):
        continue
    v = by.get(it['id'])
    if v and v.get('priceSrc') and v.get('updated', '') < DAY and (v.get('price') or {}).get('wdD'):
        skip += 1; continue
    fees = {k: it.get(k) for k in ('wdD', 'weD', 'wdN', 'weN')}
    if not all(ok_fee(x) for x in fees.values()):
        bad += 1; continue
    p = {k: x for k, x in fees.items() if x}
    for k in ('cart', 'caddie'):
        if it.get(k) and 10000 <= it[k] <= 300000:
            p[k] = it[k]
    if it.get('unit'):
        p['unit'] = html.unescape(it['unit'])
    memo = html.unescape(it.get('memo') or '').strip()
    tail = f"공식 홈페이지 요금표 기준({DAY} 확인), 시기·시간대별로 달라질 수 있음"
    if not p.get('wdD') and not p.get('weD'):
        tail = f"그린피는 공식 홈페이지에서 확인해 주세요({DAY} 확인)"
    p['memo'] = (memo + ' · ' if memo else '') + tail
    if not v:
        v = {'id': it['id']}; d['venues'].append(v); by[it['id']] = v; add += 1
    else:
        upd += 1
    v['price'] = p
    v['priceSrc'] = html.unescape(it['url'])
    v['updated'] = DAY
d['updated'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
d['count'] = len(d['venues'])
json.dump(d, open('kr-venues.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
priced = sum(1 for v in d['venues'] if (v.get('price') or {}).get('wdD') or (v.get('price') or {}).get('weD'))
print(f"items {len(items)} updated {upd} added {add} skipped(existing official) {skip} bad {bad}; venues with green fee now {priced}")
