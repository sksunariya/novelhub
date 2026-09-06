// The admin portal previews a pasted list and an uploaded CSV as the admin
// types, which means the parser has to run in the browser too. Rather than
// maintain the same logic twice, frontend/src/utils/emailList.js is generated
// from the backend one. This test is what stops the two drifting: change the
// parser without regenerating and the suite fails here, instead of the portal
// quietly showing counts the server disagrees with.

const fs = require('fs');
const { build, TARGET } = require('../scripts/buildEmailListMirror');

const describeIfFrontend = fs.existsSync(TARGET) ? describe : describe.skip;

describeIfFrontend('frontend emailList mirror', () => {
  it('matches the generated output of the backend parser', () => {
    const current = fs.readFileSync(TARGET, 'utf8');
    const expected = build();

    if (current !== expected) {
      throw new Error(
        'frontend/src/utils/emailList.js is out of date with backend/src/utils/emailList.js.\n' +
          'Regenerate it: cd backend && node scripts/buildEmailListMirror.js'
      );
    }
    expect(current).toBe(expected);
  });

  it('exports the parser as ES modules, not CommonJS', () => {
    const current = fs.readFileSync(TARGET, 'utf8');
    expect(current).toMatch(/^export \{$/m);
    expect(current).not.toMatch(/module\.exports/);
    expect(current).not.toMatch(/\brequire\(/);
  });
});
