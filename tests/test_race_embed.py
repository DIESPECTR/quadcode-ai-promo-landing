from fastapi.testclient import TestClient
from pathlib import Path
import re
import app as promo


def test_race_landing_and_static_release():
    with TestClient(promo.app) as client:
        page = client.get('/')
        assert 'id="race-launch"' in page.text
        assert 'href="/static/race/index.html"' in page.text
        assert '<iframe' not in page.text
        game = client.get('/static/race/index.html')
        assert game.status_code == 200
        assert '<html lang="en">' in game.text
        for src in re.findall(r'<script[^>]+src="([^"?]+)', game.text):
            assert client.get('/static/race/' + src).status_code == 200
        for asset in ['assets/images/vehicle_car.png', 'assets/images/vehicle_bike.png', 'LICENSE']:
            assert client.get('/static/race/' + asset).status_code == 200
        assert client.get('/static/race/tools/dev-server.mjs').status_code == 404
        assert client.get('/static/race/_utils/editor/index.html').status_code == 404


def test_release_excludes_development_files():
    root = Path(promo.BASE) / 'static' / 'race'
    assert (root / 'licenses').is_dir()
    assert not (root / 'tools').exists()
    assert not (root / 'tests').exists()
