import mongoose from 'mongoose';
import { toJSON, paginate } from '../plugins/index.js';

const searchHistorySchema = mongoose.Schema(
  {
    requestId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    service: {
      type: String,
      required: true,
      trim: true,
    },
    location: {
      type: String,
      required: true,
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
    radius: {
      type: Number,
      default: 3000,
      min: 0,
    },
    maxResults: {
      type: Number,
      default: 5,
      min: 1,
    },
    filters: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    totalFound: {
      type: Number,
      default: 0,
      min: 0,
    },
    filteredCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    cached: {
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

// Indexes
searchHistorySchema.index({ requestId: 1 });
searchHistorySchema.index({ service: 1 });
searchHistorySchema.index({ location: 1 });
searchHistorySchema.index({ userId: 1 });
searchHistorySchema.index({ createdAt: -1 });

// Add plugins
searchHistorySchema.plugin(toJSON);
searchHistorySchema.plugin(paginate);

const SearchHistory = mongoose.model('SearchHistory', searchHistorySchema);

export default SearchHistory;
