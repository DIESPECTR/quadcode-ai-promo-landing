import base64
import json
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner

import app as promo


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(promo, 'DB_PATH', str(tmp_path / 'test.sqlite3'))
    monkeypatch.delenv('TURNSTILE_SECRET', raising=False)
    monkeypatch.setattr(promo, 'PRODUCTION', False)
    # Existing tests exercise retired logic in isolation; production defaults to 410.
    monkeypatch.setattr(promo, 'LEGACY_CLAIMS_ENABLED', True)
    with TestClient(promo.app) as test_client:
        yield test_client


def login(client, sub='google-user-1', email='user@gmail.com'):
    session = {'user': {'sub': sub, 'email': email}, 'csrf': 'test-csrf'}
    payload = base64.b64encode(json.dumps(session).encode('utf-8'))
    cookie = TimestampSigner(promo.SESSION_SECRET).sign(payload).decode('utf-8')
    client.cookies.set('session', cookie)
    return {'x-csrf-token': 'test-csrf'}


def claim(client, headers):
    return client.post('/api/claim', json={'turnstile_token': ''}, headers=headers)


def test_home_and_anonymous_config(client):
    page = client.get('/')
    assert page.status_code == 200
    assert '<html lang="en">' in page.text
    assert 'Build websites, dashboards' in page.text
    assert 'Start with 1,000 free credits.' in page.text
    assert 'Get 1,000 free credits when you register.' in page.text
    assert 'The 1,000 sign-up credits are separate from any promo code.' in page.text
    assert 'Do I need a promo code for the 1,000 credits?' in page.text
    assert 'Gmail' not in page.text
    assert 'https://guides.quadcode.ai/guide/beauty-brand-landing' in page.text
    assert 'https://guides.quadcode.ai/guide/ugc-ads-workflow' in page.text
    assert not __import__('re').search(r'[А-Яа-яЁё]', page.text)
    response = client.get('/api/me')
    assert response.status_code == 200
    assert response.json()['email'] is None
    assert response.json()['available'] is False
    assert client.get('/static/styles.css').status_code == 200
    assert client.get('/static/app.js').status_code == 200


def test_manual_channel_promo_links_and_copy(client):
    from html.parser import HTMLParser

    class PromoLinkParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.promo_links = []

        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag == 'a' and any(name in attrs.get('class', '').split() for name in ('header-cta', 'button-primary', 'button-dark')):
                self.promo_links.append(attrs)

    html = client.get('/').text
    parser = PromoLinkParser()
    parser.feed(html)
    assert len(parser.promo_links) == 4
    assert all(link['href'] == 'https://t.me/quadcodeai' for link in parser.promo_links)
    assert '1,000 free credits when you register.' in html
    assert 'The 1,000 sign-up credits are separate from any promo code.' in html
    assert all(link.get('rel') == 'noopener noreferrer' for link in parser.promo_links)
    assert 'send a private message to the channel' in html
    assert 'A message does not guarantee a code.' in html
    assert 'The bot will' not in html
    assert 'Telegram channel: soon' not in html


def test_main_promo_is_first_and_walkthroughs_remain_click_to_load(client):
    from html.parser import HTMLParser

    class DemoParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.buttons = []
            self.images = []
            self.links = []
            self.iframes = []
        def handle_starttag(self, tag, attrs):
            attrs = dict(attrs)
            if tag == 'button' and 'data-video-id' in attrs:
                self.buttons.append(attrs['data-video-id'])
            if tag == 'img':
                self.images.append(attrs.get('src'))
            if tag == 'a':
                self.links.append(attrs.get('href'))
            if tag == 'iframe':
                self.iframes.append(attrs)

    parser = DemoParser()
    parser.feed(client.get('/').text)
    ids = ['nyHDkDUzH-o', '6S5AX__QRyA', 'HFVjbUmvWDU']
    assert parser.buttons == ids
    assert parser.iframes == []
    assert '/static/quadcode-promo.jpg' in parser.images
    assert client.get('/static/quadcode-promo.jpg').status_code == 200
    assert all(f'https://www.youtube.com/watch?v={video_id}' in parser.links for video_id in ids)
    script = client.get('/static/app.js').text
    assert all(video_id in script for video_id in ids)
    assert 'youtube-nocookie.com/embed/${videoId}' in script
    assert 'autoplay=1' in script  # Only added to an iframe when a play button is clicked.


