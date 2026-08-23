FROM oven/bun:1.3.14 AS build

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun build src/cli.ts --compile --outfile /out/agent-bahi

FROM oven/bun:1.3.14-slim

RUN groupadd --system --gid 10001 agentbahi \
  && useradd --system --uid 10001 --gid 10001 --no-create-home agentbahi \
  && mkdir -p /data \
  && chown agentbahi:agentbahi /data

COPY --from=build /out/agent-bahi /usr/local/bin/agent-bahi
RUN chmod 0555 /usr/local/bin/agent-bahi

ENV AGENT_BAHI_DATABASE=/data/agent-bahi.sqlite
VOLUME ["/data"]
USER 10001:10001
WORKDIR /data

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r => { if (!r.ok) process.exit(1); })"]

ENTRYPOINT ["/usr/local/bin/agent-bahi"]
CMD ["mcp", "serve", "--host", "127.0.0.1", "--port", "8787"]
