# FCM Notification Server

Node.js backend using Firebase Admin SDK with FCM HTTP v1 API for sending push notifications.

## Installation

```bash
npm install
```

## Setup

1. **Get Service Account Key**
   - Firebase Console → Project Settings → Service Accounts
   - Generate new private key
   - Download JSON file

2. **Configure Service Account**
   - Option A: Place `serviceAccountKey.json` in this folder
   - Option B: Set `FIREBASE_SERVICE_ACCOUNT` environment variable with JSON content

3. **Set Environment Variables**
   ```env
   FIREBASE_PROJECT_ID=your-project-id
   PORT=3001
   CORS_ORIGIN=http://localhost:3000,https://your-frontend.vercel.app
   ```
   
   **Note**: CORS automatically allows:
   - `http://localhost:3000` (local development)
   - `https://todo-app-virid-five.vercel.app` (production)
   - Any origins in `CORS_ORIGIN` (comma-separated)

4. **Start Server**
   ```bash
   npm start
   ```

## API Endpoints

### POST /notify
Send a single push notification.

```json
{
  "token": "FCM_TOKEN",
  "title": "Notification Title",
  "body": "Notification Body",
  "data": {
    "link": "/path",
    "taskId": "123"
  }
}
```

### POST /notify-batch
Send push notifications to multiple tokens.

```json
{
  "tokens": ["token1", "token2"],
  "title": "Batch Title",
  "body": "Batch Body",
  "data": {
    "link": "/path"
  }
}
```

### GET /health
Health check endpoint.

## Deployment

### Render.com (Free)
1. **Create New Web Service**
   - Connect GitHub repository
   - Root directory: `notification-server`
   - Build command: `npm install`
   - Start command: `node server.js`

2. **Set Environment Variables**:
   ```
   NODE_ENV=production
   PORT=10000
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}
   CORS_ORIGIN=https://your-frontend.vercel.app
   ```

3. **Deploy** and get your backend URL (e.g., `https://your-app.onrender.com`)

4. **Update Frontend**: Set `REACT_APP_NOTIFICATION_API_URL` in Vercel environment variables

### Railway.app (Free)
1. **New Project** → **Deploy from GitHub**
2. **Set Root Directory**: `notification-server`
3. **Set Environment Variables** (same as Render.com)
4. **Deploy** and get backend URL

### Heroku
1. Create Heroku app
2. Set environment variables
3. Deploy via Git or CLI

## Security

- Never commit `serviceAccountKey.json` to Git
- Use environment variables in production
