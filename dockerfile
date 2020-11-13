FROM node:15.1.0-alpine3.10 
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn
COPY . .
CMD yarn nodemon /app/index.js
