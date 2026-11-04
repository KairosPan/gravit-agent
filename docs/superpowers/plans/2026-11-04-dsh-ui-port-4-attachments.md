# dsh UI port, plan 4: attachments, with PDFs — files and images in a message, the PDF role, Poppler in the agent box — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator can pick, paste or drop files and images into a message, see them upload in
the draft and drawn in the thread, and Gravit reads what its tools can: text files from their saved
copy, a PDF's text with Poppler, and a PDF page whose layout matters through a new read-only role on
an image-taking model.

**Architecture:** A draft becomes `{runs, files}`: plan 3's runs, plus a list of attachment records
kept outside the store with the bytes they came from (D8, D18). The checks and the prompt's content
parts are pure (`js/composer/files.js`); the uploads go through an `XMLHttpRequest` helper in
`wire/api.js` (progress) and an impure `host/attachments.js` (the image limits, the uploads, the
thumbnails). Images travel inline in `session/prompt`; other files upload at once to the host's
`uploadFileBinary` route and travel as receipts. History keeps the image and file blocks
(`wire/mapper.js` → `host/kinds.js` → `render/thread.js`), thumbnails load lazily through
`session/attachment` into a `thumbs` slice, and a lightbox opens a thumbnail. PDFs need no face
code: one `GRAVIT.md` paragraph, one role (`roles/pdf-page-reader/`, `read_image` alone on
`deepseek-official/deepseek-flash`), its regenerated mirror, and `poppler-utils` in the agent box.

**Tech Stack:** Vanilla ES modules in `face/client/js`, the fake-DOM client suite
(`face/tests/client/`, `node --test` via tsx), dsh 0.2.1-rc.5's `session/prompt` content parts,
`POST /api/session/uploadFileBinary`, `session/projections` (`imageLimits`), `session/attachment`
and `dsh-tool-fs`'s `read_image`; `face/src/roles.ts` and `npm run render:roles`; the face's
`Dockerfile`; the smokes in `face/tests/dsh-ui-port-smoke.test.ts`.

**Spec:** `docs/superpowers/specs/2026-11-03-dsh-ui-port-design.md` §5.6, §5.3's draft and
paste rules, §6 row 4, §7's attachment and PDF lines, §9 items 1–3, §11, §12 Q2, and D8, D10, D12,
D18–D20 and D34. Plans 1–3's build notes are its §13–§15; this plan's are its §16 (Task 10).

**Where the code differs from the spec, this plan follows the code:**
- **The role's tool name.** §5.6, §6 and N8 write `role_pdf-page-reader`. `toolNameFor`
  (`face/src/roles.ts`) gives `role_` plus the id with `-` as `_`, so Gravit's tool is
  `role_pdf_page_reader`. The id, the directory and the preset stay `pdf-page-reader` and
  `role-pdf-page-reader`. `GRAVIT.md` and every test name the underscored tool.
- **The role adds one bullet to Gravit's prompt.** N8 says no new sentence in any system prompt
  but the role. The `gravit:roles` section (`plugins/gravit.js`) carries one `- role_<id> — <description>`
  line per role, so the role's one-line `description` joins it, and the tool's description repeats
  it. That is the role library's own form, the same for every role; nothing else is added.
- **A typed `@word` beside files.** D20 refuses files with a bot chip. A typed `@word` with no bot
  chip in a channel conversation is tried at `/data/rooms/say` today (plan 3), but that path
  carries text only. With files in the draft, such a message goes to Gravit as a prompt and is not
  tried at the room; only a bot chip refuses (Review Focus 5 of plan 3 still holds without files).
- **Uploads resume a cold conversation.** Plan 3 found that `commands/list` and
  `commands/execute` resume a cold session at rc.5 (spec §15). The upload route does too: the
  session controller registers the file-upload service's agent resolver as find-or-resume
  (`dsh-api-session-controller` `registerAgentResolver`). So a file added to a cold conversation
  uploads without the page following it; the page opens no follow for an upload, and the send
  follows as today (`live.promote`). PLAN D16 (reading never activates) is untouched: adding a
  file is a write.
- **The receipt the host dropped** is refused as `session/attachment-invalid` with
  `details.reason` `FILE_NOT_STAGED` (`resolvePromptFileReceipts`); an image on a text-only model
  as the same code with `MODEL_DOES_NOT_SUPPORT_IMAGES`. `call` (`wire/api.js`) already carries
  `details` on its error. These two reasons are D18's and D19's triggers.
- **The limits when none was read.** The `imageLimits` projection is the attachment store's
  deployment limits, the same for every session. Until the page has read it, it uses
  `dsh-attachment-local`'s defaults: 20 MiB an image, 20 a message, 200 MiB a message, 64
  megapixels, 8,192 px a side, PNG, JPEG, WebP and GIF.
- The rest checks out against rc.5: the content parts `{type: 'image', mediaType, data, name?}`
  and `{type: 'file', receiptId}` (`PromptContentPart`); an image-only prompt is valid
  (`hasPromptContent`: "text or an attachment"); `commands/execute`'s `submittedAttachments` take
  the same two shapes (`CommandSubmitAttachment`); the upload answers `{ok, value: {receiptId,
  file: {attachmentId, name, bytes}}}` or `{ok: false, error: {code, message, details}}` with HTTP
  200, and 415 without `application/octet-stream`; `session/attachment` takes `{request:
  {sessionId, attachmentId}}` and answers `{attachment, data}` for an image the log references;
  the stored blocks `{type: 'image', attachment: {attachmentId, mediaType, bytes, width, height,
  name?}, offloaded?}` and `{type: 'file', attachment: {attachmentId, name, bytes}}`;
  `deepseek-flash` declares `["text", "image"]` in `dsh-llm-deepseek`'s catalog, and `read_image`
  refuses a route that does not (`assertImageCapableRoute`); the stub model of the smokes declares
  `["text"]`.

## Global Constraints

