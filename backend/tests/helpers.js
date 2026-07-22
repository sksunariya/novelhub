const request = require('supertest');
const app = require('../src/app');
const User = require('../src/models/User');
const Novel = require('../src/models/Novel');
const Chapter = require('../src/models/Chapter');
const { ROLES } = require('../src/config/constants');
const generateToken = require('../src/utils/generateToken');

const createUser = async (overrides = {}) => {
  const user = await User.create({
    username: overrides.username || `user${Date.now()}${Math.floor(Math.random() * 1000)}`,
    email: overrides.email || `user${Date.now()}${Math.floor(Math.random() * 1000)}@test.com`,
    password: overrides.password || 'password123',
    role: overrides.role || ROLES.USER,
    banned: overrides.banned || false,
  });
  return { user, token: generateToken(user._id) };
};

const createAdmin = (overrides = {}) => createUser({ ...overrides, role: ROLES.ADMIN });

const createNovel = (overrides = {}) =>
  Novel.create({
    title: overrides.title || 'Test Novel',
    slug: overrides.slug || `test-novel-${Date.now()}${Math.floor(Math.random() * 1000)}`,
    author: overrides.author || 'Test Author',
    synopsis: overrides.synopsis || 'A test synopsis',
    genres: overrides.genres || ['Fantasy'],
    tags: overrides.tags || ['magic'],
    ...overrides,
  });

const createChapter = (novel, overrides = {}) =>
  Chapter.create({
    novel: novel._id,
    number: overrides.number || 1,
    title: overrides.title || 'Chapter One',
    content: overrides.content || '<p>Chapter content</p>',
    ...overrides,
  });

const api = () => request(app);

module.exports = { createUser, createAdmin, createNovel, createChapter, api };
