"""Campus JARVIS Online — personal, password-protected Flask web app."""
import base64
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

import requests
from cryptography.fernet import Fernet
from flask import Flask, abort, jsonify, redirect, render_template, request, session, url_for
from werkzeug.middleware.proxy_fix import ProxyFix

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv('DATA_PATH', str(ROOT / 'jarvis_private.sqlite3')))
app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', '')
if len(app.secret_key) < 24:
    raise RuntimeError('Set a long, random SECRET_KEY environment variable before starting.')
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax', SESSION_COOKIE_SECURE=os.getenv('LOCAL_DEV') != '1', PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 7, MAX_CONTENT_LENGTH=1024 * 32)
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)
PASSWORD = os.environ.get('OWNER_PASSWORD', '')
if len(PASSWORD) < 12:
    raise RuntimeError('Set OWNER_PASSWORD to a private password at least 12 characters long.')
OWNER_EMAIL = os.environ.get('OWNER_EMAIL', '').lower().strip()
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', '')
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-3.5-flash-lite')
GOOGLE_CLIENT_ID = os.getenv('GOOGLE_CLIENT_ID', '')
GOOGLE_CLIENT_SECRET = os.getenv('GOOGLE_CLIENT_SECRET', '')
PUBLIC_BASE_URL = os.getenv('PUBLIC_BASE_URL', '').rstrip('/')
FERNET_KEY = os.getenv('TOKEN_ENCRYPTION_KEY', '')
fernet = Fernet(FERNET_KEY.encode()) if FERNET_KEY else None
SCOPES = 'openid email profile https://www.googleapis.com/auth/gmail.readonly'
KEYWORDS = ('exam','timetable','assignment','deadline','submission','fee','payment','placement','interview','internship','scholarship','attendance','holiday','notice','circular','registration','results','hall ticket','assessment','semester','urgent')


def database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=5)
    connection.execute('CREATE TABLE IF NOT EXISTS credentials (email TEXT PRIMARY KEY, encrypted_token TEXT NOT NULL, created INTEGER NOT NULL)')
    connection.commit()
    return connection


def protected(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        if not session.get('logged_in'):
            return jsonify(error='Please log in first.'), 401
        return func(*args, **kwargs)
    return wrapper


def csrf_required():
    if not hmac.compare_digest(str(request.headers.get('X-Jarvis-CSRF', '')), str(session.get('csrf', ''))):
        abort(403, description='Invalid security token')


@app.after_request
def security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    return response


@app.get('/')
def index():
    if not session.get('csrf'):
        session['csrf'] = secrets.token_urlsafe(32)
    return render_template('index.html', logged_in=bool(session.get('logged_in')), csrf=session['csrf'])


@app.get('/health')
def health():
    return jsonify(status='ok')


@app.post('/api/login')
def login():
    csrf_required()
    provided = str((request.get_json(silent=True) or {}).get('password', ''))
    if len(provided) > 200 or not hmac.compare_digest(provided, PASSWORD):
        time.sleep(0.3)
        return jsonify(error='Incorrect password.'), 401
    session.clear()
    session['logged_in'] = True
    session['csrf'] = secrets.token_urlsafe(32)
    session.permanent = True
    return jsonify(ok=True, csrf=session['csrf'])


@app.post('/api/logout')
@protected
def logout():
    csrf_required()
    session.clear()
    return jsonify(ok=True)


@app.get('/api/status')
@protected
def status():
    return jsonify(ai_configured=bool(GEMINI_API_KEY), gmail_configured=bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and fernet and OWNER_EMAIL and PUBLIC_BASE_URL), gmail_connected=bool(load_google_token()), model=GEMINI_MODEL)


