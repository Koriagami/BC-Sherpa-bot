# BC-Sherpa-bot

Slack bot that turns thread discussions into Basecamp to-dos. Add the **:basecamp:** emoji to a message; the bot summarizes the thread with OpenAI, creates a to-do in Basecamp, and posts the link in the thread.

## What it does

1. You react to a thread message with :basecamp: (or `TRIGGER_EMOJI`).
2. Bot reads the thread, sends it to OpenAI, gets a title + description.
3. Bot creates a to-do in the channel’s bound Basecamp project/list and replies with the task link.
4. Optionally, thread participants are added as subscribers (Slack email → Basecamp person).

## Prerequisites

Node.js 18+, Slack app (Socket Mode), Basecamp 3 account, [OpenAI API key](https://platform.openai.com/api-keys).

## Setup

### 1. Slack app ([api.slack.com/apps](https://api.slack.com/apps))

- **Socket Mode**: On. Create an **App-Level Token** with `connections:write` → `SLACK_APP_TOKEN` (xapp-…).
- **OAuth & Permissions** → Bot Token Scopes: `channels:history`, `channels:read`, `chat:write`, `chat:write.public`, `reactions:read`, `users:read`; add `users:read.email` if using participant subscribers. For private channels use `groups:history`, `groups:read` instead of channel scopes.
- **Event Subscriptions**: On. Subscribe to **`reaction_added`**.
- **Slash Commands**: Create command **`/sherpa`** (for channel bindings).
- **Basic Information** → Signing Secret → `SLACK_SIGNING_SECRET`; Bot User OAuth Token → `SLACK_BOT_TOKEN` (xoxb-…).
- Invite the bot to each channel (`/invite @BotName` or channel Integrations).

### 2. Trigger emoji

Add a custom emoji named `basecamp` (Slack → Customize workspace → Emoji), or set `TRIGGER_EMOJI` in `.env`.

### 3. Basecamp

- **Account ID**: From Basecamp URL `https://3.basecamp.com/1234567890/...` → `1234567890`.
- **Project & to-do list IDs**: From project URL `.../projects/9876543210` and `.../todolists/5555555555`.
- **Token**: Easiest: set `BASECAMP_CLIENT_ID`, `BASECAMP_CLIENT_SECRET`, `BASECAMP_REDIRECT_URI=http://localhost:3456/callback` in .env, then run `npm run basecamp-oauth` once; the script opens the browser and writes `basecamp-tokens.json`. Or set `BASECAMP_ACCESS_TOKEN` (and optionally refresh token + client id/secret for auto-refresh).

### 4. Run

```bash
cp .env.example .env   # fill required vars
npm install
npm start
# or npm run dev for auto-restart
```

## Channel bindings

Each channel can target a different Basecamp project/list. In a channel run:

- **`/sherpa bind <project_id> <todolist_id>`** — bind this channel.
- **`/sherpa unbind`** — clear binding (uses `.env` defaults if set).
- **`/sherpa`** — show help and current binding.

Bindings are stored in `channel-bindings.json`. If a channel has no binding and no `BASECAMP_PROJECT_ID`/`BASECAMP_TODOLIST_ID` in .env, the bot asks you to run `/sherpa bind`.

## Environment (required unless noted)

| Variable | Required | Notes |
|----------|----------|--------|
| `SLACK_BOT_TOKEN` | Yes | xoxb-… from OAuth & Permissions |
| `SLACK_SIGNING_SECRET` | Yes | Basic Information |
| `SLACK_APP_TOKEN` | Yes | xapp-…, scope `connections:write` |
| `OPENAI_API_KEY` | Yes | platform.openai.com |
| `BASECAMP_ACCOUNT_ID` | Yes | From Basecamp URL |
| `BASECAMP_ACCESS_TOKEN` | If no token file | Or use `npm run basecamp-oauth` |
| `BASECAMP_PROJECT_ID` | No | Default when channel not bound |
| `BASECAMP_TODOLIST_ID` | No | Default when channel not bound |
| `TRIGGER_EMOJI` | No | Default `basecamp` |
| `OPENAI_MODEL` | No | Default `gpt-4o-mini` |
| `BASECAMP_ADD_PARTICIPANTS_AS_SUBSCRIBERS` | No | `true` to add thread participants (needs `users:read.email`) |
| `EXTRACTION_PROMPT_FILE` | No | Custom prompt path (e.g. `./prompts/extract-issue.txt`) |
| `BASECAMP_CLIENT_ID`, `BASECAMP_CLIENT_SECRET`, `BASECAMP_REDIRECT_URI` | For OAuth/refresh | For `npm run basecamp-oauth` and token refresh |

## Optional

- **Custom prompt**: Set `EXTRACTION_PROMPT_FILE` to a file that produces `TITLE:` and `DESCRIPTION:` (see `prompts/extract-issue.txt`). Output must include those two sections.
- **OpenAI limits**: `OPENAI_MAX_REQUESTS_PER_MINUTE` (default 15), `OPENAI_CIRCUIT_BREAKER_FAILURES` (5), `OPENAI_CIRCUIT_BREAKER_SECONDS` (120).

## License

MIT
