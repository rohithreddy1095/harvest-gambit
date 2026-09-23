# Harvest Bench

A benchmark for AI coding agents on one long, open-ended, visual task: build a realistic world entirely from code,
film it, and put chess puzzles in it that people can play. It measures what short benchmarks miss:

- hours of autonomous work;
- visual judgement;
- checking one's own output;
- getting past real problems in a real environment.

The Harvest Gambit project in this repo is the reference solution to the public example task. It was made by Claude
with a person steering it, so it shows what the task looks like; it is not itself a scored run.

## How a run works

1. **The brief.** The agent gets `TASK.md`, made of three parts: the task (`tasks/<id>/task.md`), the deliverables
   contract (`CONTRACT.md`) and a note on its environment. Nobody answers questions.
2. **Build session** (4 hours by default). The agent works alone in the benchmark container.
3. **One scripted round of feedback** (2 hours). The same critique (`feedback.md`) goes to every agent, so improving
   on feedback is tested without a person in the loop.
4. **Automatic checks.** `check.mjs` builds the last commit in the container and runs pass/fail gates.
5. **Blind judging.** People compare submissions side by side without knowing which model made which, and
   `judge/rank.mjs` turns their votes into a ranking.

Scored runs use the hidden tasks in a separate private repo. The example task is public, and its reference solution
is public too, so results on it say little.

## The gates

| Gate | Passes when |
|---|---|
| `manifest` | `bench.json` exists and names the build, both pages, the puzzles and the soundtrack |
| `build` | `npm install` and the build command succeed from a clean copy of the last commit |
| `noMediaFiles` | no committed images, models, textures, audio or video outside `docs/`, and no embedded media data URIs |
| `puzzles` | every puzzle passes an exhaustive search: right side to move, no faster mate, exactly one working first move, a legal solution line ending in mate |
| `playPhone`, `playDesktop` | the play page loads at 390×844 and 1280×720 with no errors and draws something |
| `playThrough` | for every puzzle, through `window.__play`: it loads, an illegal move is refused, a wrong move is shown and taken back, and a correct line (whichever defence the page picks) ends in mate |
| `film` | the right length; frames not blank or frozen; the same `t` gives the same frame |
| `sound` | the soundtrack is the film's length and audible |
| `network` | the pages fetch no media, and scripts only from the allowed CDNs |
| `original` | with `--reference`, under 15% of the code matches a known project |

The checker also records measurements: time to load, milliseconds per frame, the scene counts from `__stats`,
loudness and lines of code. Runs also record how long each session took and the tokens and cost each CLI reports.

## Setup

```sh
npm install                                   # from the repo root
docker build -t harvest-bench bench/          # Chromium, ffmpeg, and the Claude Code, Codex and Gemini CLIs
```

Your user needs access to Docker (`sudo usermod -aG docker $USER`, then log in again).

Pin the agent versions when you publish results. For example:

```sh
docker build -t harvest-bench --build-arg CLAUDE_CODE=2.1.280 --build-arg CODEX=0.155.1 --build-arg GEMINI_CLI=0.60.0 bench/
```

**Credentials.** API keys in the environment are passed through: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GEMINI_API_KEY`. If a CLI is logged in on this machine instead, a copy of its credential file goes into that run's
container home. Each run's `home/` folder therefore holds credentials; delete it once the run is done.

## Run an agent

```sh
node bench/run.mjs --task bench/tasks/example-harvest --agent claude --model claude-opus-5-5
node bench/run.mjs --task bench/tasks/example-harvest --agent codex  --model <openai-model-id>
node bench/run.mjs --task bench/tasks/example-harvest --agent gemini --model <gemini-model-id>
```

Options:

- `--build-minutes` and `--feedback-minutes` change the budget.
- `--no-feedback` skips the second session.
- `--gpu` passes `/dev/dri` into the container.
- `--reference <dir>` turns on the copy check.

Results go to `bench/runs/<task>__<agent>__<model>__<time>/`:

- `workspace/`: the agent's project, with a commit at the end of each session.
- `logs/`: each CLI's event stream.
- `run.json`: timings, usage and the gate summary.
- `check/`: the full check results, film stills, a contact sheet and play screenshots.

Add `--video` to a check to also render the full 1080p film with its soundtrack for the judges.

Agent sessions are long and expensive. Run each model at least three times per task, and report the middle result
and the spread; single agentic runs vary a lot.

## Check any project

```sh
node bench/check.mjs --submission <project> --task bench/tasks/example-harvest --out bench/runs/<name> [--video]
```

`--trusted` builds on this machine instead of in the container. Use it only for code you trust, such as the reference.

## Judge

```sh
node bench/judge/serve.mjs --task <task-id>        # open http://localhost:8765 and share it with the judges
node bench/judge/rank.mjs --task <task-id>         # ranking from bench/judge/votes.jsonl
node bench/judge/rank.mjs --task <task-id> --criterion realism    # or film, play
```

Judges see two anonymous submissions for each pair: the film (or its contact sheet), the play page before and after
solving, and the phone layout. They pick the better one overall, and optionally for realism, film and play. Use
several judges, and let each judge every pair once.

## Keeping it fair

- **The same conditions for everyone:** the same image, brief, budget, feedback and checker for every agent.
- **Record the exact versions:** `run.json` stores the CLI versions from the image.
- **Hidden tasks:** retire a task once its results are published.
- **Blind judging:** judges never see run ids, and pairs are shown in random order and on random sides.
- **Agents stay out of this repo:** the brief tells them not to look for other submissions or copy existing projects,
  and `--reference` measures how much code they share with this one.

## What has been tested

As of 23 September 2026:

- **The checker:**
  - It passes the reference solution on all 10 gates, in 4 minutes on a 2012 laptop.
  - On a deliberately broken copy, it caught every planted fault: a committed texture, a wrong-side puzzle, a page that
    accepts wrong moves, frames that differ at the same `t`, an image fetched from the web, and copied code.
- **The judging tools:** tested end to end, from pairs through votes to the ranking.
- **The runner:** a smoke run with Claude Code is next; the Codex and Gemini command lines are checked against their
  `--help` but not yet run end to end.

## Files

```
CONTRACT.md       deliverables every task shares
feedback.md       the scripted critique for the second session
tasks/            the public example task (hidden tasks live in a private repo)
Dockerfile        the benchmark environment
agents.json       how to start and resume each coding agent headless
run.mjs           one agent, one task: build session, feedback session, checks
check.mjs         the gates and measurements for any submission
lib/mate.mjs      exhaustive mate search
judge/            blind side-by-side judging and Bradley-Terry ranking
```
