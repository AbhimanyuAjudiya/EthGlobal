# Build-environment constraints (cloud session, 2026-11-02)

The session runs in a sandboxed cloud container whose network policy allows package registries and GitHub, but **denies most other hosts**. Verified with `curl` on 2026-11-02:

| Capability | Status | Consequence |
|---|---|---|
| npm registry, PyPI, crates.io | ✅ reachable | All JS/TS/Python dependencies install normally |
| github.com (git clone, release downloads), raw.githubusercontent.com | ✅ reachable | Foundry + static solc installed from GitHub releases |
| `ethglobal.com` | ❌ 403 | Prize page reconstructed from search snippets (see `research/sponsors.md`) |
| `binaries.soliditylang.org` | ❌ blocked | `forge` cannot auto-download solc → static binaries pre-seeded in `~/.svm/<ver>/solc-<ver>` |
| **Every sponsor testnet RPC** (Unichain Sepolia, Arc, 0G Galileo, Hedera Hashio, World Chain Sepolia, Whitechain Sepolia, Base, Sepolia public nodes) | ❌ 403 | **No testnet deploys or live-chain reads from this container.** All chain work runs on local Anvil (chain id 31337) with deterministic deploy scripts; the user runs the same scripts against testnets from their machine |
| Sponsor HTTP APIs (0G compute, Arkiv, World ID verifier, Hedera facilitators, Polymarket, DefiLlama, CoinGecko, Pinata) | ❌ blocked | Adapters are implemented against the real API contracts with **recorded-fixture / local-mock transports** selectable by env var; live mode is a config switch, not a code change |
| Docker Hub / GHCR | ⚠️ 401 (anonymous challenge; pulls untested) | Not relied upon |
| Web search (tool) | ✅ | Used for all research |

## What this means for the build
1. **Local-first architecture.** Every module must run end-to-end on `anvil` + local services with zero external calls (`MODE=local`). This is also what makes the red-team and audit reproducible.
2. **Live adapters are real code, not stubs.** Each external integration has one adapter module implementing the documented API; `MODE=live` points it at real endpoints and keys. The adapters are unit-tested against recorded fixtures.
3. **Deploy scripts are chain-agnostic** (`forge script … --rpc-url $RPC`) and read chain config from `deploy/chains.json` (chain ids and RPCs for Unichain Sepolia 1301, Arc Testnet 5042002, 0G Galileo 16602, Hedera Testnet 296, World Chain Sepolia 4801, Whitechain Sepolia 1874).
4. **To unblock live deploys from this environment**, the environment owner can edit the cloud environment's *Network access* (title-bar environment menu → Edit) to a broader level or add the RPC/API hosts above under *Allowed domains*. Docs: https://code.claude.com/docs/en/cloud-environments#network-access

## Verified toolchain (2026-11-02)
- Foundry 1.5.1 (`forge`, `anvil`, `cast`, `chisel`) from GitHub release; solc 0.8.26 / 0.8.28 / 0.8.30 static binaries seeded in `~/.svm` so `forge build` works with `offline = true`.
- Node 22 / pnpm 10 / bun 1.4; Python 3.13; slither 0.11.6; jscpd 4.3 (duplication); Playwright 1.63 + Chromium 1243; ffmpeg 6.1.
- Remotion 4 renders programmatic video in this sandbox when pointed at the preinstalled browser: `--browser-executable /opt/pw-browsers/chromium-1243/chrome-linux64/chrome` (test render: 1080×1920 H.264, OK).
- Dependency clones cached outside the repo: OpenZeppelin 5.7, Uniswap v4-core / v4-periphery / v4-template.
