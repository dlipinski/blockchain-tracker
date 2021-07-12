const Web3 = require('web3');
const PromisifyBatchRequest = require('./PromisifyBatchRequest');
const Token = require('./models/token');
const mongoose = require('mongoose');
require('dotenv').config();

const mongoString = `mongodb://${process.env.DB_USERNAME ? process.env.DB_USERNAME + ':' + process.env.DB_PASSWORD + '@' : ''}${process.env.DB_HOST}/${process.env.DB_NAME}`
mongoose.connect(mongoString, { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;

const timestampToFormattedDate = timestamp => {
    const dateO = new Date(timestamp * 1000);
    const hours = "0" + dateO.getHours();
    const minutes = "0" + dateO.getMinutes();
    const seconds = "0" + dateO.getSeconds();
    const date = dateO.toLocaleDateString('de').replaceAll('.', '-');
    return date + ' ' + hours.substr(-2) + ':' + minutes.substr(-2) + ':' + seconds.substr(-2);
}

const processBlock = async blockNumber => {
    const erc20ABI = [
        {
            "constant": true,
            "inputs": [],
            "name": "name",
            "outputs": [
                {
                    "name": "",
                    "type": "string"
                }
            ],
            "payable": false,
            "type": "function"
        },
        {
            "constant": true,
            "inputs": [],
            "name": "totalSupply",
            "outputs": [
                {
                    "name": "",
                    "type": "uint256"
                }
            ],
            "payable": false,
            "type": "function"
        },

        {
            "constant": true,
            "inputs": [],
            "name": "decimals",
            "outputs": [
                {
                    "name": "",
                    "type": "uint256"
                }
            ],
            "payable": false,
            "type": "function"
        },

        {
            "constant": true,
            "inputs": [],
            "name": "symbol",
            "outputs": [
                {
                    "name": "",
                    "type": "string"
                }
            ],
            "payable": false,
            "type": "function"
        },

    ]

    const web3 = new Web3('wss://bsc-ws-node.nariox.org:443');

    let block;
    while (!block) {
        block = await web3.eth.getBlock(blockNumber);
        await new Promise(r => setTimeout(r, 100));
    }
    const blockTimestamp = block.timestamp;

    const receiptsBatch = new PromisifyBatchRequest(web3);
    for (const th of block.transactions) {
        receiptsBatch.add(web3.eth.getTransactionReceipt.request, th);
    }
    const receipts = await receiptsBatch.execute();

    let newTokensAddresses = receipts.filter(r => r).filter(r => r.contractAddress).map(r => r.contractAddress);
    if (newTokensAddresses.length === 0) return;

    const codeBatch = new PromisifyBatchRequest(web3);
    for (const tokenAddress of newTokensAddresses) {
        codeBatch.add(web3.eth.getCode.request, tokenAddress);
    }
    const newTokensCodes = await codeBatch.execute();

    const validNewTokensAddresses = newTokensAddresses.filter((c, i) => newTokensCodes[i] !== '0x' && newTokensCodes[i].length > 300);

    const tokensContracts = [];
    for (const tokenAddress of validNewTokensAddresses) {
        const tokenContract = await new web3.eth.Contract(erc20ABI, tokenAddress);
        tokensContracts.push(tokenContract);
    }

    const tokensData = {};
    for (const tokenContract of tokensContracts) {
        const tokenAddress = tokenContract.options.address;
        try {
            const tokenDataBatch = new PromisifyBatchRequest(web3);
            tokenDataBatch.add(tokenContract.methods.name().call.request);
            tokenDataBatch.add(tokenContract.methods.symbol().call.request);
            tokenDataBatch.add(tokenContract.methods.decimals().call.request);
            tokenDataBatch.add(tokenContract.methods.totalSupply().call.request);
            const [name, symbol, decimals, totalSupply] = await tokenDataBatch.execute();
            tokensData[tokenAddress] = { name, symbol, decimals, totalSupply };
            console.log(tokenAddress, name, symbol);
        } catch (e) {
            console.error('Failed to get name, symbol, decimals or totalSupply: ', tokenAddress)
        }

    }

    const tokensAddresses = Object.keys(tokensData);
    if (tokensAddresses.length === 0) return;
    const newTokensInsertBulk = Token.collection.initializeUnorderedBulkOp();
    tokensAddresses.forEach(tokenAddress => {
        newTokensInsertBulk.insert({ address: tokenAddress, ...tokensData[tokenAddress], created: timestampToFormattedDate(blockTimestamp) });
    });
    await newTokensInsertBulk.execute();
}

const newTokensOnBlockchainTracker = () => {
    const web3Socket = new Web3('wss://bsc-ws-node.nariox.org:443');

    web3Socket.eth.subscribe('newBlockHeaders')
        .on("connected", () => {
            console.log('Web3 socket connection opened')
        })
        .on("data", async (blockHeader) => {
            const { number } = blockHeader;
            console.log('Block', number);
            processBlock(number);
        })
        .on("error", console.error);
}

db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', async () => {
    console.log('MongoDb connection opened.');
    newTokensOnBlockchainTracker();
});