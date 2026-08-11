const mongoose = require('mongoose');

// Atomic sequence generator. A naive "read max and add one" collides under
// concurrency, which for order numbers means two orders sharing an identifier.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  value: { type: Number, default: 0 },
});

counterSchema.statics.next = async function next(name) {
  const row = await this.findOneAndUpdate(
    { _id: name },
    { $inc: { value: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return row.value;
};

module.exports = mongoose.model('Counter', counterSchema);
