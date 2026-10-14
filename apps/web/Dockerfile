FROM node:24-bookworm-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_SITE_URL=https://sellerlabel.in
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci

COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages packages
RUN npm run build

FROM node:24-bookworm-slim AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --system --gid 1001 labels && useradd --system --uid 1001 --gid labels labels
COPY --from=production-deps --chown=labels:labels /app/package.json /app/package-lock.json ./
COPY --from=production-deps --chown=labels:labels /app/node_modules ./node_modules
COPY --from=build --chown=labels:labels /app/apps/web ./apps/web
COPY --from=build --chown=labels:labels /app/packages ./packages
RUN mkdir -p /app/apps/web/.next/cache/images && chown -R labels:labels /app/apps/web/.next/cache
USER labels
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "@label-normalizer/web"]
