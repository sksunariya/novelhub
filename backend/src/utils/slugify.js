const slugify = (text) =>
  text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const uniqueSlug = async (Model, title) => {
  const base = slugify(title) || 'novel';
  let slug = base;
  let counter = 1;
  while (await Model.exists({ slug })) {
    slug = `${base}-${counter}`;
    counter += 1;
  }
  return slug;
};

module.exports = { slugify, uniqueSlug };
