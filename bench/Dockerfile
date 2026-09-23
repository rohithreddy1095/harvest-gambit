# The benchmark environment: every agent works in this same container, and the checker builds
# submissions in it too. Build with:  docker build -t harvest-bench bench/
FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ffmpeg imagemagick git python3 zstd ca-certificates curl \
      fonts-dejavu-core libgl1-mesa-dri \
  && rm -rf /var/lib/apt/lists/*

# Pin these when you publish results, so a leaderboard names the exact agent versions.
ARG CLAUDE_CODE=latest
ARG CODEX=latest
ARG GEMINI_CLI=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE} @openai/codex@${CODEX} @google/gemini-cli@${GEMINI_CLI} \
  && npm cache clean --force

ENV CHROME_PATH=/usr/bin/chromium \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=1
RUN mkdir -p /home/agent && chmod 1777 /home/agent
WORKDIR /workspace
