# Built from the repo root, not from gateway/: the gateway serves the connector
# script to users, so the connector has to be inside the build context.
FROM node:22-slim

WORKDIR /app

# tsx is a devDependency and the entrypoint, so dev deps stay in the image.
COPY --chown=node:node gateway/package.json gateway/package-lock.json ./
RUN npm ci

COPY --chown=node:node gateway/ ./
COPY --chown=node:node connector/ ./connector/

USER node
EXPOSE 3000

CMD ["npm", "start"]
