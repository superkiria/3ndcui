# Project guide for coding agents

## Purpose

This is a Russian language, browser only prototype for demonstrating shard master operations to an operations team. It does not connect to a database. Keep the interface focused on the demo workflows; do not imply that simulated actions change real infrastructure.

## Where to work

- `src/model.ts`: demo topology, scenarios, search, eligibility, replica controls, and master moves. Keep business rules here.
- `src/main.tsx`: React state, the UI, operation timing, and in-session history.
- `src/styles.css`: presentation and responsive layout.
- `README.md`: current product behavior, setup, and verification notes. Update it when behavior changes.
- `run.sh`: local development launcher. It can use a temporary Node.js installation in this environment.

## Current behavior to preserve

- There are 12 groups (`G01`–`G12`), with one instance per data center and exactly one master per group. The initial 36 instances have four masters in each data center.
- Odd-numbered groups are asynchronous; their replicas can have replication enabled or disabled. A disabled replica cannot become master. Even-numbered groups are synchronous.
- A planned switchover requires an available current master and an available target replica with replication enabled and lag at most 1000 ms. Failed preliminary checks leave roles unchanged. Only one timed operation runs at once.
- Bulk relocation checks every group before moving any master. A blocked target leaves all groups unchanged. Groups already mastered in the destination stay as they are.
- Demo scenarios replace the dataset and clear history. Reset also clears search, the problem filter, the simulated failure toggle, and the open panel. State and history live only in browser memory.
- The summary covers all groups even when the table is filtered. Search accepts a group ID fragment or an exact instance number.

## Working and verification

- Use Node.js 22.12+ (or 24 LTS) and npm. Run `npm install` once, then `npm run dev`. `./run.sh` also starts the app and installs dependencies if needed.
- Run `npm run build` after TypeScript or UI changes. Check the relevant interaction in a browser when possible.
- Keep visible product text in Russian. Prefer simple React state and plain CSS; no backend or persistence is part of this prototype.
- Treat `README.md` and the running code as the current product description. If they disagree, verify behavior in code and update the README in the same change.
