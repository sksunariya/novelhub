const CarouselSlide = require('../models/CarouselSlide');
const Novel = require('../models/Novel');
const SiteSettings = require('../models/SiteSettings');
const storage = require('../services/storage');
const mongoose = require('mongoose');

/**
 * Format slide object for client consumption
 */
const formatSlide = (slide) => {
  const s = slide.toObject ? slide.toObject() : slide;
  const novel = s.novelId && typeof s.novelId === 'object' && !s.novelId.deletedAt && s.novelId.published ? s.novelId : null;

  let title = s.title;
  let subtitle = s.subtitle;
  let description = s.description;
  let imageUrl = s.imageUrl;
  let primaryButtonUrl = s.primaryButtonUrl || '/browse';
  let secondaryButtonUrl = s.secondaryButtonUrl || '';
  let badgeText = s.badgeText;

  if (novel && s.autoSyncWithNovel) {
    if (!title) title = novel.title;
    if (!subtitle) subtitle = `By ${novel.author} • ${novel.status.toUpperCase()}`;
    if (!description) description = novel.synopsis ? (novel.synopsis.length > 200 ? novel.synopsis.slice(0, 200) + '...' : novel.synopsis) : '';
    if (!imageUrl) imageUrl = novel.coverUrl;
    if (!primaryButtonUrl || primaryButtonUrl === '/browse') primaryButtonUrl = `/novel/${novel.slug}`;
    if (!secondaryButtonUrl) secondaryButtonUrl = `/novel/${novel.slug}`;
    if (!badgeText) {
      if (novel.ratingAvg > 0) {
        badgeText = `★ ${novel.ratingAvg.toFixed(1)} RATING`;
      } else if (novel.genres && novel.genres.length > 0) {
        badgeText = novel.genres[0].toUpperCase();
      } else {
        badgeText = 'FEATURED NOVEL';
      }
    }
  }

  return {
    _id: s._id,
    title: title || 'Apex NovelHub',
    subtitle: subtitle || 'Where dark tales come alive',
    description: description || 'Discover thousands of incredible fantasy, dark romance, and web novels.',
    imageUrl: imageUrl || '',
    badgeText: badgeText || 'FEATURED',
    badgeColor: s.badgeColor || 'crimson',
    primaryButtonText: s.primaryButtonText || 'Start Reading',
    primaryButtonUrl: primaryButtonUrl,
    secondaryButtonText: s.secondaryButtonText || (novel ? 'View Details' : 'Top Novels'),
    secondaryButtonUrl: secondaryButtonUrl || (novel ? `/novel/${novel.slug}` : '/rankings'),
    themeStyle: s.themeStyle || 'dark-crimson',
    textAlignment: s.textAlignment || 'left',
    novelSlug: novel ? novel.slug : null,
    novel: novel
      ? {
          _id: novel._id,
          title: novel.title,
          slug: novel.slug,
          coverUrl: novel.coverUrl,
          author: novel.author,
          ratingAvg: novel.ratingAvg,
          chapterCount: novel.chapterCount,
        }
      : null,
    order: s.order || 0,
  };
};

/**
 * Generate dynamic slide from a Novel model document
 */
const generateDynamicSlideFromNovel = (novel, index) => {
  const colors = ['crimson', 'violet', 'amber', 'azure', 'gold'];
  const themes = ['dark-crimson', 'dark-violet', 'dark-gold', 'dark-emerald', 'dark-obsidian'];
  const badgeColor = colors[index % colors.length];
  const themeStyle = themes[index % themes.length];

  let badgeText = 'TRENDING';
  if (novel.featured) badgeText = 'FEATURED NOVEL';
  else if (novel.ratingAvg >= 4.5) badgeText = `★ ${novel.ratingAvg.toFixed(1)} TOP RATED`;
  else if (novel.genres && novel.genres.length > 0) badgeText = novel.genres[0].toUpperCase();

  return {
    _id: `dynamic-${novel._id}`,
    title: novel.title,
    subtitle: `By ${novel.author} • ${novel.chapterCount || 0} Chapters`,
    description: novel.synopsis ? (novel.synopsis.length > 220 ? novel.synopsis.slice(0, 220) + '...' : novel.synopsis) : 'Read this captivating novel on Apex NovelHub.',
    imageUrl: novel.coverUrl || '',
    badgeText: badgeText,
    badgeColor: badgeColor,
    primaryButtonText: 'Start Reading',
    primaryButtonUrl: `/novel/${novel.slug}`,
    secondaryButtonText: 'Novel Details',
    secondaryButtonUrl: `/novel/${novel.slug}`,
    themeStyle: themeStyle,
    textAlignment: 'left',
    novelSlug: novel.slug,
    novel: {
      _id: novel._id,
      title: novel.title,
      slug: novel.slug,
      coverUrl: novel.coverUrl,
      author: novel.author,
      ratingAvg: novel.ratingAvg,
      chapterCount: novel.chapterCount,
    },
    order: index,
  };
};

