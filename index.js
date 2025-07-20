const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

const mongoURI = "mongodb+srv://safepal:123123Aa.@cluster0.dtjy4my.mongodb.net/ethNodesDB";
mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => console.log("✅ MongoDB connected"))
.catch(err => console.error("❌ MongoDB error:", err));

const NodeModel = mongoose.model("Node", new mongoose.Schema({
  id: String,
  name: String,
  requiredEth: String,
  estimatedReward: String,
  validatorAddress: String,
  status: String,
  statusColor: String,
  reliability: Number,
  countdown: Number
}, { collection: "nodes" }));

app.get("/nodes", async (req, res) => {
  try {
    const nodes = await NodeModel.find();
    res.json(nodes);
  } catch (err) {
    res.status(500).json({ error: "Failed to load nodes" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server ready at http://localhost:${PORT}`);
});
