FROM node:22-bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl tar \
  && rm -rf /var/lib/apt/lists/*
ARG HELM_VERSION=v3.16.4
ARG KUSTOMIZE_VERSION=v5.5.0
RUN curl -fsSL -o /tmp/helm.tgz "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" \
  && tar -xzf /tmp/helm.tgz -C /tmp \
  && mv /tmp/linux-amd64/helm /usr/local/bin/helm \
  && curl -fsSL -o /tmp/kustomize.tgz "https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize%2F${KUSTOMIZE_VERSION}/kustomize_${KUSTOMIZE_VERSION}_linux_amd64.tar.gz" \
  && tar -xzf /tmp/kustomize.tgz -C /usr/local/bin \
  && chmod 755 /usr/local/bin/helm /usr/local/bin/kustomize \
  && rm -rf /tmp/helm.tgz /tmp/kustomize.tgz /tmp/linux-amd64
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3847
EXPOSE 3847
CMD ["node", "server.js"]
