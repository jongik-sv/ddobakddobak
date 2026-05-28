# Frontend Refactor Loop — Exit Criteria

Goal (session `/goal`): "frontend 리펙토링이 완전해질때까지 반복".

## Baseline (2026-05-28, branch feat/per-server-persistent-login)

- Production build (`vite build`): **GREEN** ✓
- `tsc -b` (includes tests): 26 errors in 14 files — **ALL pre-existing in files NOT touched by this branch** (useDeepLink Tauri plugin types, pdfExporter html2pdf option, meetingStore/MeetingLivePage/AudioRecorder test type drift). Out of scope — documented in memory `project_known_test_gaps.md`.
- `eslint src`: 39 errors / 6 warnings — mostly pre-existing (mermaidBlock rules-of-hooks, AiSummaryPanel any, test files). Build-artifact noise (`src-tauri/target`) inflates `eslint .` to 2600+ files.
- Refactor campaign already landed: GlobalSettingsTab -747, MeetingsPage -509, MeetingLivePage -440, UserManagementPanel, ServerSetup, Dialog primitive, ConfirmDialog, etc.

## Remaining oversized pages (campaign incomplete)

| File | LOC | Target |
|------|-----|--------|
| src/pages/MeetingLivePage.tsx | 993 | ≤ 500 |
| src/pages/MeetingsPage.tsx | 744 | ≤ 500 |
| src/pages/MeetingPage.tsx | 686 | ≤ 500 |

## Exit criteria (definition of "complete")

1. The 3 pages above each ≤ 500 LOC via extraction (hooks/sub-components), matching existing pattern.
2. `vite build` stays GREEN.
3. No NEW `tsc -b` errors beyond the 26 pre-existing.
4. No NEW eslint errors in `src` beyond pre-existing.
5. No NEW vitest failures beyond pre-existing.
6. eslint config ignores build artifacts (`src-tauri/target`, `src-tauri/gen`).

## Out of scope (do NOT touch)

- Pre-existing TSC test errors / lint debt unrelated to decomposition.
- backend/, sidecar/, migrate_pending/.
- No commits without explicit user approval (`feedback_no_auto_commit`).

## Verify after EACH file (per feedback_full_compile_verify)

`npx vite build && npx tsc -b 2>&1 | tail -3 && npx vitest run 2>&1 | tail -5`
plus full-repo grep for any removed symbol.

## RESULT (2026-05-28) — COMPLETE

| File | Before | After | Extracted into |
|------|--------|-------|----------------|
| MeetingLivePage.tsx | 993 | 496 | useLiveRecording.ts, useLiveMobileTabs.tsx, LiveStatusBar.tsx |
| MeetingsPage.tsx | 744 | 473 | MeetingCardGrid, MeetingListTable, MeetingsHeader, lib/meetingFormat |
| MeetingPage.tsx | 686 | 496 | MeetingActionHeader, MeetingDetailTopBar, meetingDetailTabs |

- `vite build`: GREEN ✓
- `tsc -b`: 26 errors — unchanged from baseline (all pre-existing in untouched test/util files; NONE in refactored files).
- `eslint src`: 39 errors / 5 warnings — errors unchanged (pre-existing), warnings -1 (resolved a missing-deps warning).
- Per-page tests: MeetingLivePage 16 pass / 2 fail (baseline preserved — fails are pre-existing mobile useMeetingAccess), MeetingsPage 36/36, MeetingPage 18/18.
- Full suite: 770 pass / 23 fail — all 23 failures in untouched modules (auth, audioPlayer, dragState, setupGate, mediaQuery, transcription, touchTarget) = pre-existing.
- eslint config: build artifacts (`src-tauri/target`, `src-tauri/gen`) now ignored.

No commits made (awaiting user approval per feedback_no_auto_commit).
