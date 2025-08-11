FROM node:18
WORKDIR /app
COPY . .
RUN npm install && npm run build || true
EXPOSE 3001
CMD ["npm", "start"]
