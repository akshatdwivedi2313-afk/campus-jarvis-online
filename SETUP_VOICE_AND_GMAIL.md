# Campus JARVIS v2.1 — Voice repair and College Gmail setup

## 1. Update GitHub (no coding)

Your GitHub repository is `akshatdwivedi2313-afk/campus-jarvis-online`.

1. Download and extract `Campus_JARVIS_Online_v2.1_GitHub_Ready.zip`.
2. Open your GitHub repository and choose **Add file → Upload files**.
3. Drag the *contents* of the extracted folder into GitHub's upload area, **not** the outer folder. Confirm paths such as `static/app.js`, `app.py`, and `render.yaml` appear at the proper locations; do not place them inside a second parent folder. GitHub may ask to replace existing files. Commit the changes to `main`.
4. Render normally automatically redeploys changes to `main`. Confirm your deployment becomes **Live**.
5. Open the website and force refresh on Windows with `Ctrl + Shift + R`. Sign in, select **ENABLE HEY JARVIS**, and allow the microphone.
6. Say `Jarvis` and pause. After the acknowledgement, say `what is machine learning?`. Also test `Hey Jarvis, explain neural networks`.

**You should not need to share any secret with ChatGPT or add it to GitHub.**

### Browser listening limitations
The patch improves reliability by recovering after speech-recognition dropouts, using a limited retry delay, avoiding speech-loop feedback, and accepting a few narrow transcription variants. It still relies on built-in browser speech transcription. This means *some commands will still be missed*. Keep the site in the foreground on Edge or Chrome, permit microphone access, and turn off other apps using the microphone. On phones, background/locked-screen listening may stop. It is not a standalone OS-level wake-word engine and may use an online speech provider.

## 2. Configure Gmail (personal website login + separate college mailbox)

**Important change:**
- `OWNER_EMAIL`: your personal email or site owner identifier — leave as it is.
- `COLLEGE_GMAIL_EMAIL`: the exact college Google Workspace address you will grant Gmail access to.

### A. Prepare Render environment settings

Open Render Dashboard → `campus-jarvis-online` web service → **Environment**. Set:

- `PUBLIC_BASE_URL`: your real HTTPS Render address, such as `https://campus-jarvis-online-xxxx.onrender.com`, without a trailing slash.
- `COLLEGE_GMAIL_EMAIL`: your exact college email account.
- `TOKEN_ENCRYPTION_KEY`: a Fernet encryption key; generate it privately by running `generate_encryption_key.py` using Python on your own PC, or in Command Prompt run:

  `py -3.12 -m pip install cryptography`

  `py -3.12 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`

  Copy the printed result into Render's *private Environment variable*. Keep this key secure and unchanged; rotating it invalidates stored tokens.

Keep your existing `OWNER_PASSWORD`, `OWNER_EMAIL`, `GEMINI_API_KEY`, and automatically generated `SECRET_KEY` values. Do not put secrets in GitHub or screenshots.

### B. Configure Google Cloud (official OAuth)

1. Visit https://console.cloud.google.com/ and create or select a Google Cloud project you control.
2. In APIs & Services → Library, find **Gmail API** and click **Enable**.
3. Go to **Google Auth Platform**. Set branding, support contact, and audience. A college Workspace account is often a test user on an External application; add *your college email* under Audience → Test users if appropriate. An Internal app generally requires a Workspace organization and organization-approved project.
4. Under Data Access, request the minimum needed scopes: `openid`, `email`, `profile`, and `https://www.googleapis.com/auth/gmail.readonly`. The last one is a **restricted scope**. Your college admin might need to approve access. Google may require verification for production use.
5. Under **Clients → Create client**, choose **Web application** (not Desktop application). Add this **Authorized redirect URI** exactly:

   `https://YOUR-RENDER-HOSTNAME.onrender.com/auth/google/callback`

   Replace `YOUR-RENDER-HOSTNAME` with the real hostname from `PUBLIC_BASE_URL`. Make sure the spelling, protocol (`https`), and any custom domain match.
6. Copy the generated OAuth **Client ID** and **Client secret** into Render Environment variables `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
7. Save and redeploy/restart using Render's **Save, deploy** option.
8. Open your live JARVIS website, log in, open **College Gmail**, click **CONNECT GOOGLE GMAIL**, and choose **your college account** on Google's sign-in page. Review the read-only consent screen before approving.
9. Return to JARVIS. Use **REFRESH** or search `is:unread`; try `Jarvis, show my unread emails` after enabling voice mode.

**If sign-in says `redirect_uri_mismatch`:** verify the Google Cloud authorized redirect URI exactly matches `PUBLIC_BASE_URL` plus `/auth/google/callback`.

**If sign-in says `access_blocked` or admin restrictions:** ask the college Workspace administrator for permission. Do not attempt to bypass their policy.

**If account mismatch:** ensure `COLLEGE_GMAIL_EMAIL` is your college address, not `OWNER_EMAIL`; then sign in with that exact college account.

### Privacy, cloud hosting, and limitations
- The web app requests read-only Gmail access (`gmail.readonly`). It does not send/delete mail.
- Your email contents are displayed in the site and are **not** forwarded to the Gemini AI API by this app. Inbox highlights use keywords, not AI-generated summaries.
- The college email authentication token is encrypted before being written to server-side SQLite. The free Render service uses ephemeral storage, so mail connectivity can disappear after restarts/redeploys and you might need to reconnect. The app has not been security-audited for public multi-user use; keep it private.
- Google's OAuth test-mode refresh tokens may expire, requiring reconnecting. Gmail restricted scopes may require Google's app verification and possibly a security assessment for public deployment.
