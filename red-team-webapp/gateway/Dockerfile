FROM node:22-slim

WORKDIR /app

# tsx is a devDependency and the entrypoint, so dev deps stay in the image.
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .

USER node
EXPOSE 3000

CMD ["npm", "start"]
