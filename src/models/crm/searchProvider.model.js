import mongoose from 'mongoose';
import { toJSON } from '../plugins/index.js';

const searchProviderSchema = mongoose.Schema(
  {
    searchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SearchHistory',
      required: true,
    },
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider',
      required: true,
    },
    rank: {
      type: Number,
      required: true,
      min: 1,
    },
    score: {
      type: mongoose.Schema.Types.Decimal128,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Unique constraint: one provider can only appear once per search
searchProviderSchema.index({ searchId: 1, providerId: 1 }, { unique: true });

// Indexes
searchProviderSchema.index({ searchId: 1 });
searchProviderSchema.index({ providerId: 1 });
searchProviderSchema.index({ rank: 1 });
searchProviderSchema.index({ createdAt: -1 });

// Add plugins
searchProviderSchema.plugin(toJSON);

const SearchProvider = mongoose.model('SearchProvider', searchProviderSchema);

export default SearchProvider;