- **Copy, verbatim (English):**
  - the paperclip key: `aria-label="Attach files"`; a remove key: `aria-label="Remove <name>"`;
  - the drop overlay: `Drop files or images here`, then `Images: up to <n> a message, <m> MB
    each` from the limits (`<m>` is `maxImageBytes` in MiB, rounded);
  - a file card's line: `<EXT> · <size>` (`CSV · 2.8 MB`; `FILE` for a name with no extension);
    while it uploads `<loaded> / <total> MB` in the total's unit (`1.1 / 2.8 MB`); a failed one
    `Upload failed · ` and a `Retry` key;
  - sizes: under 1,024 bytes `<n> B`; under 1 MiB `<n> KB`, rounded; else `<n.n> MB`;
  - the model refusal, above the box: `Gravit's model takes no images. Remove the image, or run
    Gravit on a model that does.`; in a bot's own conversation the bot's name stands for both
    `Gravit`s;
  - the pre-checks, above the box: `Up to <n> images a message`, `<name> is over <m> MB`,
    `Images in one message: up to <t> MB`;
  - on the status line: `Files go to Gravit, not to a room's bots` (D20); `/<name> takes no
    files` (D12); `Files are still uploading`; `A file did not upload. Retry it or remove it.`;
    any other refusal of the attachments `send: session/attachment-invalid (<reason>)`;
  - the lightbox: `role="dialog"`, `aria-label="Image"`, its close key `aria-label="Close"`; an
    image the host cannot give back draws as a file card named by the image's name or `Image`.
- **Wire:**
  - `session/prompt {request: {requestId, sessionId, mode: 'queue', content, clientTimeZone}}`,
    `content` = the text part when the words are not blank, then the attachments in the draft's
    order: `{type: 'image', mediaType, data: <canonical base64>, name}` or `{type: 'file',
    receiptId}`;
  - `POST /api/session/uploadFileBinary?sessionId=<encoded>&name=<encoded>`, `content-type:
    application/octet-stream`, the file's bytes as the body, same origin (the owner's cookie);
  - `session/projections {request: {sessionId}}` → `values.imageLimits`;
  - `session/attachment {request: {sessionId, attachmentId}}` → `{attachment, data}`;
  - `commands/execute {agentId, line, submittedAttachments}` with the same two part shapes.
- **What is an image:** a file whose `type` is one of the limits' `mediaTypes`. Any other file,
  an SVG or a HEIC included, is a file and uploads.
- **The client rules (plan 3's, unchanged):** a keystroke never renders the page; a progress tick
  writes only `#composer-files`; every host string passes through `esc()`, an attribute through
  `attrs`; `app.css` names no hex; `css.test.js` holds both ways. Adding, removing, a finished or
  failed upload and a refusal render the page (the editor survives a render since plan 3).
- **One draft per conversation** (D8): `drafts` holds `{runs, files}` by key; an entry goes only
  when both are empty. A file uploads to the session its draft belongs to, and its progress and
  receipt land in that draft whatever is on screen.
- **The Escape order** after this plan: an open menu, the lightbox, the search box, then today's
  chain (D34; the shortcut sheet joins in plan 6).
- **The role library:** `roles/pdf-page-reader/` keeps the library's caps (`ROLE.md` ≤ 2,000
  bytes, no `{{`; a one-line `description` ≤ 300 characters); after any edit under `roles/`,
  `cd face && npm run render:roles` regenerates `bots/gravit/agent.cordis.yml`. `GRAVIT.md` stays
  ≤ 4,500 bytes (`face/tests/gravit-md.test.ts`).
- **Out of this plan:** masking, the rail and stats, jobs (plan 5); the shortcut sheet and the
  words tables (plan 6). No PDF code in the face, no PDF tool for Gravit, no change to Gate 2.
- Never the live `~/.dsh`, never port 3090, never `npm run service`. A smoke runs from a checkout
  outside `/tmp` and `$TMPDIR`. Commit messages go in a file and are committed with
  `git commit -F <file>`. No push.

## Review Focus

1. **A receipt the host dropped.** The face restarted, or the session's agent was disposed,
   between the upload and the send: the prompt is refused with `FILE_NOT_STAGED`, the page
   uploads every file again once and sends once more; a second refusal keeps the whole draft and
   says so (D18). Pinned in Task 6.
2. **New message with an image on Gravit's text-only model.** The conversation is created, then
   its prompt refused: the page opens the created conversation with the whole draft (words,
   chips, files) and the refusal line, never an empty conversation and a lost draft. Pinned in
   Task 6.
