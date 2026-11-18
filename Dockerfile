# OPERATOR's app image (docs/self-host.md): the Control Room, the agent API and the job worker, as
# one Next.js server. Settings come from the environment at run time; none are baked in.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S operator && adduser -S operator -G operator
COPY --from=build --chown=operator:operator /app/.next/standalone ./
COPY --from=build --chown=operator:operator /app/.next/static ./.next/static
USER operator
EXPOSE 3000
CMD ["node", "server.js"]
