#!/usr/bin/env node
// Generates frontend/src/utils/emailList.js from backend/src/utils/emailList.js.
//
// The admin portal previews a pasted list or an uploaded CSV as the admin types,
// which means the parser has to run in the browser; the server still re-parses
// on dispatch and its numbers win. Rather than maintain the same 300 lines
// twice and let them drift, the frontend copy is generated: same source, only
// the export syntax differs.
//
//   node scripts/buildEmailListMirror.js          # write the copy
//   node scripts/buildEmailListMirror.js --check  # fail if it is stale
//
// tests/emailListMirror.unit.test.js runs the --check path, so a change to the
// parser that forgets the copy fails the suite instead of shipping a preview
// that disagrees with the server.

const fs = require('fs');
const path = require('path');

const SOURCE = path.join(__dirname, '..', 'src', 'utils', 'emailList.js');
const TARGET = path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'emailList.js');

const EXPORT_NAMES = [
  'MAX_RECIPIENTS',
  'MAX_EMAIL_LENGTH',
  'INVALID_SAMPLE_LIMIT',
  'normalizeEmail',
  'isValidEmail',
  'parseEmailList',
  'parseEmailCsv',
  'mergeParseResults',
];

const HEADER = [
  '// GENERATED FILE - DO NOT EDIT.',
  '//',
  '// Source: backend/src/utils/emailList.js',
  '// Regenerate: cd backend && node scripts/buildEmailListMirror.js',
  '//',
  '// This copy exists so the admin portal can validate a pasted list or an',
  '// uploaded CSV as it is typed, with no round trip. It is a preview only: the',
  '// server re-parses the same input on dispatch and its counts are the real',
  '// ones. Edit the backend file and rerun the generator.',
  '',
].join('\n');

const build = () => {
  const source = fs.readFileSync(SOURCE, 'utf8');

  const exportBlock = `module.exports = {\n${EXPORT_NAMES.map((name) => `  ${name},`).join('\n')}\n};\n`;
  if (!source.includes(exportBlock)) {
    throw new Error(
      'buildEmailListMirror: the export block in src/utils/emailList.js does not match ' +
        'EXPORT_NAMES. Update EXPORT_NAMES in this script to match the module exports.'
    );
  }

  const body = source
    .replace(exportBlock, `export {\n${EXPORT_NAMES.map((name) => `  ${name},`).join('\n')}\n};\n`)
    // The backend file's own header explains the duplication from the other
    // side; the generated one carries the do-not-edit notice instead.
    .replace(/^\/\/ Recipient-list parsing[\s\S]*?guards the behaviour\.\n/, '');

  return `${HEADER}${body}`;
};

const main = () => {
  const expected = build();
  const check = process.argv.includes('--check');

  const current = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, 'utf8') : null;
  if (current === expected) {
    if (!check) console.log('emailList mirror already up to date.');
    return 0;
  }

  if (check) {
    console.error(
      `emailList mirror is stale.\n  ${path.relative(process.cwd(), TARGET)} does not match ` +
        'the generated output.\n  Run: node scripts/buildEmailListMirror.js'
    );
    return 1;
  }

  fs.mkdirSync(path.dirname(TARGET), { recursive: true });
  fs.writeFileSync(TARGET, expected);
  console.log(`Wrote ${path.relative(process.cwd(), TARGET)}`);
  return 0;
};

module.exports = { build, SOURCE, TARGET };

if (require.main === module) process.exit(main());
