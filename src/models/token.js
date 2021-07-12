const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const TokenSchema = new Schema({
    address: { type: String, default: '', trim: true, required: true, minlength: 42, maxlength: 42 },
    name: { type: String, trim: true, maxlength: 200 },
    symbol: { type: String, trim: true, maxlength: 200 },
    decimals: { type: Number },
    totalSupply: { type: Number },
    created: { type: Date, required: true },
    verified: { type: Boolean, default: false },
    pancakeV2Pair: { type: String }
});

module.exports = mongoose.model('Token', TokenSchema);
