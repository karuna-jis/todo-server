/**
 * Node.js Express Backend Server
 * Using Firebase Admin SDK with FCM HTTP v1 API
 * 
 * Features:
 * - FCM push notifications (HTTP v1 API)
 * - Batch notifications support
 * - Task notification to admin
 * - Environment variable support
 * - Auto-fix private_key \n → \\n
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
  "https://todo-app-virid-five.vercel.app/",
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map(o => o.trim()) : []),
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
let firestore = null;

function initializeFirebase() {
  try {
    if (admin.apps.length > 0) {
      messaging = admin.messaging();
      firestore = admin.firestore();
      firebaseInitialized = true;
      return;
    }

    let serviceAccount = null;

    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        const serviceAccountString = process.env.FIREBASE_SERVICE_ACCOUNT;
        // Auto-fix private_key \n → \\n
        const fixedString = serviceAccountString.replace(/\\n/g, '\n');
        serviceAccount = JSON.parse(fixedString);
      } catch (error) {
        console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT:", error.message);
      }
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
      try {
        serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
        // Auto-fix private_key: replace escaped newlines with actual newlines
        if (serviceAccount && serviceAccount.private_key) {
          serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }
      } catch (error) {
        console.error("Failed to load service account from file:", error.message);
      }
    } else {
      try {
        serviceAccount = require("./serviceAccountKey.json");
        // Auto-fix private_key: replace escaped newlines with actual newlines
        if (serviceAccount && serviceAccount.private_key) {
          serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }
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
    firestore = admin.firestore();
    firebaseInitialized = true;
    console.log("✅ Firebase Admin SDK initialized successfully");
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
 * POST /notify-task
 * Send notification when task is added
 * Body: { projectId, addedBy, addedByName, taskName, taskId, origin }
 */
app.post("/notify-task", async (req, res) => {
  try {
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        error: "Firebase not initialized",
      });
    }

    const { projectId, addedBy, addedByName, taskName, taskId, origin } = req.body;

    if (!projectId || !addedBy || !taskName) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: projectId, addedBy, or taskName",
      });
    }

    try {
      const projectDoc = await firestore.collection("projects").doc(projectId).get();
      if (!projectDoc.exists) {
        return res.status(404).json({ success: false, error: "Project not found" });
      }

      const projectData = projectDoc.data();
      const projectName = projectData.name || "Project";
      const adminUid = projectData.createdBy;
      const assignedUsers = projectData.users || [];
      const baseUrl = origin || "https://todo-app-virid-five.vercel.app";
      const notificationLink = `${baseUrl}/view/${projectId}/${encodeURIComponent(projectName)}`;

      let isAdmin = false;
      if (adminUid) {
        const adminDoc = await firestore.collection("users").doc(adminUid).get();
        if (adminDoc.exists) {
          isAdmin = adminDoc.data().email === addedBy;
        }
      }

      let targetTokens = [];
      let recipients = [];

      if (isAdmin) {
        for (const uid of assignedUsers) {
          if (uid === adminUid) continue;
          const userDoc = await firestore.collection("users").doc(uid).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            if (userData.fcmToken) {
              targetTokens.push(userData.fcmToken);
              recipients.push(userData.email || uid);
            }
          }
        }
      } else {
        if (adminUid) {
          const adminDoc = await firestore.collection("users").doc(adminUid).get();
          if (adminDoc.exists) {
            const adminData = adminDoc.data();
            if (adminData.fcmToken) {
              targetTokens.push(adminData.fcmToken);
              recipients.push(adminData.email || adminUid);
            }
          }
        }
      }

      if (targetTokens.length === 0) {
        return res.status(200).json({ success: true, message: "No recipients with FCM tokens", notified: 0 });
      }

      const messages = targetTokens.map(token => ({
        token: token,
        notification: {
          title: "New Task Added",
          body: `${addedByName || addedBy} added new task: ${taskName}`,
        },
        data: {
          projectId: String(projectId),
          projectName: String(projectName),
          taskId: String(taskId || ""),
          taskName: String(taskName),
          addedBy: String(addedBy),
          addedByName: String(addedByName || addedBy),
          createdBy: String(addedBy),
          createdByName: String(addedByName || addedBy),
          type: "task_created",
          timestamp: String(Date.now()),
          badgeCount: "1", // Badge count increment (will be calculated by service worker)
        },
        webpush: {
          fcmOptions: { link: notificationLink },
          notification: { icon: "/icons/icon.png", badge: "/icons/icon.png", sound: "default" },
        },
      }));

      let successCount = 0;
      let failureCount = 0;

      for (const message of messages) {
        try {
          await messaging.send(message);
          successCount++;
        } catch (error) {
          failureCount++;
          console.error("Failed to send notification:", error.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: `Notifications sent: ${successCount} success, ${failureCount} failed`,
        notified: successCount,
        failed: failureCount,
        recipients: recipients,
      });
    } catch (error) {
      console.error("Error in notify-task:", error);
      return res.status(500).json({ success: false, error: "Failed to send notifications", message: error.message });
    }
  } catch (error) {
    console.error("Error sending task notification:", error.message);

    if (error.code === "messaging/invalid-registration-token" ||
        error.code === "messaging/registration-token-not-registered") {
      return res.status(400).json({
        success: false,
        error: "Invalid or expired FCM token",
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
          link: data?.link 
            ? (data.link.startsWith("http") 
                ? data.link 
                : `${data?.origin || "https://todo-app-virid-five.vercel.app"}${data.link.startsWith("/") ? data.link : "/" + data.link}`)
            : (data?.origin || "https://todo-app-virid-five.vercel.app") + "/",
        },
        notification: {
          icon: data?.icon || "/icons/icon.png",
          badge: data?.badge || "/icons/icon.png",
          sound: "default",
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
        error: "Invalid or expired FCM token",
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
          link: data?.link 
            ? (data.link.startsWith("http") 
                ? data.link 
                : `${data?.origin || "https://todo-app-virid-five.vercel.app"}${data.link.startsWith("/") ? data.link : "/" + data.link}`)
            : (data?.origin || "https://todo-app-virid-five.vercel.app") + "/",
        },
        notification: {
          icon: data?.icon || "/icons/icon.png",
          badge: data?.badge || "/icons/icon.png",
          sound: "default",
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

    return res.status(200).json({
      success: true,
      message: "Batch notifications processed",
      notified: successCount,
      failed: failureCount,
      total: tokens.length,
      results: results,
    });
  } catch (error) {
    console.error("Error sending batch notifications:", error.message);
    return res.status(500).json({
      success: false,
      error: "Failed to send batch notifications",
      message: error.message,
      code: error.code,
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
    firebaseInitialized: firebaseInitialized,
    timestamp: new Date().toISOString(),
  });
});

// API info
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "FCM Notification Server",
    endpoints: {
      health: "GET /health",
      notify: "POST /notify",
      notifyBatch: "POST /notify-batch",
      sendTaskNotification: "POST /send-task-notification",
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
