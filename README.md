# TrailRiders backend

Node.js / Express REST API for the TrailRiders app (MySQL 8 or MariaDB).

## Run

```bash
npm install
cp .env.example .env   # fill in DB credentials and secrets
npm start              # or: npm run dev (nodemon)
```

1. Import `SQL/trailriders.sql` into a database called `trailriders`.
2. Start the server. On startup it creates any missing tables/columns automatically
   (`utils/schema.js`, same SQL as `SQL/migrations.sql`).

Server: `http://localhost:8000` · health check: `GET /health`

## Authentication

`POST /auth/login` returns `accessToken` (1 h) and `refreshToken` (30 days).
Send `Authorization: Bearer <accessToken>` on protected routes; refresh with `POST /auth/refresh { refreshToken }`.
Cookies (`accToken`, `refToken`) are also set for browser clients.

## Endpoints

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/signup` · `/login` · `/google` · `/refresh` · `/logout` · `/forgotPassword` · `GET+POST /resetPassword` · 🔒 `/changePassword` · 🔒 `/deleteUser` · `POST /auth/token?subGen=` |
| Users | 🔒 `GET /api/me` · `GET /api/user/:id` · 🔒 `POST /api/user/updateProfile` |
| Notifications | 🔒 `GET /api/notifications` · `/unreadCount` · `POST /markRead` · `/delete` |
| Rides | `GET /rides/getAllRides?search=&difficulty=&rideType=&upcoming=1` · `GET /rides/get/:id` · 🔒 `GET /rides/myRides` · 🔒 `POST /createRide` · `PUT /update/:id` · `DELETE /delete/:id` · `POST /joinRide` · `/leaveRide` · `GET+POST /rides/:id/comments` · 🔒 `POST /rides/:id/rate` |
| Ride sharing | `GET /passengerRides/getAllPRides` · `GET /getPRide/:id` · 🔒 `GET /my` · `POST /createPRide` · `PUT /update/:id` · `DELETE /delete/:id` · `POST /joinPRide` · `/cancelRequest` · `/selectPassenger` |
| Events | `GET /event?upcoming=1` · `GET /event/:id` · 🔒 `GET /event/my` · `POST /event/create` · `PUT/DELETE /event/:id` · `POST /event/:id/rsvp` |
| Company events | `POST /companyEvents/create` with header `x-company-token` (create a token with `node scripts/createCompanyToken.js "Company"`) |
| Premium | `GET /subscription/plans` · 🔒 `GET /subscription/check` · 🔒 `POST /subscription/start|update|cancel?subToken=` (no real payments yet) |
| Social 🔒 | `GET /social/conversations` · `GET /social/messages/unreadCount` · `GET /social/messages/:userId?after=` · `POST /social/messages/:userId` · `POST/DELETE /social/follow/:userId` · `GET /social/follows/:userId?type=followers|following` · `GET /social/feed` · `GET /social/blocks` · `POST/DELETE /social/block/:userId` · `POST /social/report` |

Free accounts can host up to 3 upcoming rides/ride shares/events at a time (`utils/social.js`, `FREE_ACTIVE_LIMIT`); Premium is unlimited and boosted in lists.
Signup requires `acceptTerms: true`. Login, signup and password routes are rate limited.
User reports are stored in the `reports` table (`status = 'open'`) for the team to review.

🔒 = requires login.
