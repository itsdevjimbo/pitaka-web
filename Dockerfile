FROM nginx:1.30.5-alpine

ARG VCS_REF=unknown
ARG WEB_ARCHIVE_SHA256=unknown

LABEL org.opencontainers.image.source="https://github.com/itsdevjimbo/pitaka-web" \
  org.opencontainers.image.revision="${VCS_REF}" \
  org.opencontainers.image.title="Pitaka Web" \
  org.pitaka.web.archive.sha256="${WEB_ARCHIVE_SHA256}"

ENV API_UPSTREAM=http://api:8080 \
  NGINX_ENVSUBST_FILTER=^API_UPSTREAM$

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/api-proxy.conf /etc/nginx/snippets/api-proxy.conf
COPY web-image/ /usr/share/nginx/html/

EXPOSE 8080
