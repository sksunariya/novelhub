const mongoose = require('mongoose');

const carouselSlideSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, default: '', maxlength: 200 },
    subtitle: { type: String, trim: true, default: '', maxlength: 300 },
    description: { type: String, trim: true, default: '', maxlength: 1000 },
    imageUrl: { type: String, trim: true, default: '', maxlength: 2000 },
    badgeText: { type: String, trim: true, default: '', maxlength: 50 },
    badgeColor: {
      type: String,
      enum: ['crimson', 'amber', 'emerald', 'azure', 'violet', 'gold', 'rose', 'cyber'],
      default: 'crimson',
    },
    primaryButtonText: { type: String, trim: true, default: 'Start Reading', maxlength: 50 },
    primaryButtonUrl: { type: String, trim: true, default: '/browse', maxlength: 2000 },
    secondaryButtonText: { type: String, trim: true, default: '', maxlength: 50 },
    secondaryButtonUrl: { type: String, trim: true, default: '', maxlength: 2000 },
    novelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Novel', default: null },
    autoSyncWithNovel: { type: Boolean, default: true },
    themeStyle: {
      type: String,
      enum: ['dark-crimson', 'dark-violet', 'dark-gold', 'dark-emerald', 'dark-obsidian', 'dark-cyber'],
      default: 'dark-crimson',
    },
    textAlignment: {
      type: String,
      enum: ['left', 'center'],
      default: 'left',
    },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

carouselSlideSchema.index({ isActive: 1, order: 1 });

module.exports = mongoose.model('CarouselSlide', carouselSlideSchema);
