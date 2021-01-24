require("dotenv").config();
const axios = require("axios");
const Web3 = require("web3");
const BigNumber = require("bignumber.js");
const fs = require("fs");
const _ = require("lodash");
const jsonexport = require("jsonexport");
const POOLABI = require("./ABI/POOL.json");
const VAULTABI = require("./ABI/VAULT.json");
const web3 = new Web3(process.env.INFURAKEY);
BigNumber.config({
  EXPONENTIAL_AT: [-100, 100],
  ROUNDING_MODE: 1,
});
const isSameAddress = (a, b) => {
  return a.toLowerCase() === b.toLowerCase();
};
const mSTONKSPools = [
  {
    name: "mTSLA_UST",
    address: "0x40C34B0E1bb6984810E17474c6B0Bcc6A6B46614",
  },
  {
    name: "mAAPL_UST",
    address: "0xc02d1Da469d68Adc651Dd135d1A7f6b42F4d1A57",
  },
  {
    name: "mAMZN_UST",
    address: "0x8Dc427Cbcc75cAe58dD4f386979Eba6662f5C158",
  },
  {
    name: "mGOOG_UST",
    address: "0xfE83a00DF3A98dE218c08719FAF7e3741b220D0D",
  },
];
const totalLuna = 27364;
// const lunaAddress = "0xd2877702675e6ceb975b4a1dff9fb7baf4c91ea9";
const lunaPerPool = totalLuna / mSTONKSPools.length;

const loadLastReward = () => {
  try {
    return JSON.parse(require("./LastUpdated/last-reward-in.json"));
  } catch {
    return {
      lastBlock: 0,
      lastBlockTimestamp: 0,
      stake: {},
    };
  }
};

