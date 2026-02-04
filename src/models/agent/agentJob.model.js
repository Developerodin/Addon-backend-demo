import mongoose from 'mongoose';
import { toJSON } from '../plugins/index.js';

const agentJobSchema = mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    flowKey: {
      type: String,
      required: true,
      trim: true,
    },
    refType: {
      type: String,
      trim: true,
      default: null,
    },
    refId: {
      type: String,
      trim: true,
      default: null,
    },
    context: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'agent_jobs',
  }
);

agentJobSchema.index({ jobId: 1 });
agentJobSchema.index({ status: 1, createdAt: -1 });

agentJobSchema.plugin(toJSON);

/**
 * @typedef AgentJob
 */
const AgentJob = mongoose.model('AgentJob', agentJobSchema);

export default AgentJob;
