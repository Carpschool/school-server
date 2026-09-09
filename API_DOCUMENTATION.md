# Carpschool Autonomous School Server - API Documentation

## Overview

The Autonomous School Server (`school-server`) manages all localized student carpool operations for an individual university or college:
- **Offline Ed25519 Federation Ticket Authentication**: Cryptographically authenticates incoming client tickets using Central Server's public key without making outbound network requests.
- **Signed Metadata**: Exposes `/api/v1/meta` signed with the School Server's Ed25519 private key in the `x-school-signature` HTTP header for automated admin onboarding.
- **Institutional `.edu` Verification**: Sends and validates 6-digit OTP codes sent to student institutional inboxes.
- **User Homes & Walking Radius**: Manages student pickup locations with custom walking radius sliders (10m to 200m).
- **Rider Applications & Bidirectional Matching**: Allows riders to post commute applications (Home -> School and School -> Home, one-time or recurring) and drivers to match along their route corridor.
- **In-Chat Location Modal & Negotiation**: Coordinates pickup point and time proposals (Confirm / Deny / Suggest New) with first-confirmed seat contention.
- **Discrete GPS Snapshots & Boarding Safety PINs**: Zero live GPS streaming and zero payments. GPS coordinates are queried only at passenger boarding and ride completion.

- **Base URL**: `http://localhost:5000` (or `https://ubc.carp.school`)
- **Interactive Swagger UI**: `http://localhost:5000/api/docs`
- **Default Port**: `5000`
- **Database**: MongoDB (`school_db`), connected via Docker internal network with zero exposed host ports.

---

## Authentication

All protected endpoints require the Ed25519-signed Federation Ticket issued by Central Server, passed in the HTTP Authorization header:

```
Authorization: Bearer <federation_ticket>
```

In development (`NODE_ENV != 'production'`), mock tokens starting with `mock_` (e.g. `Bearer mock_user_123`) are accepted for local testing.

---

## Endpoints Summary

### 1. Metadata (Public)

#### `GET /api/v1/meta`
* **Description**: Returns school name, school code, allowed `.edu` email domains, campus coordinates, and Ed25519 public key. The response is cryptographically signed by the school server in HTTP header `x-school-signature`.

---

### 2. Authentication & Profile

#### `GET /api/v1/auth/me`
* **Auth**: `Bearer <federation_ticket>`
* **Description**: Verifies the ticket offline and returns the local student profile.

---

### 3. Institutional `.edu` Verification

#### `POST /api/v1/auth/edu/send-code`
* **Auth**: `Bearer <federation_ticket>`
* **Body**: `{ "eduEmail": "student@cs.ubc.ca" }`
* **Description**: Validates that the domain matches the school's allowed list and dispatches a 6-digit code.

#### `POST /api/v1/auth/edu/verify-code`
* **Auth**: `Bearer <federation_ticket>`
* **Body**: `{ "code": "482910" }`
* **Description**: Verifies the 6-digit code and marks `isEduVerified = true` on the local profile.

---

### 4. Saved Homes & Walking Radius (10m - 200m)

#### `POST /api/v1/homes`
* **Auth**: `Bearer <federation_ticket>`
* **Body**:
  ```json
  {
    "label": "Primary Home",
    "address": "1234 Student Way, Vancouver, BC",
    "latitude": 49.2606,
    "longitude": -123.2460,
    "walkingRadiusMeters": 75
  }
  ```

#### `GET /api/v1/homes`
* **Auth**: `Bearer <federation_ticket>`
* **Description**: Lists user saved homes.

---

### 5. Rider Applications & Driver Matching

#### `POST /api/v1/applications`
* **Auth**: `Bearer <federation_ticket>`
* **Body**:
  ```json
  {
    "homeId": "673f...",
    "direction": "HOME_TO_SCHOOL",
    "scheduleType": "ONE_TIME",
    "targetDate": "2026-09-18",
    "targetTime": "08:30",
    "notes": "Luggage in trunk"
  }
  ```

#### `GET /api/v1/matching/riders`
* **Auth**: `Bearer <federation_ticket>`
* **Query Params**: `direction=HOME_TO_SCHOOL&driverHomeId=673f...`
* **Description**: Returns open rider applications intersecting the driver's route corridor.

---

### 6. In-Chat Negotiation & Pickup Proposals

#### `POST /api/v1/negotiations/start/:applicationId`
* **Auth**: `Bearer <federation_ticket>`
* **Description**: Driver initiates contact with a rider application.

#### `POST /api/v1/negotiations/:id/propose-pickup`
* **Auth**: `Bearer <federation_ticket>`
* **Description**: Sends location modal proposal into the chat.
* **Body**:
  ```json
  {
    "pickupPointName": "Corner of 10th & Main",
    "latitude": 49.2606,
    "longitude": -123.2460,
    "proposedTime": "08:20"
  }
  ```

#### `POST /api/v1/negotiations/:id/proposals/:proposalId/respond`
* **Auth**: `Bearer <federation_ticket>`
* **Body**: `{ "action": "CONFIRM" }` or `{ "action": "DENY" }`

#### `POST /api/v1/negotiations/:id/lock-in`
* **Auth**: `Bearer <federation_ticket>`
* **Description**: Locks in carpool, atomically decrements seat, and issues 4-digit Boarding Safety PIN to the rider.

---

### 7. Carpools & Discrete GPS Snapshots

#### `POST /api/v1/carpools/:id/board-passenger`
* **Auth**: `Bearer <federation_ticket>`
* **Description**: Driver submits passenger 4-digit PIN with a single GPS coordinate read.
* **Body**:
  ```json
  {
    "riderId": "673f...",
    "pin": "4819",
    "latitude": 49.2606,
    "longitude": -123.2460
  }
  ```

#### `POST /api/v1/carpools/:id/end-ride`
* **Auth**: `Bearer <federation_ticket>`
* **Description**: Driver completes carpool with a single GPS coordinate read at the school destination.
* **Body**:
  ```json
  {
    "latitude": 49.2606,
    "longitude": -123.2460
  }
  ```

---

## WebSockets (Socket.io) Events

* Connect to `ws://localhost:5000`
* `join_negotiation`: `{ "negotiationId": "..." }`
* `new_message`: Emitted when a chat message is sent.
* `proposal_update`: Emitted when a location modal proposal card is sent.
* `proposal_status_changed`: Emitted when proposal is Confirmed or Denied.
* `carpool_locked`: Emitted when the carpool is locked in, delivering the 4-digit PIN.
* `passenger_boarded`: Emitted when boarding PIN is verified.
* `ride_completed`: Emitted when the driver completes the ride.
