const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const PriceSchema = new Schema({
    token_id: { type: Schema.Types.ObjectId },
    value: { type: Number },
}, { timestamps: true });

module.exports = mongoose.model('Price', PriceSchema);
