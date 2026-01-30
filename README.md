# VibeBot — AI-Powered Personal Assistant

<p align="center">
  <strong>Built with Claude Code + Opus 4.5</strong>
</p>

<p align="center">
  <a href="https://github.com/XtraSaltyDev/VibeBot/actions"><img src="https://img.shields.io/github/actions/workflow/status/XtraSaltyDev/VibeBot/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="https://github.com/XtraSaltyDev/VibeBot/releases"><img src="https://img.shields.io/github/v/release/XtraSaltyDev/VibeBot?include_prereleases&style=for-the-badge" alt="GitHub release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

**VibeBot** is an enhanced fork of [OpenClaw](https://github.com/moltbot/moltbot) (formerly ClawdBot), rebuilt and improved using **Claude Code** and **Anthropic's Opus 4.5** model.

It's a *personal AI assistant* that runs on your own devices, answering you on the channels you already use — WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Microsoft Teams, WebChat, and more. It can speak and listen on macOS/iOS/Android, and render a live Canvas you control.

## What Makes VibeBot Different

VibeBot takes the solid foundation of OpenClaw and enhances it with:

- **AI-Assisted Development**: Built using Claude Code and Opus 4.5 for cleaner, more maintainable code
- **Factory Pattern Architecture**: Reduced code duplication across channel adapters by ~20-25%
- **Improved Onboarding**: Declarative spec-based approach for channel configuration
- **Modern TypeScript Patterns**: Leveraging generics and type safety throughout

## Quick Start

Runtime: **Node ≥22**

```bash
# Install globally
npm install -g vibebot@latest
# or: pnpm add -g vibebot@latest

# Run the onboarding wizard
vibebot onboard --install-daemon

# Start the gateway
vibebot gateway --port 18789 --verbose

# Send a message
vibebot message send --to +1234567890 --message "Hello from VibeBot"

# Talk to the assistant
vibebot agent --message "What can you help me with?" --thinking high
```

## Features

### Core Platform
- **Local-first Gateway** — single control plane for sessions, channels, tools, and events
- **Multi-channel inbox** — WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage, Microsoft Teams, Matrix, WebChat
- **Multi-agent routing** — route inbound channels/accounts/peers to isolated agents
- **Voice Wake + Talk Mode** — always-on speech for macOS/iOS/Android
- **Live Canvas** — agent-driven visual workspace with A2UI
- **First-class tools** — browser, canvas, nodes, cron, sessions, and more

### Supported Channels
- **WhatsApp** — via Baileys (Web API)
- **Telegram** — via grammY
- **Slack** — via Bolt
- **Discord** — via discord.js
- **Google Chat** — via Chat API
- **Signal** — via signal-cli
- **iMessage** — via imsg (macOS only)
- **Microsoft Teams** — extension
- **Matrix** — extension
- **WebChat** — built-in web interface

### Apps & Nodes
- **macOS app**: Menu bar control, Voice Wake/PTT, Talk Mode overlay, WebChat
- **iOS node**: Canvas, Voice Wake, Talk Mode, camera, screen recording
- **Android node**: Canvas, Talk Mode, camera, screen recording

## Architecture

```
WhatsApp / Telegram / Slack / Discord / Signal / iMessage / Teams / WebChat
               │
               ▼
┌───────────────────────────────┐
│            Gateway            │
│       (control plane)         │
│     ws://127.0.0.1:18789      │
└──────────────┬────────────────┘
               │
               ├─ Pi agent (RPC)
               ├─ CLI (vibebot …)
               ├─ WebChat UI
               ├─ macOS app
               └─ iOS / Android nodes
```

## Development

### From Source

```bash
git clone https://github.com/XtraSaltyDev/VibeBot.git
cd VibeBot

pnpm install
pnpm build

# Run in development mode
pnpm dev

# Run tests
pnpm test
```

### Build Commands

- `pnpm build` — Type-check and build (tsc)
- `pnpm lint` — Lint with oxlint
- `pnpm format` — Format with oxfmt
- `pnpm test` — Run tests with vitest
- `pnpm test:coverage` — Run tests with coverage

## Configuration

Minimal config (`~/.vibebot/vibebot.json`):

```json5
{
  agent: {
    model: "anthropic/claude-opus-4-5"
  }
}
```

## Security

VibeBot connects to real messaging surfaces. Treat inbound DMs as **untrusted input**.

Default behavior:
- **DM pairing** (`dmPolicy="pairing"`): unknown senders receive a short pairing code
- Approve with: `vibebot pairing approve <channel> <code>`
- Public DMs require explicit opt-in: set `dmPolicy="open"` and include `"*"` in allowFrom

Run `vibebot doctor` to surface risky/misconfigured DM policies.

## Chat Commands

Send these in WhatsApp/Telegram/Slack/Discord/Signal/iMessage/Teams/WebChat:

- `/status` — compact session status
- `/new` or `/reset` — reset the session
- `/compact` — compact session context
- `/think <level>` — off|minimal|low|medium|high|xhigh
- `/verbose on|off`
- `/usage off|tokens|full` — per-response usage footer
- `/restart` — restart the gateway

## Credits

VibeBot is built on the shoulders of giants:

- **[OpenClaw/Moltbot](https://github.com/moltbot/moltbot)** — The original project by Peter Steinberger and the community
- **[Anthropic](https://www.anthropic.com/)** — Claude Code and Opus 4.5 powering development
- **[pi-mono](https://github.com/badlogic/pi-mono)** — Thanks to Mario Zechner

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

AI/vibe-coded PRs welcome!

## License

MIT License — see [LICENSE](LICENSE)
