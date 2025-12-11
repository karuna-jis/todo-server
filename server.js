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
 * POST /send-task-notification
 * Send notification to admin when task is added
 * Body: { projectId, addedBy, taskName, taskId }
 */
app.post("/send-task-notification", async (req, res) => {
  try {
    if (!firebaseInitialized) {
      return res.status(500).json({
        success: false,
        error: "Firebase not initialized",
      });
    }

    const { projectId, addedBy, taskName, taskId } = req.body;

    if (!projectId || !addedBy || !taskName) {
      return res.status(400).json({
        success: false,
        error: "Missing required fields: projectId, addedBy, or taskName",
      });
    }

    console.log(`📤 Sending task notification for project: ${projectId}`);
    console.log(`   Task: ${taskName}`);
    console.log(`   Added by: ${addedBy}`);

    // Get project document to find admin
    const projectDoc = await firestore.collection("projects").doc(projectId).get();
    
    if (!projectDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Project not found",
      });
    }

    const projectData = projectDoc.data();
    const adminUid = projectData.createdBy; // Admin is the project creator

    if (!adminUid) {
      return res.status(400).json({
        success: false,
        error: "Project has no admin (createdBy field missing)",
      });
    }

    console.log(`   Admin UID: ${adminUid}`);

    // Get admin's FCM token
    const adminDoc = await firestore.collection("users").doc(adminUid).get();
    
    if (!adminDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Admin user not found",
      });
    }

    const adminData = adminDoc.data();
    const adminToken = adminData.fcmToken;

    if (!adminToken) {
      return res.status(400).json({
        success: false,
        error: "Admin has no FCM token. Admin needs to login and allow notifications.",
      });
    }

    console.log(`   Admin FCM token found: ${adminToken.substring(0, 20)}...`);

    // Get admin email for notification
    const adminEmail = adminData.email || adminUid;
    const addedByEmail = addedBy;

    // Construct notification
    const baseUrl = req.body.origin || "https://todo-app-virid-five.vercel.app";
    const projectName = projectData.name || "Project";
    const notificationLink = `${baseUrl}/view/${projectId}/${encodeURIComponent(projectName)}`;

    const message = {
      token: adminToken,
      notification: {
        title: "New Task Added",
        body: `${addedByEmail} added: ${taskName}`,
      },
      data: {
        projectId: String(projectId),
        projectName: String(projectName),
        taskId: String(taskId || ""),
        taskName: String(taskName),
        taskText: String(taskName), // Alternative field name
        addedBy: String(addedBy),
        createdBy: String(addedBy), // Alternative field name for consistency
        createdByName: String(addedByEmail), // User name/email
        type: "task_created",
        timestamp: String(Date.now()), // For duplicate prevention
      },
      webpush: {
        fcmOptions: {
          link: notificationLink,
        },
        notification: {
          icon: "/logo192.png",
          badge: "/logo192.png",
          sound: "default",
        },
      },
    };

    // Send notification
    const response = await messaging.send(message);

    console.log(`✅ Notification sent to admin: ${adminEmail}`);
    console.log(`   Message ID: ${response}`);

    return res.status(200).json({
      success: true,
      message: "Notification sent to admin successfully",
      messageId: response,
      adminEmail: adminEmail,
    });
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
          icon: data?.icon || "/logo192.png",
          badge: data?.badge || "/logo192.png",
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
          icon: data?.icon || "/logo192.png",
          badge: data?.badge || "/logo192.png",
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
