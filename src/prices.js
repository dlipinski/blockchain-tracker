const Web3 = require('web3');
const Big = require('big.js');
const mongoose = require('mongoose');
const cron = require('node-cron');
const {
    performance
} = require('perf_hooks');
require('dotenv').config();

process.title = 'Node - Prices';

const Token = require('./models/Token');
const Price = require('./models/Price');

const PromisifyBatchRequest = require('./PromisifyBatchRequest');

const mongoString = `mongodb://${process.env.DB_USERNAME ? process.env.DB_USERNAME + ':' + process.env.DB_PASSWORD + '@' : ''}${process.env.DB_HOST}/${process.env.DB_NAME}`
mongoose.connect(mongoString, { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;

const getBnbUsdPrice = async () => {
    const pancakePairABI =
        [
            {
                "constant": true,
                "inputs": [],
                "name": "getReserves",
                "outputs": [
                    { "internalType": "uint112", "name": "_reserve0", "type": "uint112" },
                    { "internalType": "uint112", "name": "_reserve1", "type": "uint112" },
                    {
                        "internalType": "uint32",
                        "name": "_blockTimestampLast",
                        "type": "uint32"
                    }
                ],
                "payable": false,
                "stateMutability": "view",
                "type": "function"
            }
        ];
    const web3 = new Web3('https://bsc-dataseed.binance.org/');
    const bnbBusdPairAddress = '0x1B96B92314C44b159149f7E0303511fB2Fc4774f';
    const bnbBusdPairContract = await new web3.eth.Contract(pancakePairABI, bnbBusdPairAddress);
    const reserves = await bnbBusdPairContract.methods.getReserves().call();
    const _reserve0 = new Big(reserves._reserve0);
    const _reserve1 = new Big(reserves._reserve1);
    return _reserve1.div(_reserve0);
}

const countTokenPrice = (bnbUsdPrice, reserves, tokenDecimals) => {
    const bnbDecimals = 18;
    const _reserve0 = new Big(reserves._reserve0).div(new Big(10).pow(tokenDecimals));
    const _reserve1 = new Big(reserves._reserve1).div(new Big(10).pow(bnbDecimals));
    const tokenBnbPrice = _reserve1.div(_reserve0);
    const tokenUsdPrice = tokenBnbPrice.times(bnbUsdPrice);
    return tokenUsdPrice;
}

const parseHrtimeToSeconds = (hrtime) => (hrtime[0] + (hrtime[1] / 1e9));

const pancakeV2PriceFinder = async () => {
    const pancakePairABI =
        [
            {
                "constant": true,
                "inputs": [],
                "name": "getReserves",
                "outputs": [
                    { "internalType": "uint112", "name": "_reserve0", "type": "uint112" },
                    { "internalType": "uint112", "name": "_reserve1", "type": "uint112" },
                    {
                        "internalType": "uint32",
                        "name": "_blockTimestampLast",
                        "type": "uint32"
                    }
                ],
                "payable": false,
                "stateMutability": "view",
                "type": "function"
            }
        ];
    const web3 = new Web3('https://bsc-dataseed.binance.org/');
    const batchSize = 3900;

    const minuteId = new Date().getMinutes();
    console.log(minuteId, 'prices', 'start');
    const allStartTime = process.hrtime();

    const bnbUsdPrice = await getBnbUsdPrice();

    let tokensWithV2PairCount = await Token.countDocuments({ pancakeV2Pair: { $ne: null } });
    const pricesInsertBulk = Price.collection.initializeUnorderedBulkOp();

    let counter = 0;
    let web3Duration = 0;
    while (tokensWithV2PairCount > 0) {
        const tokensWithV2Pair = await Token.find({ pancakeV2Pair: { $ne: null } }).skip(batchSize * counter).limit(batchSize);

        const pairsContracts = [];
        for await (const token of tokensWithV2Pair) {
            const pairContract = await new web3.eth.Contract(pancakePairABI, token.pancakeV2Pair);
            pairsContracts.push(pairContract);
        }

        const reservesBatch = new PromisifyBatchRequest(web3);
        for await (const pairContract of pairsContracts) {
            reservesBatch.add(pairContract.methods.getReserves().call.request);
        }

        const reservesBatchStartTime = process.hrtime();
        const reserves = await reservesBatch.execute();
        web3Duration += parseHrtimeToSeconds(process.hrtime(reservesBatchStartTime));

        for await (const [i, token] of tokensWithV2Pair.entries()) {
            const tokenReserves = reserves[i];
            if (tokenReserves._reserve0 !== '0') {
                const tokenUsdPrice = countTokenPrice(bnbUsdPrice, tokenReserves, token.decimals);
                pricesInsertBulk.insert({ token_id: token._id, value: tokenUsdPrice.toNumber() });
            }
        }

        tokensWithV2PairCount -= batchSize;
        counter++;
    }

    const mongoDbTimeStart = process.hrtime();
    await pricesInsertBulk.execute();
    const mongoDbDuration = parseHrtimeToSeconds(process.hrtime(mongoDbTimeStart));

    const allDuration = parseHrtimeToSeconds(process.hrtime(allStartTime));
    console.log(minuteId, 'prices', 'end', `(all: ${allDuration.toFixed(2)}s, web3: ${web3Duration.toFixed(2)}s, mongoDb: ${mongoDbDuration.toFixed(2)}s)`)
}

db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', async () => {
    console.log('MongoDb connection opened.');
    cron.schedule('* * * * *', pancakeV2PriceFinder);
});
