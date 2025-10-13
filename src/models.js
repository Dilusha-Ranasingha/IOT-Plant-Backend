import mongoose from "mongoose";

export async function connectMongo(uri) {
  await mongoose.connect(uri, { autoIndex: true });
  console.log("[mongo] connected");
}

const ReadingSchema = new mongoose.Schema({
  ts: { type: Date, required: true },
  deviceId: { type: String, index: true },
  t_c: Number,
  h_pct: Number,
  soil_pct: Number
}, { timestamps: true });

export const Reading = mongoose.model("Reading", ReadingSchema);

const DisplaySchema = new mongoose.Schema({
  ts: Date,
  deviceId: String,
  payload: mongoose.Schema.Types.Mixed
}, { timestamps: true });

export const Display = mongoose.model("Display", DisplaySchema);