/**
 * GET /api/carousel (Public)
 */
exports.getPublicSlides = async (req, res) => {
  try {
    const settings = await SiteSettings.getSettings();
    const mode = settings.carouselMode || 'hybrid';

    let slides = [];

    if (mode === 'hybrid' || mode === 'custom_only') {
      const now = new Date();
      const rawSlides = await CarouselSlide.find({
        isActive: true,
        $and: [
          { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
          { $or: [{ endDate: null }, { endDate: { $gte: now } }] },
        ],
      })
        .populate('novelId')
        .sort({ order: 1, createdAt: -1 });

      slides = rawSlides.map(formatSlide);
    }

    // Auto-fill from top novels if mode is 'auto_smart' or 'hybrid' with < 4 custom slides
    if (mode === 'auto_smart' || (mode === 'hybrid' && slides.length < 4)) {
      const existingNovelIds = slides
        .map((s) => s.novel?._id)
        .filter(Boolean)
        .map((id) => new mongoose.Types.ObjectId(String(id)));
      const needed = 5 - slides.length;

      const topNovels = await Novel.find({
        published: true,
        deletedAt: null,
        _id: { $nin: existingNovelIds },
      })
        .sort({ featured: -1, weeklyViews: -1, ratingAvg: -1 })
        .limit(needed);

      const dynamicSlides = topNovels.map((novel, idx) => generateDynamicSlideFromNovel(novel, slides.length + idx));
      slides = [...slides, ...dynamicSlides];
    }

    return res.json({
      slides,
      settings: {
        autoPlayInterval: settings.carouselAutoPlayInterval || 6,
        enableAutoPlay: settings.enableCarouselAutoPlay !== false,
      },
    });
  } catch (error) {
    console.error('getPublicSlides error:', error);
    return res.status(500).json({ message: 'Failed to fetch carousel slides' });
  }
};

/**
 * GET /api/admin/carousel (Admin)
 */
exports.getAdminSlides = async (req, res) => {
  try {
    const slides = await CarouselSlide.find().populate('novelId').sort({ order: 1, createdAt: -1 });
    return res.json(slides);
  } catch (error) {
    console.error('getAdminSlides error:', error);
    return res.status(500).json({ message: 'Failed to fetch admin slides' });
  }
};

/**
 * POST /api/admin/carousel (Admin)
 */
exports.createSlide = async (req, res) => {
  try {
    const {
      title,
      subtitle,
      description,
      imageUrl,
      badgeText,
      badgeColor,
      primaryButtonText,
      primaryButtonUrl,
      secondaryButtonText,
      secondaryButtonUrl,
      novelId,
      autoSyncWithNovel,
      themeStyle,
      textAlignment,
      isActive,
      startDate,
      endDate,
    } = req.body;

    let finalImageUrl = imageUrl || '';

    if (req.file) {
      finalImageUrl = await storage.uploadPublic(req.file, 'carousel');
    }

    const lastSlide = await CarouselSlide.findOne().sort({ order: -1 });
    const order = lastSlide ? lastSlide.order + 1 : 0;

    const slide = await CarouselSlide.create({
      title: title || '',
      subtitle: subtitle || '',
      description: description || '',
      imageUrl: finalImageUrl,
      badgeText: badgeText || '',
      badgeColor: badgeColor || 'crimson',
      primaryButtonText: primaryButtonText || 'Start Reading',
      primaryButtonUrl: primaryButtonUrl || '/browse',
      secondaryButtonText: secondaryButtonText || '',
      secondaryButtonUrl: secondaryButtonUrl || '',
      novelId: novelId || null,
      autoSyncWithNovel: autoSyncWithNovel !== 'false' && autoSyncWithNovel !== false,
      themeStyle: themeStyle || 'dark-crimson',
      textAlignment: textAlignment || 'left',
      order,
      isActive: isActive !== 'false' && isActive !== false,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      createdBy: req.user._id,
    });

    const populated = await CarouselSlide.findById(slide._id).populate('novelId');
    return res.status(201).json(populated);
  } catch (error) {
    console.error('createSlide error:', error);
    return res.status(400).json({ message: error.message || 'Failed to create carousel slide' });
  }
};

/**
 * PUT /api/admin/carousel/:id (Admin)
 */
exports.updateSlide = async (req, res) => {
  try {
    const slide = await CarouselSlide.findById(req.params.id);
    if (!slide) {
      return res.status(404).json({ message: 'Slide not found' });
    }

    const {
      title,
      subtitle,
      description,
      imageUrl,
      badgeText,
      badgeColor,
      primaryButtonText,
      primaryButtonUrl,
      secondaryButtonText,
      secondaryButtonUrl,
      novelId,
      autoSyncWithNovel,
      themeStyle,
      textAlignment,
      isActive,
      startDate,
      endDate,
    } = req.body;

    if (req.file) {
      if (slide.imageUrl) {
        try {
          await storage.remove(slide.imageUrl);
        } catch (imgErr) {
          console.error('Failed to remove old slide image (best-effort):', imgErr);
        }
      }
      slide.imageUrl = await storage.uploadPublic(req.file, 'carousel');
    } else if (imageUrl !== undefined) {
      if (imageUrl !== slide.imageUrl && slide.imageUrl) {
        try {
          await storage.remove(slide.imageUrl);
        } catch (imgErr) {
          console.error('Failed to remove old slide image (best-effort):', imgErr);
        }
      }
      slide.imageUrl = imageUrl;
    }

    if (title !== undefined) slide.title = title;
    if (subtitle !== undefined) slide.subtitle = subtitle;
    if (description !== undefined) slide.description = description;
    if (badgeText !== undefined) slide.badgeText = badgeText;
    if (badgeColor !== undefined) slide.badgeColor = badgeColor;
    if (primaryButtonText !== undefined) slide.primaryButtonText = primaryButtonText;
    if (primaryButtonUrl !== undefined) slide.primaryButtonUrl = primaryButtonUrl;
    if (secondaryButtonText !== undefined) slide.secondaryButtonText = secondaryButtonText;
    if (secondaryButtonUrl !== undefined) slide.secondaryButtonUrl = secondaryButtonUrl;
    if (novelId !== undefined) slide.novelId = novelId || null;
    if (autoSyncWithNovel !== undefined) slide.autoSyncWithNovel = autoSyncWithNovel === 'true' || autoSyncWithNovel === true;
    if (themeStyle !== undefined) slide.themeStyle = themeStyle;
    if (textAlignment !== undefined) slide.textAlignment = textAlignment;
    if (isActive !== undefined) slide.isActive = isActive === 'true' || isActive === true;
    if (startDate !== undefined) slide.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) slide.endDate = endDate ? new Date(endDate) : null;

    await slide.save();

    const populated = await CarouselSlide.findById(slide._id).populate('novelId');
    return res.json(populated);
  } catch (error) {
    console.error('updateSlide error:', error);
    return res.status(400).json({ message: error.message || 'Failed to update carousel slide' });
  }
};

