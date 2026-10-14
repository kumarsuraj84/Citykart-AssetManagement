FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# S8: the release id shown in problem reports (optional; falls back to the package version).
ARG GIT_COMMIT=
ENV GIT_COMMIT=$GIT_COMMIT
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
