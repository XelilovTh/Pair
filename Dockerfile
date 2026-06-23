FROM node:20-bookworm

WORKDIR /app

# Copy everything first so patch-baileys.js is available during postinstall
COPY . .

RUN npm install

EXPOSE 8000

CMD ["npm", "start"]
