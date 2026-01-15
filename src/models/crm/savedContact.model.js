import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const savedContactSchema = mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider',
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
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
      trim: true,
      default: 'India',
    },
    serviceType: {
      type: String,
      trim: true,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
    tags: {
      type: [String],
      default: [],
    },
    lastCalledAt: {
      type: Date,
      default: null,
    },
    callCount: {
      type: Number,
      min: 0,
      default: 0,
    },
    isFavorite: {
      type: Boolean,
      default: false,
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

// Unique constraint on phone + userId combination
savedContactSchema.index({ phone: 1, userId: 1 }, { unique: true });

// Indexes
savedContactSchema.index({ providerId: 1 });
savedContactSchema.index({ phone: 1 });
savedContactSchema.index({ userId: 1 });
savedContactSchema.index({ serviceType: 1 });
savedContactSchema.index({ isFavorite: 1 });
savedContactSchema.index({ lastCalledAt: -1 });

// Add plugins
savedContactSchema.plugin(toJSON);
savedContactSchema.plugin(paginate);

const SavedContact = mongoose.model('SavedContact', savedContactSchema);

export default SavedContact;
