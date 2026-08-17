# Dev constraints

Working preferences for this repo. Keep in mind on every change.

## Comments

- **Comment sparingly.** Prefer code that reads clearly on its own over prose
  explaining it. Good names and structure beat a comment.
- Only comment what the code genuinely cannot say: a non-obvious *why*, a
  load-bearing constraint, a subtle gotcha.
- Do **not** narrate *what* the code does, restate the line below, or annotate
  every field/branch. No paragraph-length rationale blocks on routine code.
- One short line where it earns its place; otherwise none.

# Commit rules

When Claude finishes a task in this repo, it should create a git commit for the change (unless the user says otherwise). Follow these conventions.

## Format

```
<type>(<optional scope>): <short imperative summary>

<optional body — why, not what>
```

- Summary in the imperative mood ("add", "fix", "rename" — not "added", "adds").
- Lowercase after the type prefix. No trailing period in the summary.
- Keep the summary under ~72 characters. Details go in the body.
- Body explains **why** the change was made when it's not obvious from the diff. Skip it for trivial changes.

## Allowed types

| Type       | When to use it |
|------------|----------------|
| `feat`     | A new user-visible feature or capability (new endpoint, new phase, new config option). |
| `fix`      | A bug fix — behavior was wrong, now it's right. |
| `refactor` | Internal restructuring with no behavior change (rename, extract, move, split). |
| `chore`    | Repo housekeeping that isn't code behavior: deps bumps, gitignore, tooling config, cleanup of dead files. |
| `docs`     | Documentation only: README, `.claude/rules/*.md`, docstrings, comments. |
| `test`     | Adding or updating tests, with no production-code change. |
| `perf`     | A change whose point is measurable performance improvement. |
| `style`    | Formatting, whitespace, import order — no code meaning change. |
| `build`    | Build system, Dockerfile, requirements pinning, CI config affecting the build. |
| `ci`       | CI pipeline configuration only. |
| `revert`   | Reverts a previous commit. Reference the reverted SHA in the body. |

Pick the type by the **primary** intent of the change. If a commit is doing two things (e.g. a feat plus a refactor), that's usually a sign it should be split into two commits.

## Scope (optional)

Use a scope when it meaningfully narrows the change and matches how this repo is organized: `feat(server): ...`, `refactor(core): ...`, `fix(target_factory): ...`, `docs(claude): ...`. Skip it if it adds no signal.

## When not to commit

- The user asked for exploration, explanation, or a plan only — no code change was intended.
- The change is broken or half-finished (tests failing, obvious TODO left in the middle).
- The working tree has unrelated uncommitted changes from the user — ask before bundling them in.

## Process

1. `git status` + `git diff` to confirm what's staged/unstaged and that nothing unrelated sneaks in.
2. Stage the specific files for this task (avoid `git add -A` / `git add .`).
3. Commit with a message following the format above, via a HEREDOC to preserve formatting.
4. `git status` after to confirm the commit landed clean.

Never `git push`, `--amend`, `--no-verify`, or force-push unless the user explicitly asks.

