# IDC 机房数字孪生（Node 22 + Vite + three.js）
# 构建阶段：vite 打包，生产 base 固定为 /idc_insight/（同域反代入口）
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_BASE=/idc_insight/
RUN npm run build

# 运行阶段：Node 内置 http + node:sqlite，无第三方运行时依赖
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    CMDB_DB=/data/cmdb.db
COPY package.json ./
COPY server ./server
COPY --from=build /app/dist ./dist
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server/server.js"]
