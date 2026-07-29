const bcrypt = require('bcryptjs');
const User = require('../src/models/User');

describe('User password hashing', () => {
  it('hashes a plaintext password on save by default', async () => {
    const user = await User.create({ username: 'plainuser', email: 'plain@test.com', password: 'secret123' });
    const stored = await User.findById(user._id).select('+password');
    expect(stored.password).not.toBe('secret123');
    expect(await stored.comparePassword('secret123')).toBe(true);
  });

  it('stores an already-hashed password verbatim when flagged', async () => {
    const preHash = await bcrypt.hash('secret123', 10);
    const user = new User({ username: 'preuser', email: 'pre@test.com' });
    user.password = preHash;
    user.$locals.passwordAlreadyHashed = true;
    await user.save();
    const stored = await User.findById(user._id).select('+password');
    expect(stored.password).toBe(preHash);
    expect(await stored.comparePassword('secret123')).toBe(true);
  });
});
