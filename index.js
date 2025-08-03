const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// ---- MongoDB ----
const mongoURI = "mongodb+srv://safepal:123123Aa.@cluster0.dtjy4my.mongodb.net/ethNodesDB";
mongoose.set("strictQuery", true);
mongoose
  .connect(mongoURI)
  .then(async () => {
    console.log("✅ MongoDB connected");

    // Index'leri burada oluşturuyoruz (varsa dokunmaz, yoksa kurar)
    try {
      await User.init(); // unique index'leri uygular
      await NodeModel.init();
      console.log("✅ Indexes ensured");
    } catch (e) {
      console.warn("⚠️ Index ensure warning:", e.message);
    }
  })
  .catch((err) => console.error("❌ MongoDB error:", err.message));

// ---- Schemas & Models ----
// Nodes (mevcut yapınızı korudum)
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
// "id" alanına hızlı erişim için index (duplicate varsa unique hata verir)
NodeSchema.index({ id: 1 }, { unique: false });
const NodeModel = mongoose.model("Node", NodeSchema);

// Users (ödeme/polling akışı)
const UserSchema = new mongoose.Schema(
  {
    machineId: { type: String, required: true, unique: true },
    ethAddress: { type: String, required: true },
    paymentStatus: { type: Boolean, default: false },
    rewardAddress: { type: String, required: true },
    selectedNode: { type: String },
  },
  {
    collection: "users",
    timestamps: { createdAt: "createdAt", updatedAt: "updatedAt" }
  }
);
UserSchema.index({ machineId: 1 }, { unique: true });
UserSchema.index({ paymentStatus: 1 });
const User = mongoose.model("User", UserSchema);

// ---- Helpers ----
const makeRewardAddress = () =>
  "0x" + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

const SIMULATE_PAYMENT = String(process.env.SIMULATE_PAYMENT || "false").toLowerCase() === "true";

// ---- Routes ----
app.get("/health", (req, res) => res.json({ ok: true }));

// === NODES ===
// Tüm node'lar
app.get("/nodes", async (req, res) => {
  try {
    const nodes = await NodeModel.find();
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: "Failed to load nodes" });
  }
});

// Tek node
app.get("/nodes/:id", async (req, res) => {
  try {
    const node = await NodeModel.findOne({ id: req.params.id });
    if (!node) return res.status(404).json({ error: "Node not found" });
    res.json(node);
  } catch (err) {
    console.error("Error fetching node:", err);
    res.status(500).json({ error: "Failed to load node" });
  }
});

// === USERS ===
// Upsert (Search sayfasında çağırın)
// Body: { machineId, ethAddress, selectedNode? }
const upsertHandler = async (req, res) => {
  try {
    const { machineId, ethAddress, selectedNode } = req.body;
    if (!machineId || !ethAddress) {
      return res.status(400).json({ error: "machineId ve ethAddress zorunlu." });
    }

    const now = new Date();

    const user = await User.findOneAndUpdate(
      { machineId },
      {
        ethAddress,
        selectedNode: selectedNode || "node-1",
        $setOnInsert: {
          paymentStatus: false,
          rewardAddress: makeRewardAddress(),
        }
      },
      { upsert: true, new: true }
    );

    // Opsiyonel: otomatik ödeme onayı simülasyonu
    if (SIMULATE_PAYMENT) {
      setTimeout(async () => {
        try {
          await User.findOneAndUpdate(
            { machineId },
            { paymentStatus: true }
          );
          console.log(`💸 Payment confirmed (simulated) for ${machineId}`);
        } catch (e) {
          console.error("Simulated payment error:", e.message);
        }
      }, 15000);
    }

    res.json({
      success: true,
      machineId: user.machineId,
      paymentStatus: user.paymentStatus,
      rewardAddress: user.rewardAddress,
      selectedNode: user.selectedNode
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// alias: /users/upsert ve /api/users/upsert
app.post("/users/upsert", upsertHandler);
app.post("/api/users/upsert", upsertHandler);

// Kullanıcı getir (Payment Confirmation polling & Countdown başlangıcı)
// Path: /users/:machineId  VE /api/users/:machineId
const getUserHandler = async (req, res) => {
  try {
    const { machineId } = req.params;
    const user = await User.findOne({ machineId });
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({
      machineId: user.machineId,
      paymentStatus: user.paymentStatus,
      rewardAddress: user.rewardAddress,
      ethAddress: user.ethAddress,
      selectedNode: user.selectedNode
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
app.get("/users/:machineId", getUserHandler);
app.get("/api/users/:machineId", getUserHandler);

// (İsteğe bağlı) paymentStatus true yapma endpoint'i (admin/test)
app.post("/users/confirm-payment", async (req, res) => {
  try {
    const { machineId } = req.body;
    if (!machineId) return res.status(400).json({ error: "machineId gerekli" });

    const user = await User.findOneAndUpdate(
      { machineId },
      { paymentStatus: true },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: "User not found" });

    res.json({ success: true, paymentStatus: user.paymentStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Start ----
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server ready at http://localhost:${PORT}`);
});
