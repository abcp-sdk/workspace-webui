# agent-webui

Agent chat SPA over `agent.v1.AgentService` (Connect). **Svelte 5 (runes) +
shadcn-svelte style components (bits-ui primitives) + lucide icons + Tailwind
v4**, with the **sqlite-wasm (OPFS)** local mirror and a **PWA** (installable,
offline shell).

Full parity with the former Flutter client: setup gate + user manager, session
list (search / multi-select / unread / live watchSessions), chat (local-first
sync, streaming bubbles with reasoning + tool cards, drafts, attachments,
voice), mailbox, config (appearance / users / providers + gateway + models /
presets / tools) and zh-en i18n.

## Connection model (same-origin)

The webui is served **same-origin with the agent**: an aggregating proxy (Caddy)
in front forwards `/agent.v1.*` to the agent over h2c, and `/` serves this SPA.
So the API base is always the page's own origin and the user enters **only a
tenant token** — no backend/gateway URL. (Local dev can still override with
`?base=`.)

## Run

```bash
npm install
npm run dev        # vite dev server
npm run build      # PWA production build -> dist/
npm run check      # svelte-check + tsc
```

## Deploy

Built as a static image (nginx) and fronted by the aggregating Caddy that also
reverse-proxies the agent. OPFS needs a secure context (https).

## Layout

```
src/
├── App.svelte            # setup gate + backends manager + root
├── lib/
│   ├── components/ui/    # shadcn-style primitives (button/dialog/select/…)
│   ├── components/       # MessageBubble, ToolPartView, MediaAttachment, SessionRow
│   ├── pages/            # Chat, SessionList, Config, Mailbox, providers/*
│   ├── api.ts            # AgentApi facade over @abcp/agent-sdk
│   ├── store.svelte.ts   # sessions / drafts / nav stacks
│   ├── messages.svelte.ts# streaming controller
│   ├── db.ts             # sqlite-wasm (OPFS) mirror
│   ├── i18n.svelte.ts    # zh/en (generated from the Flutter arb)
│   └── voice.ts          # MediaRecorder
└── main.ts               # mount + PWA service worker
```
