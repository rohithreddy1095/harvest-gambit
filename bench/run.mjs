#!/usr/bin/env node
// Run one agent on one task in the benchmark container: a build session, one scripted round of
// feedback, then the checker.
//   node bench/run.mjs --task <taskdir> --agent claude|codex|gemini --model <model-id>
//        [--build-minutes N] [--feedback-minutes N] [--no-feedback] [--no-check]
//        [--gpu] [--image harvest-bench] [--out bench/runs] [--reference <dir>]...
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const argList = k => argv.flatMap((a, i) => a === `--${k}` ? [argv[i + 1]] : []);
const AGENTS = JSON.parse(fs.readFileSync(path.join(HERE, 'agents.json'), 'utf8'));
const agentName = arg('agent'), model = arg('model'), TASKDIR = arg('task') && path.resolve(arg('task'));
if (!TASKDIR || !AGENTS[agentName] || !model) {
  console.error(`usage: run.mjs --task <taskdir> --agent ${Object.keys(AGENTS).join('|')} --model <model-id> [--build-minutes N] [--feedback-minutes N]`);
  process.exit(2);
}
const agent = AGENTS[agentName], IMAGE = arg('image', 'harvest-bench');
const task = JSON.parse(fs.readFileSync(path.join(TASKDIR, 'task.json'), 'utf8'));
const minutes = { build: +arg('build-minutes', task.minutes.build), feedback: +arg('feedback-minutes', task.minutes.feedback) };
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const id = `${task.id}__${agentName}__${model.replace(/[^\w.-]/g, '_')}__${stamp}`;
const RUN = path.resolve(arg('out', path.join(HERE, 'runs')), id);
const WS = path.join(RUN, 'workspace'), HOMEDIR = path.join(RUN, 'home'), LOGS = path.join(RUN, 'logs');
for (const d of [WS, HOMEDIR, LOGS]) fs.mkdirSync(d, { recursive: true });
const git = (...a) => spawnSync('git', ['-C', WS, '-c', 'user.name=harness', '-c', 'user.email=harness@bench', ...a], { encoding: 'utf8' });
const record = { id, task: task.id, agent: agentName, model, image: IMAGE, minutes, started: new Date().toISOString(), phases: [] };
const save = () => fs.writeFileSync(path.join(RUN, 'run.json'), JSON.stringify(record, null, 2));

// ---------------------------------------------------------------- the brief, as the agent will see it
const env = arg('gpu')
  ? 'Chromium (/usr/bin/chromium, start it with --no-sandbox) can use the GPU for WebGL.'
  : 'Chromium (/usr/bin/chromium, start it with --no-sandbox) runs headless with software WebGL, so renders are slow: check a few frames, not the whole film.';
fs.writeFileSync(path.join(WS, 'TASK.md'), [
  fs.readFileSync(path.join(TASKDIR, 'task.md'), 'utf8').trim(),
  fs.readFileSync(path.join(HERE, 'CONTRACT.md'), 'utf8').trim(),
  `## Your environment\n\nYou are working alone in a Linux container, in \`/workspace\`, with Node.js, npm, git, Python 3, ffmpeg,
ImageMagick and Chromium. ${env} You have internet access for packages and open data. This session has
${minutes.build} minutes; after that it is stopped, so commit early and often.`,
].join('\n\n') + '\n');
fs.writeFileSync(path.join(WS, '.gitignore'), 'node_modules/\n');
git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'The brief');

// Credentials: API keys pass through from the environment; logged-in CLIs get a copy of their credential files.
const envArgs = agent.env.filter(k => process.env[k]).flatMap(k => ['-e', k]);
for (const rel of agent.credentials) {
  const from = path.join(os.homedir(), rel);
  if (fs.existsSync(from)) { fs.mkdirSync(path.dirname(path.join(HOMEDIR, rel)), { recursive: true }); fs.copyFileSync(from, path.join(HOMEDIR, rel)); }
}
record.versions = Object.fromEntries(['claude', 'codex', 'gemini'].map(c => [c, spawnSync('docker', ['run', '--rm', IMAGE, c, '--version'], { encoding: 'utf8' }).stdout.trim().split('\n')[0]]));