@app.post('/api/chat')
@protected
def chat():
    csrf_required()
    payload = request.get_json(silent=True) or {}
    message = str(payload.get('message', '')).strip()[:2000]
    if not message:
        return jsonify(error='Ask JARVIS a question.'), 400
    if not GEMINI_API_KEY:
        return jsonify(error='The website owner has not set GEMINI_API_KEY in hosting settings.'), 503
    prompt = ('You are Campus JARVIS, an articulate, calm, helpful student assistant. '
              'Reply naturally in the language used by the student. Keep spoken responses concise. '
              'Do not claim to have read emails, calendars, or other private information unless supplied explicitly. '
              'Avoid echoing secrets. Your voice is original, not an impersonation. ')
    contents = [{'role': 'user', 'parts': [{'text': prompt + '\nStudent: ' + message}]}]
    history = payload.get('history', [])
    if isinstance(history, list):
        for item in history[-8:]:
            if isinstance(item, dict) and item.get('role') in ('user', 'model') and isinstance(item.get('text'), str):
                contents.insert(-1, {'role': item['role'], 'parts': [{'text': item['text'][:1000]}]})
    endpoint = f'https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent'
    try:
        result = requests.post(endpoint, headers={'x-goog-api-key': GEMINI_API_KEY}, json={'contents': contents, 'generationConfig': {'maxOutputTokens': 500, 'temperature': 0.65}}, timeout=35)
        if result.status_code != 200:
            return jsonify(error=f'AI service returned HTTP {result.status_code}. Check the model and API key in hosting settings.'), 502
        data = result.json()
        reply = ''.join(p.get('text', '') for c in data.get('candidates', []) for p in c.get('content', {}).get('parts', []))
        return jsonify(reply=reply or 'I could not generate a reply this time.')
    except requests.RequestException:
        return jsonify(error='AI service is temporarily unavailable.'), 502


def oauth_enabled():
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and PUBLIC_BASE_URL and OWNER_EMAIL and fernet)


@app.get('/auth/google')
@protected
def google_start():
    if not oauth_enabled():
        return 'Gmail is not configured. Follow the deployment guide.', 503
    state = secrets.token_urlsafe(36)
    session['google_state'] = state
    from urllib.parse import urlencode
    params = {'client_id': GOOGLE_CLIENT_ID, 'redirect_uri': PUBLIC_BASE_URL + '/auth/google/callback', 'response_type': 'code', 'scope': SCOPES, 'state': state, 'access_type': 'offline', 'prompt': 'consent', 'login_hint': OWNER_EMAIL}
    return redirect('https://accounts.google.com/o/oauth2/v2/auth?' + urlencode(params))


@app.get('/auth/google/callback')
@protected
def google_callback():
    if not oauth_enabled() or not session.pop('google_state', None) == request.args.get('state'):
        abort(403)
    code = request.args.get('code')
    if not code:
        return 'Google did not grant access. Return to JARVIS and try again.', 400
    try:
        r = requests.post('https://oauth2.googleapis.com/token', data={'code': code, 'client_id': GOOGLE_CLIENT_ID, 'client_secret': GOOGLE_CLIENT_SECRET, 'redirect_uri': PUBLIC_BASE_URL + '/auth/google/callback', 'grant_type': 'authorization_code'}, timeout=15)
        r.raise_for_status()
        token = r.json()
        info = requests.get('https://openidconnect.googleapis.com/v1/userinfo', headers={'Authorization': 'Bearer ' + token['access_token']}, timeout=15)
        info.raise_for_status()
        identity = info.json()
        if identity.get('email', '').lower() != OWNER_EMAIL or not identity.get('email_verified'):
            return 'This Google account does not match OWNER_EMAIL. No access was saved.', 403
        token['expires_at'] = int(time.time()) + int(token.get('expires_in', 3500))
        old = load_google_token()
        if not token.get('refresh_token') and old:
            token['refresh_token'] = old.get('refresh_token')
        if not token.get('refresh_token'):
            return 'Google did not provide a refresh token. Please disconnect and retry.', 400
        with database() as conn:
            conn.execute('INSERT OR REPLACE INTO credentials VALUES (?, ?, ?)', (OWNER_EMAIL, fernet.encrypt(json.dumps(token).encode()).decode(), int(time.time())))
        return redirect('/?gmail=connected')
    except (requests.RequestException, KeyError, ValueError):
        return 'Google authorization did not finish. Check the OAuth credentials and callback address.', 502


