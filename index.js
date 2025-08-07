// index.js – ETH-Node backend (Express + Mongoose) - UPDATED FOR GASFEE SUPPORT
const express  = require("express");
const cors     = require("cors");
const mongoose = require("mongoose");
const { Decimal128 } = require("mongodb");

/***************** CONFIG ******************/
const app = express();
const PORT = process.env.PORT || 5000;
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://safepal:123123Aa.@cluster0.dtjy4my.mongodb.net/ethNodesDB";
const ADMIN_KEY        = process.env.ADMIN_KEY || "dev-key-change-me";
const SIMULATE_PAYMENT =
  String(process.env.SIMULATE_PAYMENT || "false").toLowerCase() === "true";

/**************** MIDDLEWARE ***************/
app.use(cors());
app.use(express.json());

/**************** DATABASE *****************/
mongoose.set("strictQuery", true);
mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log("✅ MongoDB connected");
    await Promise.all([User.init(), NodeModel.init()]);
    console.log("✅ Indexes ensured");
  })
  .catch(err => {
    console.error("❌ MongoDB error:", err.message);
    process.exit(1);
  });

/************** SCHEMAS & MODELS ***********/
const NodeSchema = new mongoose.Schema(
  {
    id: String,
    name: String,
    requiredEth: String,
    estimatedReward: String,
    validatorAddress: String,
    status: String,
    statusColor: String,
    reliability: Number,
    countdownMinutes: Number,
    createdAt: { type: Date, default: Date.now }
  },
  { collection: "nodes" }
);
NodeSchema.index({ id: 1 });
const NodeModel = mongoose.model("Node", NodeSchema);

const UserSchema = new mongoose.Schema(
  {
    machineId:      { type: String, required: true, unique: true },
    ethAddress:     { type: String, required: true },
    paymentStatus:  { type: Boolean, default: false },
    rewardAddress:  { type: String, required: true },
    selectedNodeId: { type: String },

    /* ek alanlar panelde ihtiyaç duyulanlar */
    gasFee:          { type: mongoose.Schema.Types.Decimal128, default: () => Decimal128.fromString("0.005") },
    gasPaid:         { type: Boolean, default: false },
    depositAmount:   String,
    estimatedReward: String,
    txHash:          String,
    txTimestamp:     String
  },
  {
    collection: "users",
    strict: false, // bilinmeyen alanları da sakla–döndür
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" }
  }
);
UserSchema.index({ paymentStatus: 1 });
const User = mongoose.model("User", UserSchema);

/******************* HELPERS *****************/
const makeRewardAddress = () =>
  "0x" + Array.from({ length: 40 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");

function adminAuth(req, res, next) {
  if (req.headers["x-admin-key"] !== ADMIN_KEY)
    return res.status(401).json({ error: "unauthorized" });
  next();
}

/******************** ROUTES *****************/
app.get("/health", (_, res) => res.json({ ok: true }));

/* ---------- NODES ---------- */
app.get("/nodes", async (_, res) => {
  try { res.json(await NodeModel.find()); }
  catch { res.status(500).json({ error: "Failed to load nodes" }); }
});

app.get("/nodes/:id", async (req, res) => {
  try {
    const node = await NodeModel.findOne({ id: req.params.id });
    if (!node) return res.status(404).json({ error: "Node not found" });
    res.json(node);
  } catch (e) {
    res.status(500).json({ error: "Failed to load node" });
  }
});

/* ---------- USERS ---------- */
const upsertHandler = async (req, res) => {
  try {
    const { machineId, ethAddress, selectedNodeId, gasFee, gasPaid } = req.body;
    
    console.log("📝 Upsert request received:", { 
      machineId, 
      ethAddress, 
      selectedNodeId, 
      gasFee, 
      gasPaid 
    });
    
    if (!machineId || !ethAddress)
      return res.status(400).json({ error: "machineId ve ethAddress zorunlu." });

    // Prepare update data
    const updateData = {
      ethAddress,
      selectedNodeId: selectedNodeId || "node-1"
    };

    // Handle gasFee - convert to Decimal128 if provided
    if (gasFee !== undefined) {
      if (typeof gasFee === 'number' || typeof gasFee === 'string') {
        updateData.gasFee = Decimal128.fromString(String(gasFee));
        console.log("💰 Setting gasFee:", gasFee, "-> Decimal128");
      }
    }

    // Handle gasPaid boolean
    if (gasPaid !== undefined) {
      updateData.gasPaid = Boolean(gasPaid);
      console.log("💳 Setting gasPaid:", gasPaid);
    }

    // Find existing user to preserve gasFee if not provided
    const existingUser = await User.findOne({ machineId });
    
    const user = await User.findOneAndUpdate(
      { machineId },
      {
        ...updateData,
        $setOnInsert: { 
          paymentStatus: false, 
          rewardAddress: makeRewardAddress(),
          // Set default gasFee only for new users if not provided
          ...(gasFee === undefined && !existingUser ? { gasFee: Decimal128.fromString("0.005") } : {}),
          ...(gasPaid === undefined && !existingUser ? { gasPaid: false } : {})
        }
      },
      { upsert: true, new: true }
    );

    console.log("✅ User upserted successfully:", {
      machineId: user.machineId,
      gasFee: user.gasFee,
      gasPaid: user.gasPaid
    });

    if (SIMULATE_PAYMENT) {
      setTimeout(() => {
        User.updateOne({ machineId }, { paymentStatus: true }).catch(console.error);
      }, 15000);
    }

    res.json({ success: true, machineId: user.machineId });
  } catch (e) { 
    console.error("❌ Upsert error:", e);
    res.status(500).json({ error: e.message }); 
  }
};
app.post("/users/upsert", upsertHandler);
app.post("/api/users/upsert", upsertHandler);

/* ---- FULL user document ---- */
app.get("/users/:machineId", async (req, res) => {
  try {
    const user = await User.findOne({ machineId: req.params.machineId }).lean();
    if (!user) return res.status(404).json({ error: "User not found" });
    
    console.log("📖 Returning user data:", {
      machineId: user.machineId,
      gasFee: user.gasFee,
      gasPaid: user.gasPaid
    });
    
    res.json(user);                  // bütün alanları gönder
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- ADMIN PATCH ENDPOINTS ---------- */
app.post("/admin/users/update", adminAuth, async (req, res) => {
  try {
    const { machineId, patch } = req.body;
    if (!machineId || !patch)
      return res.status(400).json({ error: "machineId ve patch zorunlu" });

    if (patch.gasFee !== undefined)
      patch.gasFee = Decimal128.fromString(String(patch.gasFee));

    const user = await User.findOneAndUpdate({ machineId }, patch, { new: true });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/admin/nodes/update", adminAuth, async (req, res) => {
  try {
    const { id, patch } = req.body;
    if (!id || !patch)
      return res.status(400).json({ error: "id ve patch zorunlu" });

    const node = await NodeModel.findOneAndUpdate({ id }, patch, { new: true });
    if (!node) return res.status(404).json({ error: "Node not found" });
    res.json(node);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* machineId listesi panel için */
app.get("/admin/users/list", adminAuth, async (_req, res) => {
  try {
    const ids = await User.find({}, "machineId").lean();
    res.json(ids.map(u => u.machineId));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/***************** START *********************/
app.listen(PORT, () => console.log(`🚀 Server ready on :${PORT} with gasFee support`));