const main = async () => {
  const precision = 5;
  let i = 0;
  for (let _pool of mSTONKSPools) {
    const poolContract = new web3.eth.Contract(POOLABI, _pool.address);
    const lpToken = await poolContract.methods.lpToken().call();
    const vaultContract = new web3.eth.Contract(VAULTABI, lpToken);
    mSTONKSPools[i].lpToken = lpToken;
    const balance = await vaultContract.methods.balanceOf(_pool.address).call();
    mSTONKSPools[i].balance = balance;
    i++;
  }

  const { lastBlock, lastBlockTimestamp, stake } = loadLastReward();
  let rewardPool = {};
  let stakeAmount = {};

  const latestBlock = await web3.eth.getBlockNumber();
  const { timestamp: latestBlockTimestamp } = await web3.eth.getBlock(
    latestBlock
  );
  const period = latestBlockTimestamp - lastBlockTimestamp;
  const unitReward = new BigNumber(lunaPerPool).dividedBy(period);

  for (const { address: pool, name, balance, lpToken } of mSTONKSPools) {
    let rewardTimeSum = period;
    rewardPool[pool] = {};
    let prevTimeStamp = lastBlockTimestamp;
    stakeAmount[pool] = stake[pool] || {};

    let stakeSum = new BigNumber(0); // total stake amount
    for (const [_, amount] of Object.entries(stakeAmount[pool])) {
      stakeSum = stakeSum.plus(amount);
    }

    for (let page = 1; ; page++) {
      const apiURL = `https://api.etherscan.io/api?module=account&action=tokentx&contractAddress=${lpToken}&address=${pool}&page=${page}&offset=5000&startblock=${
        lastBlock + 1
      }&endblock=${latestBlock}&sort=asc&apikey=${
        process.env.ETHERSCAN_APIKEY
      }`;
      const {
        data: { result },
      } = await axios.get(apiURL);

      for (const txn of result) {
        const { from, to, value, tokenSymbol, blockNumber } = txn;
        const timeStamp = parseInt(txn.timeStamp);

        if (timeStamp > prevTimeStamp) {
          if (stakeSum.isZero()) {
            rewardTimeSum -= timeStamp - prevTimeStamp;
          } else {
            const reward = unitReward.multipliedBy(timeStamp - prevTimeStamp);

            for (const [address, amount] of Object.entries(stakeAmount[pool])) {
              rewardPool[pool][address] = new BigNumber(
                rewardPool[pool][address] || 0
              ).plus(amount.dividedBy(stakeSum).multipliedBy(reward));
            }
          }
        }

        if (isSameAddress(to, pool) && tokenSymbol === "fUNI-V2") {
          //lp deposit action
          stakeAmount[pool][from] = new BigNumber(
            stakeAmount[pool][from] || 0
          ).plus(value);
          stakeSum = stakeSum.plus(value);
        } else if (isSameAddress(from, pool) && tokenSymbol === "fUNI-V2") {
          //withdraw action
          stakeAmount[pool][to] = new BigNumber(
            stakeAmount[pool][to] || 0
          ).minus(value);
          stakeSum = stakeSum.minus(value);
        }

        prevTimeStamp = timeStamp;
      }

      if (!result.length) {
        break;
      }
    }

    for (const [address, amount] of Object.entries(stakeAmount[pool])) {
      rewardPool[pool][address] = new BigNumber(
        rewardPool[pool][address] || 0
      ).plus(
        amount
          .dividedBy(stakeSum)
          .multipliedBy(
            unitReward.multipliedBy(latestBlockTimestamp - prevTimeStamp)
          )
      );
    }
    for (const [address, amount] of Object.entries(rewardPool[pool])) {
      rewardPool[pool][address] = amount
        .multipliedBy(period)
        .dividedBy(rewardTimeSum);
    }

    console.log("pool: ", pool);
    console.log("latestBlock: ", latestBlock);
    console.log("latestBlockTimestamp: ", latestBlockTimestamp);
    console.log("stakeAmount");
    for (const [address, amount] of Object.entries(stakeAmount[pool])) {
      console.log(
        `address: ${address}, amount: ${web3.utils.fromWei(amount.toFixed(0))}`
      );
    }
    console.log("stakeSum", web3.utils.fromWei(stakeSum.toFixed(0)));

    console.log("rewardPool");
    for (const [address, amount] of Object.entries(rewardPool[pool])) {
      console.log(`address: ${address}, amount: ${amount.toString()}`);
    }

    let rewardPoolSum = new BigNumber(0); // total stake amount
    for (const [_, amount] of Object.entries(rewardPool[pool])) {
      rewardPoolSum = rewardPoolSum.plus(amount);
    }
    console.log("rewardPoolSum", rewardPoolSum.toString());

    let analyze = [],
      multisend = [];
    Object.keys(rewardPool[pool]).forEach((key) => {
      if (!rewardPool[pool][key].isZero()) {
        const percentage = new BigNumber(rewardPool[pool][key])
          .dividedBy(rewardPoolSum)
          .multipliedBy(100);
        analyze.push({
          name,
          pool,
          key,
          deposit: web3.utils.fromWei(stakeAmount[pool][key].toFixed(0)),
          percentage: `${percentage.toFixed(4, 0)}%`,
          reward: rewardPool[pool][key].toString(),
        });
        multisend.push({
          key,
          reward: rewardPool[pool][key].toFixed(precision, 1),
        });
      }
    });

    jsonexport(
      analyze,
      {
        rename: [
          "Pool Name",
          "Pool Address",
          "User Address",
          "Deposit Amount",
          "Share rate",
          "Luna Reward",
        ],
      },
      function (err, csv) {
        if (err) return console.error(err);
        fs.writeFile(
          `Analyze/Rewards-${name}.csv`,
          csv,
          "utf8",
          function (err) {
            if (err) {
              console.log(
                `Some error occured - Rewards-${name}.csv file either not saved or corrupted file saved.`
              );
            } else {
              console.log(`Rewards-${name}.csv saved!`);
            }
          }
        );
      }
    );

    //multisender csv
    jsonexport(multisend, { includeHeaders: false }, function (err, csv) {
      if (err) return console.error(err);
      fs.writeFile(
        `Multisend/Multisend-${name}.csv`,
        csv,
        "utf8",
        function (err) {
          if (err) {
            console.log(
              `Some error occured - Multisend-${name}.csv file either not saved or corrupted file saved.`
            );
          } else {
            console.log(`Multisend-${name}.csv saved!`);
          }
        }
      );
    });
  }

  fs.writeFile(
    "LastUpdated/last-reward-out.json",
    JSON.stringify({
      lastBlock: latestBlock,
      lastBlockTimestamp: latestBlockTimestamp,
      stake: stakeAmount,
    }),
    "utf8",
    function (err) {
      if (err) {
        console.log(
          "Some error occured - last-reward-out.json file either not saved or corrupted file saved."
        );
      } else {
        console.log("last-reward-out.json saved!");
      }
    }
  );
};

main();