/**
 * DELETE /api/admin/carousel/:id (Admin)
 */
exports.deleteSlide = async (req, res) => {
  try {
    const slide = await CarouselSlide.findById(req.params.id);
    if (!slide) {
      return res.status(404).json({ message: 'Slide not found' });
    }

    if (slide.imageUrl) {
      try {
        await storage.remove(slide.imageUrl);
      } catch (imgErr) {
        console.error('Failed to remove slide image (best-effort):', imgErr);
      }
    }

    await CarouselSlide.deleteOne({ _id: slide._id });
    return res.json({ message: 'Carousel slide deleted successfully' });
  } catch (error) {
    console.error('deleteSlide error:', error);
    return res.status(500).json({ message: 'Failed to delete carousel slide' });
  }
};

/**
 * PUT /api/admin/carousel/reorder (Admin)
 */
exports.reorderSlides = async (req, res) => {
  try {
    const { slideIds } = req.body;
    if (!Array.isArray(slideIds)) {
      return res.status(400).json({ message: 'slideIds must be an array' });
    }

    const updates = slideIds.map((id, index) =>
      CarouselSlide.updateOne({ _id: id }, { $set: { order: index } })
    );

    await Promise.all(updates);
    return res.json({ message: 'Carousel slides reordered successfully' });
  } catch (error) {
    console.error('reorderSlides error:', error);
    return res.status(500).json({ message: 'Failed to reorder slides' });
  }
};