def test_retired_google_email_endpoints_are_closed(client, monkeypatch):
    monkeypatch.setattr(promo, 'LEGACY_CLAIMS_ENABLED', False)
    for path in ('/api/me', '/auth/google', '/auth/callback'):
        assert client.get(path, follow_redirects=False).status_code == 410
    assert client.post('/api/claim', json={'turnstile_token': ''}).status_code == 410
    assert client.post('/auth/logout').status_code == 410
    assert '/api/me' not in client.get('/static/app.js').text
    assert 'turnstile' not in client.get('/static/app.js').text.lower()


def test_auth_and_csrf_required(client):
    assert claim(client, {}).status_code == 403
    headers = login(client)
    assert claim(client, {}).status_code == 403
    assert claim(client, {**headers, 'origin': 'https://evil.example'}).status_code == 403


def test_one_code_per_account_and_mail(client, monkeypatch):
    deliveries = []
    monkeypatch.setattr(promo, 'send_email', lambda email, code: deliveries.append((email, code)))
    db = promo.connect()
    db.execute('INSERT INTO codes(code) VALUES ("LIVE-CODE-A"), ("LIVE-CODE-B")')
    db.close()
    headers = login(client)
    first = claim(client, headers)
    second = claim(client, headers)
    assert first.status_code == second.status_code == 200
    assert len(deliveries) == 1
    assert deliveries[0] == ('user@gmail.com', 'LIVE-CODE-A')
    assert 'LIVE-CODE-A' not in first.text
    db = promo.connect()
    assert db.execute('SELECT COUNT(*) FROM codes WHERE google_sub=?', ('google-user-1',)).fetchone()[0] == 1
    assert db.execute('SELECT COUNT(*) FROM codes WHERE status="available"').fetchone()[0] == 1
    db.close()


def test_empty_pool_does_not_send(client, monkeypatch):
    deliveries = []
    monkeypatch.setattr(promo, 'send_email', lambda email, code: deliveries.append(code))
    assert claim(client, login(client)).status_code == 503
    assert deliveries == []


def test_delivery_failure_reuses_reserved_code(client, monkeypatch):
    db = promo.connect()
    db.execute('INSERT INTO codes(code) VALUES ("LIVE-CODE-A")')
    db.close()
    headers = login(client)
    def fail(email, code):
        raise RuntimeError('SMTP down')
    monkeypatch.setattr(promo, 'send_email', fail)
    assert claim(client, headers).status_code == 503
    db = promo.connect()
    row = db.execute('SELECT code, status FROM codes WHERE google_sub=?', ('google-user-1',)).fetchone()
    assert tuple(row) == ('LIVE-CODE-A', 'failed')
    db.execute('UPDATE codes SET updated_at=updated_at-61 WHERE google_sub=?', ('google-user-1',))
    db.close()
    deliveries = []
    monkeypatch.setattr(promo, 'send_email', lambda email, code: deliveries.append(code))
    assert claim(client, headers).status_code == 200
    assert deliveries == ['LIVE-CODE-A']


def test_concurrent_claims_do_not_allocate_two(client, monkeypatch):
    db = promo.connect()
    db.execute('INSERT INTO codes(code) VALUES ("LIVE-CODE-A"), ("LIVE-CODE-B")')
    db.close()
    headers = login(client)
    cookie = client.cookies.get('session')
    entered = threading.Event()
    finish = threading.Event()
    def slow_send(email, code):
        entered.set()
        assert finish.wait(timeout=5)
    monkeypatch.setattr(promo, 'send_email', slow_send)
    def first_request():
        with TestClient(promo.app) as other:
            other.cookies.set('session', cookie)
            return claim(other, headers)
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(first_request)
        assert entered.wait(timeout=5)
        concurrent = claim(client, headers)
        finish.set()
        first = future.result(timeout=5)
    assert first.status_code == 200
    assert concurrent.status_code == 202
    db = promo.connect()
    assert db.execute('SELECT COUNT(*) FROM codes WHERE google_sub=?', ('google-user-1',)).fetchone()[0] == 1
    assert db.execute('SELECT COUNT(*) FROM codes WHERE status="available"').fetchone()[0] == 1
    db.close()


