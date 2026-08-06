# Kimi WebBridge — Complete Agent Reference

Kimi WebBridge lets an AI agent control the user's real browser — navigate, click, type, read page content, take screenshots, save PDFs, and interact with any website using the user's actual logged-in sessions (cookies, auth tokens, everything).

It runs as a local daemon at `http://127.0.0.1:10086` and communicates with a browser extension installed in Chrome/Edge.

---

## How It Works

```
AI Agent  ──HTTP POST──▶  Local Daemon (:10086)  ──WebSocket──▶  Browser Extension  ──▶  Real Browser Tab
```

1. **Daemon** — a binary at `~/.kimi-webbridge/bin/kimi-webbridge` that listens on port 10086.
2. **Browser Extension** — installed in Chrome/Edge, connects to the daemon via WebSocket.
3. **Agent** — sends JSON commands via `curl` to the daemon, which forwards them to the extension, which executes them in the user's actual browser.

The user's real login sessions are used — no headless browser, no puppeteer. If the user is logged into Gmail in their browser, you can read their Gmail.

---

## Setup & Health Check

### Always check health first

```bash
~/.kimi-webbridge/bin/kimi-webbridge status
```

Response is JSON:

```json
{
  "running": true,
  "port": 10086,
  "version": "1.2.3",
  "extension_connected": true,
  "extension_id": "abc123...",
  "uptime_seconds": 3600
}
```

### What to do based on status

| Status                                        | Action                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Binary not found                              | Install: `curl -fsSL https://cdn.kimi.com/webbridge/install.sh \| bash`                                                       |
| `running: false`                              | Start: `~/.kimi-webbridge/bin/kimi-webbridge start`                                                                           |
| `running: true`, `extension_connected: false` | User needs to open browser with the Kimi WebBridge extension installed. Install link: https://www.kimi.com/features/webbridge |
| `running: true`, `extension_connected: true`  | Healthy — proceed with commands                                                                                               |

### Daemon lifecycle commands

```bash
~/.kimi-webbridge/bin/kimi-webbridge start     # Start (idempotent)
~/.kimi-webbridge/bin/kimi-webbridge stop      # Stop
~/.kimi-webbridge/bin/kimi-webbridge restart   # Restart
~/.kimi-webbridge/bin/kimi-webbridge logs -n 100   # Last 100 log lines
~/.kimi-webbridge/bin/kimi-webbridge logs -f       # Follow logs live
~/.kimi-webbridge/bin/kimi-webbridge logs --prev   # Previous run's logs
```

---

## Command Format

Every command is an HTTP POST to `http://127.0.0.1:10086/command` with a JSON body:

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -H 'Content-Type: application/json' \
  -d '{
    "action": "ACTION_NAME",
    "args": { ... },
    "session": "optional-session-name"
  }'
```

---

## Sessions

Each session maps to a separate browser tab group. Use different session names for different sites/tasks to keep operations isolated.

```bash
# Task A works on GitHub
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"navigate","args":{"url":"https://github.com","newTab":true},"session":"github-task"}'

# Task B works on Supabase (separate tab group)
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"navigate","args":{"url":"https://supabase.com","newTab":true},"session":"supabase-task"}'
```

Always close your session when done:

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"close_session","args":{},"session":"github-task"}'
```

---

## All Available Tools (Actions)

### 1. `navigate` — Open a URL

Opens a URL in the browser. Always use `newTab: true` on first call.

| Arg           | Type    | Required | Description                                  |
| ------------- | ------- | -------- | -------------------------------------------- |
| `url`         | string  | Yes      | The URL to open                              |
| `newTab`      | boolean | No       | Open in a new tab (use `true` on first call) |
| `group_title` | string  | No       | Label for the tab group                      |

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"navigate","args":{"url":"https://example.com","newTab":true,"group_title":"My Task"},"session":"demo"}'
```

Returns: `{success, url, tabId}`

---

### 2. `find_tab` — Reuse an already-open tab

Finds a tab that's already open (matches by domain).

| Arg      | Type    | Required | Description                                                                             |
| -------- | ------- | -------- | --------------------------------------------------------------------------------------- |
| `url`    | string  | Yes      | URL or domain to match                                                                  |
| `active` | boolean | No       | `true` = pick the tab the user is currently viewing; `false` (default) = leftmost match |

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"find_tab","args":{"url":"https://github.com","active":false},"session":"demo"}'
```

Returns: `{success, url, tabId}` — if no match, falls back to using `navigate`.

---

### 3. `snapshot` — Read the page (accessibility tree)

Returns a text representation of the page with interactive element references (`@e` refs). This is how you "see" the page.

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"snapshot","args":{},"session":"demo"}'
```

Returns: `{url, title, tree}` — the `tree` contains text content and `@eXX` refs for clickable/fillable elements.

**This is the primary way to read page content.** Prefer `snapshot` over CSS selectors — the `@e` refs survive CSS class changes.

---

### 4. `click` — Click an element

Performs a synthetic click on an element.

| Arg        | Type   | Required | Description                                        |
| ---------- | ------ | -------- | -------------------------------------------------- |
| `selector` | string | Yes      | `@e` ref from snapshot (preferred) or CSS selector |

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"click","args":{"selector":"@e15"},"session":"demo"}'
```

