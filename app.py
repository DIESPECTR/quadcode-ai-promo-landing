import asyncio
import csv
import hmac
import os
import secrets
import smtplib
import sqlite3
import sys
import time
from email.message import EmailMessage
from pathlib import Path
from urllib.parse import urlparse

import httpx
from authlib.integrations.starlette_client import OAuth
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

BASE = Path(__file__).resolve().parent
DB_PATH = os.getenv('DATABASE_PATH', str(BASE / 'promo.sqlite3'))
PUBLIC_URL = os.getenv('PUBLIC_URL', 'http://127.0.0.1:8000').rstrip('/')
PRODUCTION = os.getenv('APP_ENV') == 'production'
SESSION_SECRET = os.getenv('SESSION_SECRET', '')
if PRODUCTION and (len(SESSION_SECRET) < 32 or not PUBLIC_URL.startswith('https://')):
    raise RuntimeError('Production requires a 32+ character SESSION_SECRET and HTTPS PUBLIC_URL')
if not SESSION_SECRET:
    SESSION_SECRET = secrets.token_urlsafe(48)  # Development only; resets login on restart.

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, https_only=PRODUCTION, same_site='lax', max_age=3600)
app.mount('/static', StaticFiles(directory=str(BASE / 'static')), name='static')
oauth = OAuth()
GOOGLE_ENABLED = bool(os.getenv('GOOGLE_CLIENT_ID') and os.getenv('GOOGLE_CLIENT_SECRET'))
if GOOGLE_ENABLED:
    oauth.register(name='google', client_id=os.getenv('GOOGLE_CLIENT_ID'), client_secret=os.getenv('GOOGLE_CLIENT_SECRET'), server_metadata_url='https://accounts.google.com/.well-known/openid-configuration', client_kwargs={'scope': 'openid email profile'})


def connect():
    db = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA busy_timeout = 10000')
    db.execute('PRAGMA journal_mode = WAL')
    db.execute('CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, google_sub TEXT UNIQUE, email TEXT, status TEXT NOT NULL DEFAULT "available", attempts INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)')
    db.execute('CREATE TABLE IF NOT EXISTS attempts (key TEXT NOT NULL, created_at INTEGER NOT NULL)')
    db.execute('CREATE INDEX IF NOT EXISTS attempts_lookup ON attempts(key, created_at)')
    return db


def generate_codes(count):
    """Generate exportable codes; import only AFTER activation on the target platform."""
    if not 1 <= count <= 10000:
        raise ValueError('count must be 1..10000')
    return ['START-' + secrets.token_hex(10).upper() for _ in range(count)]


def import_codes(path):
    db = connect()
    count = 0
    try:
        with open(path, newline='', encoding='utf-8-sig') as file:
            db.execute('BEGIN IMMEDIATE')
            try:
                for row in csv.reader(file):
                    if not row or not row[0].strip() or row[0].strip().lower() == 'code':
                        continue
                    code = row[0].strip()
                    if len(code) > 128 or any(ord(c) < 33 or ord(c) > 126 for c in code):
                        raise ValueError('Invalid promo code in CSV')
                    cursor = db.execute('INSERT OR IGNORE INTO codes(code) VALUES (?)', (code,))
                    count += cursor.rowcount
                db.commit()
            except Exception:
                db.rollback()
                raise
        return count
    finally:
        db.close()


def throttle(key, limit, seconds):
    now = int(time.time())
    db = connect()
    try:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DELETE FROM attempts WHERE created_at < ?', (now - 86400,))
        amount = db.execute('SELECT COUNT(*) FROM attempts WHERE key=? AND created_at>=?', (key, now - seconds)).fetchone()[0]
        if amount >= limit:
            db.commit()
            raise HTTPException(status_code=429, detail='Too many attempts. Please try again later.')
        db.execute('INSERT INTO attempts(key, created_at) VALUES (?,?)', (key, now))
        db.commit()
    finally:
        db.close()


