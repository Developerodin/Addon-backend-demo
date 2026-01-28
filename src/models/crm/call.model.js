import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const callSchema = mongoose.Schema(
  {
    requestId: {
      type: String,
      trim: true,
    },
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider',
      default: null,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    businessName: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: ['initiated', 'in_progress', 'completed', 'failed', 'no_answer', 'busy', 'call_disconnected'],
      default: 'initiated',
    },
    language: {
      type: String,
      enum: ['en', 'hi'],
      default: 'en',
    },
    agentId: {
      type: String,
      trim: true,
    },
    externalCallId: {
      type: String,
      trim: true,
    },
    executionId: {
      type: String,
      trim: true,
    },
    duration: {
      type: Number,
      min: 0,
      default: null,
    },
    recordingUrl: {
      type: String,
      trim: true,
      default: null,
    },
    transcription: {
      type: String,
      default: null,
    },
    extractedData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    aiAnalysis: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    userId: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
callSchema.index({ requestId: 1 });
callSchema.index({ providerId: 1 });
callSchema.index({ externalCallId: 1 });
callSchema.index({ status: 1 });
callSchema.index({ language: 1 });
callSchema.index({ startedAt: -1 });
callSchema.index({ userId: 1 });
callSchema.index({ executionId: 1 });

// Add plugins
callSchema.plugin(toJSON);
callSchema.plugin(paginate);

const Call = mongoose.model('Call', callSchema);

export default Call;
