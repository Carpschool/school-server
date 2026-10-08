# Carpschool school server

NestJS and Mongoose. Exchange a scoped central ticket once for an opaque school session, verify education email, then permanently choose rider or driver. No production mock tokens or test mailer.

Copy .env.example to .env, configure real credentials and Mongo replica set, run npm ci, npm run keys, npm run build, then npm start. Persist the signing key. Transactions require a replica set. Configure CENTRAL_URL and CENTRAL_ISSUER to the trusted central, PUBLIC_URL to this school, CORS_ORIGINS to exact web origins. Register centrally before heartbeats can succeed. Gmail uses OAuth2.

Swagger is at /docs and OpenAPI at /openapi.json. Coordinates are [longitude, latitude]. HTTP uses Authorization Bearer school session. Socket.IO uses auth.token. Admin permissions derive only from the central signed claim.

npm run build && npm test runs isolated Mongo replica-set tests covering federation, OTP, ownership, locked roles, atomic seats, PINs, snapshots and socket auth.