def identity(request: Request):
    user = request.session.get('user')
    if not user or not user.get('sub') or not user.get('email'):
        raise HTTPException(status_code=401, detail='Sign in with Google first.')
    return user


def enforce_origin_and_csrf(request: Request):
    origin = request.headers.get('origin')
    if origin and origin != PUBLIC_URL:
        raise HTTPException(403, 'Request origin is not allowed.')
    token = request.session.get('csrf', '')
    if not token or not hmac.compare_digest(request.headers.get('x-csrf-token', ''), token):
        raise HTTPException(403, 'Refresh the page and try again.')


async def verify_turnstile(token, ip):
    secret = os.getenv('TURNSTILE_SECRET', '')
    if not secret:
        if PRODUCTION:
            raise HTTPException(503, 'Security check is not configured.')
        return
    if not token:
        raise HTTPException(400, 'Complete the security check first.')
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            result = await client.post('https://challenges.cloudflare.com/turnstile/v0/siteverify', data={'secret': secret, 'response': token, 'remoteip': ip})
            result.raise_for_status()
            verdict = result.json()
            if not verdict.get('success') or verdict.get('hostname') != urlparse(PUBLIC_URL).hostname:
                raise HTTPException(400, 'Security check failed. Please try again.')
    except httpx.HTTPError:
        raise HTTPException(503, 'Security check is temporarily unavailable.')


def send_email(email, code):
    host = os.getenv('SMTP_HOST', '')
    sender = os.getenv('SMTP_FROM', '')
    if not host or not sender:
        raise RuntimeError('SMTP is not configured')
    msg = EmailMessage()
    msg['Subject'] = 'Your Quadcode AI promo code'
    msg['From'] = sender
    msg['To'] = email
    msg.set_content(f'Your personal Quadcode AI promo code: {code}\n\nExplore Quadcode AI: https://quadcode.ai\nExplore the guides: https://guides.quadcode.ai/#guides\n\nOffer terms and availability are set by the campaign organizer. If you did not request this code, please ignore this email.')
    with smtplib.SMTP(host, int(os.getenv('SMTP_PORT', '587')), timeout=10) as smtp:
        smtp.starttls()
        smtp.login(os.getenv('SMTP_USER', ''), os.getenv('SMTP_PASSWORD', ''))
        smtp.send_message(msg)


@app.get('/')
async def homepage():
    return FileResponse(BASE / 'static' / 'index.html')


# Legacy Google/email fulfillment is retired for the Telegram landing.
# Kept temporarily for isolated regression tests and migration; never enabled in deployment.
LEGACY_CLAIMS_ENABLED = False


def require_legacy_claims():
    if not LEGACY_CLAIMS_ENABLED:
        raise HTTPException(status_code=410, detail='This promo claim flow is no longer available.')


@app.get('/api/me')
async def me(request: Request):
    require_legacy_claims()
    user = request.session.get('user')
    if not request.session.get('csrf'):
        request.session['csrf'] = secrets.token_urlsafe(32)
    db = connect()
    try:
        row = db.execute('SELECT status FROM codes WHERE google_sub=?', (user['sub'],)).fetchone() if user else None
        available = db.execute('SELECT EXISTS(SELECT 1 FROM codes WHERE status="available")').fetchone()[0]
    finally:
        db.close()
    return {'email': user['email'] if user else None, 'status': row['status'] if row else None, 'available': bool(available), 'csrf': request.session['csrf'], 'google_enabled': GOOGLE_ENABLED, 'turnstile_site_key': os.getenv('TURNSTILE_SITE_KEY', ''), 'quadcode_url': os.getenv('QUADCODE_URL', 'https://quadcode.ai')}


@app.get('/auth/google')
async def google_login(request: Request):
    require_legacy_claims()
    if not GOOGLE_ENABLED:
        raise HTTPException(503, 'Google sign-in is not available yet.')
    ip = request.client.host if request.client else 'unknown'
    throttle('login:' + ip, 15, 3600)
    return await oauth.google.authorize_redirect(request, PUBLIC_URL + '/auth/callback')