// ---------------------------------------------------------------- one agent session in the container
function session(name, template, prompt, mins) {
  const cmd = template.map(a => a.replace('{prompt}', () => prompt).replace('{model}', () => model));
  const container = `${id}-${name}`.slice(0, 120);
  const args = ['run', '--rm', '--name', container, '--user', `${process.getuid()}:${process.getgid()}`,
    '-e', 'HOME=/home/agent', '-v', `${HOMEDIR}:/home/agent`, '-v', `${WS}:/workspace`, '-w', '/workspace',
    '--shm-size', '2g', ...(arg('gpu') ? ['--device', '/dev/dri'] : []), ...envArgs, IMAGE, ...cmd];
  const out = fs.openSync(path.join(LOGS, `${name}.jsonl`), 'w'), err = fs.openSync(path.join(LOGS, `${name}.err`), 'w');
  const t0 = Date.now();
  console.log(`[${name}] ${agentName} ${model}, ${mins} min`);
  return new Promise(resolve => {
    const p = spawn('docker', args, { stdio: ['ignore', out, err] });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; spawnSync('docker', ['kill', container]); }, mins * 60000);
    p.on('close', code => {
      clearTimeout(timer);
      const phase = { name, exitCode: code, timedOut, seconds: Math.round((Date.now() - t0) / 1000), usage: usage(path.join(LOGS, `${name}.jsonl`)) };
      git('add', '-A'); git('commit', '-qm', `Harness: end of ${name}`);
      phase.commit = git('rev-parse', 'HEAD').stdout.trim();
      record.phases.push(phase); save();
      console.log(`[${name}] finished: exit ${code}${timedOut ? ' (time limit)' : ''}, ${Math.round(phase.seconds / 60)} min`);
      resolve(phase);
    });
  });
}

// Token and cost figures, read from each CLI's own event stream where it reports them.
function usage(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (agent.usage === 'claude') {
    const r = lines.reverse().find(l => l.type === 'result');
    return r ? { costUsd: r.total_cost_usd, turns: r.num_turns, usage: r.usage, isError: r.is_error } : null;
  }
  if (agent.usage === 'codex') {
    const t = lines.filter(l => l.usage).map(l => l.usage);
    return t.length ? t.reduce((a, u) => { for (const [k, v] of Object.entries(u)) if (typeof v === 'number') a[k] = (a[k] || 0) + v; return a; }, {}) : null;
  }
  const r = lines.reverse().find(l => l.stats || l.type === 'result');
  return r ? (r.stats || r) : null;
}

// ---------------------------------------------------------------- build, feedback, check
const brief = `Read /workspace/TASK.md and carry it out completely. Work on your own until it is done: nobody will answer questions. You have about ${minutes.build} minutes. Commit your work to git as you go.`;
await session('build', agent.start, brief, minutes.build);
if (!arg('no-feedback')) {
  const feedback = `${fs.readFileSync(path.join(HERE, 'feedback.md'), 'utf8').trim()} You have about ${minutes.feedback} minutes.`;
  await session('feedback', agent.resume, feedback, minutes.feedback);
}
record.finished = new Date().toISOString(); save();

if (!arg('no-check')) {
  const refs = argList('reference').flatMap(r => ['--reference', path.resolve(r)]);
  const c = spawnSync('node', [path.join(HERE, 'check.mjs'), '--submission', WS, '--task', TASKDIR, '--out', path.join(RUN, 'check'), '--image', IMAGE, ...refs], { stdio: 'inherit' });
  try { record.check = JSON.parse(fs.readFileSync(path.join(RUN, 'check', 'results.json'), 'utf8')).summary; } catch { record.check = { error: `checker exited ${c.status}` }; }
  save();
}
console.log(`\nRun saved in ${path.relative(process.cwd(), RUN)}`);
