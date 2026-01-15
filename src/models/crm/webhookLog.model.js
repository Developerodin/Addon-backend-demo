import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const webhookLogSchema = mongoose.Schema(
  {
    executionId: {
      type: String,
      required: true,
      trim: true,
    },
    callId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Call',
      default: null,
    },
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider',
      default: null,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      trim: true,
      default: null,
    },
    transcript: {
      type: String,
      default: null,
    },
    extractedData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    recordingUrl: {
      type: String,
      trim: true,
      default: null,
    },
    telephonyData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    conversationDuration: {
      type: Number,
      min: 0,
      default: null,
    },
    totalCost: {
      type: Number,
      min: 0,
      default: null,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
webhookLogSchema.index({ executionId: 1 });
webhookLogSchema.index({ callId: 1 });
webhookLogSchema.index({ providerId: 1 });
webhookLogSchema.index({ receivedAt: -1 });

// Add plugins
webhookLogSchema.plugin(toJSON);
webhookLogSchema.plugin(paginate);

const WebhookLog = mongoose.model('WebhookLog', webhookLogSchema);

export default WebhookLog;