def test_ip_rate_limit(client):
    for _ in range(30):
        promo.throttle('claim-ip:test', 30, 86400)
    with pytest.raises(promo.HTTPException) as error:
        promo.throttle('claim-ip:test', 30, 86400)
    assert error.value.status_code == 429


def test_generated_codes_unique(client):
    codes = promo.generate_codes(30)
    assert len(codes) == len(set(codes)) == 30
    assert all(code.startswith('START-') for code in codes)


def test_google_callback_requires_verified_gmail(client, monkeypatch):
    class FakeGoogle:
        info = {}
        async def authorize_access_token(self, request):
            return {'userinfo': self.info}
    google = FakeGoogle()
    monkeypatch.setattr(promo, 'GOOGLE_ENABLED', True)
    monkeypatch.setattr(promo.oauth, 'google', google, raising=False)
    google.info = {'sub': 'sub-1', 'email': 'name@example.com', 'email_verified': True}
    rejected = client.get('/auth/callback', follow_redirects=False)
    assert rejected.status_code == 307 and 'error=gmail' in rejected.headers['location']
    google.info = {'sub': 'sub-1', 'email': 'name@gmail.com', 'email_verified': False}
    assert 'error=gmail' in client.get('/auth/callback', follow_redirects=False).headers['location']
    google.info = {'sub': 'sub-1', 'email': 'name@gmail.com', 'email_verified': True}
    approved = client.get('/auth/callback', follow_redirects=False)
    assert approved.status_code == 307 and approved.headers['location'] == '/#claim'
    assert client.get('/api/me').json()['email'] == 'name@gmail.com'


def test_turnstile_fails_closed_and_checks_hostname(client, monkeypatch):
    import asyncio
    monkeypatch.setattr(promo, 'PRODUCTION', True)
    with pytest.raises(promo.HTTPException) as missing_key:
        asyncio.run(promo.verify_turnstile('token', '127.0.0.1'))
    assert missing_key.value.status_code == 503
    monkeypatch.setenv('TURNSTILE_SECRET', 'private-key')
    with pytest.raises(promo.HTTPException) as missing_token:
        asyncio.run(promo.verify_turnstile('', '127.0.0.1'))
    assert missing_token.value.status_code == 400
    class FakeResponse:
        def raise_for_status(self):
            pass
        def json(self):
            return {'success': True, 'hostname': 'attacker.example'}
    class FakeClient:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def post(self, *args, **kwargs):
            return FakeResponse()
    monkeypatch.setattr(promo.httpx, 'AsyncClient', lambda **kwargs: FakeClient())
    with pytest.raises(promo.HTTPException) as wrong_host:
        asyncio.run(promo.verify_turnstile('token', '127.0.0.1'))
    assert wrong_host.value.status_code == 400
    FakeResponse.json = lambda self: {'success': True, 'hostname': '127.0.0.1'}
    asyncio.run(promo.verify_turnstile('token', '127.0.0.1'))


def test_public_experience_is_english_only(client):
    import re
    for name in ('index.html', 'app.js'):
        assert not re.search(r'[А-Яа-яЁё]', (promo.BASE / 'static' / name).read_text(encoding='utf-8'))
    assert not re.search(r'[А-Яа-яЁё]', (promo.BASE / 'app.py').read_text(encoding='utf-8'))
    response = client.post('/api/claim', json={'turnstile_token': ''})
    assert response.status_code == 403
    assert response.json()['detail'] == 'Refresh the page and try again.'


def test_promo_email_is_in_english(monkeypatch):
    deliveries = []
    class FakeSMTP:
        def __init__(self, *args, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def starttls(self):
            pass
        def login(self, *args):
            pass
        def send_message(self, message):
            deliveries.append(message)
    monkeypatch.setenv('SMTP_HOST', 'mail.example')
    monkeypatch.setenv('SMTP_FROM', 'promo@example.com')
    monkeypatch.setattr(promo.smtplib, 'SMTP', FakeSMTP)
    promo.send_email('user@gmail.com', 'LIVE-CODE-A')
    assert deliveries[0]['Subject'] == 'Your Quadcode AI promo code'
    body = deliveries[0].get_content()
    assert 'LIVE-CODE-A' in body
    assert 'https://guides.quadcode.ai/#guides' in body
    assert not __import__('re').search(r'[А-Яа-яЁё]', body)
