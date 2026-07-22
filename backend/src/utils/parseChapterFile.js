const fs = require('fs/promises');
const path = require('path');
const mammoth = require('mammoth');

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const textToHtml = (text) =>
  text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br/>')}</p>`)
    .join('');

const parseChapterFile = async (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.docx') {
    const result = await mammoth.convertToHtml({ path: filePath });
    return result.value;
  }
  if (ext === '.txt') {
    const raw = await fs.readFile(filePath, 'utf-8');
    return textToHtml(raw);
  }
  throw new Error(`Unsupported file type: ${ext}`);
};

const parseChapterBuffer = async (buffer, filename) => {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.docx') {
    const result = await mammoth.convertToHtml({ buffer });
    return result.value;
  }
  if (ext === '.txt') {
    return textToHtml(buffer.toString('utf-8'));
  }
  throw new Error(`Unsupported file type: ${ext}`);
};

const titleFromFilename = (filename) => {
  const base = path.basename(filename, path.extname(filename));
  return base.replace(/[-_]+/g, ' ').trim();
};

module.exports = { parseChapterFile, parseChapterBuffer, textToHtml, titleFromFilename };
