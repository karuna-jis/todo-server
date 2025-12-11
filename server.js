/**
 * Node.js Express Backend Server
 * Using Firebase Admin SDK with FCM HTTP v1 API
 * 
 * Features:
 * - FCM push notifications (HTTP v1 API)
 * - Batch notifications support
 * - Environment variable support
 */

// Load environment variables from .env file
try {
  require("dotenv").config();
} catch (error) {
  // dotenv is optional
}

const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
// CORS configuration - allow multiple origins for production and development
const allowedOrigins = [
  "http://localhost:3000",
  "https://todo-app-virid-five.vercel.app",
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : []),
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // In development, allow localhost with any port
      if (process.env.NODE_ENV !== "production" && origin.startsWith("http://localhost:")) {
        callback(null, true);
      } else {
        console.warn(`⚠️ CORS blocked origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    }
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());

// Firebase Admin SDK initialization
let firebaseInitialized = false;
let messaging = null;

function initializeFirebase() {
  try {
    if (admin.apps.length > 0) {
      messaging = admin.messaging();
      firebaseInitialized = true;
      return;
    }

    let serviceAccount = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      } catch (error) {
        console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT:", error.message);
      }
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      try {
        serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
      } catch (error) {
        console.error("Failed to load service account from file:", error.message);
      }
    } else {
      try {
        serviceAccount = require("./serviceAccountKey.json");
      } catch (error) {
        // Try application default credentials
      }
    }

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id,
      });
    } else {
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID,
      });
    }

    messaging = admin.messaging();
    firebaseInitialized = true;
  } catch (error) {
    console.error("Failed to initialize Firebase Admin SDK:", error.message);
    firebaseInitialized = false;
  }
}

initializeFirebase();

// ============================================================================
// FCM PUSH NOTIFICATIONS
// ============================================================================

/**
 * POST /notify
 * Send a push notification to a single FCM token
 */
app.post("/notify", async (req, res) => {
  try {
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        error: "Firebase not initialized",
      });
    }

    const {token, title, body, data, imageUrl} = req.body;

    if (!token || !title || !body) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: token, title, or body",
      });
    }

    const message = {
      token: token,
      notification: {
        title: title,
        body: body,
        ...(imageUrl && {imageUrl: imageUrl}),
      },
      data: {
        ...Object.fromEntries(
          Object.entries(data || {}).map(([key, value]) => [key, String(value)])
        ),
      },
      webpush: {
        fcmOptions: {
          // Use absolute URL - construct from origin if link is relative
          link: data?.link 
            ? (data.link.startsWith("http") 
                ? data.link 
                : `${data?.origin || "https://todo-app-virid-five.vercel.app"}${data.link.startsWith("/") ? data.link : "/" + data.link}`)
            : (data?.origin || "https://todo-app-virid-five.vercel.app") + "/",
        },
        notification: {
          icon: data?.icon || "/logo192.png",
          badge: data?.badge || "/logo192.png",
        },
      },
    };

    const response = await messaging.send(message);

    return res.status(200).json({
      success: true,
      message: "Notification sent successfully",
      messageId: response,
    });
  } catch (error) {
    console.error("Error sending notification:", error.message);

    if (error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered") {
      return res.status(400).json({
        success: false,
        error: "Invalid or unregistered FCM token",
        code: error.code,
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to send notification",
      message: error.message,
      code: error.code,
    });
  }
});

/**
 * POST /notify-batch
 * Send push notifications to multiple FCM tokens at once
 */
app.post("/notify-batch", async (req, res) => {
  try {
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        error: "Firebase not initialized",
      });
    }

    const {tokens, title, body, data, imageUrl} = req.body;

    if (!tokens || !Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Missing or invalid tokens array",
      });
    }

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: title or body",
      });
    }

    const messages = tokens.map((token) => ({
      token: token,
      notification: {
        title: title,
        body: body,
        ...(imageUrl && {imageUrl: imageUrl}),
      },
      data: {
        ...Object.fromEntries(
          Object.entries(data || {}).map(([key, value]) => [key, String(value)])
        ),
      },
      webpush: {
        fcmOptions: {
          // Use absolute URL - construct from origin if link is relative
          link: data?.link 
            ? (data.link.startsWith("http") 
                ? data.link 
                : `${data?.origin || "https://todo-app-virid-five.vercel.app"}${data.link.startsWith("/") ? data.link : "/" + data.link}`)
            : (data?.origin || "https://todo-app-virid-five.vercel.app") + "/",
        },
        notification: {
          icon: data?.icon || "/logo192.png",
          badge: data?.badge || "/logo192.png",
        },
      },
    }));

    const BATCH_SIZE = 500;
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    // Try batch sending first, fallback to individual sends if batch fails
    try {
      for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        const batch = messages.slice(i, i + BATCH_SIZE);
        const batchResponse = await messaging.sendAll(batch);

        batchResponse.responses.forEach((response, index) => {
          const token = batch[index].token;
          if (response.success) {
            successCount++;
            results.push({
              token,
              success: true,
              messageId: response.messageId,
            });
          } else {
            failureCount++;
            results.push({
              token,
              success: false,
              error: response.error.message,
              code: response.error.code,
            });
          }
        });
      }
    } catch (batchError) {
      // If batch API fails (404 or other errors), fallback to individual sends
      console.warn("⚠️ Batch API failed, falling back to individual sends:", batchError.message);
      console.log("📤 Sending notifications individually (slower but more reliable)...");
      
      for (const message of messages) {
        try {
          const response = await messaging.send(message);
          successCount++;
          results.push({
            token: message.token,
            success: true,
            messageId: response,
          });
        } catch (error) {
          failureCount++;
          results.push({
            token: message.token,
            success: false,
            error: error.message,
            code: error.code,
          });
        }
      }
    }

    console.log(`📊 Batch notification result: ${successCount} success, ${failureCount} failures out of ${tokens.length} total`);

    return res.status(200).json({
      success: true,
      notified: successCount,
      failed: failureCount,
      total: tokens.length,
      results: results,
    });
  } catch (error) {
    console.error("❌ Error in batch notification:", error.message);
    console.error("   Stack:", error.stack);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message,
    });
  }
});

// ============================================================================
// HEALTH CHECK
// ============================================================================

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Server is running",
    firebase: {
      initialized: firebaseInitialized,
      projectId: firebaseInitialized ? admin.app().options.projectId : null,
    },
  });
});

app.get("/", (req, res) => {
  res.status(200).json({
    message: "FCM Notification Server",
    endpoints: {
      health: "GET /health",
      notify: "POST /notify",
      notifyBatch: "POST /notify-batch",
    },
  });
});

// Error handlers
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
  });
});

app.use((error, req, res, next) => {
  console.error("Unhandled error:", error);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: error.message,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Firebase initialized: ${firebaseInitialized ? "Yes" : "No"}`);
  if (firebaseInitialized) {
    console.log(`Project ID: ${admin.app().options.projectId}`);
  } else {
    console.warn("WARNING: Firebase not initialized. Set FIREBASE_SERVICE_ACCOUNT or add serviceAccountKey.json");
  }
});
