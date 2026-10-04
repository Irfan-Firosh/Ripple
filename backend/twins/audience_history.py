"""Archive real audience versions, and back up imports before an explicit reset."""
import argparse
import json
import os
import time
from pathlib import Path

from .config import STDB_DATABASE, STDB_URL, load_stdb_token
from .stdb import StdbClient

IMPORT_TABLES = ['x_user', 'audience_membership', 'x_post', 'x_post_reference', 'x_post_entity',
                 'x_context_annotation', 'x_post_media', 'x_ingestion_run', 'twin', 'twin_audience',
                 'twin_niche', 'audience_edge', 'backtest_result', 'twin_build_run', 'twin_build_job', 'onboarding']


def capture_audience(stdb, handle: str, run_id: str, phase: str = 'ready') -> bool:
    users = stdb.sql('SELECT * FROM x_user')
    brand = next((u for u in users if u['username'].lower() == handle.lower()), None)
    if not brand:
        return False
    bid = brand['user_id']
    links = stdb.sql('SELECT * FROM twin_audience')
    memberships = stdb.sql('SELECT * FROM audience_membership')
    ids = {r['user_id'] for r in links if r['brand_user_id'] == bid}
    ids.update(r['follower_user_id'] for r in memberships if r['brand_user_id'] == bid)
    if not ids:
        return False
    twins = {r['user_id']: r for r in stdb.sql('SELECT * FROM twin')}
    catalog = stdb.sql('SELECT * FROM niche')
    labels = {r['slug']: r['label'] for r in catalog}
    niches = {}
    for r in stdb.sql('SELECT * FROM twin_niche'):
        niches.setdefault(r['user_id'], []).append(dict(slug=r['niche'], label=labels.get(r['niche'], r['niche']), affinity=r['affinity']))
    members = []
    for u in users:
        uid = u['user_id']
        if uid not in ids:
            continue
        t = twins.get(uid, {})
        ns = sorted(niches.get(uid, []), key=lambda n: -n['affinity'])
        if not ns:
            ns = [dict(slug='pending-twins', label='Building profiles', affinity=0)]
        platform = 'bluesky' if uid.startswith('did:') or '.' in u['username'] else 'x'
        members.append(dict(userId=uid, username=u['username'], name=u['name'], avatar=u.get('profile_image_url') or '',
            followers=u.get('followers_count') or 0, profileUrl=f"https://{'bsky.app/profile' if platform == 'bluesky' else 'x.com'}/{u['username']}",
            postCount=t.get('post_count', u.get('post_count') or 0), engagementRate=t.get('engagement_rate', 0), replyShare=t.get('reply_share', 0),
            pending=uid not in twins, tone=t.get('tone', ''), personaSummary=t.get('persona_summary', ''), hotButtons=t.get('hot_buttons', []), niches=ns, primaryNiche=ns[0]['slug']))
    edges = stdb.sql('SELECT * FROM audience_edge')
    payload = dict(brand=dict(userId=bid, username=handle, name=brand['name'], avatar=brand.get('profile_image_url') or '',
                             platform='bluesky' if '.' in handle else 'x'), members=members,
                   niches=[dict(slug=r['slug'], label=r['label']) for r in catalog] + [dict(slug='pending-twins', label='Building profiles')],
                   links=[[r['a'], r['b']] for r in edges if r['brand_user_id'] == bid and r['a'] in ids and r['b'] in ids and r['kind'] == 'reply'])
    stamp = time.time_ns() // 1000
    stdb.call('archive_audience', f'{handle}:{run_id}:{phase}', handle, bid, brand['name'], run_id,
              len(members), len({m['primaryNiche'] for m in members}), json.dumps(payload), stamp)
    stdb.call('archive_profiles')
    return True


def archive_all(stdb) -> int:
    users = {u['user_id']: u['username'] for u in stdb.sql('SELECT user_id, username FROM x_user')}
    brands = {r['brand_user_id'] for r in stdb.sql('SELECT brand_user_id FROM twin_audience')}
    brands.update(r['brand_user_id'] for r in stdb.sql('SELECT brand_user_id FROM audience_membership'))
    run = f'before-reset-{time.time_ns()}'
    return sum(capture_audience(stdb, users[bid], run, 'imported') for bid in sorted(brands) if bid in users)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reset', action='store_true')
    parser.add_argument('--backup', type=Path, required=True)
    args = parser.parse_args()
    db = StdbClient(STDB_URL, STDB_DATABASE, load_stdb_token())
    args.backup.parent.mkdir(parents=True, exist_ok=True)
    # Private local backup: no credentials/admin identities, and never overwrite a previous backup.
    fd = os.open(args.backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump({table: db.sql(f'SELECT * FROM {table}') for table in IMPORT_TABLES}, output)
        output.flush(); os.fsync(output.fileno())
    print(f'Import backup saved: {args.backup}')
    print(f'Archived {archive_all(db)} audience maps')
    db.call('archive_profiles')
    if args.reset:
        db.call('reset_imported_audiences')
        print('Active imports reset; audience snapshots, profile history and all Lab records retained')


if __name__ == '__main__':
    main()
