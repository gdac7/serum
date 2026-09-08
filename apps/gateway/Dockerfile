# Built from the repo root, not from apps/gateway/: the gateway serves the
# connector script to users, so the connector has to be inside the build
# context — and the npm lockfile lives at the workspace root.
FROM node:22-slim

WORKDIR /app

# tsx is a devDependency and the entrypoint, so dev deps stay in the image.
# Both workspace manifests are needed for `npm ci` to resolve the lockfile,
# even though only the gateway's dependencies are installed.
COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node apps/gateway/package.json apps/gateway/
COPY --chown=node:node apps/webapp/package.json apps/webapp/
RUN npm ci -w apps/gateway

COPY --chown=node:node apps/gateway/ apps/gateway/
COPY --chown=node:node apps/connector/ apps/connector/

USER node
EXPOSE 3000

CMD ["npm", "start", "-w", "apps/gateway"]
