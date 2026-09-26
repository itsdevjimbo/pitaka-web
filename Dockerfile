FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build -- --configuration production

FROM nginx:1.30.5-alpine

ARG VCS_REF=unknown

LABEL org.opencontainers.image.source="https://github.com/itsdevjimbo/pitaka-web" \
  org.opencontainers.image.revision="${VCS_REF}" \
  org.opencontainers.image.title="Pitaka Web"

ENV API_UPSTREAM=http://api:8080 \
  NGINX_ENVSUBST_FILTER=^API_UPSTREAM$

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/api-proxy.conf /etc/nginx/snippets/api-proxy.conf
COPY --from=build /app/dist/pitaka/browser/ /usr/share/nginx/html/

EXPOSE 8080