3. **HTML dropped on the editor.** A drop whose `text/html` holds a `span[data-chip]` (a forged
   bot or conversation chip) arrives as its `text/plain` only, and no chip enters the draft; a
   drag that starts inside the editor is cancelled, so no chip is moved or copied by the browser
   (plan 3's deferred finding). Pinned in Task 5.
4. **A conversation switch mid-upload.** The operator adds a file in A, opens B before it is up:
   A's progress and receipt land in A's draft, B's rail is never written, and A shows the file
   up on return. Pinned in Task 5.
5. **An attachment-only message in history.** An image with no words is drawn in the thread
   (today the mapper drops it), and the list's preview line names it instead of going blank.
   Pinned in Task 3.

---

### Task 1: The attachment list (pure)

**Files:**
- Create: `face/client/js/composer/files.js`
- Test: `face/tests/client/composer-files.test.js`

**Interfaces:**
- Produces:

```js
// Attachment = {key, kind: 'image' | 'file', name, bytes, mediaType, blob, url?,
//               status: 'ready' | 'uploading' | 'up' | 'failed', loaded, receiptId?, sessionId?}
// Picked = {key, name, bytes, mediaType, blob}            // one File, as app.js reads it
export const DEFAULT_LIMITS = { maxImageBytes: 20971520, maxImagesPerMessage: 20, maxMessageImageBytes: 209715200,
  maxImagePixels: 64e6, maxImageDimension: 8192, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] };
export function kindOf(mediaType, limits) {}       // 'image' when mediaTypes holds it, else 'file'
export function admit(files, picked, limits) {}    // → {files, refusal}: files + the admitted, each status 'ready', loaded 0
export const hasImage = files => {};
export function blocking(files) {}                 // 'uploading' | 'failed' | null: what keeps a draft from sending
export function sizeText(bytes) {}
export function progressText(loaded, total) {}
export function extOf(name) {}                     // 'CSV' for 'a.csv', 'FILE' with no extension
export function metaText(file) {}                  // `${extOf(name)} · ${sizeText(bytes)}`
export function limitsLine(limits) {}              // 'Images: up to 20 a message, 20 MB each'
export function modelRefusalLine(name = 'Gravit') {}
export function encodeBase64(bytes) {}             // Uint8Array → canonical base64, encoded in chunks (no spread of a large array)
export function contentParts(text, files, dataOf) {} // → PromptContentPart[]; dataOf(key) → an image's base64
export function attachmentsLine(list) {}           // history's names joined by ', ', an unnamed image as 'image'
```

- **`admit`** walks `picked` in order. A file's kind is `kindOf(mediaType)`. An image is refused
  when it is over `maxImageBytes` (`<name> is over <m> MB`), when it would make the images more
  than `maxImagesPerMessage` (`Up to <n> images a message`), or when the images' bytes would pass
  `maxMessageImageBytes` (`Images in one message: up to <t> MB`). A refused image is left out;
  the rest are admitted; `refusal` is the first refusal's line, or null. A file is never refused.
- **`contentParts`** gives the text part only when `text.trim()` is not empty, then one part per
  attachment in the draft's order: an image as `{type: 'image', mediaType, data: dataOf(key),
  name}`, a file as `{type: 'file', receiptId}`.

- [ ] **Step 1: Write the failing tests:**
  - `an image is one of the limits' media types; an SVG and a PDF are files`;
  - `admit keeps files whatever their size and refuses an image over the per-image limit, by name`
    (a 21 MiB `chart.png` → refusal `chart.png is over 20 MB`, a 300 MiB `big.zip` admitted);
  - `admit stops at the count and at the message total, admitting the rest`
    (21 small PNGs → 20 admitted, `Up to 20 images a message`; eleven 19 MiB JPEGs with the
    default limits → ten admitted, `Images in one message: up to 200 MB`);
  - `blocking reads an upload in flight before a failed one, and nothing for a ready draft`;
  - `sizes and progress read B, KB and MB, the progress in the total's unit`
    (`sizeText(900)` → `900 B`, `sizeText(15360)` → `15 KB`, `sizeText(2936013)` → `2.8 MB`,
    `progressText(1153434, 2936013)` → `1.1 / 2.8 MB`, `metaText({name: 'q3.csv', bytes: 2936013})`
    → `CSV · 2.8 MB`, `extOf('README')` → `FILE`);
  - `the limits line and the model refusal read as the spec writes them`
    (`limitsLine(DEFAULT_LIMITS)` → `Images: up to 20 a message, 20 MB each`;
    `modelRefusalLine('news-scout')` names `news-scout` twice and `Gravit` never);
  - `base64 is canonical for every length, and a 3 MB array encodes without a stack overflow`
    (equal to `Buffer.from(bytes).toString('base64')` for lengths 0–5 and 3,145,728);
  - `content: text first when not blank, then images and receipts in the draft's order; no text part for blank words`;
  - `history's names: an unnamed image reads image`.
- [ ] **Step 2: Run them and see them fail.** Run
  `npx tsx --test tests/client/composer-files.test.js` in `face/`. Expected: FAIL, the module is
  missing.
- [ ] **Step 3: Implement `composer/files.js`.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** with `git commit -F <file>`.

### Task 2: The composer's attachments in markup: the paperclip, the rail, the note, the overlay, the lightbox

**Files:**
- Modify: `face/client/js/composer/view.js`, `face/client/js/render/messages.js`
  (`renderComposer`, `draftScreen`, `emptyScreen`, `renderMessagesScreen`),
  `face/client/js/icons.js` (`paperclip`), `face/client/css/app.css`
- Test: `face/tests/client/composer-view.test.js`, `face/tests/client/messages-screen.test.js`,
  `face/tests/client/css.test.js`

**Interfaces:**
- Consumes: Task 1's `Attachment`, `metaText`, `progressText`, `limitsLine`.
- Produces:

```js
// composer/view.js
export function fileCard({ name, meta, failedKey = null, removeKey = null, removeName = '' }) {} // the shared card
export function filesRail(files) {}       // '' for none; a draft's images and file cards
export function dropOverlay(limits) {}
export function lightboxHtml({ src, name }) {}
// render/messages.js
export function renderComposer({ placeholder = 'Tell Gravit…', above = '', menu = null, files = [], note = '' } = {}) {}
export function renderMessagesScreen(state, now, composer = { menu: null, files: [], note: '' }) {}
```

- **The composer** (plan 3's form, in this order): `#composer-menu`; then
  `div.composer-note#composer-note` with `role="status"` holding `esc(note)`; then
  `div.composer-box`, holding `div.composer-files#composer-files` with `filesRail(files)` (first,
  above the text), the paperclip `button.attach-key` (`type="button"`,
  `data-action="attachFiles"`, `aria-label="Attach files"`, the `paperclip` icon at 18 px), a
  hidden `input#attach-input.sr-only` (`type="file"`, `multiple`, `tabindex="-1"`,
  `aria-hidden="true"`), the editor and the send key. The three screens pass `composer.files` and
  `composer.note` on.
- **The rail:**
  - an image is `div.attach-image` (64 px square) with `img` (`src` = its object URL,
    `alt` = its name) and the remove key;
  - a file is `fileCard`: `div.file-card` with the `file` icon, `span.file-name`, `span.file-meta`
    (`metaText`; `progressText` while `uploading`, with `uploading` on the card; `Upload failed · `
    and `button.file-retry` `data-action="attachRetry"` `data-key` when `failed`, with `failed` on
    the card) and the remove key;
  - the remove key is `button.attach-remove` (`data-action="attachRemove"`, `data-key`,
    `aria-label="Remove <name>"`, the `x` icon), shown on hover or focus within.
- **The overlay** is `div.drop-overlay` holding `div.drop-card`: the `upload` icon, `div.drop-title`
  `Drop files or images here`, `div.drop-sub` `limitsLine(limits)`.
- **The lightbox** is `div.lightbox` (`role="dialog"`, `aria-modal="true"`, `aria-label="Image"`,
  `data-action="lightboxClose"`) holding `img.lightbox-img` (`data-action="lightboxKeep"`, so a
  click on the image is not a click outside) and `button.close-key.lightbox-close`
  (`data-action="lightboxClose"`, `aria-label="Close"`).
- **CSS:** `.composer-note` in `--down` on `--down-fill`, `:empty` not drawn; `.composer-files` a
  wrapping row with a gap, `:empty` not drawn; `.attach-image` 64 × 64 at `var(--radius-s)` with
  `object-fit: cover`; `.file-card` 240 × 64; `.file-card.failed` on `--down-fill` with
  `--down-edge`; `.attach-remove` at opacity 0 until `:hover` or `:focus-within` of its card;
  `.drop-overlay` fixed over the page on a translucent `--bg`; `.lightbox` fixed, `img` within the
  viewport (`max-width: 92vw; max-height: 88vh`).

- [ ] **Step 1: Write the failing tests:**
  - in `composer-view.test.js`:
    - `the rail draws an image's square with its remove key and a file's card with its line`
      (a name `<b>.csv` comes out as text; `aria-label="Remove &lt;b&gt;.csv"`);
    - `an uploading card reads its progress, a failed one Upload failed and a Retry key with its data-key`;
    - `no files draws an empty rail`;
    - `the overlay reads the two lines from the limits`;
    - `the lightbox is a dialog whose image keeps a click and whose backdrop and close key close it`;
  - in `messages-screen.test.js`, plan 3's guard (`attachFiles`, `toggleMic`, `pickFile`,
    `attach-input` absent) becomes
    `the composer has the paperclip and a hidden file input, no mic`: `data-action="attachFiles"`
    with `aria-label="Attach files"`, `id="attach-input"` with `multiple`, `id="composer-files"`
    inside `.composer-box` before `id="say"`, `id="composer-note"` outside it; `toggleMic` and
    `pickFile` still absent;
  - `a note handed in is drawn above the box, escaped`;
  - in `css.test.js`, the class harvest gains a rail with each card state, the overlay, the
    lightbox and a note; it asserts `.file-card.failed` reads `var(--down-fill)`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 3: Attachments in history: the mapper, the kinds, the bubble, the preview

