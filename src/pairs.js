const Web3 = require('web3');
const Big = require('big.js');
const mongoose = require('mongoose');
const cron = require('node-cron');
const {
    performance
} = require('perf_hooks');
require('dotenv').config();

process.title = 'Node - Pairs';

const Token = require('./models/Token');

const PromisifyBatchRequest = require('./PromisifyBatchRequest');

const mongoString = `mongodb://${process.env.DB_USERNAME ? process.env.DB_USERNAME + ':' + process.env.DB_PASSWORD + '@' : ''}${process.env.DB_HOST}/${process.env.DB_NAME}`
mongoose.connect(mongoString, { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;

const parseHrtimeToSeconds = (hrtime) => (hrtime[0] + (hrtime[1] / 1e9));

const pancakeV2PairFinder = async () => {
    const pancakeFactoryABI =
        [
            {
                "constant": true,
                "inputs": [
                    { "internalType": "address", "name": "", "type": "address" },
                    { "internalType": "address", "name": "", "type": "address" }
                ],
                "name": "getPair",
                "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
                "payable": false,
                "stateMutability": "view",
                "type": "function"
            }
        ];
    const web3 = new Web3('https://bsc-dataseed.binance.org/');
    const batchSize = 3900;
    const bnbAddress = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
    const pancakeFactoryAddress = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';

    const minuteId = new Date().getMinutes();
    console.log(minuteId, 'pairs', 'start');
    const allStartTime = process.hrtime();
    let tokensWithoutV2PairCount = await Token.collection.countDocuments({ pancakeV2Pair: null });
    const tokensUpdateBulk = Token.collection.initializeUnorderedBulkOp();

    let counter = 0;
    let web3Duration = 0;
    while (tokensWithoutV2PairCount > 0) {
        const tokensWithoutV2Pair = await Token.find({ pancakeV2Pair: null }).skip(batchSize * counter).limit(batchSize);
        const pancakeFactoryContract = await new web3.eth.Contract(pancakeFactoryABI, pancakeFactoryAddress);

        const pairsBatch = new PromisifyBatchRequest(web3);
        for (const token of tokensWithoutV2Pair) {
            pairsBatch.add(pancakeFactoryContract.methods.getPair(bnbAddress, token.address).call.request);
        }

        const pairsBatchStartTime = process.hrtime();
        const pairsAddresses = await pairsBatch.execute();
        web3Duration += parseHrtimeToSeconds(process.hrtime(pairsBatchStartTime));

        for await (const [i, token] of tokensWithoutV2Pair.entries()) {
            const pairAddress = pairsAddresses[i];
            if (pairAddress !== '0x0000000000000000000000000000000000000000') {
                tokensUpdateBulk.find({ _id: token._id }).update({ $set: { pancakeV2Pair: pairAddress } });
            }
        }

        tokensWithoutV2PairCount -= batchSize;
        counter++;
    }

    const mongoDbDurationStart = process.hrtime();
    await tokensUpdateBulk.execute();
    const mongoDbDuration = parseHrtimeToSeconds(process.hrtime(mongoDbDurationStart));
    const allDuration = parseHrtimeToSeconds(process.hrtime(allStartTime));
    console.log(minuteId, 'pairs', 'end', `(all: ${allDuration.toFixed(2)}s, web3: ${web3Duration.toFixed(2)}s, mongoDb: ${mongoDbDuration.toFixed(2)}s)`)
}

db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', async () => {
    console.log('MongoDb connection opened.');
    cron.schedule('* * * * *', pancakeV2PairFinder);
});