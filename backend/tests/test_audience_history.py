import json

from conftest import FakeStdb
from twins.audience_history import capture_audience


def test_archive_contains_real_scraped_people_and_keeps_recorded_connections():
    db = FakeStdb({
        'x_user': [dict(user_id='brand', username='raycast', name='Raycast'),
                   dict(user_id='a', username='alice', name='Alice'), dict(user_id='b', username='bob', name='Bob')],
        'twin_audience': [dict(brand_user_id='brand', user_id='a')],
        'audience_membership': [dict(brand_user_id='brand', follower_user_id='b')],
        'twin': [dict(user_id='a', persona_summary='Builds software')],
        'niche': [dict(slug='builders', label='Builders')],
        'twin_niche': [dict(user_id='a', niche='builders', affinity=.9)],
        'audience_edge': [dict(brand_user_id='brand', a='a', b='b', kind='reply'),
                          dict(brand_user_id='brand', a='brand', b='a', kind='niche_hub')],
    })
    assert capture_audience(db, 'raycast', 'onboard-5', 'ready')
    args = db.reducers('archive_audience')[0]
    payload = json.loads(args[7])
    assert args[:3] == ('raycast:onboard-5:ready', 'raycast', 'brand')
    assert args[5:7] == (2, 2)
    assert payload['links'] == [['a', 'b']]
    assert {m['userId'] for m in payload['members']} == {'a', 'b'}
    assert payload['members'][1]['primaryNiche'] == 'pending-twins'
    assert db.reducers('archive_profiles') == [()]


def test_missing_or_empty_audiences_are_not_saved_as_fake_maps():
    assert not capture_audience(FakeStdb({}), 'raycast', 'new')
    db = FakeStdb({'x_user': [dict(user_id='brand', username='raycast', name='Raycast')]})
    assert not capture_audience(db, 'raycast', 'new')
    assert db.reducers('archive_audience') == []
