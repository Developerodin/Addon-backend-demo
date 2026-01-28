import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const providerSchema = mongoose.Schema(
  {
    placeId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      default: null,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    address: {
      type: String,
      trim: true,
      default: null,
    },
    city: {
      type: String,
      trim: true,
      default: null,
    },
    state: {
      type: String,
      trim: true,
      default: null,
    },
    country: {
      type: String,
      default: 'India',
      trim: true,
    },
    latitude: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
    },
    longitude: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
    },
    rating: {
      type: mongoose.Schema.Types.Decimal128,
      min: 0,
      max: 5,
      default: null,
    },
    reviewCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    businessStatus: {
      type: String,
      enum: ['OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY'],
      default: 'OPERATIONAL',
    },
    priceLevel: {
      type: Number,
      min: 1,
      max: 4,
      default: null,
    },
    serviceType: {
      type: String,
      trim: true,
      default: null,
    },
    distanceKm: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
    },
    score: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
    },
    status: {
      type: String,
      enum: ['pending', 'calling', 'available', 'unavailable', 'no_answer', 'failed'],
      default: 'pending',
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
providerSchema.index({ placeId: 1 });
providerSchema.index({ serviceType: 1 });
providerSchema.index({ status: 1 });
providerSchema.index({ createdAt: -1 });
providerSchema.index({ expiresAt: 1 });

// Add plugins
providerSchema.plugin(toJSON);
providerSchema.plugin(paginate);

const Provider = mongoose.model('Provider', providerSchema);

export default Provider;