Returns: `{success, tag, text}`

---

### 5. `fill` — Type into an input field

Fills text into any input, textarea, or contenteditable element. **Replaces** existing content (clear-and-insert).

| Arg        | Type   | Required | Description              |
| ---------- | ------ | -------- | ------------------------ |
| `selector` | string | Yes      | `@e` ref or CSS selector |
| `value`    | string | Yes      | Text to type             |

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"fill","args":{"selector":"@e8","value":"Hello world"},"session":"demo"}'
```

Returns: `{success, tag, mode}` — mode is `"value"` (standard input) or `"contenteditable"` (rich text editors like ProseMirror, Lexical, Slate, Quill).

**To append** instead of replace: read current value with `evaluate`, concatenate, then `fill` with the combined string.

---

### 6. `evaluate` — Run JavaScript on the page

Executes arbitrary JavaScript in the page context. Supports async/await.

| Arg    | Type   | Required | Description           |
| ------ | ------ | -------- | --------------------- |
| `code` | string | Yes      | JavaScript to execute |

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"evaluate","args":{"code":"document.title"},"session":"demo"}'
```

Returns: `{type, value}`

**Tips:**

- Always use compact `JSON.stringify(data)` — never `JSON.stringify(data, null, 2)` (inflates response, causes truncation).
- Wrap in IIFE to avoid `const`/`let` redeclaration errors across multiple calls: `(() => { const x = ...; return x; })()`

**Use case — press a key (e.g., Escape):**

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"evaluate","args":{"code":"document.activeElement.dispatchEvent(new KeyboardEvent(\"keydown\",{key:\"Escape\",bubbles:true}))"},"session":"demo"}'
```

---

### 7. `screenshot` — Capture the page visually

Takes a screenshot of the current page or a specific element.

| Arg        | Type   | Required | Description                                           |
| ---------- | ------ | -------- | ----------------------------------------------------- |
| `format`   | string | No       | `png` (default) or `jpeg`                             |
| `quality`  | number | No       | 0-100, only for JPEG                                  |
| `selector` | string | No       | `@e` ref or CSS selector — captures only that element |

**IMPORTANT: Never call the screenshot API directly for full-page screenshots.** The base64 response floods the context window. Use the helper script instead:

```bash
# Default — saves PNG to /tmp/kimi-webbridge-screenshots/{timestamp}.png
bash ~/.claude/skills/kimi-webbridge/scripts/screenshot.sh -s SESSION_NAME

# Custom output path
bash ~/.claude/skills/kimi-webbridge/scripts/screenshot.sh -s SESSION_NAME -o /tmp/my-screenshot.png

# JPEG at quality 60
bash ~/.claude/skills/kimi-webbridge/scripts/screenshot.sh -s SESSION_NAME -f jpeg -q 60
```

The script saves the image to disk and returns the file path. Then use your file-reading tool to view the image.

For **element-only screenshots** (small), calling the API directly is OK:

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"screenshot","args":{"selector":"@e5","format":"png"},"session":"demo"}'
```

---

### 8. `network` — Monitor network requests

Capture and inspect network traffic on the page.

| Arg         | Type   | Required | Description                          |
| ----------- | ------ | -------- | ------------------------------------ |
| `cmd`       | string | Yes      | `start`, `stop`, `list`, or `detail` |
| `filter`    | string | No       | Filter pattern for requests          |
| `requestId` | string | No       | Specific request ID (for `detail`)   |

```bash
# Start capturing
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"network","args":{"cmd":"start"},"session":"demo"}'

# List captured requests
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"network","args":{"cmd":"list"},"session":"demo"}'

# Get details of a specific request
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"network","args":{"cmd":"detail","requestId":"REQ_ID"},"session":"demo"}'

# Stop capturing
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"network","args":{"cmd":"stop"},"session":"demo"}'
```

---

### 9. `upload` — Upload files to a file input

| Arg        | Type     | Required | Description                                 |
| ---------- | -------- | -------- | ------------------------------------------- |
| `selector` | string   | Yes      | `@e` ref or CSS selector for the file input |
| `files`    | string[] | Yes      | Array of absolute file paths                |

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"upload","args":{"selector":"@e12","files":["/Users/hugo/photo.jpg"]},"session":"demo"}'
```

Returns: `{success, fileCount}`

---

### 10. `save_as_pdf` — Save page as PDF

Renders the current page to PDF and saves it to `/tmp/kimi-webbridge-pdfs/`.

| Arg                | Type    | Required | Description                                          |
| ------------------ | ------- | -------- | ---------------------------------------------------- |
| `paper_format`     | string  | No       | `letter` (default), `a4`, `legal`, `a3`, `tabloid`   |
| `landscape`        | boolean | No       | `false` (default)                                    |
| `scale`            | number  | No       | `1.0` (default), range 0.1–2.0                       |
| `print_background` | boolean | No       | `true` (default) — keep background colors            |
| `file_name`        | string  | No       | Custom filename (derived from page title if omitted) |

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"save_as_pdf","args":{"paper_format":"a4","landscape":false},"session":"demo"}'
```

