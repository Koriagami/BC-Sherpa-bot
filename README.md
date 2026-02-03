# BC-Sherpa-bot

A Slack bot that turns reported issues into Basecamp tasks. Someone reports an issue in a thread, others discuss it, then someone adds a custom **:basecamp:** emoji to the original post. The bot uses OpenAI to extract the core problem from the thread, creates a Basecamp to-do with that info, and posts a link back in the thread.

## What it does (end-to-end)

1. **Someone reports an issue** in a Slack channel.
2. **Discussion happens in the thread** (replies under that message).
3. **Someone adds the :basecamp: emoji** to the original post with the issue.
4. **The bot is triggered** and:
   - Reads the whole thread (parent + replies).
   - Sends it to OpenAI with a **customizable prompt** that filters chatter and keeps only core problem details.
   - Creates a **Basecamp to-do** in a configured project/list with:
     - **Title**: short summary (from the prompt output).
     - **Description**: cleaned-up issue details.
   - Optionally **adds thread participants as subscribers** on the new task (by matching Slack email → Basecamp person).
   - **Posts a reply in the thread**: “Issue was extracted to Basecamp” with the task link.

---

## Setup (detailed)

### Prerequisites

- **Node.js 18+**  
  Check with: `node -v`
- **Slack workspace** where you can create apps (admin or permission to create apps).
- **Basecamp 3** account (API: `https://3.basecampapi.com`).
- **OpenAI** API key ([platform.openai.com](https://platform.openai.com/api-keys)).

---

### 1. Slack app (step-by-step)

#### 1.1 Create the app

1. Go to [api.slack.com/apps](https://api.slack.com/apps).
2. Click **Create New App** → **From scratch**.
3. Enter an **App Name** (e.g. “BC-Sherpa”) and pick your **Workspace**.
4. Click **Create App**.

#### 1.2 Enable Socket Mode and create App-Level Token (→ `SLACK_APP_TOKEN`)

1. In the left sidebar, open **Settings** → **Socket Mode**.
2. Turn **Socket Mode** **On**.
3. When prompted to create an App-Level Token:
   - Click **Generate** (or go to **Settings** → **Basic Information** → scroll to **App-Level Tokens**).
   - **Token Name**: e.g. `socket-mode`.
   - **Scopes**: add **`connections:write`** (this is the only scope needed for the App-Level Token; it allows the app to connect via WebSocket).
   - Click **Generate**.
4. **Copy the token** (starts with `xapp-`). This is your **`SLACK_APP_TOKEN`**.  
   Store it in `.env`; you won’t see it again in the UI.

#### 1.3 Bot Token Scopes (for `SLACK_BOT_TOKEN`)

1. In the left sidebar, open **OAuth & Permissions**.
2. Scroll to **Scopes** → **Bot Token Scopes**.
3. Click **Add an OAuth Scope** and add:

   | Scope | Purpose |
   |-------|--------|
   | `channels:history` | Read messages in public channels |
   | `channels:read` | List public channels |
   | `chat:write` | Post messages (including in threads) |
   | `chat:write.public` | Post in channels without joining first |
   | `reactions:read` | See when :basecamp: is added |
   | `users:read` | Resolve user IDs to display names |
   | `users:read.email` | *(Optional)* Match Slack users to Basecamp people for “add participants as subscribers” |

   If the bot will run in **private channels** only, add instead of the channel scopes:

   | Scope | Purpose |
   |-------|--------|
   | `groups:history` | Read messages in private channels |
   | `groups:read` | List private channels |

4. Scroll to the top of **OAuth & Permissions** and click **Install to Workspace** (or **Reinstall to Workspace** if you already installed). Approve the permissions.
5. After installing, under **OAuth Tokens for Your Workspace** you’ll see:
   - **Bot User OAuth Token** (starts with `xoxb-`).  
   **Copy this** → this is your **`SLACK_BOT_TOKEN`**.

#### 1.4 Subscribe to bot events

1. In the left sidebar, open **Event Subscriptions**.
2. Turn **Enable Events** **On**.
3. Under **Subscribe to bot events**, click **Add Bot User Event**.
4. Add **`reaction_added`**.
5. Save changes. (With Socket Mode you don’t need a Request URL.)

#### 1.5 Signing Secret (→ `SLACK_SIGNING_SECRET`)

1. In the left sidebar, open **Settings** → **Basic Information**.
2. Under **App Credentials**, find **Signing Secret**.
3. Click **Show** and copy the value → this is your **`SLACK_SIGNING_SECRET`**.

#### 1.6 Create the slash command (for channel bindings)

1. In the left sidebar, open **Slash Commands**.
2. Click **Create New Command**.
3. Fill in:
   - **Command**: `sherpa` (Slack will show it as `/sherpa`; enter without the slash in some UIs, or `/sherpa` if the field expects the full command).
   - **Short Description**: e.g. `Bind this channel to a Basecamp project and to-do list`
   - **Usage Hint**: e.g. `bind <project_id> <todolist_id>` or leave empty.
4. Save changes.

If you get **"dispatch_failed"** when using `/sherpa`, ensure the bot is running, Socket Mode is enabled, and the command name in the app config matches (the code listens for `/sherpa`). Restart the bot after changing the slash command.

This command is used to bind each channel to a Basecamp project and to-do list (see [Channel bindings](#channel-bindings) below).

#### 1.7 Invite the bot to channels

- In each **public channel** where you want the bot to work: type `/invite @YourBotName` (or add the app via channel details).
- For **private channels**: open the channel → **Integrations** → **Add apps** → add your app.

---

### 2. Custom emoji :basecamp:

1. In Slack: click your **workspace name** (top left) → **Settings & administration** → **Customize [workspace]**.
2. Open the **Emoji** tab → **Add Custom Emoji**.
3. Upload an image and set the **name** to `basecamp` (no colons).
4. Save.

To use a different emoji name, set **`TRIGGER_EMOJI`** in `.env` to that name (e.g. `TRIGGER_EMOJI=basecamp`).

---

### 3. OpenAI

1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
2. Sign in or create an account.
3. Click **Create new secret key**. Name it (e.g. “BC-Sherpa”), copy the key.
4. Put it in `.env` as **`OPENAI_API_KEY`**.
5. Optionally set **`OPENAI_MODEL`** (default: `gpt-4o-mini`). For example: `gpt-4o` for higher quality, `gpt-4o-mini` for lower cost.

**OpenAI failsafe:** The bot limits how often it calls OpenAI (default: 15 requests per minute) and uses a circuit breaker: after 5 consecutive OpenAI failures it stops calling OpenAI for 2 minutes. This prevents runaway usage from bugs (e.g. a loop). You can tune this with `OPENAI_MAX_REQUESTS_PER_MINUTE`, `OPENAI_CIRCUIT_BREAKER_FAILURES`, and `OPENAI_CIRCUIT_BREAKER_SECONDS` in `.env`.

---

### 4. Basecamp (OAuth and IDs)

The bot uses the **Basecamp 3 API** (`https://3.basecampapi.com`). You need an OAuth 2 access token and your **account ID**. **Project ID** and **to-do list ID** can be set in `.env` as defaults or per channel via the `/sherpa bind` command (see [Channel bindings](#channel-bindings)).

#### 4.1 Create a Basecamp API app and get an access token

**Important:** You must be **logged in** to your Basecamp/37signals account first. If you open [https://launchpad.37signals.com/integrations](https://launchpad.37signals.com/integrations) without being signed in, you only see the **Basecamp Log In** page and no way to register an app.

1. **Sign in to Basecamp**  
   Go to [launchpad.37signals.com](https://launchpad.37signals.com) and log in with your Basecamp account (Google or email). Make sure you’re fully signed in (you should see your account/launchpad, not the login form).

2. **Open the Integrations page**  
   After you’re signed in, go to:  
   **https://launchpad.37signals.com/integrations**  
   You should see your existing integrations (if any) and a way to add a new one.  
   If you don’t see “Register another application”, try the direct **new app** URL:  
   **https://launchpad.37signals.com/integrations/new**

3. **Register a new app**  
   On the integrations page, click **“Register another application”** (or **“New application”**), or use the `/integrations/new` link above. Fill in:
   - **Application name**: e.g. “BC-Sherpa”
   - **Company name**: your company or “Personal”
   - **Website URL**: e.g. your repo or `https://localhost`
   - **Redirect URI**: e.g. `https://localhost` or `https://localhost/callback` (you’ll use this when exchanging the auth code for a token; for a one-off token you can complete the OAuth flow once in a browser or a small script.)

4. **Get Client ID and Client Secret**  
   After you click **“Register this app”**, the app’s page shows your **Client ID** and **Client Secret**. Keep the secret private.

5. **Get an access token**  
   - If 37signals shows a **“Personal token”** or **“Token”** option for your app, use that (simplest: copy the token and put it in `.env` as **`BASECAMP_ACCESS_TOKEN`**).
   - Otherwise, complete the OAuth 2 flow once:  
     - Open in a browser: `https://launchpad.37signals.com/authorization/new?type=web_server&client_id=YOUR_CLIENT_ID&redirect_uri=YOUR_REDIRECT_URI`  
       (Use the **exact** `redirect_uri` you registered, e.g. `https://localhost/callback` — it must match later.)  
     - Authorize the app. You’ll be redirected to your `redirect_uri` with a `code` in the URL (e.g. `https://localhost/callback?code=12345`). Copy the `code` value.  
     - **Exchange the code for an access token** with a **POST** request. 37signals expects **`type=web_server`** (not `grant_type=authorization_code`) and the parameters in the **query string**. Do **not** open this URL in a browser (that would send a GET and return 400). From the command line:

       ```bash
       curl -X POST "https://launchpad.37signals.com/authorization/token?type=web_server&client_id=YOUR_CLIENT_ID&client_secret=YOUR_CLIENT_SECRET&redirect_uri=YOUR_REDIRECT_URI&code=THE_CODE_FROM_STEP_ABOVE"
       ```

       Replace `YOUR_CLIENT_ID`, `YOUR_CLIENT_SECRET`, `YOUR_REDIRECT_URI` (must match the redirect URI you used in the auth URL exactly, e.g. `https://localhost/callback`), and `THE_CODE_FROM_STEP_ABOVE` (the `code` from the redirect URL).  
     - The response is JSON with **`access_token`**. Use that value as **`BASECAMP_ACCESS_TOKEN`** in `.env`.

**If you still don’t see a way to register an app:**  
- Make sure you’re logged in at launchpad.37signals.com (not just basecamp.com).  
- Try [https://launchpad.37signals.com/integrations/new](https://launchpad.37signals.com/integrations/new) directly after signing in.  
- If your account uses a different 37signals product (e.g. Basecamp 4), the UI may differ; check [Basecamp help](https://basecamp.com/support) or [bc3-api docs](https://github.com/basecamp/bc3-api) for the current registration flow.

#### 4.2 Get Account ID (`BASECAMP_ACCOUNT_ID`)

- When you’re in Basecamp in the browser, the URL often looks like:  
  `https://3.basecamp.com/1234567890/...`  
  The number **`1234567890`** is your **Account ID**.
- Or call the API with your token:  
  `GET https://3.basecampapi.com/1234567890/authorization.json`  
  (use the same number you see in your Basecamp URLs). The account ID in the URL is **`BASECAMP_ACCOUNT_ID`**.

#### 4.3 Get Project ID and To-do list ID (for `.env` or `/sherpa bind`)

These IDs are not sensitive; they identify which project and list receive new to-dos.

- **Project ID**: In Basecamp, open the **project**. The URL is like:  
  `https://3.basecamp.com/1234567890/projects/9876543210`  
  The **second number** (`9876543210`) is the **Project ID**.
- **To-do list ID**: In that project, open **To-dos** and click the **to-do list**. The URL is like:  
  `https://3.basecamp.com/1234567890/projects/9876543210/todolists/5555555555`  
  The **last number** (`5555555555`) is the **To-do list ID**.

You can set **`BASECAMP_PROJECT_ID`** and **`BASECAMP_TODOLIST_ID`** in `.env` as **defaults** (used when a channel has no binding), or bind each channel with `/sherpa bind <project_id> <todolist_id>` (see [Channel bindings](#channel-bindings)).

#### 4.4 Channel bindings (multiple channels → different Basecamp lists)

You can use **one bot** for **multiple Slack channels**, each sending issues to a **different Basecamp project and to-do list**.

1. In each channel where you want the bot to create to-dos, run:
   ```
   /sherpa bind <project_id> <todolist_id>
   ```
   Use the project and to-do list IDs from [4.3](#43-get-project-id-and-to-do-list-id-for-env-or-sherpa-bind). The channel is then **bound** to that project/list.
2. When someone adds the trigger emoji to a thread in that channel, the bot creates the to-do in the **bound** project and list.
3. **Other commands:**
   - **`/sherpa`** (no args) – show help and current binding for the channel.
   - **`/sherpa unbind`** – remove the channel binding (the bot will use **`BASECAMP_PROJECT_ID`** and **`BASECAMP_TODOLIST_ID`** from `.env` as default, if set).

Bindings are stored in **`channel-bindings.json`** (or the path in **`CHANNEL_BINDINGS_FILE`**). That file is created automatically and is listed in `.gitignore` so each deployment can have its own bindings.

If a channel has **no** binding and **no** env default, the bot replies in the thread asking you to run `/sherpa bind <project_id> <todolist_id>`.

#### 4.5 Optional: add thread participants as subscribers

- Set **`BASECAMP_ADD_PARTICIPANTS_AS_SUBSCRIBERS=true`** in `.env`.
- The bot matches Slack users to Basecamp people by **email**. Slack app must have **`users:read.email`** (see Slack Bot Token Scopes). Basecamp people must have the same email as in Slack.

#### 4.6 Automated token retrieval and refresh

Basecamp access tokens expire after about **2 weeks**. The bot can **automatically refresh** the token if you provide Client ID, Client Secret, and a refresh token.

**Option A – One-time OAuth script (recommended)**  
1. In `.env` set: **`BASECAMP_CLIENT_ID`**, **`BASECAMP_CLIENT_SECRET`**, and **`BASECAMP_REDIRECT_URI`** (e.g. `http://localhost:3456/callback`). The redirect URI must **exactly match** the one you registered for the app in launchpad.37signals.com.  
2. Run once: **`node scripts/basecamp-oauth.js`**  
3. Open the URL it prints in your browser, authorize the app, and complete the redirect. The script will receive the code, exchange it for tokens, and write **`basecamp-tokens.json`** (or the path in **`BASECAMP_TOKEN_FILE`**).  
4. From then on the bot uses that file and refreshes the token when it’s close to expiry (or on 401). You do **not** need to set **`BASECAMP_ACCESS_TOKEN`** in `.env` when using the token file.

**Option B – Manual token + refresh from .env**  
1. Do the OAuth flow once (browser + `curl` as in step 5 of 4.1) and get **`access_token`** and **`refresh_token`** from the response.  
2. In `.env` set **`BASECAMP_ACCESS_TOKEN`**, **`BASECAMP_REFRESH_TOKEN`**, **`BASECAMP_CLIENT_ID`**, and **`BASECAMP_CLIENT_SECRET`**.  
3. On first use the bot will load from env and, when it refreshes, write **`basecamp-tokens.json`** so later runs use the file.

**Option C – Manual token only (no refresh)**  
Set only **`BASECAMP_ACCESS_TOKEN`** in `.env`. The bot will use it until it expires; then you must get a new token manually (e.g. run the OAuth script or repeat the flow in 4.1).

---

### 5. Project and environment

1. Clone and enter the repo:

   ```bash
   git clone <this-repo>
   cd BC-Sherpa-bot
   ```

2. Copy the example env file and edit it:

   ```bash
   cp .env.example .env
   ```

   Fill in every value (see table below). Example:

   ```env
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_SIGNING_SECRET=...
   SLACK_APP_TOKEN=xapp-...
   TRIGGER_EMOJI=basecamp
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4o-mini
   BASECAMP_ACCOUNT_ID=1234567890
   BASECAMP_ACCESS_TOKEN=...
   BASECAMP_PROJECT_ID=9876543210
   BASECAMP_TODOLIST_ID=5555555555
   ```

3. Install dependencies and start:

   ```bash
   npm install
   npm start
   ```

   You should see something like:  
   `BC-Sherpa bot is running (Socket Mode). React with :basecamp: to extract to Basecamp.`

4. **Development** (auto-restart on file changes):

   ```bash
   npm run dev
   ```

---

## Env reference

| Variable | Required | Where to get it |
|----------|----------|------------------|
| **`SLACK_BOT_TOKEN`** | Yes | Slack app → **OAuth & Permissions** → **Bot User OAuth Token** (starts with `xoxb-`). |
| **`SLACK_SIGNING_SECRET`** | Yes | Slack app → **Settings** → **Basic Information** → **Signing Secret** (show & copy). |
| **`SLACK_APP_TOKEN`** | Yes | Slack app → **Settings** → **Basic Information** → **App-Level Tokens** (or **Socket Mode**). Create token with scope **`connections:write`** (starts with `xapp-`). |
| **`TRIGGER_EMOJI`** | No | Emoji name without colons. Default: `basecamp`. |
| **`OPENAI_API_KEY`** | Yes | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → Create new secret key. |
| **`OPENAI_MODEL`** | No | e.g. `gpt-4o-mini` (default) or `gpt-4o`. |
| **`OPENAI_MAX_REQUESTS_PER_MINUTE`** | No | Max OpenAI calls per minute (default: 15). Failsafe against runaway usage. |
| **`OPENAI_CIRCUIT_BREAKER_FAILURES`** | No | After this many consecutive OpenAI failures, pause all OpenAI calls (default: 5). |
| **`OPENAI_CIRCUIT_BREAKER_SECONDS`** | No | Pause duration in seconds when circuit opens (default: 120). |
| **`BASECAMP_ACCOUNT_ID`** | Yes | Number in Basecamp URL (e.g. `https://3.basecamp.com/**1234567890**/...`) or from API. |
| **`BASECAMP_ACCESS_TOKEN`** | If no token file | OAuth access token. Omit if using `node scripts/basecamp-oauth.js` (tokens stored in `basecamp-tokens.json`). |
| **`BASECAMP_PROJECT_ID`** | No (default) | Project URL: `.../projects/**9876543210**`. Used when a channel has no binding. |
| **`BASECAMP_TODOLIST_ID`** | No (default) | To-do list URL: `.../todolists/**5555555555**`. Used when a channel has no binding. |
| **`CHANNEL_BINDINGS_FILE`** | No | Path to channel bindings JSON. Default: `channel-bindings.json`. |
| **`BASECAMP_CLIENT_ID`** | For auto-refresh | App **Client ID** from launchpad.37signals.com (needed for token refresh and OAuth script). |
| **`BASECAMP_CLIENT_SECRET`** | For auto-refresh | App **Client Secret** from launchpad.37signals.com (needed for token refresh and OAuth script). |
| **`BASECAMP_REDIRECT_URI`** | For OAuth script | Exact redirect URI registered for the app (e.g. `http://localhost:3456/callback`). Used by `node scripts/basecamp-oauth.js`. |
| **`BASECAMP_TOKEN_FILE`** | No | Path to token file. Default: `basecamp-tokens.json`. |
| **`BASECAMP_REFRESH_TOKEN`** | Optional | OAuth refresh token. Set in `.env` to bootstrap; after first refresh the bot writes tokens to the token file. |
| **`BASECAMP_ADD_PARTICIPANTS_AS_SUBSCRIBERS`** | No | `true` to add thread participants as subscribers (needs `users:read.email` and matching emails in Basecamp). Default: `false`. |
| **`EXTRACTION_PROMPT_FILE`** | No | Path to custom prompt file (e.g. `./prompts/extract-issue.txt`). If unset, built-in prompt in `src/config.js` is used. |

---

## Customizing the extraction prompt

The bot sends the Slack thread to OpenAI and expects a reply with **`TITLE:`** and **`DESCRIPTION:`** (case-insensitive). You can change the system prompt that tells the model how to summarize.

- **Without a file**: Edit the **`DEFAULT_EXTRACTION_PROMPT`** string in **`src/config.js`**.
- **With a file**:
  1. Copy `prompts/extract-issue.example.txt` to e.g. `prompts/extract-issue.txt`.
  2. Edit the text (language, tone, what to keep or drop).
  3. Keep the instruction that the model must output exactly **TITLE:** and **DESCRIPTION:** (the parser depends on it).
  4. In `.env` set: `EXTRACTION_PROMPT_FILE=./prompts/extract-issue.txt`.
  5. Restart the bot.

---

## Implementation walkthrough (for developers)

### Architecture

- **Runtime**: Node.js 18+, JavaScript (CommonJS).
- **Slack**: [Bolt](https://slack.dev/bolt-js/) with **Socket Mode** (no public URL; uses `reaction_added` and `conversations.replies`).
- **OpenAI**: Chat completion with a system prompt that defines how to turn a thread into a title + description.
- **Basecamp**: Basecamp 3 API (`3.basecampapi.com`) over HTTPS: create to-do, optionally update subscriptions.

### Flow (code path)

1. **`src/index.js`**  
   Loads config (env + optional custom prompt file). Creates Slack `App` (Socket Mode), OpenAI client, and Basecamp config. Subscribes to `reaction_added`. When `event.reaction === config.triggerEmoji` and `event.item` is a message: posts “Extracting issue to Basecamp…” in the thread, then calls `fetchThread()` → `extractIssueFromThread()` → `createTodo()` (and optionally `addSubscribers()`), and updates that message to “Issue was extracted to Basecamp: &lt;link&gt;” or posts a new reply on error.

2. **`src/slack.js`**  
   **`fetchThread(client, channelId, threadTs)`**: `conversations.replies` to get parent + all replies; optionally resolves display names via `users.info`. **`formatThreadForPrompt(messages)`**: builds one text block like `[Display Name]: message` for the LLM. **`postThreadReply(...)`**: `chat.postMessage` with `thread_ts`; returns `ts` so the message can be updated later.

3. **`src/openai-extract.js`**  
   **`extractIssueFromThread(openai, systemPrompt, model, threadText)`**: sends system prompt (from config) + user message = thread text. Parses the reply for `TITLE:` and `DESCRIPTION:` (case-insensitive) and returns `{ title, description }`. Default prompt (in `src/config.js`) tells the model to drop chatter and output exactly those two sections.

4. **`src/basecamp.js`**  
   **`createTodo(config, { content, description, completionSubscriberIds })`**: `POST /buckets/{projectId}/todolists/{todolistId}/todos.json`. **`addSubscribers(config, bucketId, recordingId, personIds)`**: `PUT .../recordings/{id}/subscription.json`. **`listPeople(config)`**: `GET /people.json` for Slack email → Basecamp person ID mapping.

5. **`src/participants.js`**  
   **`resolveBasecampPersonIds(slackClient, basecampConfig, slackUserIds)`**: for each Slack user, gets email via `users.info`; loads Basecamp people (cached), matches by email, returns Basecamp person IDs. Used only when `BASECAMP_ADD_PARTICIPANTS_AS_SUBSCRIBERS=true`.

6. **`src/config.js`**  
   Reads `.env` (via `dotenv`). Loads required and optional env vars; if `EXTRACTION_PROMPT_FILE` is set, uses that file’s content as the system prompt, otherwise the built-in prompt. Parser expects `TITLE:` and `DESCRIPTION:` in the model reply.

---

## License

MIT
