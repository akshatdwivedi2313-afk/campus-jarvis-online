# Campus JARVIS — Online Website v2.1

This is a **new, cloud-hostable website edition**. It does not use your laptop's Ollama service, and it is **not** the original OpenJarvis framework. It includes a responsive JARVIS-style dashboard, AI conversation, browser speech/wake phrase, an on-device study planner, and a Google Workspace Gmail reader.

## What works

- Private password login. Without OWNER_PASSWORD, the app intentionally refuses to start.
- AI chat using a Google Gemini API key (the model can be changed using GEMINI_MODEL).
- Browser voice recognition using the phrases **"Hey Jarvis"** and **"Jarvis"**. Other speech is ignored unless the user has just summoned JARVIS and it is waiting for a command.
- Spoken responses using your browser's installed English voice (prefers British English). This is **not an imitation of a movie actor**.
- Gmail OAuth with the `gmail.readonly` scope, account restriction, keyword-based important notice highlighting, search, and message reading. **Gmail content is not sent to Gemini.**
- Study planner using browser localStorage (tasks do not sync between devices).
- Works on laptop and phone with a responsive website UI.

## Your fastest deployment route — GitHub + Render

1. Sign in at https://github.com and create a **private repository** named `campus-jarvis-online`. Upload all the project files. **Never upload `.env`, API keys, credentials.json, token files, or the private SQLite database.** GitHub's web uploader can upload files/folders when dragged in; make sure `templates/` and `static/` are present.
2. Visit https://render.com and connect GitHub. Click **New > Blueprint**, choose that repository, and accept `render.yaml` (or use **New > Web Service** and enter build command `pip install -r requirements.txt` and start command `gunicorn --workers 1 --threads 4 --timeout 90 app:app`). A single worker is important for this starter setup.
3. In Render > **Environment**, set the values below. Blueprint may prompt for the fields marked `sync: false`. Choose a unique private password.
   - `OWNER_PASSWORD`: choose a unique strong password (12+ characters); never send it to anyone.
   - `OWNER_EMAIL`: your personal JARVIS site owner email.
   - `COLLEGE_GMAIL_EMAIL`: your exact college Gmail/Google Workspace address (separate from OWNER_EMAIL).
   - `GEMINI_API_KEY`: obtain from https://aistudio.google.com/apikey (subject to Google availability, quotas and terms).
   - `GEMINI_MODEL`: default `gemini-3.5-flash-lite` (change to an available model if API says model not found).
   - `PUBLIC_BASE_URL`: your exact Render URL, for example `https://campus-jarvis-online-xxxx.onrender.com`. **No trailing slash.** This may not be known until the first deployment; set/update it afterward.
   - `TOKEN_ENCRYPTION_KEY`: on your Windows computer, in Command Prompt after Python has `cryptography` installed, run `py -3.12 -m pip install cryptography` then `py -3.12 generate_encryption_key.py` from the extracted project folder. Paste the generated output only into Render environment (don't share it). If you are comfortable with a Python command, `py -3.12 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` works too.
   - `SECRET_KEY`: if using the provided Blueprint, Render generates it for you. Otherwise use another long random string.
4. Save environment variables and deploy/redeploy. Open the Render HTTPS URL, enter the private password. First test text chat.

## Connect your college Gmail securely

Google **Web application** OAuth credentials are required for the online website. **Do not reuse the Desktop OAuth credentials from the older Windows version.**

1. Open https://console.cloud.google.com/ and select/create a project. Enable **Gmail API** under APIs & Services.
2. In **Google Auth Platform** configure branding/audience/data access. For personal use with a college Google Workspace account, the account may need to be added as a **test user** for an External app. Use `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/gmail.readonly` scopes. Google's labels/steps can change.
3. Create an OAuth Client ID of type **Web application**. Add exactly this **Authorized redirect URI**: `https://YOUR-RENDER-SERVICE.onrender.com/auth/google/callback` (replace with your real hostname). If using a custom domain, use its matching callback instead.
4. In Render Environment, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from the Google Cloud project, and confirm `PUBLIC_BASE_URL` is the deployed HTTPS origin. Redeploy.
5. Open JARVIS > **College Gmail > Connect Google Gmail**, sign in with your exact `COLLEGE_GMAIL_EMAIL`, and consent to read-only mail access. Gmail messages aren't available until consent is completed.

**Important:** Gmail `gmail.readonly` is a **restricted Google API scope**, not a casual login integration. Google may require OAuth verification or a security assessment for production/public use, and a college Workspace administrator may block the app. Testing mode can also cause refresh-token expiry; you may have to reconnect periodically. Do not bypass college policy. If blocked, ask your college IT administrator for approval.

## Voice setup (desktop + phone)

1. Open the HTTPS site in a supported browser and sign in.
2. Select **Enable Hey Jarvis**, grant microphone permission.
3. Say: `Hey Jarvis, explain neural networks in two sentences` or `Jarvis` then give your command after the acknowledgement.
4. For Gmail: `Jarvis, show my unread emails` or `Hey Jarvis, check important notices`.
5. Your phone may not support continuous recognition; the browser may stop the microphone when locked or in the background. Browser speech recognition may use the browser vendor's online recognition service. This **cannot** listen when your website/browser is closed.

## Deployment / privacy limitations

- Render's free tier may spin down with inactivity, causing slow first loads, and has **ephemeral filesystem storage**. This edition stores encrypted OAuth tokens in a local SQLite file on the web server. On a free ephemeral instance, Gmail connection can disappear after a redeploy/restart. You would reconnect Google; stable 24/7 persistence needs a managed database and a hardened production setup. Do **not** treat this as a production-certified Gmail application.
- The website AI uses the Gemini API, not local Ollama. Gemini AI requests incur whatever quotas/costs apply to your account. **Email bodies are never included in AI chat requests.** Summaries of emails are currently subject/snippet highlights and keyword rules, not LLM summaries.
- Voice output depends on voices available on the user's computer/phone. Wake-word detection is from **browser speech transcription**, not fully local privacy-preserving keyword spotting. Once enabled, browser speech recognition may process ambient audio even though JARVIS only responds when it hears its name.
- Website login session persists for seven days; don't share your password. Use **HTTPS** for production and do not put your API key or OAuth secret in any frontend JavaScript.
- Study tasks are stored in each browser's localStorage, not in the cloud; they won't sync across laptop and phone.
- This package is a personal-use MVP. For sharing with other students you need per-user login, verified OAuth, a durable secret store/database, and a proper privacy/consent review.

## Local test (optional)

Copy `.env.example` to `.env`, fill private settings, and run `START_LOCAL_DEMO.bat` on Windows with Python 3.12. Local Gmail OAuth requires a local redirect configuration that differs from the hosted setup, so test Gmail through the deployed HTTPS site.

## Files

- `app.py` Flask server (password login, AI, Google OAuth, Gmail)
- `templates/index.html` responsive website markup
- `static/style.css` design
- `static/app.js` interaction, voice, inbox, tasks
- `render.yaml` Render deployment blueprint
- `requirements.txt` dependencies
- `generate_encryption_key.py` local key generation
- `.env.example` configuration template

## Safest first test

**First deploy without Gmail credentials, log in, and test the AI chat.** Then connect Gmail following Google's own approval flow. You don't need to give anyone your college password or your OAuth secrets.

## Version 2.1 update

See [SETUP_VOICE_AND_GMAIL.md](SETUP_VOICE_AND_GMAIL.md). The college mailbox is now restricted to the separate `COLLEGE_GMAIL_EMAIL` variable; the wake phrase has better recognition recovery.