Returns: `{path, sizeBytes, mimeType, pageTitle}` — max 100 MB.

---

### 11. `list_tabs` — See all open tabs in a session

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"list_tabs","args":{},"session":"demo"}'
```

Returns: `{success, tabs: [{tabId, url, title, active, groupTitle}]}`

---

### 12. `close_tab` — Close the current tab

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"close_tab","args":{},"session":"demo"}'
```

Returns: `{success, closed: bool}`

---

### 13. `close_session` — Close all tabs in a session

**Always call this when your task is done.**

```bash
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"close_session","args":{},"session":"demo"}'
```

Returns: `{success, closed: int}` (count of closed tabs)

---

## Typical Workflow

```
1. Check health          →  ~/.kimi-webbridge/bin/kimi-webbridge status
2. Navigate to page      →  navigate (newTab: true)
3. Read the page         →  snapshot (get @e refs)
4. Interact              →  click / fill using @e refs
5. Verify                →  snapshot again, or screenshot
6. Repeat 3-5 as needed
7. Clean up              →  close_session
```

### Example: Log into a site and fill a form

```bash
# 1. Open the login page
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"navigate","args":{"url":"https://app.example.com/login","newTab":true},"session":"login-test"}'

# 2. Read the page to find form fields
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"snapshot","args":{},"session":"login-test"}'
# Response includes: @e3 = email input, @e4 = password input, @e5 = submit button

# 3. Fill email
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"fill","args":{"selector":"@e3","value":"user@example.com"},"session":"login-test"}'

# 4. Fill password
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"fill","args":{"selector":"@e4","value":"mypassword"},"session":"login-test"}'

# 5. Click submit
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"click","args":{"selector":"@e5"},"session":"login-test"}'

# 6. Take a screenshot to verify
bash ~/.claude/skills/kimi-webbridge/scripts/screenshot.sh -s login-test

# 7. Clean up when done
curl -s -X POST http://127.0.0.1:10086/command \
  -d '{"action":"close_session","args":{},"session":"login-test"}'
```

---

## Known Limitations

1. **`isTrusted` enforcement** — Some sites (banking portals, captchas) reject synthetic clicks/fills because `event.isTrusted` is `false`. This is a fundamental browser security boundary — no workaround exists.

2. **Cross-origin iframes** — `fill`, `click`, `evaluate`, and `snapshot` operate on the top frame only. For elements inside a cross-origin iframe, navigate directly to the iframe's URL instead.

3. **Full-page screenshots flood context** — Always use the helper script (`screenshot.sh`) for full-page captures. Only call the API directly for small element-only screenshots.

---

## Troubleshooting

| Problem                                      | Solution                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `command not found`                          | Install: `curl -fsSL https://cdn.kimi.com/webbridge/install.sh \| bash`                                                                                |
| "address already in use" on start            | `~/.kimi-webbridge/bin/kimi-webbridge stop && ~/.kimi-webbridge/bin/kimi-webbridge start`. If that fails: `lsof -i :10086` to find conflicting process |
| Tool calls time out                          | Check logs: `~/.kimi-webbridge/bin/kimi-webbridge logs -n 100`                                                                                         |
| `extension_connected` stays false            | User needs to open browser with extension installed. Install: https://www.kimi.com/features/webbridge                                                  |
| Extension connected but tools fail           | Possible multi-browser conflict. Check logs for details                                                                                                |
| "Please update the Kimi WebBridge extension" | User must update extension from https://www.kimi.com/features/webbridge                                                                                |

---

## Quick Reference Card

| Action          | What it does                                        | Key args                             |
| --------------- | --------------------------------------------------- | ------------------------------------ |
| `navigate`      | Open a URL                                          | `url`, `newTab`, `group_title`       |
| `find_tab`      | Find an already-open tab                            | `url`, `active`                      |
| `snapshot`      | Read page content (accessibility tree with @e refs) | —                                    |
| `click`         | Click an element                                    | `selector`                           |
| `fill`          | Type into input/textarea/contenteditable            | `selector`, `value`                  |
| `evaluate`      | Run JavaScript                                      | `code`                               |
| `screenshot`    | Capture image (use helper script!)                  | `format`, `quality`, `selector`      |
| `network`       | Monitor HTTP requests                               | `cmd`, `filter`, `requestId`         |
| `upload`        | Upload files to file input                          | `selector`, `files`                  |
| `save_as_pdf`   | Save page as PDF                                    | `paper_format`, `landscape`, `scale` |
| `list_tabs`     | List all tabs in session                            | —                                    |
| `close_tab`     | Close current tab                                   | —                                    |
| `close_session` | Close all tabs in session (always do this at end)   | —                                    |
