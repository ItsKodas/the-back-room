# Build the browser client, then ship it with the game server.
#
# The server runs its TypeScript directly through tsx rather than being
# compiled. The workspace packages export TypeScript source — that is what
# makes the fast development loop work — and tsx resolves them exactly as
# Vite and Vitest already do. Compiling the server would mean solving the
# packaging of every workspace package first, for no gain at this size.

FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
# Every workspace. A missing manifest here does not fail loudly: `npm ci`
# succeeds having linked only what it was shown, `COPY . .` brings the rest of
# the source in behind it with no symlinks, and the build dies much later on an
# import it cannot resolve, naming a package that is plainly there in the tree.
# Four games had drifted off this list before anyone ran it, so packaging.test
# now checks the two against each other.
COPY packages/core/package.json packages/core/
COPY packages/economy/package.json packages/economy/
COPY packages/rules/package.json packages/rules/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY games/greed/package.json games/greed/
COPY games/blackjack/package.json games/blackjack/
COPY games/slots/package.json games/slots/
COPY games/poker/package.json games/poker/
COPY games/roulette/package.json games/roulette/
COPY games/death-roll/package.json games/death-roll/
COPY games/two-up/package.json games/two-up/
COPY games/tips/package.json games/tips/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
# Copies whatever sound files are present and writes their manifest.
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# Every workspace. A missing manifest here does not fail loudly: `npm ci`
# succeeds having linked only what it was shown, `COPY . .` brings the rest of
# the source in behind it with no symlinks, and the build dies much later on an
# import it cannot resolve, naming a package that is plainly there in the tree.
# Four games had drifted off this list before anyone ran it, so packaging.test
# now checks the two against each other.
COPY packages/core/package.json packages/core/
COPY packages/economy/package.json packages/economy/
COPY packages/rules/package.json packages/rules/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY games/greed/package.json games/greed/
COPY games/blackjack/package.json games/blackjack/
COPY games/slots/package.json games/slots/
COPY games/poker/package.json games/poker/
COPY games/roulette/package.json games/roulette/
COPY games/death-roll/package.json games/death-roll/
COPY games/two-up/package.json games/two-up/
COPY games/tips/package.json games/tips/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev

COPY packages/ packages/
# The games too: the server runs their TypeScript, so their source has to be
# in the image as surely as the server's own.
COPY games/ games/
COPY apps/server/ apps/server/
COPY --from=build /app/apps/web/dist apps/web/dist

# Never as root.
USER node

EXPOSE 3001
ENV PORT=3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `serve`, not `start`: compose hands the environment in, so the .env lookup
# `start` does would find nothing and say so on every boot.
CMD ["npm", "run", "serve", "-w", "@backroom/server"]