def load_google_token():
    if not fernet or not OWNER_EMAIL:
        return None
    try:
        with database() as conn:
            row = conn.execute('SELECT encrypted_token FROM credentials WHERE email=?', (OWNER_EMAIL,)).fetchone()
        return json.loads(fernet.decrypt(row[0].encode()).decode()) if row else None
    except Exception:
        return None


def gmail_access_token():
    token = load_google_token()
    if not token:
        return None
    if token.get('expires_at', 0) > time.time() + 90:
        return token['access_token']
    r = requests.post('https://oauth2.googleapis.com/token', data={'client_id': GOOGLE_CLIENT_ID, 'client_secret': GOOGLE_CLIENT_SECRET, 'refresh_token': token['refresh_token'], 'grant_type': 'refresh_token'}, timeout=15)
    r.raise_for_status()
    fresh = r.json()
    token['access_token'] = fresh['access_token']
    token['expires_at'] = int(time.time()) + int(fresh.get('expires_in', 3500))
    with database() as conn:
        conn.execute('UPDATE credentials SET encrypted_token=? WHERE email=?', (fernet.encrypt(json.dumps(token).encode()).decode(), OWNER_EMAIL))
    return token['access_token']


def gmail_get(path, params=None):
    token = gmail_access_token()
    if not token:
        raise ValueError('Connect Gmail first.')
    resp = requests.get('https://gmail.googleapis.com/gmail/v1/users/me/' + path, params=params, headers={'Authorization': 'Bearer ' + token}, timeout=15)
    resp.raise_for_status()
    return resp.json()


def message_summary(raw):
    headers = {x.get('name', '').lower(): x.get('value', '') for x in raw.get('payload', {}).get('headers', [])}
    subject = headers.get('subject', '(no subject)')[:180]
    snippet = re.sub(r'\s+', ' ', raw.get('snippet', '')).strip()[:240]
    combined = (subject + ' ' + snippet).lower()
    hits = [k for k in KEYWORDS if k in combined]
    return {'id': raw.get('id'), 'from': headers.get('from', '')[:180], 'subject': subject, 'date': headers.get('date', '')[:100], 'snippet': snippet, 'unread': 'UNREAD' in raw.get('labelIds', []), 'important': bool(hits), 'topics': hits[:4]}


@app.get('/api/mail')
@protected
def mail_list():
    q = request.args.get('q', '')[:120]
    try:
        listing = gmail_get('messages', {'maxResults': 20, 'q': q})
        messages = []
        for item in listing.get('messages', [])[:20]:
            messages.append(message_summary(gmail_get('messages/' + item['id'], {'format': 'metadata', 'metadataHeaders': ['From', 'Subject', 'Date']})))
        return jsonify(messages=messages, count=len(messages), note='Important notices are keyword-based, not guaranteed.')
    except ValueError as exc:
        return jsonify(error=str(exc)), 400
    except requests.RequestException:
        return jsonify(error='Gmail request failed. Check your authorization and college policy.'), 502


@app.get('/api/mail/<message_id>')
@protected
def mail_detail(message_id):
    if not re.fullmatch(r'[A-Za-z0-9_-]{5,40}', message_id):
        abort(400)
    try:
        raw = gmail_get('messages/' + message_id, {'format': 'full'})
        summary = message_summary(raw)
        def text_part(part):
            if part.get('mimeType') == 'text/plain':
                data = part.get('body', {}).get('data')
                if data:
                    try:
                        return base64.urlsafe_b64decode(data + '===').decode('utf-8', errors='replace')
                    except Exception:
                        return ''
            for child in part.get('parts', []):
                found = text_part(child)
                if found:
                    return found
            return ''
        summary['body'] = text_part(raw.get('payload', {}))[:6000] or summary['snippet']
        return jsonify(message=summary)
    except (requests.RequestException, ValueError):
        return jsonify(error='Unable to read this message.'), 502


@app.post('/api/mail/disconnect')
@protected
def mail_disconnect():
    csrf_required()
    with database() as conn:
        conn.execute('DELETE FROM credentials WHERE email=?', (OWNER_EMAIL,))
    return jsonify(ok=True)


if __name__ == '__main__':
    app.run(host='127.0.0.1', port=int(os.getenv('PORT', 8766)), debug=False)