@app.get('/auth/callback')
async def google_callback(request: Request):
    require_legacy_claims()
    if not GOOGLE_ENABLED:
        raise HTTPException(503, 'Google sign-in is not available yet.')
    try:
        token = await oauth.google.authorize_access_token(request)
        info = token.get('userinfo') or await oauth.google.userinfo(token=token)
    except Exception:
        return RedirectResponse('/?error=login')
    email = str(info.get('email', '')).lower()
    if info.get('email_verified') is not True or email.split('@')[-1] not in ('gmail.com', 'googlemail.com') or not info.get('sub'):
        return RedirectResponse('/?error=gmail')
    request.session.clear()
    request.session['user'] = {'sub': str(info['sub']), 'email': email}
    request.session['csrf'] = secrets.token_urlsafe(32)
    return RedirectResponse('/#claim')


@app.post('/auth/logout')
async def logout(request: Request):
    require_legacy_claims()
    enforce_origin_and_csrf(request)
    request.session.clear()
    return {'ok': True}


class ClaimBody(BaseModel):
    turnstile_token: str = ''


@app.post('/api/claim')
async def claim(request: Request, body: ClaimBody):
    require_legacy_claims()
    enforce_origin_and_csrf(request)
    user = identity(request)
    ip = request.client.host if request.client else 'unknown'
    throttle('claim-ip:' + ip, 30, 86400)
    throttle('claim-account:' + user['sub'], 5, 86400)
    await verify_turnstile(body.turnstile_token, ip)
    now = int(time.time())
    db = connect()
    try:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT code, status, attempts, updated_at FROM codes WHERE google_sub=?', (user['sub'],)).fetchone()
        if row:
            if row['status'] == 'sent':
                db.commit()
                return {'status': 'sent', 'message': 'Your code has already been emailed to you.'}
            if row['status'] == 'pending':
                db.commit()
                return JSONResponse({'status': 'pending', 'message': 'Your email is being sent. Please check your inbox shortly.'}, status_code=202)
            if row['attempts'] >= 3 or now - row['updated_at'] < 60:
                db.commit()
                raise HTTPException(429, 'Email delivery is temporarily unavailable. Please try again later.')
            code = row['code']
            db.execute('UPDATE codes SET status="pending", attempts=attempts+1, updated_at=? WHERE code=?', (now, code))
        else:
            available = db.execute('SELECT code FROM codes WHERE status="available" ORDER BY rowid LIMIT 1').fetchone()
            if not available:
                db.commit()
                raise HTTPException(503, 'No promo codes are available right now. Please check back later.')
            code = available['code']
            db.execute('UPDATE codes SET google_sub=?, email=?, status="pending", attempts=1, updated_at=? WHERE code=?', (user['sub'], user['email'], now, code))
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    try:
        await asyncio.to_thread(send_email, user['email'], code)
    except Exception:
        db = connect()
        try:
            db.execute('UPDATE codes SET status="failed", updated_at=? WHERE code=? AND status="pending"', (int(time.time()), code))
        finally:
            db.close()
        raise HTTPException(503, 'Could not send your email. Please try again later.')
    db = connect()
    try:
        db.execute('UPDATE codes SET status="sent", updated_at=? WHERE code=? AND status="pending"', (int(time.time()), code))
    finally:
        db.close()
    return {'status': 'sent', 'message': 'Your promo code has been emailed to you.'}


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'import-codes':
        print(f'Imported {import_codes(sys.argv[2])} codes')
    elif len(sys.argv) == 3 and sys.argv[1] == 'generate':
        print('\n'.join(generate_codes(int(sys.argv[2]))))
    else:
        print('Usage: python app.py import-codes codes.csv | python app.py generate COUNT')
