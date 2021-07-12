const mongoose = require('mongoose');
const Token = require('./models/Token');
const Price = require('./models/Price');
const { sleep } = require('./utilities');
require('dotenv').config()

process.title = 'Node - Db Size'


const mongoString = `mongodb://${process.env.DB_USERNAME ? process.env.DB_USERNAME + ':' + process.env.DB_PASSWORD + '@' : ''}${process.env.DB_HOST}/${process.env.DB_NAME}`
mongoose.connect(mongoString, { useNewUrlParser: true, useUnifiedTopology: true });


const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', async () => {
    console.log('DB OPEN');
    while (true) {
        const tokenStats = await Token.collection.stats();
        const priceStats = await Price.collection.stats();
        console.log('--------');
        console.log(new Date().toLocaleTimeString());
        console.log('Token', (tokenStats.storageSize / (1024 * 1024)).toFixed(2), 'MB');
        console.log('Price', (priceStats.storageSize / (1024 * 1024)).toFixed(2), 'MB');
        await sleep(30);
    }
});
