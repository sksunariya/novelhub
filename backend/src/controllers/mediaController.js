const mediaService = require('../services/community/mediaService');
const spaceService = require('../services/community/spaceService');
const permissions = require('../services/community/spacePermissionService');
const settingsService = require('../services/settingsService');
const { asyncHandler } = require('../middlewares/errorHandler');

const requireMediaEnabled = async () => {
  const snapshot = await settingsService.snapshot();
  if (!snapshot.get('spaces.enabled')) throw Object.assign(new Error('Not found'), { status: 404 });
  if (!snapshot.get('spaces.media.enabled')) {
    throw Object.assign(new Error('Media uploads are disabled'), { status: 403 });
  }
  return snapshot;
};

/**
 * Upload images for a post that does not exist yet.
 *
 * The composer uploads as files are dragged in, so there is no post to attach
 * to. These land under the draft prefix and are claimed on submit; anything
 * never claimed is swept.
 */
const uploadDraftMedia = asyncHandler(async (req, res) => {
  await requireMediaEnabled();

  const files = req.files || (req.file ? [req.file] : []);
  if (!files.length) return res.status(400).json({ message: 'No file received' });

  // A space is optional at this point but improves the audit trail if the
  // composer already knows where the post is going.
  let space = null;
  if (req.body.space) {
    const loaded = await spaceService.loadForActor(req.body.space, req.user, req);
    if (!loaded.perms.can.post) {
      return res.status(403).json({ message: 'You cannot post in that space' });
    }
    space = loaded.space;
  }

  const media = await mediaService.uploadMany({
    files,
    user: req.user,
    space,
    post: null,
    limits: req.mediaLimits,
    req,
  });

  return res.status(201).json({ media });
});

/** Attach previously uploaded drafts to a submitted post. */
const claimMedia = asyncHandler(async (req, res) => {
  await requireMediaEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  if (!perms.can.post) return res.status(403).json({ message: 'You cannot post here' });

  const media = await mediaService.claimForPost({
    assetIds: req.body.assetIds,
    post: { _id: req.body.postId },
    space,
    user: req.user,
  });

  return res.json({ media });
});

/** Space icon or banner. Its own byte cap, separate from post media. */
const uploadSpaceImage = asyncHandler(async (req, res) => {
  await requireMediaEnabled();
  const { space, perms } = await spaceService.loadForActor(req.params.slug, req.user, req);
  if (!perms.can.manageSettings) {
    return res.status(403).json({ message: 'You do not have permission to do that' });
  }
  if (!req.file) return res.status(400).json({ message: 'No file received' });

  const kind = req.params.kind === 'banner' ? 'banner' : 'icon';
  const asset = await mediaService.uploadOne({
    file: req.file,
    user: req.user,
    space,
    post: null,
    limits: req.mediaLimits,
    req,
  });

  space[kind === 'banner' ? 'bannerUrl' : 'iconUrl'] = asset.url;
  await space.save();

  return res.json({ [kind]: asset.url });
});

module.exports = { uploadDraftMedia, claimMedia, uploadSpaceImage };
