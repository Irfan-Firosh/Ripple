
## 2026-10-04 — Overwrote another agent's untracked files
- **Mistake:** wrote `frontend/src/lab/LabPage.tsx`, `LabDock.tsx`, `LabComposer.tsx` with the Write tool while another agent (Codex) had untracked versions there; they were lost (untracked = not in git).
- **Rule:** before creating any file, run `git status --short <dir>` and `ls <dir>`; if the path exists (tracked or untracked) and I didn't author it this session, read it and stop to ask. Treat a "file updated" result on a supposedly new file as an incident: stop immediately.
- **Rule:** when the user hands work to another tool (e.g. a Codex prompt), assume that tool may be editing the same folder concurrently; keep out of its files.