**Files:**
- Modify: `face/client/js/wire/mapper.js` (`bubble`, a new `blocksAttachments` beside
  `blocksText`), `face/client/js/host/kinds.js` (the `you` row), `face/client/js/render/thread.js`
  (the `you` message), `face/client/js/render/rail.js` (`previewOf`),
  `face/client/js/host/search-view.js` (`previewLine`), `face/client/js/reducers/host.js`
  (`hostThumb`), `face/client/js/data/empty.js` (`thumbs: {}`), `face/client/css/app.css`
- Test: `face/tests/mapper.test.ts`, `face/tests/client/kinds.test.js`,
  `face/tests/client/thread.test.js`, `face/tests/client/rail.test.js`,
  `face/tests/client/search-view.test.js`, `face/tests/client/host-reducers.test.js`,
  `face/tests/client/css.test.js`

**Interfaces:**
- Consumes: Task 1's `metaText`, `attachmentsLine`; Task 2's `fileCard`.
- Produces:
  - a bubble view gains `attachments: Array<{type: 'image', attachmentId, mediaType, bytes, width,
    height, name?, offloaded?: true} | {type: 'file', attachmentId, name, bytes}>`, present only
    when the message holds one; a user message with no text and no reasoning but an attachment is
    a bubble, not `ignore()`. Only an operator bubble carries them.
  - the `you` row's `data.attachments` is that array.
  - `hostThumb {attachmentId, src}`: `thumbs[attachmentId] = src`, where `src` is a `data:` URL,
    or `null` for an image the host cannot give back.
  - `render/thread.js` exports `thumbsNeeded(conv, thumbs) → [{sessionId, attachmentId}]`: the
    conversation's `you` images, not offloaded, with no entry in `thumbs` yet.
- **The `you` message:** `div.msg.you` holds, before the bubble, `div.you-files` (right-aligned)
  when there are attachments, and the bubble only when the text is not empty:
  - a lone image (the only attachment) is `button.you-image` with `img` up to 240 px wide;
    with other attachments, images are `button.you-thumb` 64 px squares. Each carries
    `data-action="openImage"`, `data-attachment` and `data-name`;
  - `thumbs[id] === undefined` draws the square or the frame empty with `loading`; `null`, or an
    `offloaded` image, draws `fileCard` named by the image's name or `Image`, its meta from the
    media type (`PNG · 1.2 MB`);
  - a file is `fileCard` with `metaText`, no remove key, no action (the host gives no file back).
- **The preview line:** a message whose text is empty but which holds attachments reads
  `attachmentsLine(data.attachments)` in `previewOf` and in `search-view.js`'s `previewLine`.

- [ ] **Step 1: Write the failing tests:**
  - in `mapper.test.ts`: `an operator message keeps its image and file blocks beside its text`;
    `an image-only operator message is a bubble with empty text, not dropped` (Review Focus 5);
    `an offloaded image keeps offloaded: true`; `a block with no attachmentId is dropped, not thrown`;
    `Gravit's message never carries attachments`;
  - in `kinds.test.js`: `the you row carries the bubble's attachments`;
  - in `thread.test.js`:
    - `a lone image draws large, several draw as squares, a file as its card, all before the bubble`;
    - `an image-only message draws no empty bubble`;
    - `an image not loaded draws loading; one the host cannot give back, or offloaded, draws a card named Image`;
    - `thumbsNeeded lists the conversation's images with no thumb, never an offloaded one`;
  - in `rail.test.js` and `search-view.test.js`:
    `an attachment-only last message previews as its names` (`chart.png, q3.csv`) (Review Focus 5);
  - in `host-reducers.test.js`: `hostThumb keeps a src or a null by attachment id`;
  - in `css.test.js`, the harvest gains a `you` message with each attachment kind.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** `blocksText` is unchanged; the new reader sits beside it.
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 4: The upload helper and the attachments' reads

**Files:**
- Modify: `face/client/js/wire/api.js` (`uploadFile`)
- Create: `face/client/js/host/attachments.js`, `face/tests/client/helpers/fake-xhr.js`
- Test: `face/tests/api.test.ts`, `face/tests/client/host-attachments.test.js`

**Interfaces:**
- Consumes: `call`; Task 1's `DEFAULT_LIMITS`.
- Produces:

```js
// wire/api.js — the one write the page makes outside call(): fetch reports no upload progress
export function uploadFile({ sessionId, name, blob, onProgress = () => {}, makeXhr = () => new XMLHttpRequest() }) {
  return { done: /* Promise<{receiptId, file}> */ null, abort() {} };
}
// host/attachments.js
export function startAttachments({ call, upload = uploadFile, store }) {
  return {
    limits() {},                    // the imageLimits last read, else DEFAULT_LIMITS
    async readLimits(sessionId) {}, // session/projections {request: {sessionId}} → values.imageLimits, once; a throw or a bad shape keeps what was
    upload(sessionId, file, onProgress) {}, // → {done: Promise<string> (the receiptId), abort}
    async thumb(sessionId, attachmentId) {}, // once per id while in flight or answered: dispatches hostThumb with `data:<mediaType>;base64,<data>`, or null on a throw
  };
}
```

- **`uploadFile`:** `POST` to
  `/api/session/uploadFileBinary?sessionId=<encodeURIComponent>&name=<encodeURIComponent>` with
  `content-type: application/octet-stream` and `blob` as the body; `xhr.upload.onprogress` calls
  `onProgress(loaded)`. It resolves `value` when the JSON is `{ok: true, value: {receiptId}}`. It
  rejects with an `Error` carrying:
  - `status: 401` on a 401 (the actions' `NOT_SIGNED_IN` line follows from it);
  - `status` on any other non-200;
  - `code` and `details` from `{ok: false, error}`;
  - `code: 'bad-response'` for a body that is not that JSON;
  - `code: 'aborted'` after `abort()`.
- **The fake XHR** records `open`, `setRequestHeader` and `send`, and lets a test drive
  `upload.onprogress`, `onload` (status, `responseText`), `onerror` and `abort`.

- [ ] **Step 1: Write the failing tests:**
  - in `api.test.ts`:
    - `an upload posts the bytes as octet-stream to the session's route, names encoded` (`估值 v2.pdf`
      → `name=%E4%BC%B0%E5%80%BC%20v2.pdf`);
    - `progress reports the loaded bytes`;
    - `an ok answer resolves the receipt; ok: false rejects with its code and details`;
    - `a 401 rejects as not signed in, a 415 with its status, a body that is not JSON as bad-response`;
    - `abort rejects with aborted and aborts the request`;
  - in `host-attachments.test.js`:
    - `the limits are dsh's defaults until read, then the projection's` (a `maxImagesPerMessage`
      of 5 read back);
    - `a failed or malformed limits read keeps what was`;
    - `an upload resolves its receipt id`;
    - `a thumb is read once per attachment and lands as a data URL, or null on a throw` (two calls
      while the first is in flight make one `session/attachment` call with
      `{request: {sessionId, attachmentId}}`).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 5: Files in the draft: pick, paste, drop, upload, remove, retry

**Files:**
- Modify: `face/client/js/app.js` (`drafts` as `{runs, files}`; `filesOf`, `setFiles`, `addFiles`,
  `drawFiles`; the `attachFiles`, `attachRemove` and `attachRetry` actions; the `change` of
  `#attach-input`; the paste listener; `dragstart`, `dragover`, `dragleave` and `drop`; the limits
  read; `render()` passing `files` and `note`), `face/client/js/composer/dom.js` (`pointAt`),
  `face/client/js/reducers/controls.js` (`setDropping`), `face/client/js/data/empty.js`
  (`dropping: false`)
- Test: `face/tests/client/app-dom.test.js`, `face/tests/client/composer-dom.test.js`

**Interfaces:**
- Consumes: Tasks 1, 2 and 4. `boot(win, host)` takes `host.attachments`, which defaults to
  `startAttachments({call, store})`.
- Produces, in `app.js`:
  - `filesOf(key)` and `setFiles(files, key = draftKey(s))`; `setRuns` keeps the files under its
    key; a key's entry is deleted only when its runs and files are both empty;
  - `addFiles(list, key)`: every `File` becomes a `Picked` (`key: 'a<n>'` from a counter, `name`,
    `bytes: size`, `mediaType: type`, `blob`) and goes through `admit` with
    `attachments.limits()`. An admitted image gets `url = win.URL.createObjectURL(blob)`. The
    refusal, if any, is the key's note. On a conversation (the key is its id), each admitted file
    starts uploading at once; on New message they stay `ready` (D10). Then `render()`;
  - `startUpload(key, fileKey)`: the record turns `uploading`, `loaded: 0`;
    `attachments.upload(id, record, onProgress)`; a progress tick sets `loaded` and calls
    `drawFiles()` only while `key` is the draft on screen; the answer sets `up`, `receiptId` and
    `sessionId`, a refusal `failed`, then `render()`. Every landing first finds the record under
    its own key by `fileKey`; a record removed meanwhile takes nothing (Review Focus 4);
  - `drawFiles()` writes `filesRail(filesOf(draftKey(s)))` into `#composer-files` and never calls
    `render()`;
  - `notes`: a `Map` from key to the line above the box, set by a refusal and cleared by the next
    add or remove under that key;
  - `render()` passes `{menu, files: filesOf(key), note: notes.get(key) ?? ''}` to
    `renderMessagesScreen`; when `s.dropping` and a composer is on screen, it appends
    `dropOverlay(attachments.limits())` to the page;
  - the first conversation `follow()` settles on calls `attachments.readLimits(id)` once.
  - `composer/dom.js`'s editor gains `pointAt(el, x, y) → caret units | null`, from
    `doc.caretPositionFromPoint` or `doc.caretRangeFromPoint`, null when neither exists or the
    point is outside `el`.
- **The actions:** `attachFiles` clicks `#attach-input`; its `change` calls `addFiles(el.files)`
  and clears `el.value`; `attachRemove` aborts an upload in flight, revokes an image's URL and
  drops the record; `attachRetry` starts the upload again.
- **Paste on `#say`:** with `clipboardData.files` not empty, `preventDefault`, `addFiles` and no
  text inserted; otherwise plan 3's plain-text paste.
- **Drag and drop**, one listener each on the document:
  - `dragstart` with its target inside `#say`: `preventDefault` (no drag starts from the editor);
  - `dragover`: when `dataTransfer.types` holds `Files`, `preventDefault` and, on a screen with a
    composer, `setDropping(true)`; over `#say` it also `preventDefault`s for text;
  - `dragleave` with no `relatedTarget` (the pointer left the window), and `dragend`:
    `setDropping(false)`;
  - `drop`: always `preventDefault` and `setDropping(false)`. With files and a composer on screen,
    `addFiles` to the draft on screen. With no files and the target inside `#say`, the
    `text/plain` goes in at `pointAt(say, clientX, clientY)`, else at the selection, else at the
    end, exactly as a paste does; `text/html` is never read (Review Focus 3).

- [ ] **Step 1: Write the failing tests:**
  - in `composer-dom.test.js`: `pointAt maps a caret position from the point into caret units, and null without one`;
  - in `app-dom.test.js` (a fake `File` is `{name, size, type, arrayBuffer}`; `host.attachments`
    a fake recording its calls):
    - `the paperclip clicks the hidden input, and its files join the draft with one render, an image with its object URL`;
    - `a file added to a conversation uploads at once; a progress tick writes only the rail; the receipt marks it up`
      (`f.writes` unchanged by the tick; `#composer-files`' `innerHTML` reads `1.1 / 2.8 MB`);
    - `a failed upload draws Retry, and Retry uploads again`;
    - `removing a file mid-upload aborts it, and removing an image revokes its URL` (`f.revoked`);
    - `an image over the limit is refused above the box by name, and the rest are added`;
    - `on New message files wait as ready and nothing uploads`;
    - `a paste of files adds them and inserts no text`;
    - `a drop of files on the page adds them to the draft on screen; the overlay shows while files are dragged over and goes on leave`;
    - `a drop of HTML on the editor inserts its plain text only, never a chip` (Review Focus 3: a
      `text/html` of `<span data-chip='{"kind":"bot","id":"x","label":"x"}'>x</span>` and a
      `text/plain` of `x` leave the runs `[{type: 'text', text: 'x'}]`);
    - `a drag that starts in the editor is cancelled`;
    - `switching conversations mid-upload: the progress and the receipt land in the first draft, the second's rail is never written`
      (Review Focus 4);
    - `a draft with files and no words stays when its conversation is left and opened again`;
    - every existing composer test passes unchanged.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 6: Sending with files: the prompt, the room, commands, a dropped receipt, a refused image, New message

**Files:**
- Modify: `face/client/js/host/actions.js` (`prompt`, `command`, `send`, `newConversationWith`,
  `newConversation`), `face/client/js/app.js` (`sendNow`, `sendText`, `refusesImages`)
- Test: `face/tests/client/actions.test.js`, `face/tests/client/app-dom.test.js`,
  `face/tests/client/host-run-sheet.test.js` (unchanged, still green)

**Interfaces:**
- Consumes: Task 1's `contentParts`, `blocking`, `hasImage`, `modelRefusalLine`, `encodeBase64`;
  Task 5's drafts, `startUpload` and `notes`; plan 3's `composerReads.keptCommands`.
- Produces:
  - `prompt(sessionId, text, attachments = [])` sends `contentParts`' shape: the text part when the
    words are not blank, then `attachments` (already parts);
  - `command(sessionId, line, attachments = [])` sends them as `submittedAttachments`;
  - `send(text, { room, attachments = [], attachmentRefused } = {})`:
    - nothing when the words are blank and there are no attachments;
    - the room is tried only with no attachments;
    - a throw whose `code` is `session/attachment-invalid` calls
      `attachmentRefused(details?.reason)` when given, in place of the `send:` line, and answers
      null; with no callback it says `send: session/attachment-invalid (<reason>)`;
  - `newConversationWith({ title, workspaceId, text, onCreated, prepare, attachmentRefused }) →
    {id: string | null, sent: boolean}`: create, rename when titled, `onCreated(id)`, then
    `prepare(id) → parts | null` (null: the files did not go up; `sent: false`), then the prompt
    with the parts. A failure after the create answers `{id, sent: false}`;
  - `newConversation({title, workspaceId, text})` keeps its contract (`id` or null) as
    `newConversationWith`'s wrapper, so the Run sheet (`host/run-sheet.js`) is unchanged.
- **`sendNow`**, in this order, each refusal keeping the whole draft:
  1. nothing when the runs are blank and there are no files;
  2. files with a bot chip (D20): `Files go to Gravit, not to a room's bots`. With files and no
     bot chip, `room` is false, a typed `@word` included;
  3. plan 3's O9 refusal, unchanged;
  4. `blocking(files)`: `Files are still uploading`, or `A file did not upload. Retry it or remove
     it.`;
  5. an image in a conversation in `refusesImages`: the model line above the box (D19), no call;
  6. a `/` line with files: the kept command row whose `name` is the line's first word after `/`;
     a row found whose `input?.attachments !== true` refuses with `/<name> takes no files` (D12);
     an unknown name goes to the host;
  7. the images' base64 is read (`blob.arrayBuffer()`, `encodeBase64`) before the draft is
     cleared; then the draft clears and the parts go with `sendText`.
- **`attachmentRefused(reason)`:**
  - `MODEL_DOES_NOT_SUPPORT_IMAGES`: the draft comes back, its conversation joins
    `refusesImages` (until a reload), and the key's note is `modelRefusalLine(name)`, the name
    being the bot's for a bot's own conversation;
  - `FILE_NOT_STAGED`, the first time for this send: the draft comes back, every `up` file turns
    `ready` and uploads again, and once all are up the send runs once more (D18). The second
    time, or a failed re-upload: the draft stays and the status line says
    `send: session/attachment-invalid (FILE_NOT_STAGED)` (Review Focus 1);
  - any other reason: the draft comes back and the line says it.
- **An image added** to a conversation in `refusesImages` sets the model line at once (D19).
- **New message:** `onCreated(id)` moves the draft from `new` to `id` (runs, files, note);
  `prepare(id)` uploads the files there and awaits them; then the prompt. When `sent` is false
  with an `id`, the page refreshes the list, opens the conversation with its draft and note, and
  follows it (Review Focus 2); with no `id`, the draft is back under `new`, as today.
- On a successful send every image URL of the sent draft is revoked.

- [ ] **Step 1: Write the failing tests:**
  - in `actions.test.js`:
    - `a prompt with attachments sends the text part, then the parts in order; an image-only prompt sends no text part`;
    - `a slash line with attachments sends them as submittedAttachments`;
    - `with attachments the room is never tried, even for a line with @`;
    - `an attachment refusal goes to attachmentRefused with its reason and says nothing else`;
    - `newConversationWith creates, reports the id, prepares and prompts; a refused prompt answers the id with sent false`;
    - `newConversation still answers an id or null` (the Run sheet's contract);
  - in `app-dom.test.js`:
    - `a draft with a file sends its receipt and its words, and the draft clears`;
    - `an image goes inline as base64 with its media type and name`;
    - `files with a bot chip are refused before sending, and a typed @word with files goes to Gravit as a prompt`;
    - `a send while a file uploads is refused, and one with a failed file says Retry it or remove it`;
    - `/compact with a file is refused as taking no files; /goal, whose input takes attachments, sends them`;
    - `a refused image keeps the draft, draws the model line, and the next image there shows it at once with no call`;
    - `in a bot's conversation the model line names the bot`;
    - `a dropped receipt uploads again once and sends; a second drop keeps the draft and says so` (Review Focus 1);
    - `New message with a file creates, uploads to the new conversation, then prompts`;
    - `New message refused for its image opens the created conversation with the whole draft and the line` (Review Focus 2);
    - `a sent draft revokes its images' URLs`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test` and `npm run typecheck`.
- [ ] **Step 5: Commit.**

### Task 7: Thumbnails and the lightbox in the page

**Files:**
- Modify: `face/client/js/app.js` (thumbnails after a render, `openImage`, `lightboxClose`,
  `lightboxKeep`, the Escape order, the lightbox in `render()`),
  `face/client/js/reducers/controls.js` (`openLightbox`, `closeLightbox`),
  `face/client/js/data/empty.js` (`lightbox: null`)
- Test: `face/tests/client/app-dom.test.js`, `face/tests/client/reducers.test.js`

**Interfaces:**
- Consumes: Task 3's `thumbsNeeded` and `hostThumb`; Task 4's `attachments.thumb`; Task 2's
  `lightboxHtml`.
- Produces:
  - after every render that drew a conversation, `thumbsNeeded(conv, s.thumbs)` is asked of
    `attachments.thumb(conv.id, attachmentId)` (each id once: `thumb` keeps its own in-flight set);
    the answer's `hostThumb` renders through the store;
  - `openLightbox {attachmentId, name}` and `closeLightbox`; `render()` appends
    `lightboxHtml({src: s.thumbs[attachmentId], name})` to the page while `s.lightbox` stands and
    its thumb is a `data:` URL;
  - `openImage` dispatches `openLightbox` from the key's `data-attachment` and `data-name`;
    `lightboxClose` closes; `lightboxKeep` does nothing;
  - Escape: after an open menu and before the search box, an open lightbox closes (D34). Leaving
    the conversation closes it.

- [ ] **Step 1: Write the failing tests:**
  - in `reducers.test.js`: `the lightbox opens on an attachment and closes`;
  - in `app-dom.test.js`:
    - `a conversation with an image reads its thumb once and draws it when it lands`;
    - `an image that cannot be read draws its card, and is not asked again`;
    - `a click on a thumb opens the lightbox; a click on the image keeps it; the backdrop and × close it`;
    - `Esc closes the lightbox before Details, and a menu before the lightbox`;
    - `leaving the conversation closes the lightbox`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass,** then `npm test`.
- [ ] **Step 5: Commit.**

### Task 8: PDFs: the role, its mirror, the `GRAVIT.md` paragraph, Poppler in the agent box

**Files:**
- Create: `roles/pdf-page-reader/ROLE.md`, `roles/pdf-page-reader/role.yml`
- Modify: `bots/gravit/agent.cordis.yml` (regenerated, never by hand), `GRAVIT.md`,
  `face/Dockerfile`
- Test: `face/tests/roles.test.ts`, `face/tests/bot-presets.test.ts`,
  `face/tests/gravit-md.test.ts`, `face/tests/compose.test.ts`, `face/tests/bots-smoke.test.ts`
  (gated; run in Task 9)

**Interfaces:**
- Produces: the tool `role_pdf_page_reader`, the preset `role-pdf-page-reader`, the row
  `role-pdf-page-reader` in Gravit's composition.
- **`role.yml`**, exactly:

```yaml
# roles/pdf-page-reader/role.yml - the PDF page reader (dsh UI port spec §5.6, O8): page images in, their text out.
name: PDF page reader
description: Reads page images Gravit rendered from a PDF with pdftoppm and returns their tables, figures and layout as text, quoting what it reads and naming what it cannot read; the brief gives the PNG paths and the question.
allow:
  - read_image
model: deepseek-official/deepseek-flash
```

- **`ROLE.md`** (English; the library's other personas are the Lunhui modules' Chinese, and this
  role is not one of them), exactly:

```markdown
You are the PDF page reader, a one-shot role on Gravit's team. Gravit hands you the paths of page images rendered from a PDF and a question about them; you see nothing else of its conversation. Read each image once with `read_image` and answer from what the images show, nothing else.

Transcribe what the question needs: a table as a Markdown table with its header, units and footnotes as printed; a chart by its title, axes, series and the values its labels print; a multi-column page in reading order. Quote figures exactly as printed, and Chinese as Chinese. Never estimate a value no label prints and never fill a cell you cannot read: write `[unreadable]` there and say why under limits.

Report, under exactly these four headings: **status** (`done` or `blocked`, one line of why; an image that would not read is `blocked`); **pages** (each path read and what it shows); **transcription** (the tables, figures and text asked for); **limits** (what you could not read or could not tell). Keep it under 6,000 characters.
```

- **`GRAVIT.md`** gains, before `## Tests`, exactly (4,168 bytes today; 4,462 after):

```markdown
## PDFs

A PDF: `pdftotext -layout -f A -l B <file> -` for its text (`pdfinfo` for its pages); render a
page whose layout matters (a table, a chart, a scan) with `pdftoppm -png -r 110 -f N -l N <file>
"${TMPDIR:-/tmp}/<name>"`, never into the tree, and hand the PNG to `role_pdf_page_reader`.
```

  `${TMPDIR:-/tmp}` holds in both worlds: the Mac's sandbox grants `$TMPDIR`, and the agent box
  sets none.
- **`face/Dockerfile`** gains, after `FROM`, one layer:
  `RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*`,
  and its header comment names Poppler as Gravit's PDF tool.

- [ ] **Step 1: Write the failing tests:**
  - in `roles.test.ts`, the shipped-library test becomes four roles:
    `["cn-market-analyst", "cn-reviewer", "cn-stock-analyst", "pdf-page-reader"]`; the fourth's
    tool is `role_pdf_page_reader`, its `name` `PDF page reader`, its `allow` exactly
    `["read_image"]`, its model `deepseek-official/deepseek-flash`; the mirror carries four
    `- id: role-` rows, `tool: role_pdf_page_reader`, and four flash routes; the Lunhui-only
    assertions (no freeze, no `lunhui_present`, the analysts' and reviewer's overlaps) stay on the
    three Lunhui roles;
  - `pdf-page-reader's ROLE.md: English, within 2,000 bytes, read_image once, [unreadable] for what it cannot read, the four headings`;
  - in `bot-presets.test.ts`, the shipped roles and Gravit's role rows name the fourth;
  - in `bots-smoke.test.ts` (gated), the roster lists `role-pdf-page-reader` whole and Gravit's
    `role_*` tools are the four;
  - in `gravit-md.test.ts`: `GRAVIT.md reads a PDF with Poppler and hands a layout page to a shipped role`:
    it holds `pdftotext -layout`, `pdftoppm -png` and `${TMPDIR:-/tmp}`, and every `role_*` it
    names is a tool of `readRoles(ROLES_ROOT)`; the budget test still holds;
  - in `compose.test.ts`: `the agent image installs poppler-utils from the distribution, in one layer that cleans its lists`.
- [ ] **Step 2: Run them and see them fail.** Run
  `npx tsx --test tests/roles.test.ts tests/bot-presets.test.ts tests/gravit-md.test.ts tests/compose.test.ts`
  in `face/`. Expected: FAIL.
- [ ] **Step 3: Write the two role files, the `GRAVIT.md` paragraph and the Dockerfile layer.**
- [ ] **Step 4: Regenerate the mirror.** Run `npm run render:roles` in `face/`. Expected:
  `bots/gravit/agent.cordis.yml` gains one `role-pdf-page-reader` row and one line in the
  `gravit` row's `roles`; `git diff --stat` shows nothing else in it.
- [ ] **Step 5: Run them and see them pass,** then `wc -c ../GRAVIT.md` (Expected: `4462`),
  `npm test` and `npm run typecheck`.
- [ ] **Step 6: Sweep for the old count.** Run
  `grep -rn "three roles\|cn-stock-analyst\"\]" tests src plugins scripts` in `face/` and fix each
  test or comment that still says the library is three roles; the gated smokes are run in Task 9.
- [ ] **Step 7: Commit.**

### Task 9: The smokes on a real boot

**Files:**
- Modify: `face/tests/dsh-ui-port-smoke.test.ts` (its `before`, five tests)

**Interfaces:**
- Consumes: the file's `open`, `rpc`, `rpcResult`, `agentOf` and `turn`; `StubAdapter`
  (`tests/stub-llm.ts`); Task 1's `contentParts` imported from the browser module.
- `before()` registers a second adapter for the provider `stub-see`: a subclass of
  `StubAdapter` in this file whose `listModels` and `resolveModel` declare `["text", "image"]`.
  `PNG_1PX` is a constant: a valid 1 × 1 PNG in base64.

- [ ] **Step 1: Write the five tests:**
  - `the image limits: session/projections on a cold session carries imageLimits`
    (`maxImagesPerMessage` 20, `maxImageBytes` 20971520, the four media types);
  - `an image to a text-only model is refused before admission: session/attachment-invalid, reason MODEL_DOES_NOT_SUPPORT_IMAGES`
    (through `rpcResult`, reading `error.details.reason`);
  - `a receipt the session never staged is refused with FILE_NOT_STAGED`;
  - `an image on an image route: accepted, logged as an image block, and session/attachment gives its bytes back`:
    the session moves to `{provider: 'stub-see', model: 'echo'}` with `session/selectModel` (the
    builder reads the request's shape in the installed `dsh-api-session-controller`); the prompt
    is `contentParts('look', [image], () => PNG_1PX)`; the stored `user/message` holds an `image`
    block with an `attachmentId`; `session/attachment {request: {sessionId, attachmentId}}`
    answers `data` that decodes to a PNG;
  - `the PDF role is up: role-pdf-page-reader is listed whole, and read_image is among the host's tools`.
- [ ] **Step 2: Run them.** Run `FACE_SMOKE=1 npx tsx --test tests/dsh-ui-port-smoke.test.ts` in
  `face/`, from this checkout (outside `/tmp`). Expected: the file's sixteen tests pass. If the
  image-route test cannot reach `stub-see` through `session/selectModel`, stop and report: the
  thumbnails' wire form is then pinned only by the keyed drill.
- [ ] **Step 3: Run the gated suite.** Run `FACE_SMOKE=1 npm test` in `face/`. Expected: 0 fail,
  `bots-smoke` with the fourth role included.
- [ ] **Step 4: Commit.**

### Task 10: The documents and the build notes

**Files:**
- Modify:
  - `DEVELOPMENT.md`: §3.3 (the PDF paragraph and the new byte count), §3.8 (four roles; the
    fourth's allow, route and persona), §5.1 (`composer/files.js`, `host/attachments.js`), §5.2
    (the upload route, the content parts, `session/projections`' `imageLimits`,
    `session/attachment`, the two refusal reasons), §5.3 (`startAttachments`), §5.4 (the rail, the
    note, the overlay, the lightbox, the `you` message's attachments), §5.5 (`{runs, files}`
    outside the store, `refusesImages`, the `thumbs`, `lightbox` and `dropping` slices), §5.6, §7.3
    (the tests), §7.4 (the drills);
  - `face/README.md`: "The page (client/)" (attachments), "Roles" (the fourth role), "The two-box
    drill" (`poppler-utils` in the agent box: `docker compose run --rm agent pdftotext -v`),
    "Run" (Poppler on the Mac: `brew install poppler`; the service runs with the PATH it was
    installed with, so `/opt/homebrew/bin` must have been on it), and the dsh UI port drill's
    attachment steps from spec §7: a CSV that Gravit reads from its saved copy; an image refused
    on deepseek-v4-pro with the line; the same image in a scratch bot's conversation on
    deepseek-flash, accepted and drawn; a broker report's PDF asked about its text (Gravit runs
    `pdftotext`) and then about a table on one page (Gravit runs `pdftoppm` and calls
    `role_pdf_page_reader`, which reads the PNG); and, in the operator's browser, a file dropped on
    the editor, a drag of a chip refused, a lightbox closed by Esc. The role drill gains the
    fourth role;
  - `CLAUDE.md`: the `roles/` line names four roles, `pdf-page-reader` among them;
  - `Gravit-Docs-and-Prompt-Loops.html`: loop 1 gains the image and file parts and the saved
    copy's line; the `gravit:roles` section gains its bullet;
  - `ROADMAP.md`: the built log;
  - the spec: `## 16. Build notes, plan 4`, in the §13–§15 form, with the rows of "Where the code
    differs" above among its clauses, and §9's items 1 and 3 left for the keyed drill.
- [ ] **Step 1: Write the documents.** The counts come from a fresh `npm test` and
  `FACE_SMOKE=1 npm test`, run in `face/`.
- [ ] **Step 2: Commit.**
